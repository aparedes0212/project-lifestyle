from math import floor, ceil, isfinite
from typing import List, Optional, Tuple

MPH_STEP = 0.1
DIST_STEP = 0.01
TIME_STEP = 0.01  # only used if you want to round time inputs/outputs
FIVE_K_PER_SET_MILES = 0.75
EPS = 1e-9


def round_to_step(x: float, step: float) -> float:
    return round(x / step) * step


def floor_to_step(x: float, step: float) -> float:
    return floor(x / step) * step


def ceil_to_step(x: float, step: float) -> float:
    return ceil(x / step) * step


def _best_two_speed_split_for_time(remaining_dist: float, remaining_time: float, mph_req: float):
    """
    Solve remaining_time ≈ d_low/mph_low + d_high/mph_high with:
      d_low + d_high = remaining_dist
      mph_low and mph_high are 0.1 mph apart (rounded to 0.1)
      distances rounded to 0.01
    Returns a plan dict with either 1 segment or 2 segments.
    """
    if remaining_dist <= 0 or remaining_time <= 0 or not isfinite(mph_req) or mph_req <= 0:
        raise ValueError("Invalid remaining_dist/remaining_time/mph_req; check inputs.")

    mph_single = round_to_step(mph_req, MPH_STEP)
    d_single = round_to_step(remaining_dist, DIST_STEP)
    t_single = d_single / mph_single
    err_single = abs(t_single - remaining_time)

    # If one rounded segment is already close enough, keep it.
    # "Close enough" here means within half a distance-step at the given speed (pretty strict),
    # but you can loosen/tighten as you like.
    if err_single <= (DIST_STEP / max(mph_single, 1e-9)):
        return {
            "segments": [(d_single, mph_single)],
            "time_error_hours": t_single - remaining_time,
            "achieved_time_hours": t_single,
            "target_time_hours": remaining_time,
        }

    # Two-speed split: use the two nearest 0.1 mph ticks around mph_req
    mph_low = floor_to_step(mph_req, MPH_STEP)
    mph_high = mph_low + MPH_STEP

    # Edge: if mph_req is exactly on a tick, we still allow a split (low==req, high=req+0.1)
    if mph_low <= 0:
        mph_low = MPH_STEP
        mph_high = mph_low + MPH_STEP

    # Solve for d_high:
    # remaining_time = (remaining_dist - d_high)/mph_low + d_high/mph_high
    # => remaining_time = remaining_dist/mph_low + d_high*(1/mph_high - 1/mph_low)
    denom = (1.0 / mph_high) - (1.0 / mph_low)

    # If denom is 0 (shouldn't happen), fall back
    if abs(denom) < 1e-12:
        return {
            "segments": [(round_to_step(remaining_dist, DIST_STEP), round_to_step(mph_req, MPH_STEP))],
            "time_error_hours": (remaining_dist / round_to_step(mph_req, MPH_STEP)) - remaining_time,
            "achieved_time_hours": remaining_dist / round_to_step(mph_req, MPH_STEP),
            "target_time_hours": remaining_time,
        }

    d_high_exact = (remaining_time - (remaining_dist / mph_low)) / denom

    # Round d_high to 0.01 and clamp to [0, remaining_dist]
    d_high_guess = round_to_step(d_high_exact, DIST_STEP)
    d_high_guess = max(0.0, min(remaining_dist, d_high_guess))

    # Because rounding can cause slight mismatch, search nearby 0.01 steps for best fit
    best = None
    for i in range(-5, 6):  # search +/- 0.05 miles around the rounded guess
        d_high = d_high_guess + i * DIST_STEP
        if d_high < 0 or d_high > remaining_dist:
            continue
        d_low = remaining_dist - d_high
        # Round low segment distance to 0.01 too, then re-adjust high to keep totals exact
        d_low = round_to_step(d_low, DIST_STEP)
        d_high = round_to_step(remaining_dist - d_low, DIST_STEP)

        t = (d_low / mph_low) + (d_high / mph_high)
        err = abs(t - remaining_time)
        cand = (err, d_low, d_high, t)
        if best is None or cand < best:
            best = cand

    if best is None:
        raise RuntimeError("Failed to find a feasible split; check inputs.")

    err, d_low, d_high, t = best
    segments = []
    if d_low > 0:
        segments.append((d_low, mph_low))
    if d_high > 0:
        segments.append((d_high, mph_high))

    return {
        "segments": segments,
        "time_error_hours": t - remaining_time,
        "achieved_time_hours": t,
        "target_time_hours": remaining_time,
        "mph_required_unrounded": mph_req,
    }


def remaining_mph_distance_based(
    mph_fast: float,
    dist_fast: float,
    mph_total: float,
    dist_total: float,
):
    """
    Inputs:
      mph_fast: fastest segment speed (mph)
      dist_fast: distance at mph_fast (miles, rounded to 0.01 externally or not)
      mph_total: total workout average mph
      dist_total: total workout distance (miles)

    Returns:
      plan dict with remaining distance split into 1 or 2 segments with mph rounded to 0.1
      and distances rounded to 0.01, aiming to match the total average mph.
    """
    if mph_fast <= 0 or mph_total <= 0 or dist_fast < 0 or dist_total <= 0:
        raise ValueError("Invalid inputs.")

    # Work in hours
    total_time = dist_total / mph_total
    fast_time = dist_fast / mph_fast

    remaining_dist = dist_total - dist_fast
    remaining_time = total_time - fast_time

    if remaining_dist <= 0:
        return {"segments": [], "note": "No remaining distance."}
    if remaining_time <= 0:
        raise ValueError("Fast segment already uses all (or more than) the total time implied by mph_total.")

    mph_req = remaining_dist / remaining_time  # exact required avg speed for remaining portion
    plan = _best_two_speed_split_for_time(remaining_dist, remaining_time, mph_req)

    # Add some helpful totals
    achieved_total_time = fast_time + plan["achieved_time_hours"]
    achieved_total_mph = dist_total / achieved_total_time

    plan.update({
        "fast_segment": (round_to_step(dist_fast, DIST_STEP), round_to_step(mph_fast, MPH_STEP)),
        "remaining_distance": round_to_step(remaining_dist, DIST_STEP),
        "target_total_mph": mph_total,
        "achieved_total_mph_from_plan": achieved_total_mph,
        "target_total_time_hours": total_time,
        "achieved_total_time_hours_from_plan": achieved_total_time,
    })
    return plan


def remaining_mph_time_based(
    mph_fast: float,
    time_fast: float,
    mph_total: float,
    time_total: float,
    time_unit: str = "minutes",
):
    """
    Inputs:
      mph_fast: fastest segment speed (mph)
      time_fast: time at mph_fast (in time_unit)
      mph_total: total workout average mph
      time_total: total workout time (in time_unit)

    Returns:
      plan dict with remaining time split into 1 or 2 segments with mph rounded to 0.1.
      (Time is fixed; this function computes what mph(s) you need in the remaining time.)
    """
    if mph_fast <= 0 or mph_total <= 0 or time_fast < 0 or time_total <= 0:
        raise ValueError("Invalid inputs.")
    if time_fast > time_total:
        raise ValueError("time_fast cannot exceed time_total.")

    # Convert times to hours to be consistent with mph
    if time_unit.lower().startswith("min"):
        tf = time_fast / 60.0
        tt = time_total / 60.0
    elif time_unit.lower().startswith("hour"):
        tf = time_fast
        tt = time_total
    else:
        raise ValueError("time_unit must be 'minutes' or 'hours'.")

    # Total distance implied by mph_total over time_total
    dist_total = mph_total * tt
    dist_fast = mph_fast * tf

    remaining_time = tt - tf
    remaining_dist = dist_total - dist_fast

    if remaining_time <= 0:
        return {"segments": [], "note": "No remaining time."}
    if remaining_dist <= 0:
        # Means the fast block already covers all required distance (at that total mph).
        # Remaining mph would have to be 0 or negative, which is not meaningful for running.
        raise ValueError("Fast segment already exceeds the total distance implied by mph_total * time_total.")

    mph_req = remaining_dist / remaining_time
    # Here remaining_time is fixed; we "simulate" a remaining distance over remaining_time,
    # using the same split logic by treating remaining_dist as the total and matching remaining_time.
    plan = _best_two_speed_split_for_time(remaining_dist, remaining_time, mph_req)

    plan.update({
        "fast_segment_time_unit": time_unit,
        "fast_segment_time": time_fast,
        "fast_segment_mph": round_to_step(mph_fast, MPH_STEP),
        "target_total_mph": mph_total,
        "target_total_time": time_total,
        "implied_total_distance_miles": dist_total,
        "implied_fast_distance_miles": dist_fast,
        "implied_remaining_distance_miles": remaining_dist,
        "remaining_time_hours": remaining_time,
    })
    return plan


def interval_mph_plan(
    mph_fast_interval: float,
    mph_avg_all_intervals: float,
    n_intervals: int,
):
    """
    Special interval case:
      Inputs: fastest interval mph, target average mph across ALL intervals, number of intervals.
      Output: list of per-interval mph values (rounded to 0.1) that gets closest to target average.

    Assumption: "average mph of all intervals" means arithmetic mean of the interval mph values.
    """
    if n_intervals < 1:
        raise ValueError("n_intervals must be >= 1.")
    if mph_fast_interval <= 0 or mph_avg_all_intervals <= 0:
        raise ValueError("Invalid mph inputs.")

    mph_fast = round_to_step(mph_fast_interval, MPH_STEP)
    target_avg = round_to_step(mph_avg_all_intervals, MPH_STEP)  # optional; you can keep unrounded target too

    if n_intervals == 1:
        return {
            "interval_mphs": [mph_fast],
            "achieved_avg_mph": mph_fast,
            "target_avg_mph": mph_avg_all_intervals,
        }

    total_target_sum = n_intervals * mph_avg_all_intervals
    remaining_sum = total_target_sum - mph_fast
    per_rest_exact = remaining_sum / (n_intervals - 1)

    mph_low = floor_to_step(per_rest_exact, MPH_STEP)
    mph_high = mph_low + MPH_STEP
    if mph_low <= 0:
        mph_low = MPH_STEP
        mph_high = mph_low + MPH_STEP


    k = ceil((remaining_sum - (n_intervals - 1) * mph_low) / MPH_STEP)
    k = max(0, min(n_intervals - 1, int(k)))

    interval_mphs = [mph_fast] + [mph_high] * k + [mph_low] * ((n_intervals - 1) - k)

    achieved_avg = sum(interval_mphs) / n_intervals
    return {
        "interval_mphs": interval_mphs,
        "achieved_avg_mph": achieved_avg,
        "target_avg_mph": mph_avg_all_intervals,
        "fast_interval_mph": mph_fast,
        "rest_interval_mph_low": mph_low,
        "rest_interval_mph_high": mph_high,
        "n_high_rest_intervals": k,
    }


# ---- Presentation helpers for API responses ----
def _format_mph(value: float) -> str:
    try:
        v = float(value)
    except (TypeError, ValueError):
        return "-"
    if not isfinite(v) or v <= 0:
        return "-"
    return f"{round_to_step(v, MPH_STEP):.1f} mph"


def _format_miles(value: float) -> str:
    try:
        v = float(value)
    except (TypeError, ValueError):
        return "-"
    if not isfinite(v) or v <= 0:
        return "-"
    return f"{round_to_step(v, DIST_STEP):.2f} mi"


def _format_duration_minutes(minutes: float) -> str:
    try:
        v = float(minutes)
    except (TypeError, ValueError):
        return "-"
    if not isfinite(v) or v < 0:
        return "-"
    total_seconds = max(0, int(round(v * 60)))
    mins = total_seconds // 60
    secs = total_seconds - mins * 60
    return f"{mins}m {secs:02d}s"


def _distance_chunks(total_miles: float, per_set_miles: float) -> List[float]:
    distances = []
    if per_set_miles and per_set_miles > 0:
        remaining = total_miles
        while remaining > per_set_miles + EPS:
            distances.append(per_set_miles)
            remaining -= per_set_miles
        if remaining > EPS:
            distances.append(remaining)
        if not distances:
            distances.append(per_set_miles)
    else:
        distances.append(total_miles)
    # ensure rounding consistency
    adj = sum(distances)
    if abs(adj - total_miles) > DIST_STEP:
        distances[-1] += (total_miles - adj)
    return [round_to_step(d, DIST_STEP) for d in distances]


def _rows_from_segments(distances: List[float], segments: List[Tuple[float, float]]):
    rows = []
    if not segments:
        return rows
    seg_idx = 0
    seg_remaining = segments[0][0]
    seg_mph = segments[0][1]

    for idx, dist in enumerate(distances):
        need = dist
        time_hours = 0.0
        while need > EPS and seg_idx < len(segments):
            portion = min(need, seg_remaining)
            time_hours += portion / max(seg_mph, EPS)
            seg_remaining -= portion
            need -= portion
            if seg_remaining <= EPS:
                seg_idx += 1
                if seg_idx < len(segments):
                    seg_remaining = segments[seg_idx][0]
                    seg_mph = segments[seg_idx][1]
        mph_row = dist / time_hours if time_hours > EPS else None
        rows.append({
            "label": f"Set {idx + 1}",
            "primary": _format_mph(mph_row),
            "secondary": f"{_format_miles(dist)} | {_format_duration_minutes(time_hours * 60)}",
        })
    return rows


def build_sprint_distribution(sets: float, mph_fast: float, mph_avg: float, meta_extras=None):
    title = "Sprint MPH Distribution"
    meta = list(meta_extras or [])
    try:
        n_sets = int(round(sets))
    except Exception:
        return {"title": title, "meta": meta, "rows": [], "error": "Goal must be a valid number of sets."}
    if n_sets <= 0:
        return {"title": title, "meta": meta, "rows": [], "error": "No remaining sets to distribute."}

    try:
        mph_fast_val = round_to_step(float(mph_fast), MPH_STEP)
    except Exception:
        mph_fast_val = 0.0
    try:
        mph_avg_val = round_to_step(float(mph_avg), MPH_STEP)
    except Exception:
        mph_avg_val = mph_fast_val

    if mph_fast_val <= 0:
        return {"title": title, "meta": meta, "rows": [], "error": "MPH goal is unavailable."}
    if mph_avg_val <= 0:
        mph_avg_val = mph_fast_val

    meta.extend([f"Sets: {n_sets}", f"Max MPH: {mph_fast_val:.1f}", f"Avg MPH: {mph_avg_val:.1f}"])

    try:
        plan = interval_mph_plan(mph_fast_val, mph_avg_val, n_sets)
        mphs = plan.get("interval_mphs", [])
    except Exception as exc:
        return {"title": title, "meta": meta, "rows": [], "error": str(exc) or "Unable to build distribution."}

    rows = [{
        "label": f"Set {idx + 1}",
        "primary": _format_mph(mph),
    } for idx, mph in enumerate(mphs)]

    return {"title": title, "meta": meta, "rows": rows, "error": None}


def build_five_k_distribution(
    total_miles: float,
    mph_fast: float,
    mph_avg: float,
    per_set_miles: float = FIVE_K_PER_SET_MILES,
    target_minutes: Optional[float] = None,
    is_tempo: bool = False,
    meta_extras=None,
):
    title = "5K Prep Distribution"
    meta = list(meta_extras or [])

    try:
        tm = float(total_miles)
    except Exception:
        tm = 0.0
    if tm <= 0:
        return {"title": title, "meta": meta, "rows": [], "error": "Total distance could not be determined."}

    try:
        mph_fast_val = round_to_step(float(mph_fast), MPH_STEP)
    except Exception:
        mph_fast_val = 0.0
    try:
        mph_avg_val = round_to_step(float(mph_avg), MPH_STEP)
    except Exception:
        mph_avg_val = mph_fast_val

    if mph_fast_val <= 0:
        return {"title": title, "meta": meta, "rows": [], "error": "MPH goal is unavailable."}
    if mph_avg_val <= 0:
        mph_avg_val = mph_fast_val

    distances = _distance_chunks(tm, per_set_miles if per_set_miles else tm)
    fast_distance = distances[0] if distances else tm

    plan = None
    try:
        if is_tempo:
            total_minutes = target_minutes
            if total_minutes is None or total_minutes <= 0:
                total_minutes = (tm / mph_avg_val) * 60.0
            time_fast_minutes = (fast_distance / mph_fast_val) * 60.0
            plan = remaining_mph_time_based(
                mph_fast=mph_fast_val,
                time_fast=time_fast_minutes,
                mph_total=mph_avg_val,
                time_total=total_minutes,
                time_unit="minutes",
            )
        else:
            plan = remaining_mph_distance_based(
                mph_fast=mph_fast_val,
                dist_fast=fast_distance,
                mph_total=mph_avg_val,
                dist_total=tm,
            )
    except Exception as exc:
        return {"title": title, "meta": meta, "rows": [], "error": str(exc) or "Unable to build distribution."}

    segments = [(fast_distance, mph_fast_val)]
    segments.extend(plan.get("segments", []))

    rows = _rows_from_segments(distances, segments)

    meta.append(f"Total distance: {_format_miles(tm)}")
    meta.append(f"Sets: {len(distances)}")
    if len(distances) == 1:
        meta.append(f"Set distance: {_format_miles(distances[0])}")
    else:
        base_set = distances[0]
        last_set = distances[-1]
        if abs(last_set - base_set) > DIST_STEP:
            meta.append(f"Set distance: {_format_miles(base_set)} (final {_format_miles(last_set)})")
        else:
            meta.append(f"Set distance: {_format_miles(base_set)}")
    meta.append(f"Max MPH: {mph_fast_val:.1f}")
    meta.append(f"Avg MPH: {mph_avg_val:.1f}")
    if is_tempo:
        meta.append(f"Tempo goal: {_format_duration_minutes(target_minutes) if target_minutes else '-'}")

    return {"title": title, "meta": meta, "rows": rows, "error": None}
