"""Environment-owned configuration for the hosted engine."""

from dataclasses import dataclass
import os


def _required(name: str) -> str:
    value = os.getenv(name)
    if not value:
        raise RuntimeError(f"missing required environment variable {name}")
    return value


@dataclass(frozen=True)
class HostedSettings:
    database_url: str
    redis_url: str
    bucket_name: str
    bucket_endpoint: str
    bucket_access_key_id: str
    bucket_secret_access_key: str
    bucket_region: str = "auto"
    allowed_origins: tuple[str, ...] = ()
    worker_concurrency: int = 2
    replay_url_ttl_seconds: int = 3600
    # Shared secret the terrain service presents as a bearer token. Required by
    # from_env(), so a deployed API is never unauthenticated; tests construct
    # settings directly and may leave it None to run the API open.
    api_token: str | None = None
    # Where the terrain service listens, for batches submitted as a plan id
    # rather than an uploaded payload. Only needed for that path.
    terrain_service_url: str | None = None

    @classmethod
    def from_env(cls) -> "HostedSettings":
        origins = tuple(
            origin.strip()
            for origin in os.getenv("ALLOWED_ORIGINS", "").split(",")
            if origin.strip()
        )
        return cls(
            database_url=_required("DATABASE_URL"),
            redis_url=_required("REDIS_URL"),
            api_token=_required("API_TOKEN"),
            terrain_service_url=(os.getenv("TERRAIN_SERVICE_URL") or "").strip() or None,
            bucket_name=os.getenv("AWS_S3_BUCKET_NAME")
            or _required("BUCKET"),
            bucket_endpoint=os.getenv("AWS_ENDPOINT_URL")
            or _required("BUCKET_ENDPOINT"),
            bucket_access_key_id=_required("AWS_ACCESS_KEY_ID"),
            bucket_secret_access_key=_required("AWS_SECRET_ACCESS_KEY"),
            bucket_region=os.getenv("AWS_DEFAULT_REGION", "auto"),
            allowed_origins=origins,
            worker_concurrency=max(1, int(os.getenv("WORKER_CONCURRENCY", "2"))),
            replay_url_ttl_seconds=max(
                60, int(os.getenv("REPLAY_URL_TTL_SECONDS", "3600"))
            ),
        )
