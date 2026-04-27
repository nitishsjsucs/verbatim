"""
Cloudflare R2 client for qwerty_mode.

Uses the S3-compatible API via boto3. R2 is only used to store the
original PDF so the frontend viewer can fetch it via a presigned URL.
"""

from __future__ import annotations

import logging
from typing import Optional

from qwerty_mode.config import get_qwerty_config

logger = logging.getLogger(__name__)


def _client():
    import boto3  # imported lazily so qwerty_mode imports don't break setups without boto3
    from botocore.config import Config

    cfg = get_qwerty_config()
    return boto3.client(
        "s3",
        endpoint_url=cfg.r2_endpoint,
        aws_access_key_id=cfg.r2_access_key_id,
        aws_secret_access_key=cfg.r2_secret_access_key,
        region_name="auto",
        config=Config(signature_version="s3v4"),
    )


def upload_pdf(key: str, content: bytes, content_type: str = "application/pdf") -> str:
    cfg = get_qwerty_config()
    client = _client()
    client.put_object(
        Bucket=cfg.r2_bucket,
        Key=key,
        Body=content,
        ContentType=content_type,
    )
    logger.info("[QWERTY][r2] Uploaded %s (%d bytes)", key, len(content))
    return key


def presigned_get_url(key: str, expires_in: int = 3600) -> str:
    cfg = get_qwerty_config()
    client = _client()
    return client.generate_presigned_url(
        "get_object",
        Params={"Bucket": cfg.r2_bucket, "Key": key},
        ExpiresIn=expires_in,
    )


def get_object_bytes(key: str) -> bytes:
    cfg = get_qwerty_config()
    resp = _client().get_object(Bucket=cfg.r2_bucket, Key=key)
    return resp["Body"].read()


def delete_object(key: str) -> None:
    cfg = get_qwerty_config()
    _client().delete_object(Bucket=cfg.r2_bucket, Key=key)
    logger.info("[QWERTY][r2] Deleted %s", key)
