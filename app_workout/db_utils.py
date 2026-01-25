from __future__ import annotations

import random
import time
from collections.abc import Callable
from typing import TypeVar

from django.db import OperationalError, connection, transaction

T = TypeVar("T")


def _is_sqlite_locked_error(exc: BaseException) -> bool:
    msg = str(exc).lower()
    return ("database is locked" in msg) or ("database is busy" in msg) or ("sqlite_busy" in msg)


def sqlite_atomic_retry(
    fn: Callable[[], T],
    *,
    max_attempts: int = 8,
    base_sleep_s: float = 0.05,
    max_sleep_s: float = 0.6,
) -> T:
    """
    Retry a write transaction when SQLite is contended.

    This is intended for dev/local SQLite use where UI can generate many
    concurrent writes. For non-sqlite databases, it just runs once.
    """
    # If we're already in an atomic block, do not nest or retry here.
    # Let the outermost caller decide how to handle failures.
    if getattr(connection, "in_atomic_block", False):
        return fn()

    if connection.vendor != "sqlite":
        with transaction.atomic():
            return fn()

    last_exc: OperationalError | None = None
    for attempt in range(max_attempts):
        try:
            with transaction.atomic():
                return fn()
        except OperationalError as exc:
            last_exc = exc
            if not _is_sqlite_locked_error(exc) or attempt >= (max_attempts - 1):
                raise
            try:
                # Drop the connection so the next attempt gets a fresh one.
                connection.close()
            except Exception:
                pass
            sleep_s = min(max_sleep_s, base_sleep_s * (2**attempt)) + random.uniform(0, base_sleep_s)
            time.sleep(sleep_s)

    # Should be unreachable, but keeps mypy happy.
    raise last_exc or OperationalError("database is locked")
