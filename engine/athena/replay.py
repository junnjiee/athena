"""Convert engine execution results into a compact replay log."""

from pathlib import Path

from athena.models import (
    BattlefieldSnapshot,
    ExecutionResult,
    Position,
    ReplayBattlefield,
    ReplayLog,
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
        )
        self._steps = [
            ReplayStep(
                step=0,
                soldiers=_replay_soldiers(initial_snapshot),
                shots=(),
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
        )
        self._steps.append(step)
        return step

    def save(self, output_path: str | Path) -> None:
        """Write the complete replay log as JSON."""
        path = Path(output_path)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(f"{self.log.model_dump_json(indent=2)}\n", encoding="utf-8")
