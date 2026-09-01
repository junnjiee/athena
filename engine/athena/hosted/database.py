"""Postgres-backed batch status and reconnectable completion events."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
import json
from typing import Any, Iterable
from uuid import UUID

import asyncpg


SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS simulation_batches (
    id uuid PRIMARY KEY,
    simulation_count integer NOT NULL,
    ticks integer NOT NULL,
    model text,
    payload_key text,
    plan_id text,
    status text NOT NULL DEFAULT 'queued',
    created_at timestamptz NOT NULL DEFAULT now(),
    completed_at timestamptz
);

-- A batch names its scenario one of two ways: an uploaded payload in the bucket,
-- or a plan id the worker pulls from the terrain service. Both columns are
-- nullable so either can be absent; these run on databases created before the
-- plan_id path existed.
ALTER TABLE simulation_batches ADD COLUMN IF NOT EXISTS plan_id text;
ALTER TABLE simulation_batches ALTER COLUMN payload_key DROP NOT NULL;

CREATE TABLE IF NOT EXISTS simulations (
    id uuid PRIMARY KEY,
    batch_id uuid NOT NULL REFERENCES simulation_batches(id) ON DELETE CASCADE,
    simulation_index integer NOT NULL,
    status text NOT NULL DEFAULT 'queued',
    replay_key text,
    error text,
    started_at timestamptz,
    completed_at timestamptz,
    UNIQUE (batch_id, simulation_index)
);

-- Who won, and at what cost. Known when the run ends, so a caller asking only
-- for a win rate never fetches a replay; also what makes a completed batch
-- readable after its event stream has been consumed.
ALTER TABLE simulations ADD COLUMN IF NOT EXISTS outcome jsonb;

CREATE TABLE IF NOT EXISTS simulation_events (
    id bigserial PRIMARY KEY,
    batch_id uuid NOT NULL REFERENCES simulation_batches(id) ON DELETE CASCADE,
    event_type text NOT NULL,
    data jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS simulation_events_batch_cursor
    ON simulation_events(batch_id, id);
"""


@dataclass(frozen=True)
class SimulationJob:
    simulation_id: UUID
    batch_id: UUID
    simulation_index: int
    ticks: int
    model: str | None
    # Exactly one of these is set: an uploaded payload in the bucket, or a plan
    # the worker pulls from the terrain service.
    payload_key: str | None
    plan_id: str | None


@dataclass(frozen=True)
class BatchEvent:
    id: int
    event_type: str
    data: dict[str, Any]
    created_at: datetime


class BatchRepository:
    def __init__(self, pool: asyncpg.Pool) -> None:
        self.pool = pool

    @classmethod
    async def connect(cls, database_url: str) -> "BatchRepository":
        pool = await asyncpg.create_pool(database_url, min_size=1, max_size=5)
        repository = cls(pool)
        await repository.ensure_schema()
        return repository

    async def close(self) -> None:
        await self.pool.close()

    async def ensure_schema(self) -> None:
        async with self.pool.acquire() as connection:
            await connection.execute(SCHEMA_SQL)

    async def create_batch(
        self,
        *,
        batch_id: UUID,
        simulation_ids: Iterable[UUID],
        ticks: int,
        model: str | None,
        payload_key: str | None = None,
        plan_id: str | None = None,
    ) -> None:
        simulation_ids = tuple(simulation_ids)
        async with self.pool.acquire() as connection:
            async with connection.transaction():
                await connection.execute(
                    """
                    INSERT INTO simulation_batches
                        (id, simulation_count, ticks, model, payload_key, plan_id)
                    VALUES ($1, $2, $3, $4, $5, $6)
                    """,
                    batch_id,
                    len(simulation_ids),
                    ticks,
                    model,
                    payload_key,
                    plan_id,
                )
                await connection.executemany(
                    """
                    INSERT INTO simulations
                        (id, batch_id, simulation_index)
                    VALUES ($1, $2, $3)
                    """,
                    [
                        (simulation_id, batch_id, index)
                        for index, simulation_id in enumerate(simulation_ids)
                    ],
                )
                await self._insert_event(
                    connection,
                    batch_id,
                    "batch.queued",
                    {
                        "batchId": str(batch_id),
                        "simulationCount": len(simulation_ids),
                    },
                )

    async def fail_batch_enqueue(self, batch_id: UUID, error: str) -> None:
        async with self.pool.acquire() as connection:
            async with connection.transaction():
                await connection.execute(
                    """
                    UPDATE simulations SET status = 'failed', error = $2,
                        completed_at = now()
                    WHERE batch_id = $1 AND status = 'queued'
                    """,
                    batch_id,
                    error,
                )
                await connection.execute(
                    """
                    UPDATE simulation_batches SET status = 'failed',
                        completed_at = now()
                    WHERE id = $1
                    """,
                    batch_id,
                )
                await self._insert_event(
                    connection,
                    batch_id,
                    "batch.completed",
                    {"batchId": str(batch_id), "status": "failed"},
                )

    async def claim_simulation(self, simulation_id: UUID) -> SimulationJob | None:
        row = await self.pool.fetchrow(
            """
            UPDATE simulations AS simulation
            SET status = 'running', started_at = now()
            FROM simulation_batches AS batch
            WHERE simulation.id = $1
              AND simulation.batch_id = batch.id
              AND simulation.status IN ('queued', 'running')
            RETURNING simulation.id, simulation.batch_id,
                simulation.simulation_index, batch.ticks, batch.model,
                batch.payload_key, batch.plan_id
            """,
            simulation_id,
        )
        if row is None:
            return None
        return SimulationJob(
            simulation_id=row["id"],
            batch_id=row["batch_id"],
            simulation_index=row["simulation_index"],
            ticks=row["ticks"],
            model=row["model"],
            payload_key=row["payload_key"],
            plan_id=row["plan_id"],
        )

    async def complete_simulation(
        self,
        job: SimulationJob,
        replay_key: str,
        outcome: dict[str, Any] | None = None,
    ) -> None:
        await self._finish_simulation(
            job,
            replay_key=replay_key,
            error=None,
            outcome=outcome,
        )

    async def fail_simulation(self, job: SimulationJob, error: str) -> None:
        await self._finish_simulation(job, replay_key=None, error=error)

    async def _finish_simulation(
        self,
        job: SimulationJob,
        *,
        replay_key: str | None,
        error: str | None,
        outcome: dict[str, Any] | None = None,
    ) -> None:
        status = "completed" if error is None else "failed"
        async with self.pool.acquire() as connection:
            async with connection.transaction():
                await connection.fetchrow(
                    "SELECT id FROM simulation_batches WHERE id = $1 FOR UPDATE",
                    job.batch_id,
                )
                update_result = await connection.execute(
                    """
                    UPDATE simulations
                    SET status = $2, replay_key = $3, error = $4, outcome = $5,
                        completed_at = now()
                    WHERE id = $1 AND status = 'running'
                    """,
                    job.simulation_id,
                    status,
                    replay_key,
                    error,
                    json.dumps(outcome) if outcome is not None else None,
                )
                if update_result != "UPDATE 1":
                    return
                data: dict[str, Any] = {
                    "simulationId": str(job.simulation_id),
                    "simulationIndex": job.simulation_index,
                }
                if replay_key is not None:
                    data["replayKey"] = replay_key
                if outcome is not None:
                    data["outcome"] = outcome
                if error is not None:
                    data["error"] = error
                await self._insert_event(
                    connection,
                    job.batch_id,
                    f"simulation.{status}",
                    data,
                )

                counts = await connection.fetchrow(
                    """
                    SELECT
                        count(*) FILTER (WHERE status = 'completed') AS completed,
                        count(*) FILTER (WHERE status = 'failed') AS failed,
                        count(*) FILTER (WHERE status IN ('queued', 'running')) AS active
                    FROM simulations WHERE batch_id = $1
                    """,
                    job.batch_id,
                )
                if counts["active"] == 0:
                    batch_status = "completed" if counts["failed"] == 0 else "failed"
                    await connection.execute(
                        """
                        UPDATE simulation_batches
                        SET status = $2, completed_at = now()
                        WHERE id = $1
                        """,
                        job.batch_id,
                        batch_status,
                    )
                    await self._insert_event(
                        connection,
                        job.batch_id,
                        "batch.completed",
                        {
                            "batchId": str(job.batch_id),
                            "status": batch_status,
                            "completed": counts["completed"],
                            "failed": counts["failed"],
                        },
                    )

    async def record_progress(
        self,
        batch_id: UUID,
        data: dict[str, Any],
    ) -> None:
        """Append a progress event for a run in flight.

        Ordinary event, same table and same cursor as the rest, so the existing
        stream carries it and a client that does not know the type ignores it.
        Callers throttle: a tick is fast and a batch is large, so writing one
        row per tick per simulation would be most of what the database does.
        """
        async with self.pool.acquire() as connection:
            await self._insert_event(connection, batch_id, "simulation.progress", data)

    async def events_after(
        self,
        batch_id: UUID,
        cursor: int,
    ) -> list[BatchEvent]:
        rows = await self.pool.fetch(
            """
            SELECT id, event_type, data, created_at
            FROM simulation_events
            WHERE batch_id = $1 AND id > $2
            ORDER BY id
            """,
            batch_id,
            cursor,
        )
        return [
            BatchEvent(
                id=row["id"],
                event_type=row["event_type"],
                data=(
                    json.loads(row["data"])
                    if isinstance(row["data"], str)
                    else dict(row["data"])
                ),
                created_at=row["created_at"],
            )
            for row in rows
        ]

    async def list_batches(self, limit: int, offset: int) -> list[dict[str, Any]]:
        """Recent batches, newest first, with their per-status run counts.

        Exists so a completed batch is still readable after its event stream has
        been consumed -- without this the results live only in whichever browser
        tab happened to be open while the batch ran.
        """
        rows = await self.pool.fetch(
            """
            SELECT b.id, b.simulation_count, b.ticks, b.model, b.plan_id,
                   b.status, b.created_at, b.completed_at,
                   count(s.*) FILTER (WHERE s.status = 'completed') AS completed,
                   count(s.*) FILTER (WHERE s.status = 'failed') AS failed
            FROM simulation_batches b
            LEFT JOIN simulations s ON s.batch_id = b.id
            GROUP BY b.id
            ORDER BY b.created_at DESC
            LIMIT $1 OFFSET $2
            """,
            limit,
            offset,
        )
        return [dict(row) for row in rows]

    async def batch_detail(self, batch_id: UUID) -> dict[str, Any] | None:
        """One batch and every run in it, outcomes included."""
        batch = await self.pool.fetchrow(
            """
            SELECT id, simulation_count, ticks, model, plan_id, status,
                   created_at, completed_at
            FROM simulation_batches WHERE id = $1
            """,
            batch_id,
        )
        if batch is None:
            return None

        runs = await self.pool.fetch(
            """
            SELECT id, simulation_index, status, replay_key, outcome, error,
                   started_at, completed_at
            FROM simulations WHERE batch_id = $1 ORDER BY simulation_index
            """,
            batch_id,
        )
        return {
            "batch": dict(batch),
            "runs": [
                dict(row)
                | {
                    "outcome": (
                        json.loads(row["outcome"])
                        if isinstance(row["outcome"], str)
                        else row["outcome"]
                    )
                }
                for row in runs
            ],
        }

    async def batch_status(self, batch_id: UUID) -> str | None:
        return await self.pool.fetchval(
            "SELECT status FROM simulation_batches WHERE id = $1",
            batch_id,
        )

    @staticmethod
    async def _insert_event(
        connection: asyncpg.Connection,
        batch_id: UUID,
        event_type: str,
        data: dict[str, Any],
    ) -> None:
        await connection.execute(
            """
            INSERT INTO simulation_events (batch_id, event_type, data)
            VALUES ($1, $2, $3::jsonb)
            """,
            batch_id,
            event_type,
            json.dumps(data),
        )
