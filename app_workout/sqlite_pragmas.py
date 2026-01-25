from __future__ import annotations

from django.db.backends.signals import connection_created
from django.dispatch import receiver


@receiver(connection_created)
def _set_sqlite_pragmas(sender, connection, **kwargs):
    """
    Improve SQLite concurrency for local/dev.

    - WAL allows readers during a write transaction.
    - busy_timeout tells SQLite to wait briefly instead of failing immediately.
    """
    if getattr(connection, "vendor", None) != "sqlite":
        return

    try:
        with connection.cursor() as cursor:
            cursor.execute("PRAGMA journal_mode=WAL;")
            cursor.execute("PRAGMA synchronous=NORMAL;")
            cursor.execute("PRAGMA busy_timeout=15000;")
    except Exception:
        # Don't fail startup if pragmas can't be set for some reason.
        return

