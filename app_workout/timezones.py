from __future__ import annotations

import os
from datetime import datetime, time, timedelta
from zoneinfo import ZoneInfo

from django.conf import settings
from django.utils import timezone


USER_TIMEZONE_HEADER = "X-User-Timezone"
USER_TIMEZONE_META_KEY = f"HTTP_{USER_TIMEZONE_HEADER.upper().replace('-', '_')}"


def _coerce_zoneinfo(value) -> ZoneInfo | None:
    if isinstance(value, ZoneInfo):
        return value
    tz_name = str(value or "").strip()
    if not tz_name:
        return None
    try:
        return ZoneInfo(tz_name)
    except Exception:
        return None


def get_fallback_calendar_zone() -> ZoneInfo:
    tz_name = (
        getattr(settings, "CALENDAR_TIME_ZONE", None)
        or os.environ.get("APP_CALENDAR_TZ")
        or "America/Denver"
    )
    zone = _coerce_zoneinfo(tz_name)
    if zone is not None:
        return zone
    return timezone.get_default_timezone()


def get_request_calendar_zone(request) -> ZoneInfo:
    header_value = ""
    if request is not None:
        header_value = request.META.get(USER_TIMEZONE_META_KEY, "")
    zone = _coerce_zoneinfo(header_value)
    if zone is not None:
        return zone
    return get_fallback_calendar_zone()


def get_current_calendar_zone() -> ZoneInfo:
    active = getattr(getattr(timezone, "_active", None), "value", None)
    return _coerce_zoneinfo(active) or get_fallback_calendar_zone()


def derive_activity_date(datetime_value):
    zone = get_current_calendar_zone()
    if datetime_value is None:
        return timezone.localdate(timezone=zone)

    dt = datetime_value
    if timezone.is_naive(dt):
        dt = timezone.make_aware(dt, timezone.utc)
    return timezone.localtime(dt, zone).date()


def get_local_day_bounds(activity_date, zone: ZoneInfo | None = None):
    zone = zone or get_current_calendar_zone()
    start_naive = datetime.combine(activity_date, time.min)
    end_naive = start_naive + timedelta(days=1)
    return (
        timezone.make_aware(start_naive, timezone=zone),
        timezone.make_aware(end_naive, timezone=zone),
    )
