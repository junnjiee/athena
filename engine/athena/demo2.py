"""Hill-defense demo: six Blue attackers against four Red defenders."""

import argparse
import asyncio
import sys
from functools import partial
from pathlib import Path
from shutil import get_terminal_size

from dotenv import load_dotenv

from athena.agent import choose_action
from athena.demo import (
    ELEVATION_COLORS,
    OLLAMA_PREFIX,
    both_teams_have_living_soldiers,
    render_demo_frame as render_verbose_demo_frame,
    soldier_symbol,
)
from athena.loop import ActionChooser, LoopEngine
from athena.models import (
    ActionValidationResult,
    AgentContext,
    ChosenTurn,
    CommunicationGroup,
    ExecutionResult,
    HoldAction,
    MoveAction,
    ObservedSoldier,
    Position,
    ShootAction,
    SoldierSnapshot,
    SurvivalState,
    Team,
    VisibilityObservation,
)
from athena.params import (
    COMMUNICATION_HISTORY_LIMIT,
    MAX_ACTION_ATTEMPTS,
    VISIBILITY_HISTORY_LIMIT,
)
from athena.replay import ReplayRecorder
from athena.resolvers.movement import MovementResolver
from athena.resolvers.vision import VisionResolver
from athena.world_state import Battlefield, Soldier

WIDTH = 17
HEIGHT = 15
HILL_CENTER_X = 8
HILL_CENTER_Y = 4
HILL_SUMMIT_ELEVATION = 3
CONCEALMENT_HIDE_PROBABILITY = 1.0
FOOT_CONCEALMENT_CELLS = frozenset(
    (x, y)
    for x in (*range(4, 7), *range(10, 13))
    for y in range(8, 11)
)

_DIRECTION_ABBREVIATIONS = {
    "north": "N",
    "northeast": "NE",
    "east": "E",
    "southeast": "SE",
    "south": "S",
    "southwest": "SW",
    "west": "W",
    "northwest": "NW",
}
_GROUP_ABBREVIATIONS = {
    "blue-team": "BT",
    "blue-left": "BL",
    "blue-right": "BR",
    "red-team": "RT",
}
RED_PATROL_ROUTES = {
    6: ((7, 3, 3), (8, 3, 3)),
    7: ((9, 3, 3), (9, 4, 3)),
    8: ((7, 5, 3), (7, 4, 3)),
    9: ((9, 5, 3), (8, 5, 3)),
}

BLUE_TEAM_OBJECTIVES = (
    "\n- You are Blue. All six Blue soldiers begin together at the southern "
    "bottom of the hill and must split into two three-soldier assault elements."
    "\n- Your communication_groups identify your assignment. Members of "
    "blue-left must separate toward the west side of x=8 and attack up the "
    "western flank through the concealed corridor at x=4..6. Members of "
    "blue-right must separate toward the east side of x=8 and use the "
    "concealed corridor at x=10..12."
    "\n- Move north through concealment at y=10..8. Each soldier must occupy a "
    "distinct staging cell at y=8 in its assigned corridor. Do not leave "
    "concealment or start climbing the hill while staging."
    "\n- Once in position, broadcast exactly one READY at (x,y,z) report on your "
    "assigned blue-left or blue-right group, using your actual position. Then "
    "hold in concealment."
    "\n- If you observe a friendly casualty in your assigned flank, and that exact "
    "casualty position has not already been reported in your element's "
    "communication_history, broadcast CASUALTY at (x,y,z) on your blue-left "
    "or blue-right group. Count duplicate reports of one position only once."
    "\n- Before launch, use blue-left or blue-right for readiness, casualty, and "
    "element coordination. Only flank commanders use blue-team before launch. "
    "After launch, stay in your assigned lane, maintain spacing, and do not "
    "obstruct the other element."
    "\n- Engage visible living Red defenders. Never target a Blue soldier. If "
    "you have no useful legal movement or shot, hold position."
    "\n- Use blue-left or blue-right for element coordination and blue-team "
    "for information useful to both elements."
)

BLUE_MAIN_COMMANDER_OBJECTIVES = (
    "\n- You are Blue soldier 0, the overall assault commander and left-flank "
    "commander. Only you may authorize the attack."
    "\n- Account for the three original left-flank soldiers using blue-left "
    "messages. Count unique READY sender_index values plus unique CASUALTY "
    "positions. If a casualty position matches an earlier READY position, count "
    "that soldier once, not twice."
    "\n- When all three left-flank soldiers are accounted for and you receive a "
    "RIGHT FORCE READY report from sender_index 3 on blue-team, choose hold and "
    "broadcast exactly PUSH NOW on blue-team. Do not move on the command tick, "
    "and send PUSH NOW only once."
    "\n- Surviving-force contingency: after your left flank is accounted for, if "
    "you hold for three consecutive ticks without a RIGHT FORCE READY report, "
    "choose hold and broadcast PUSH NOW anyway."
    "\n- On the next tick, after your own PUSH NOW from sender_index 0 appears "
    "in communication_history, leave concealment and attack uphill."
)

BLUE_RIGHT_COMMANDER_OBJECTIVES = (
    "\n- You are Blue soldier 3, the right-flank commander under Blue soldier 0. "
    "You may report flank readiness but must never broadcast PUSH NOW."
    "\n- Account for the three original right-flank soldiers using blue-right "
    "messages. Count unique READY sender_index values plus unique CASUALTY "
    "positions. If a casualty position matches an earlier READY position, count "
    "that soldier once, not twice."
    "\n- When all three right-flank soldiers are accounted for, choose hold and "
    "broadcast exactly RIGHT FORCE READY: N ready, M casualties on blue-team, "
    "replacing N and M with your counts. Send this report only once."
    "\n- Surviving-force contingency: after sending your own READY report, if you "
    "hold for three consecutive ticks without accounting for all three soldiers, "
    "send RIGHT FORCE READY with the strength you can account for."
    "\n- After reporting, hold until PUSH NOW from sender_index 0 appears in "
    "communication_history. Then attack uphill immediately."
)

BLUE_SUBORDINATE_OBJECTIVES = (
    "\n- Blue soldier 0 is the overall assault commander and Blue soldier 3 is "
    "the right-flank commander. You must never broadcast PUSH NOW or RIGHT "
    "FORCE READY."
    "\n- After sending your readiness report, hold in concealment until "
    "communication_history contains the exact message PUSH NOW from "
    "sender_index 0 on blue-team."
    "\n- On the first tick when that command is present, leave concealment and "
    "attack uphill immediately."
)

RED_TEAM_OBJECTIVES = (
    "\n- HARD MOVEMENT BOUNDARY: you may occupy only your two assigned patrol "
    "positions at the summit. Never leave them, even to pursue an attacker or "
    "obtain a better shot. Leaving your sector is mission failure."
    "\n- If you see a living Blue attacker, stop patrolling, shoot it, and use "
    "red-team to report the contact and its position."
    "\n- If no living Blue attacker is visible, patrol to the other cell in your "
    "assigned sector. Hold only when that move is blocked."
    "\n- Never enter another defender's patrol sector. Use red-team to coordinate "
    "defensive fire."
)


def _team_objectives_for(
    soldier_index: int,
    soldier: Soldier,
) -> str:
    if soldier.team == Team.BLUE:
        if soldier_index == 0:
            role_objectives = BLUE_MAIN_COMMANDER_OBJECTIVES
        elif soldier_index == 3:
            role_objectives = BLUE_RIGHT_COMMANDER_OBJECTIVES
        else:
            role_objectives = BLUE_SUBORDINATE_OBJECTIVES
        return (
            BLUE_TEAM_OBJECTIVES
            + f"\n- Your soldier identity is Blue {soldier_index}."
            + role_objectives
        )

    first_position, second_position = RED_PATROL_ROUTES[soldier_index]
    return (
        RED_TEAM_OBJECTIVES
        + f"\n- Your soldier identity is Red {soldier_index}. Your patrol route is "
        f"{first_position} <-> {second_position}. Move only between these exact "
        "positions."
    )


class HillAssaultMovementResolver(MovementResolver):
    """Enforce Red patrol routes without changing general engine movement."""

    def validate_move_action(
        self,
        battlefield: Battlefield,
        soldier: Soldier,
        action: MoveAction,
    ) -> ActionValidationResult:
        validation = super().validate_move_action(battlefield, soldier, action)
        if not validation.valid or soldier.team != Team.RED:
            return validation

        soldier_index = next(
            index
            for index, battlefield_soldier in enumerate(battlefield.soldiers)
            if battlefield_soldier is soldier
        )
        destination = self.resolve_move_position(battlefield, soldier, action)
        allowed_positions = {
            Position(x=x, y=y, z=z)
            for x, y, z in RED_PATROL_ROUTES[soldier_index]
        }
        if destination not in allowed_positions:
            return ActionValidationResult.rejected(
                "Destination is outside your assigned summit patrol sector."
            )
        return validation


def _compact_live_frame(
    label: str,
    battlefield: Battlefield,
    observations: list[ObservedSoldier],
    execution_result: ExecutionResult | None,
    terminal_columns: int,
) -> str:
    lines = [label]
    map_lines: list[str] = []
    for y in range(battlefield.height):
        row: list[str] = []
        for x in range(battlefield.width):
            position = battlefield.position_at(x, y)
            if position is None:
                raise RuntimeError(f"battlefield surface missing position at {(x, y)}")

            soldiers = [
                soldier
                for soldier in battlefield.soldiers
                if soldier.position == position
            ]
            if len(soldiers) > 1:
                symbol = "*"
            elif len(soldiers) == 1:
                symbol = soldier_symbol(soldiers[0])
            elif position in battlefield.cover:
                symbol = "#"
            elif position in battlefield.concealment:
                symbol = "!"
            else:
                symbol = "."

            if color := ELEVATION_COLORS.get(position.z):
                symbol = f"\033[38;5;{color}m{symbol}\033[0m"
            row.append(symbol)
        map_lines.append(" ".join(row))

    panel_lines = _agent_panel_lines(
        battlefield,
        observations,
        execution_result,
    )
    map_width = battlefield.width * 2 - 1
    panel_width = terminal_columns - map_width - 3
    for row_index, map_line in enumerate(map_lines):
        if panel_width > 0 and row_index < len(panel_lines):
            panel_line = _truncate(panel_lines[row_index], panel_width)
            lines.append(f"{map_line}   {panel_line}")
        else:
            lines.append(map_line)

    lines.append(
        "B/R=living b/r=casualty x=dead #=cover !=concealment *=multiple"
    )
    team_counts: list[str] = []
    for team in (Team.BLUE, Team.RED):
        soldiers = [
            soldier for soldier in battlefield.soldiers if soldier.team == team
        ]
        alive = sum(
            soldier.survival_status == SurvivalState.ALIVE for soldier in soldiers
        )
        casualties = sum(
            soldier.survival_status == SurvivalState.CASUALTY
            for soldier in soldiers
        )
        dead = sum(
            soldier.survival_status == SurvivalState.DEAD for soldier in soldiers
        )
        team_counts.append(
            f"{team.value.title()} A{alive} C{casualties} D{dead}"
        )
    lines.append(" | ".join(team_counts))

    if execution_result is None:
        lines.append("Last tick: waiting for agents")
    else:
        submitted_moves = sum(
            isinstance(action, MoveAction) for action in execution_result.actions
        )
        accepted_moves = sum(
            before.position != after.position
            for before, after in zip(
                execution_result.before.soldiers,
                execution_result.after.soldiers,
            )
        )
        holds = sum(
            isinstance(action, HoldAction) for action in execution_result.actions
        )
        shots = sum(
            isinstance(action, ShootAction) for action in execution_result.actions
        )
        hits = sum(outcome.hit for outcome in execution_result.shot_outcomes)
        lines.append(
            f"Last: moves {accepted_moves}/{submitted_moves}, holds {holds}, "
            f"hits {hits}/{shots}, messages {len(execution_result.team_messages)}"
        )

    return "\n".join(lines) + "\n"


def _agent_panel_lines(
    battlefield: Battlefield,
    observations: list[ObservedSoldier],
    execution_result: ExecutionResult | None,
) -> list[str]:
    if execution_result is None:
        agent_states = list(enumerate(battlefield.soldiers))
        tick_observations: tuple[ObservedSoldier | VisibilityObservation, ...] = tuple(
            observations
        )
        actions = (None,) * len(agent_states)
        messages_by_sender = {}
        header = "ID action | V: visible IDs | C: comms"
    else:
        agent_states = [
            (snapshot.soldier_index, snapshot)
            for snapshot in execution_result.before.soldiers
        ]
        tick_observations = execution_result.observations
        actions = execution_result.actions
        messages_by_sender = {
            message.sender_index: message
            for message in execution_result.team_messages
        }
        header = "ID action/result | V: pre-action view | C: comms"

    lines = [header]
    for soldier_index, soldier_state in agent_states:
        agent_id = f"{soldier_state.team.value[0].upper()}{soldier_index}"
        action_text = _action_text(
            soldier_index,
            actions[soldier_index],
            execution_result,
        )
        visible_ids = _visible_agent_ids(
            tick_observations[soldier_index],
            agent_states,
        )
        line = f"{agent_id} {action_text} | V:{visible_ids}"
        if message := messages_by_sender.get(soldier_index):
            group = _GROUP_ABBREVIATIONS.get(message.group_id, message.group_id)
            content = " ".join(message.content.split())
            line += f" | C:{group} {content}"
        lines.append(line)
    return lines


def _visible_agent_ids(
    observation: ObservedSoldier | VisibilityObservation,
    agent_states: list[tuple[int, Soldier | SoldierSnapshot]],
) -> str:
    visible_ids: list[str] = []
    for visible in observation.visible_soldiers:
        visible_ids.extend(
            str(soldier_index)
            for soldier_index, soldier_state in agent_states
            if soldier_state.team == visible.team
            and soldier_state.position == visible.position
            and soldier_state.survival_status == visible.survival_status
        )
    return ",".join(visible_ids) or "-"


def _action_text(
    soldier_index: int,
    action: HoldAction | MoveAction | ShootAction | None,
    execution_result: ExecutionResult | None,
) -> str:
    if execution_result is None:
        return "waiting"
    if action is None:
        return "none"
    if isinstance(action, HoldAction):
        return "hold"
    if isinstance(action, MoveAction):
        direction = _DIRECTION_ABBREVIATIONS[action.direction.value]
        moved = (
            execution_result.before.soldiers[soldier_index].position
            != execution_result.after.soldiers[soldier_index].position
        )
        return f"move {direction} {'ok' if moved else 'rejected'}"

    target_ids = [
        snapshot.soldier_index
        for snapshot in execution_result.before.soldiers
        if snapshot.position == action.target_position
    ]
    target = str(target_ids[0]) if len(target_ids) == 1 else "?"
    outcome = next(
        (
            shot
            for shot in execution_result.shot_outcomes
            if shot.shooter_index == soldier_index
        ),
        None,
    )
    result = "invalid" if outcome is None else "hit" if outcome.hit else "miss"
    return f"shoot {target} {result}"


def _truncate(text: str, width: int) -> str:
    if len(text) <= width:
        return text
    if width <= 1:
        return "…"[:width]
    return text[: width - 1] + "…"


def render_demo_frame(
    label: str,
    battlefield: Battlefield,
    observations: list[ObservedSoldier],
    execution_result: ExecutionResult | None = None,
) -> None:
    """Use a bounded live frame while retaining verbose redirected output."""
    if not sys.stdout.isatty():
        render_verbose_demo_frame(
            label,
            battlefield,
            observations,
            execution_result=execution_result,
        )
        return

    frame = _compact_live_frame(
        label,
        battlefield,
        observations,
        execution_result,
        terminal_columns=get_terminal_size(fallback=(80, 24)).columns,
    )
    sys.stdout.write(f"\033[H\033[2J{frame}")
    sys.stdout.flush()


def _hill_elevation(x: int, y: int) -> int:
    """Return a three-level hill with a 3x3 summit and one-level contours."""
    distance_from_summit = max(
        0,
        abs(x - HILL_CENTER_X) - 1,
        abs(y - HILL_CENTER_Y) - 1,
    )
    return max(0, HILL_SUMMIT_ELEVATION - distance_from_summit)


def build_battlefield() -> Battlefield:
    surface = {
        Position(x=x, y=y, z=_hill_elevation(x, y))
        for x in range(WIDTH)
        for y in range(HEIGHT)
    }
    surface_by_xy = {(position.x, position.y): position for position in surface}

    def ground(x: int, y: int) -> Position:
        return surface_by_xy[(x, y)]

    blue_starts = (
        ((7, 12), "blue-left"),
        ((8, 12), "blue-left"),
        ((7, 13), "blue-left"),
        ((9, 12), "blue-right"),
        ((8, 13), "blue-right"),
        ((9, 13), "blue-right"),
    )
    blue_soldiers = [
        Soldier(
            team=Team.BLUE,
            position=ground(x, y),
            vision_range=6,
            communication_group_ids={"blue-team", element_group},
        )
        for (x, y), element_group in blue_starts
    ]
    red_soldiers = [
        Soldier(
            team=Team.RED,
            position=ground(x, y),
            vision_range=6,
            communication_group_ids={"red-team"},
        )
        for x, y in ((7, 3), (9, 3), (7, 5), (9, 5))
    ]

    concealment = {
        ground(x, y) for x, y in FOOT_CONCEALMENT_CELLS
    }
    concealment.update({ground(5, 6), ground(11, 6)})

    return Battlefield(
        width=WIDTH,
        height=HEIGHT,
        soldiers=[*blue_soldiers, *red_soldiers],
        surface=surface,
        cover={
            ground(5, 7),
            ground(11, 7),
            ground(6, 6),
            ground(10, 6),
        },
        concealment=concealment,
        communication_groups=[
            CommunicationGroup(
                group_id="blue-team",
                name="Blue team",
                team=Team.BLUE,
            ),
            CommunicationGroup(
                group_id="blue-left",
                name="Blue left assault element",
                team=Team.BLUE,
            ),
            CommunicationGroup(
                group_id="blue-right",
                name="Blue right assault element",
                team=Team.BLUE,
            ),
            CommunicationGroup(
                group_id="red-team",
                name="Red summit defenders",
                team=Team.RED,
            ),
        ],
    )


def build_action_chooser(model_spec: str | None) -> ActionChooser:
    """Select an OpenRouter model and inject orders for each soldier's team."""
    if model_spec is not None and model_spec.startswith(OLLAMA_PREFIX):
        raise ValueError("demo2 supports OpenRouter models only")

    if model_spec is None:
        print("[athena] agent: OpenRouter (default hosted model)", file=sys.stderr)
        hosted_chooser = choose_action
    else:
        print(f"[athena] agent: OpenRouter model '{model_spec}'", file=sys.stderr)
        hosted_chooser = partial(choose_action, model=model_spec)

    async def choose_with_team_orders(
        agent_context: AgentContext,
        battlefield: Battlefield,
        soldier: Soldier,
        movement_resolver: MovementResolver,
        max_attempts: int = MAX_ACTION_ATTEMPTS,
        visibility_history_limit: int = VISIBILITY_HISTORY_LIMIT,
        communication_history_limit: int = COMMUNICATION_HISTORY_LIMIT,
    ) -> ChosenTurn | None:
        soldier_index = next(
            index
            for index, battlefield_soldier in enumerate(battlefield.soldiers)
            if battlefield_soldier is soldier
        )
        team_objectives = _team_objectives_for(soldier_index, soldier)
        return await hosted_chooser(
            agent_context=agent_context,
            battlefield=battlefield,
            soldier=soldier,
            movement_resolver=movement_resolver,
            max_attempts=max_attempts,
            visibility_history_limit=visibility_history_limit,
            communication_history_limit=communication_history_limit,
            team_objectives=team_objectives,
        )

    return choose_with_team_orders


async def run_demo(
    model_spec: str | None = None,
    ticks: int = 60,
    replay_log_path: str | Path | None = None,
) -> None:
    load_dotenv()
    battlefield = build_battlefield()
    loop = LoopEngine(
        battlefield=battlefield,
        vision_resolver=VisionResolver(
            concealment_hide_probability=CONCEALMENT_HIDE_PROBABILITY
        ),
        movement_resolver=HillAssaultMovementResolver(),
        action_chooser=build_action_chooser(model_spec),
    )
    replay_recorder = (
        ReplayRecorder(battlefield.snapshot())
        if replay_log_path is not None
        else None
    )

    try:
        initial_label = (
            "Hill assault - running tick 1 (waiting for agents)"
            if ticks > 0
            else "Hill assault - initial state"
        )
        render_demo_frame(
            initial_label,
            battlefield,
            loop.observed_soldiers_map(),
        )
        for tick_index in range(ticks):
            result = await loop.tick()
            if replay_recorder is not None:
                replay_recorder.record(result)
            completed_tick = tick_index + 1
            battle_finished = not both_teams_have_living_soldiers(battlefield)
            reached_tick_limit = completed_tick == ticks

            if battle_finished:
                label = f"After tick {completed_tick} - battle finished"
            elif reached_tick_limit:
                label = f"After tick {completed_tick} - tick limit reached"
            else:
                label = (
                    f"After tick {completed_tick} - running tick "
                    f"{completed_tick + 1} (waiting for agents)"
                )

            render_demo_frame(
                label,
                battlefield,
                loop.observed_soldiers_map(),
                execution_result=result,
            )
            if battle_finished:
                break
    finally:
        if replay_recorder is not None and replay_log_path is not None:
            replay_recorder.save(replay_log_path)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Run the Athena hill-assault demo simulation."
    )
    parser.add_argument("--model", default=None)
    parser.add_argument(
        "--ticks",
        type=int,
        default=60,
        help="maximum simulation ticks to run (default: 60)",
    )
    parser.add_argument(
        "--replay-log",
        type=Path,
        default=None,
        help="write result-only replay JSON to this path",
    )
    args = parser.parse_args()
    try:
        asyncio.run(
            run_demo(
                model_spec=args.model,
                ticks=args.ticks,
                replay_log_path=args.replay_log,
            )
        )
    except ValueError as exc:
        raise SystemExit(f"error: {exc}")


if __name__ == "__main__":
    main()
