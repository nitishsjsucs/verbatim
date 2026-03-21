"""
Redis caching layer for GOVINDA V2 — supports actionables, approved-by-team, etc.

Falls back to in-process cache if Redis is unavailable.
"""

import logging
import os
import json
from typing import Any, Optional, Callable
from datetime import datetime, timedelta

logger = logging.getLogger(__name__)

# Try to import redis; if unavailable, use in-process cache
try:
    import redis
    REDIS_AVAILABLE = True
except ImportError:
    REDIS_AVAILABLE = False
    logger.warning("redis-py not installed; using in-process cache (NOT recommended for production)")


class CacheManager:
    """Unified cache interface (Redis or in-process)."""

    def __init__(self):
        self.redis_client: Optional[redis.Redis] = None
        self.in_process_cache: dict = {}  # {key: (value, expiry_time)}
        self._init_redis()

    def _init_redis(self):
        """Initialize Redis connection if available and configured."""
        if not REDIS_AVAILABLE:
            logger.info("Redis not available; using in-process cache")
            return

        redis_url = os.getenv("REDIS_URL", "redis://localhost:6379/0")
        try:
            self.redis_client = redis.from_url(redis_url, decode_responses=True)
            self.redis_client.ping()
            logger.info(f"✓ Connected to Redis: {redis_url}")
        except Exception as e:
            logger.warning(f"Failed to connect to Redis ({redis_url}): {e}. Falling back to in-process cache.")
            self.redis_client = None

    def set(self, key: str, value: Any, ttl_seconds: int = 300) -> None:
        """Set a cache entry with TTL (default 5 min)."""
        if self.redis_client:
            try:
                serialized = json.dumps(value)
                self.redis_client.setex(key, ttl_seconds, serialized)
                logger.debug(f"Cache SET (Redis): {key} (TTL: {ttl_seconds}s)")
            except Exception as e:
                logger.warning(f"Redis SET failed for {key}: {e}")
        else:
            self.in_process_cache[key] = (value, datetime.now() + timedelta(seconds=ttl_seconds))
            logger.debug(f"Cache SET (in-process): {key} (TTL: {ttl_seconds}s)")

    def get(self, key: str) -> Any:
        """Get a cache entry, returns None if missing or expired."""
        if self.redis_client:
            try:
                val = self.redis_client.get(key)
                if val:
                    logger.debug(f"Cache HIT (Redis): {key}")
                    return json.loads(val)
                logger.debug(f"Cache MISS (Redis): {key}")
                return None
            except Exception as e:
                logger.warning(f"Redis GET failed for {key}: {e}")
                return None
        else:
            if key in self.in_process_cache:
                value, expiry = self.in_process_cache[key]
                if datetime.now() < expiry:
                    logger.debug(f"Cache HIT (in-process): {key}")
                    return value
                else:
                    del self.in_process_cache[key]
            logger.debug(f"Cache MISS (in-process): {key}")
            return None

    def delete(self, key: str) -> None:
        """Delete a cache entry."""
        if self.redis_client:
            try:
                self.redis_client.delete(key)
                logger.debug(f"Cache DELETE (Redis): {key}")
            except Exception as e:
                logger.warning(f"Redis DELETE failed for {key}: {e}")
        else:
            self.in_process_cache.pop(key, None)
            logger.debug(f"Cache DELETE (in-process): {key}")

    def delete_pattern(self, pattern: str) -> None:
        """Delete all keys matching a pattern (e.g., 'actionables:*')."""
        if self.redis_client:
            try:
                keys = self.redis_client.keys(pattern)
                if keys:
                    self.redis_client.delete(*keys)
                    logger.debug(f"Cache DELETE_PATTERN (Redis): {pattern} ({len(keys)} keys)")
            except Exception as e:
                logger.warning(f"Redis DELETE_PATTERN failed for {pattern}: {e}")
        else:
            keys_to_delete = [k for k in self.in_process_cache if pattern.replace("*", "") in k or pattern == "*"]
            for k in keys_to_delete:
                del self.in_process_cache[k]
            logger.debug(f"Cache DELETE_PATTERN (in-process): {pattern} ({len(keys_to_delete)} keys)")

    def get_or_compute(self, key: str, fn: Callable, ttl_seconds: int = 300) -> Any:
        """Get from cache, or compute and cache if missing."""
        cached = self.get(key)
        if cached is not None:
            return cached
        result = fn()
        self.set(key, result, ttl_seconds)
        return result


# Global singleton cache manager
_cache_manager: Optional[CacheManager] = None


def get_cache_manager() -> CacheManager:
    """Get/initialize the global cache manager."""
    global _cache_manager
    if _cache_manager is None:
        _cache_manager = CacheManager()
    return _cache_manager
