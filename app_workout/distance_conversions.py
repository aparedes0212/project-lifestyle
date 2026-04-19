from __future__ import annotations

from typing import Dict, Optional

from .models import CardioUnit, DistanceConversionSettings


SPRINT_DISTANCE_KEYS = ("x800", "x400", "x200")
SPRINT_INTERVAL_UNIT_NAMES = {
    "x800": "800m Intervals",
    "x400": "400m Intervals",
    "x200": "200m Intervals",
}


def _coerce_positive_float(value) -> Optional[float]:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if number <= 0:
        return None
    return number


def get_distance_conversion_settings() -> DistanceConversionSettings:
    settings_obj = DistanceConversionSettings.objects.first()
    if settings_obj is not None:
        return settings_obj

    settings_obj = DistanceConversionSettings.objects.create()
    sync_interval_units_from_settings(settings_obj)
    return settings_obj


def get_distance_conversion_payload() -> Dict[str, object]:
    settings_obj = get_distance_conversion_settings()
    return {
        "ten_k_miles": float(settings_obj.ten_k_miles),
        "x800_miles": float(settings_obj.x800_miles),
        "x800_meters": float(settings_obj.x800_meters),
        "x800_yards": float(settings_obj.x800_yards),
        "x400_miles": float(settings_obj.x400_miles),
        "x400_meters": float(settings_obj.x400_meters),
        "x400_yards": float(settings_obj.x400_yards),
        "x200_miles": float(settings_obj.x200_miles),
        "x200_meters": float(settings_obj.x200_meters),
        "x200_yards": float(settings_obj.x200_yards),
    }


def get_ten_k_miles() -> float:
    payload = get_distance_conversion_payload()
    return float(payload["ten_k_miles"])


def get_sprint_distance_miles(key: str) -> Optional[float]:
    clean_key = str(key or "").strip().lower()
    if clean_key not in SPRINT_DISTANCE_KEYS:
        return None
    payload = get_distance_conversion_payload()
    return _coerce_positive_float(payload.get(f"{clean_key}_miles"))


def get_sprint_distance_summary(key: str) -> Optional[Dict[str, float]]:
    clean_key = str(key or "").strip().lower()
    if clean_key not in SPRINT_DISTANCE_KEYS:
        return None
    payload = get_distance_conversion_payload()
    miles = _coerce_positive_float(payload.get(f"{clean_key}_miles"))
    meters = _coerce_positive_float(payload.get(f"{clean_key}_meters"))
    yards = _coerce_positive_float(payload.get(f"{clean_key}_yards"))
    if miles is None or meters is None or yards is None:
        return None
    return {
        "miles": miles,
        "meters": meters,
        "yards": yards,
    }


def get_sprint_distance_miles_map() -> Dict[str, float]:
    return {
        key: get_sprint_distance_miles(key) or 0.0
        for key in SPRINT_DISTANCE_KEYS
    }


def sync_interval_units_from_settings(settings_obj: Optional[DistanceConversionSettings] = None) -> None:
    settings_obj = settings_obj or get_distance_conversion_settings()
    pending_updates = []

    for sprint_key, unit_name in SPRINT_INTERVAL_UNIT_NAMES.items():
        unit = CardioUnit.objects.filter(name=unit_name).first()
        if unit is None:
            continue

        miles = _coerce_positive_float(getattr(settings_obj, f"{sprint_key}_miles", None))
        if miles is None:
            continue

        unit.mile_equiv_numerator = miles
        unit.mile_equiv_denominator = 1
        pending_updates.append(unit)

    if pending_updates:
        CardioUnit.objects.bulk_update(
            pending_updates,
            ["mile_equiv_numerator", "mile_equiv_denominator"],
        )
