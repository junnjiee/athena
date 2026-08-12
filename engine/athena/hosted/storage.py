"""Private object storage for submitted payloads and replay logs."""

import asyncio
from pathlib import Path

import boto3

from athena.hosted.config import HostedSettings


class BucketStorage:
    def __init__(self, settings: HostedSettings) -> None:
        self.bucket_name = settings.bucket_name
        self.replay_url_ttl_seconds = settings.replay_url_ttl_seconds
        self.client = boto3.client(
            "s3",
            endpoint_url=settings.bucket_endpoint,
            region_name=settings.bucket_region,
            aws_access_key_id=settings.bucket_access_key_id,
            aws_secret_access_key=settings.bucket_secret_access_key,
        )

    async def upload_file(
        self,
        path: Path,
        key: str,
        *,
        content_type: str,
        content_encoding: str | None = None,
    ) -> None:
        extra_args = {"ContentType": content_type}
        if content_encoding is not None:
            extra_args["ContentEncoding"] = content_encoding
        await asyncio.to_thread(
            self.client.upload_file,
            str(path),
            self.bucket_name,
            key,
            ExtraArgs=extra_args,
        )

    async def put_bytes(
        self,
        data: bytes,
        key: str,
        *,
        content_type: str,
        content_encoding: str | None = None,
    ) -> None:
        kwargs = {
            "Bucket": self.bucket_name,
            "Key": key,
            "Body": data,
            "ContentType": content_type,
        }
        if content_encoding is not None:
            kwargs["ContentEncoding"] = content_encoding
        await asyncio.to_thread(self.client.put_object, **kwargs)

    async def download_file(self, key: str, path: Path) -> None:
        await asyncio.to_thread(
            self.client.download_file,
            self.bucket_name,
            key,
            str(path),
        )

    def presigned_get_url(self, key: str) -> str:
        return self.client.generate_presigned_url(
            "get_object",
            Params={"Bucket": self.bucket_name, "Key": key},
            ExpiresIn=self.replay_url_ttl_seconds,
        )
