"""Convert engine execution results into a compact replay log."""

from pathlib import Path

from athena.models import (
    BattlefieldSnapshot,
    ExecutionResult,
    Position,
    ReplayBattlefield,
    ReplayCommunicationGroup,
    ReplayLog,
    ReplayMessage,
    ReplayShot,
    ReplaySoldier,
    ReplayStep,
)


def _sorted_positions(positions: frozenset[Position]) -> tuple[Position, ...]:
    return tuple(
        sorted(
            positions,
            key=lambda position: (position.y, position.x, position.z),
        )
    )


def _replay_soldiers(snapshot: BattlefieldSnapshot) -> tuple[ReplaySoldier, ...]:
    return tuple(
        ReplaySoldier(
            soldier_index=soldier.soldier_index,
            team=soldier.team,
            position=soldier.position,
            survival_status=soldier.survival_status,
        )
        for soldier in snapshot.soldiers
    )


class ReplayRecorder:
    """Accumulate sequential execution results as UI-facing replay steps."""

    def __init__(self, initial_snapshot: BattlefieldSnapshot) -> None:
        self._battlefield = ReplayBattlefield(
            width=initial_snapshot.width,
            height=initial_snapshot.height,
            surface=_sorted_positions(initial_snapshot.surface),
            cover=_sorted_positions(initial_snapshot.cover),
            concealment=_sorted_positions(initial_snapshot.concealment),
            communication_groups=tuple(
                ReplayCommunicationGroup(
                    group_id=group.group_id,
                    name=group.name,
                    team=group.team,
                    member_indices=tuple(
                        soldier.soldier_index
                        for soldier in initial_snapshot.soldiers
                        if group.group_id in soldier.communication_group_ids
                    ),
                )
                for group in initial_snapshot.communication_groups
            ),
        )
        self._steps = [
            ReplayStep(
                step=0,
                soldiers=_replay_soldiers(initial_snapshot),
                shots=(),
                messages=(),
            )
        ]

    @property
    def log(self) -> ReplayLog:
        return ReplayLog(
            battlefield=self._battlefield,
            steps=tuple(self._steps),
        )

    def record(self, result: ExecutionResult) -> ReplayStep:
        """Append one completed tick and return its replay representation."""
        step = ReplayStep(
            step=len(self._steps),
            soldiers=_replay_soldiers(result.after),
            shots=tuple(
                ReplayShot(
                    shooter_index=shot.shooter_index,
                    target_index=shot.target_index,
                    shooter_position=result.before.soldiers[
                        shot.shooter_index
                    ].position,
                    target_position=result.before.soldiers[
                        shot.target_index
                    ].position,
                    hit=shot.hit,
                )
                for shot in result.shot_outcomes
            ),
            messages=tuple(
                ReplayMessage(
                    sender_index=message.sender_index,
                    group_id=message.group_id,
                    content=message.content,
                )
                for message in result.team_messages
            ),
        )
        self._steps.append(step)
        return step

    def save(self, output_path: str | Path) -> None:
        """Write the complete replay log as JSON."""
        path = Path(output_path)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(f"{self.log.model_dump_json(indent=2)}\n", encoding="utf-8")
