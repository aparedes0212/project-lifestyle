import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import useApi from "../hooks/useApi";
import { API_BASE } from "../lib/config";
import Card from "../components/ui/Card";
import Row from "../components/ui/Row";
import Modal from "../components/ui/Modal";
import { formatWithStep, formatNumber } from "../lib/numberFormat";
import { deriveRestColor } from "../lib/restColors";
import {
  buildSprintsDistribution,
  buildFiveKDistribution,
  FIVE_K_PER_SET_MILES,
} from "../lib/runDistribution";

const btnStyle = { border: "1px solid #e5e7eb", background: "#f9fafb", borderRadius: 8, padding: "6px 10px", cursor: "pointer" };
const xBtnInline = { border: "none", background: "transparent", color: "#b91c1c", cursor: "pointer", fontSize: 14, lineHeight: 1, padding: 2, marginLeft: 8 };
const editBtnInline = { border: "none", background: "transparent", color: "#1d4ed8", cursor: "pointer", fontSize: 14, lineHeight: 1, padding: 2 };
const distributionBtnStyle = { border: "none", background: "transparent", color: "#2563eb", cursor: "pointer", fontSize: 12, padding: 0, marginLeft: 8 };

function toIsoLocal(date) {
  const d = date instanceof Date ? date : new Date(date);
  const tzOffset = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - tzOffset).toISOString().slice(0, 19);
}
function toIsoLocalNow() { return toIsoLocal(new Date()); }
function n(v) { const x = Number(v); return Number.isFinite(x) ? x : null; }
function toMinutes(mins, secs) { return (n(mins) || 0) + (n(secs) || 0) / 60; }
function fromMinutes(total) {
  const t = Math.max(0, Number(total) || 0);
  const m = Math.floor(t);
  const s = (t - m) * 60;
  return { m, s: Math.round(s * 1000) / 1000 };
}
function splitMinutesSeconds(total) {
  const val = n(total);
  if (val === null || val < 0) return { m: "", s: "" };
  const m = Math.floor(val);
  const s = Math.round((val - m) * 60 * 1000) / 1000;
  return { m: String(m), s: s ? String(s) : "" };
}
function formatMinutesValue(total) {
  const val = n(total);
  if (val === null || val < 0) return "—";
  const whole = Math.floor(val);
  const secondsRaw = (val - whole) * 60;
  const seconds = Math.round(secondsRaw * 1000) / 1000;
  return seconds > 0 ? `${whole}m ${seconds}s` : `${whole}m`;
}
function mphFrom(miles, mins, secs) {
  const mi = n(miles); const total = toMinutes(mins, secs);
  if (!mi || mi <= 0 || !total || total <= 0) return "";
  return String(Math.round((mi / (total / 60)) * 1000) / 1000);
}
function minsFrom(mph, miles) {
  const vMph = n(mph); const vMi = n(miles);
  if (!vMph || vMph <= 0 || !vMi || vMi <= 0) return { m: "", s: "" };
  return fromMinutes((vMi / vMph) * 60);
}

const emptyRow = {
  datetime: "",
  exercise_id: "",
  running_minutes: "",
  running_seconds: "",
  running_miles: "",
  running_mph: "",
  treadmill_time_minutes: "",
  treadmill_time_seconds: "",
};

export default function LogDetailsPage() {
  const { id } = useParams();

  // log + intervals
  const { data, loading, error, refetch } = useApi(`${API_BASE}/api/cardio/log/${id}/`, { deps: [id] });

  const restThresholdsApi = useApi(`${API_BASE}/api/cardio/rest-thresholds/`, { deps: [] });
  const restThresholdsByWorkout = useMemo(() => {
    const map = {};
    (restThresholdsApi.data || []).forEach(item => {
      map[String(item.workout)] = item;
    });
    return map;
  }, [restThresholdsApi.data]);

  const unitTypeLower = useMemo(() => {
    const ut = data?.workout?.unit?.unit_type;
    if (!ut) return "";
    if (typeof ut === "string") return ut.toLowerCase();
    if (typeof ut?.name === "string") return ut.name.toLowerCase();
    return "";
  }, [data?.workout?.unit?.unit_type]);

  const [startedAt, setStartedAt] = useState("");
  useEffect(() => {
    if (data?.datetime_started) {
      setStartedAt(toIsoLocal(new Date(data.datetime_started)));
    }
  }, [data?.datetime_started]);

  const [updatingStart, setUpdatingStart] = useState(false);
  const [updateStartErr, setUpdateStartErr] = useState(null);
  const saveStart = async () => {
    setUpdatingStart(true);
    setUpdateStartErr(null);
    try {
      const payload = { datetime_started: new Date(startedAt).toISOString() };
      const res = await fetch(`${API_BASE}/api/cardio/log/${id}/`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      await res.json();
      await refetch();
    } catch (err) {
      setUpdateStartErr(err);
    } finally {
      setUpdatingStart(false);
    }
  };

  const [maxMphInput, setMaxMphInput] = useState("");
  useEffect(() => {
    if (data?.max_mph != null) {
      setMaxMphInput(String(data.max_mph));
    }
  }, [data?.max_mph]);

  const [goalTimeMinutesInput, setGoalTimeMinutesInput] = useState("");
  const [goalTimeSecondsInput, setGoalTimeSecondsInput] = useState("");
  const [goalDistanceInput, setGoalDistanceInput] = useState("");
  useEffect(() => {
    if (unitTypeLower === "time") {
      if (data?.goal_time != null) {
        setGoalDistanceInput(String(data.goal_time));
      } else {
        setGoalDistanceInput("");
      }
      setGoalTimeMinutesInput("");
      setGoalTimeSecondsInput("");
      return;
    }
    setGoalDistanceInput("");
    if (data?.goal_time != null) {
      const parts = splitMinutesSeconds(data.goal_time);
      setGoalTimeMinutesInput(parts.m);
      setGoalTimeSecondsInput(parts.s);
    } else {
      setGoalTimeMinutesInput("");
      setGoalTimeSecondsInput("");
    }
  }, [data?.goal_time, unitTypeLower]);

  const [updatingMax, setUpdatingMax] = useState(false);
  const [updateMaxErr, setUpdateMaxErr] = useState(null);
  const saveMax = async () => {
    setUpdatingMax(true);
    setUpdateMaxErr(null);
    try {
      const payload = { max_mph: n(maxMphInput) };
      const res = await fetch(`${API_BASE}/api/cardio/log/${id}/`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      await res.json();
      await refetch();
      refreshMphGoal();
    } catch (err) {
      setUpdateMaxErr(err);
    } finally {
      setUpdatingMax(false);
    }
  };

  const [updatingGoalTime, setUpdatingGoalTime] = useState(false);
  const [updateGoalTimeErr, setUpdateGoalTimeErr] = useState(null);
  const saveGoalTime = async () => {
    setUpdatingGoalTime(true);
    setUpdateGoalTimeErr(null);
    try {
      let goalTargetValue = null;
      if (unitTypeLower === "time") {
        const distance = n(goalDistanceInput);
        goalTargetValue = Number.isFinite(distance) && distance > 0 ? distance : null;
      } else {
        const mins = n(goalTimeMinutesInput);
        const secs = n(goalTimeSecondsInput);
        const total = (mins != null ? mins : 0) + (secs != null ? secs / 60 : 0);
        goalTargetValue = Number.isFinite(total) && total > 0 ? total : null;
      }
      const payload = { goal_time: goalTargetValue };
      const res = await fetch(`${API_BASE}/api/cardio/log/${id}/`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      await res.json();
      await refetch();
      // Updating goal time can imply a faster max_mph; refresh MPH goals.
      refreshMphGoal();
    } catch (err) {
      setUpdateGoalTimeErr(err);
    } finally {
      setUpdatingGoalTime(false);
    }
  };

  // Planned goal value for conversions (do not use remaining)
  const goalValue = useMemo(() => n(data?.goal), [data?.goal]);
  const isSprints = useMemo(() => ((data?.workout?.routine?.name || "").toLowerCase() === "sprints"), [data?.workout?.routine?.name]);
  const isFiveKPrep = useMemo(() => ((data?.workout?.routine?.name || "").toLowerCase() === "5k prep"), [data?.workout?.routine?.name]);

  const [mphGoalInfo, setMphGoalInfo] = useState(null);
  const [distributionOpen, setDistributionOpen] = useState(false);
  const [distributionState, setDistributionState] = useState({ title: "", meta: [], rows: [], error: null });
  const [overrideMphMax, setOverrideMphMax] = useState("");
  const [overrideMphAvg, setOverrideMphAvg] = useState("");

  useEffect(() => {
    // Reset overrides when navigating to a new log
    setOverrideMphMax("");
    setOverrideMphAvg("");
  }, [id]);

  const hasValidGoalInput = useMemo(() => {
    if (unitTypeLower === "time") {
      const distance = n(goalDistanceInput);
      return distance != null && distance >= 0;
    }
    const mins = n(goalTimeMinutesInput);
    const secs = n(goalTimeSecondsInput);
    return (mins != null && mins >= 0) || (secs != null && secs >= 0);
  }, [unitTypeLower, goalDistanceInput, goalTimeMinutesInput, goalTimeSecondsInput]);

  const refreshMphGoal = useCallback(() => {
    const wid = data?.workout?.id;
    if (!wid || goalValue === null || goalValue <= 0) {
      setMphGoalInfo(null);
      return null;
    }
    const controller = new AbortController();
    const params = new URLSearchParams({ workout_id: String(wid), value: String(goalValue) });
    fetch(`${API_BASE}/api/cardio/mph-goal/?${params.toString()}`, {
      signal: controller.signal,
    })
      .then((res) => (res.ok ? res.json() : Promise.reject(res)))
      .then((info) => setMphGoalInfo(info))
      .catch(() => setMphGoalInfo(null));
    return controller;
  }, [data?.workout?.id, goalValue]);

  useEffect(() => {
    const ctrl = refreshMphGoal();
    return () => ctrl?.abort();
  }, [refreshMphGoal]);

  const parsedOverrideMax = n(overrideMphMax);
  const parsedOverrideAvg = n(overrideMphAvg);
  const effectiveMphMax = useMemo(
    () => {
      const normalize = (val) => {
        const num = Number(val);
        return Number.isFinite(num) && num > 0 ? num : null;
      };
      return normalize(parsedOverrideMax)
        ?? normalize(data?.mph_goal)
        ?? normalize(mphGoalInfo?.mph_goal);
    },
    [parsedOverrideMax, data?.mph_goal, mphGoalInfo?.mph_goal]
  );
  const effectiveMphAvg = useMemo(() => {
    const normalize = (val) => {
      const num = Number(val);
      return Number.isFinite(num) && num > 0 ? num : null;
    };
    const base = normalize(parsedOverrideAvg)
      ?? normalize(data?.mph_goal_avg)
      ?? normalize(mphGoalInfo?.mph_goal_avg);
    if (base != null) return base;
    return effectiveMphMax ?? null;
  }, [parsedOverrideAvg, data?.mph_goal_avg, mphGoalInfo?.mph_goal_avg, effectiveMphMax]);

  const resetDistribution = () => {
    setDistributionState({ title: "", meta: [], rows: [], error: null });
    setDistributionOpen(false);
  };

  const formatGoalLabel = (value) => {
    if (!Number.isFinite(value)) return null;
    return Number(value.toFixed(2)).toString();
  };
  const formatMilesLabel = (value) => {
    if (!Number.isFinite(value) || value <= 0) return null;
    const formatted = formatGoalLabel(value);
    return formatted ? `${formatted} mi` : null;
  };

  const openSprintDistribution = () => {
    if (!isSprints) {
      setDistributionState({
        title: "Sprint MPH Distribution",
        meta: [],
        rows: [],
        error: "Distribution is only available for Sprints.",
      });
      setDistributionOpen(true);
      return;
    }
    const maxCandidate = effectiveMphMax;
    const avgCandidate = effectiveMphAvg ?? effectiveMphMax;
    const distribution = buildSprintsDistribution({
      sets: goalValue,
      maxMph: maxCandidate,
      avgMph: avgCandidate,
    });
    setDistributionState(distribution);
    setDistributionOpen(true);
  };

  const openFiveKDistribution = () => {
    if (!isFiveKPrep) {
      setDistributionState({
        title: "5K Prep Distribution",
        meta: [],
        rows: [],
        error: "Distribution is only available for 5K Prep.",
      });
      setDistributionOpen(true);
      return;
    }

    const maxCandidate = effectiveMphMax;
    const avgCandidate = effectiveMphAvg ?? effectiveMphMax;

    let totalMiles = unitTypeLower === "time"
      ? (n(mphGoalInfo?.miles_avg) ?? n(mphGoalInfo?.miles))
      : (n(mphGoalInfo?.miles_max) ?? n(mphGoalInfo?.miles));
    if ((totalMiles === null || totalMiles <= 0) && unitTypeLower !== "time" && milesPerUnit > 0) {
      const distanceCandidate = (goalValue != null && goalValue > 0) ? goalValue : n(data?.total_completed);
      if (distanceCandidate != null && distanceCandidate > 0) {
        totalMiles = distanceCandidate * milesPerUnit;
      }
    }
    if ((totalMiles === null || totalMiles <= 0) && unitTypeLower === "time" && goalValue != null && goalValue > 0 && avgCandidate != null && avgCandidate > 0) {
      totalMiles = (avgCandidate * goalValue) / 60;
    }

    const goalMinutesDisplay = unitTypeLower === "time" && goalValue != null && goalValue > 0
      ? formatGoalLabel(goalValue)
      : null;
    let goalDistanceDisplay = null;
    if (unitTypeLower !== "time") {
      const distanceValue = (goalValue != null && goalValue > 0) ? goalValue : n(data?.total_completed);
      if (distanceValue != null && distanceValue > 0) {
        goalDistanceDisplay = formatGoalLabel(distanceValue);
      } else {
        const distanceFromInfo = n(mphGoalInfo?.distance);
        if (distanceFromInfo != null && distanceFromInfo > 0) {
          goalDistanceDisplay = formatGoalLabel(distanceFromInfo);
        }
      }
    }

    const distribution = buildFiveKDistribution({
      totalMiles,
      maxMph: maxCandidate,
      avgMph: avgCandidate,
      perSetMiles: FIVE_K_PER_SET_MILES,
      goalMinutesLabel: goalMinutesDisplay,
      goalDistanceLabel: unitTypeLower === "time" ? null : goalDistanceDisplay,
      goalUnitLabel: unitTypeLower === "time" ? null : (data?.workout?.unit?.name || null),
      isTempo: unitTypeLower === "time",
    });
    setDistributionState(distribution);
    setDistributionOpen(true);
  };

  const handleViewDistribution = () => {
    if (isSprints) {
      openSprintDistribution();
    } else if (isFiveKPrep) {
      openFiveKDistribution();
    }
  };

  // Compute times client-side to avoid rare server rounding/field issues
  const milesPerUnit = useMemo(() => {
    const u = data?.workout?.unit;
    const num = Number(u?.mile_equiv_numerator || 0);
    const den = Number(u?.mile_equiv_denominator || 1);
    const mpu = den ? num / den : 0;
    return Number.isFinite(mpu) && mpu > 0 ? mpu : 0;
  }, [data?.workout?.unit?.mile_equiv_numerator, data?.workout?.unit?.mile_equiv_denominator]);

  const workoutGoalDistance = useMemo(() => n(data?.workout?.goal_distance), [data?.workout?.goal_distance]);
  const goalDistanceMilesMax = useMemo(() => {
    if (unitTypeLower !== "time" || workoutGoalDistance == null || workoutGoalDistance <= 0) return null;
    const mph = Number(mphGoalInfo?.mph_goal ?? effectiveMphMax ?? data?.mph_goal ?? 0);
    if (!Number.isFinite(mph) || mph <= 0) return null;
    return (mph * workoutGoalDistance) / 60;
  }, [unitTypeLower, workoutGoalDistance, mphGoalInfo?.mph_goal, effectiveMphMax, data?.mph_goal]);
  const goalDistanceMiles = useMemo(() => {
    if (unitTypeLower === "time") return goalDistanceMilesMax;
    if (workoutGoalDistance == null || workoutGoalDistance <= 0 || milesPerUnit <= 0) return null;
    return workoutGoalDistance * milesPerUnit;
  }, [unitTypeLower, goalDistanceMilesMax, milesPerUnit, workoutGoalDistance]);
  const showGoalTime = workoutGoalDistance != null && workoutGoalDistance > 0 && unitTypeLower !== "time" && goalDistanceMiles !== null;
  const showGoalDistanceInput = workoutGoalDistance != null && workoutGoalDistance > 0 && unitTypeLower === "time";
  const goalDistanceLabel = useMemo(() => {
    if (workoutGoalDistance == null || workoutGoalDistance <= 0) return null;
    const formatted = formatGoalLabel(workoutGoalDistance);
    if (!formatted) return null;
    const unitName = data?.workout?.unit?.name || data?.workout?.unit?.unit_type;
    return unitName ? `${formatted} ${unitName}` : formatted;
  }, [data?.workout?.unit?.name, data?.workout?.unit?.unit_type, workoutGoalDistance]);
  const goalDistanceHeading = goalDistanceLabel ? `Goal Distance (${goalDistanceLabel})` : "Goal Distance";
  const goalDistanceGoalHeading = unitTypeLower === "time" ? `${goalDistanceHeading} Goal` : goalDistanceHeading;
  const goalDistanceMilesMaxLabel = useMemo(() => formatMilesLabel(goalDistanceMilesMax), [goalDistanceMilesMax]);
  const goalDistanceLabelForDisplay = goalDistanceMilesMaxLabel ?? goalDistanceLabel;
  const goalTimeLabel = goalDistanceLabel ? `Goal Time (${goalDistanceLabel})` : "Goal Time";

  // For distance units: compute Max/Avg times from persisted mph goals when available.
  const computedMphTimes = useMemo(() => {
    if (unitTypeLower === "time") return null;
    const mphAvg = Number(effectiveMphAvg ?? effectiveMphMax);
    // For sprints, display per-interval time regardless of total intervals planned.
    let units = isSprints ? 1 : Number(goalValue);
    if (!Number.isFinite(units) || units <= 0) {
      units = Number(mphGoalInfo?.distance);
    }
    if (isSprints) {
      units = 1;
    }
    if (!Number.isFinite(mphAvg) || mphAvg <= 0 || !Number.isFinite(units) || units <= 0 || milesPerUnit <= 0) return null;
    const miles = units * milesPerUnit;
    const tAvg = (miles / mphAvg) * 60;
    const mAvg = Math.trunc(tAvg);
    const sAvg = Math.round((tAvg - mAvg) * 60);
    return { minutes_avg: mAvg, seconds_avg: sAvg };
  }, [unitTypeLower, effectiveMphAvg, effectiveMphMax, goalValue, mphGoalInfo?.distance, milesPerUnit, isSprints]);

  // For time units: compute Miles (Max/Avg) from persisted mph goals when available.
  const computedMilesFromTime = useMemo(() => {
    if (unitTypeLower !== "time") return null;
    const minutesTotal = Number(goalValue);
    const mphAvg = Number(effectiveMphAvg ?? effectiveMphMax);
    if (!Number.isFinite(minutesTotal) || minutesTotal <= 0 || !Number.isFinite(mphAvg) || mphAvg <= 0) return null;
    const milesAvg = mphAvg * (minutesTotal / 60.0);
    const minutesInt = Math.trunc(minutesTotal);
    const seconds = Math.round((minutesTotal - minutesInt) * 60.0);
    return { miles_avg: Math.round(milesAvg * 100) / 100, minutes: minutesInt, seconds };
  }, [unitTypeLower, goalValue, effectiveMphAvg, effectiveMphMax]);

  const goalTimeGoal = useMemo(
    () => (showGoalTime ? n(mphGoalInfo?.goal_time_goal) : null),
    [showGoalTime, mphGoalInfo?.goal_time_goal]
  );

  const autoMax = useMemo(() => {
    const details = data?.details || [];
    if (!details.length) return null;
    let max = null;
    for (const d of details) {
      const v = n(d.running_mph);
      if (v !== null && (max === null || v > max)) max = v;
    }
    return max !== null ? Math.round(max * 1000) / 1000 : null;
  }, [data?.details]);

  // sync auto-calculated max to backend only when greater than stored value
  useEffect(() => {
    if (autoMax === null) return;
    const current = n(data?.max_mph);
    if (autoMax > (current ?? 0)) {
      (async () => {
        try {
          await fetch(`${API_BASE}/api/cardio/log/${id}/`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ max_mph: autoMax }),
          });
          await refetch();
          refreshMphGoal();
        } catch (err) {
          console.error(err);
        }
      })();
    }
  }, [autoMax, data?.max_mph, id, refetch, refreshMphGoal]);

  const autoGoalTime = useMemo(() => {
    if (!showGoalTime || unitTypeLower === "time") return null;
    const targetMiles = goalDistanceMiles;
    if (targetMiles == null || targetMiles <= 0) return null;

    const details = Array.isArray(data?.details) ? data.details : [];
    let milesFromDetails = 0;
    let minutesFromDetails = 0;
    for (const d of details) {
      const miles = n(d.running_miles);
      const mins = toMinutes(d.running_minutes, d.running_seconds);
      if (miles != null) milesFromDetails += miles;
      if (mins > 0) minutesFromDetails += mins;
    }
    const totalCompletedUnits = unitTypeLower !== "time" ? n(data?.total_completed) : null;
    const milesFromTotal = totalCompletedUnits != null && milesPerUnit > 0
      ? totalCompletedUnits * milesPerUnit
      : null;
    const milesDone = milesFromTotal ?? (milesFromDetails > 0 ? milesFromDetails : null);
    if (milesDone == null || milesDone <= 0) return null;

    let minutesValue = n(data?.minutes_elapsed);
    if (minutesValue == null || minutesValue <= 0) {
      minutesValue = minutesFromDetails > 0 ? minutesFromDetails : null;
    }
    if (minutesValue == null || minutesValue <= 0) return null;

    const estimate = (minutesValue / milesDone) * targetMiles;
    return Math.round(estimate * 1000) / 1000;
  }, [data?.details, data?.minutes_elapsed, data?.total_completed, goalDistanceMiles, milesPerUnit, showGoalTime, unitTypeLower]);

  useEffect(() => {
    if (autoGoalTime === null || !showGoalTime) return;
    const current = n(data?.goal_time);
    if (current !== null && autoGoalTime >= current) return;
    (async () => {
      try {
        await fetch(`${API_BASE}/api/cardio/log/${id}/`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ goal_time: autoGoalTime }),
        });
        await refetch();
      } catch (err) {
        console.error(err);
      }
    })();
  }, [autoGoalTime, data?.goal_time, id, refetch, showGoalTime]);

  // prevTM FIRST (used by others)
  // Sort details by datetime DESC for display and calculations
  const sortedDetails = useMemo(() => {
    const arr = Array.isArray(data?.details) ? [...data.details] : [];
    arr.sort((a, b) => new Date(b.datetime) - new Date(a.datetime));
    return arr;
  }, [data?.details]);

  const prevTM = useMemo(() => {
    if (!sortedDetails.length) return 0;
    const last = sortedDetails[0]; // newest first
    const m = n(last.treadmill_time_minutes) || 0;
    const s = n(last.treadmill_time_seconds) || 0;
    return m + s / 60;
  }, [sortedDetails]);

  const isFirstEntry = useMemo(() => (sortedDetails.length || 0) === 0, [sortedDetails]);

  const lastDetailTime = useMemo(() => {
    if (sortedDetails.length) return new Date(sortedDetails[0].datetime).getTime();
    return data?.datetime_started ? new Date(data.datetime_started).getTime() : null;
  }, [sortedDetails, data?.datetime_started]);

  const [restSeconds, setRestSeconds] = useState(0);
  useEffect(() => {
    if (!lastDetailTime) return;
    const update = () => setRestSeconds(Math.floor((Date.now() - lastDetailTime) / 1000));
    update();
    const t = setInterval(update, 1000);
    return () => clearInterval(t);
  }, [lastDetailTime]);

  const restTimerDisplay = useMemo(() => {
    const m = Math.floor(restSeconds / 60);
    const s = String(restSeconds % 60).padStart(2, "0");
    return `${m}:${s}`;
  }, [restSeconds]);

  const workoutIdKey = data?.workout?.id != null ? String(data.workout.id) : "";
  const restColor = useMemo(() => {
    const thresholds = workoutIdKey ? restThresholdsByWorkout[workoutIdKey] : null;
    return deriveRestColor(restSeconds, thresholds);
  }, [restSeconds, workoutIdKey, restThresholdsByWorkout]);

  // ---- Units ----
  // Fetch all CardioUnits
  const unitsApi = useApi(`${API_BASE}/api/cardio/units/`, { deps: [] });

  // Only distance units should be available for selection
  const distanceUnits = useMemo(() => (
    (unitsApi.data || []).filter(u => (u.unit_type || "").toLowerCase() === "distance")
  ), [unitsApi.data]);

  // default unit = workout.unit if it's distance; else the smallest distance unit id
  const defaultUnitId = useMemo(() => {
    const list = distanceUnits;
    if (!list.length) return "";
    const workoutUnit = data?.workout?.unit;
    if (workoutUnit && (workoutUnit.unit_type || "").toLowerCase() === "distance") {
      return String(workoutUnit.id);
    }
    return String(Math.min(...list.map(u => u.id)));
  }, [distanceUnits, data?.workout?.unit]);

  const [unitId, setUnitId] = useState("");
  useEffect(() => { if (!unitId && defaultUnitId) setUnitId(defaultUnitId); }, [unitId, defaultUnitId]);

  const selectedUnit = useMemo(() => {
    return distanceUnits.find(u => String(u.id) === String(unitId));
  }, [distanceUnits, unitId]);

  // miles per 1 "unit" (e.g., 400m ≈ 0.248548 mi)
  const unitMilesFactor = useMemo(() => {
    if (!selectedUnit) return 1;
    const num = Number(selectedUnit.mile_equiv_numerator);
    const den = Number(selectedUnit.mile_equiv_denominator || 1);
    const f = num / den;
    return Number.isFinite(f) && f > 0 ? f : 1;
  }, [selectedUnit]);

  const unitRoundStep = useMemo(() => {
    if (!selectedUnit) return 0;
    const num = Number(selectedUnit.mround_numerator);
    const den = Number(selectedUnit.mround_denominator || 1);
    if (!Number.isFinite(num) || !Number.isFinite(den) || den === 0) return 0;
    return num / den;
  }, [selectedUnit]);

  const isTimePerDist = (selectedUnit?.speed_type || "").toLowerCase() === "time/distance";
  const speedLabelText = (selectedUnit?.speed_label || "").toLowerCase(); // e.g., "mph"

  // Warmup settings determine the baseline for the first interval's TM
  const [tmSync, setTmSync] = useState("run_to_tm");
  const [tmDefault, setTmDefault] = useState("run_to_tm");
  const workoutUnitRoundStep = useMemo(() => {
    const unit = data?.workout?.unit;
    if (!unit) return 0;
    const num = Number(unit.mround_numerator);
    const den = Number(unit.mround_denominator || 1);
    if (!Number.isFinite(num) || !Number.isFinite(den) || den === 0) return 0;
    return num / den;
  }, [data?.workout?.unit?.mround_numerator, data?.workout?.unit?.mround_denominator]);

  const [warmupDefaults, setWarmupDefaults] = useState({ minutes: null, mph: null });

  useEffect(() => {
    const wid = data?.workout?.id;
    if (!wid) {
      setWarmupDefaults({ minutes: null, mph: null });
      return;
    }
    let ignore = false;
    const fetchWarmup = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/cardio/warmup-defaults/?workout_id=${wid}`);
        if (!res.ok) {
          if (!ignore) setWarmupDefaults({ minutes: null, mph: null });
          return;
        }
        const payload = await res.json();
        if (ignore) return;
        const item = Array.isArray(payload) && payload[0] ? payload[0] : null;
        setWarmupDefaults({
          minutes: item ? n(item.warmup_minutes) : null,
          mph: item ? n(item.warmup_mph) : null,
        });
      } catch (_) {
        if (!ignore) setWarmupDefaults({ minutes: null, mph: null });
      }
    };
    fetchWarmup();
    return () => { ignore = true; };
  }, [data?.workout?.id]);

  const warmupMinutes = useMemo(() => {
    const val = warmupDefaults.minutes;
    return val != null && Number.isFinite(val) && val > 0 ? val : 0;
  }, [warmupDefaults.minutes]);

  const warmupMph = useMemo(() => {
    const val = warmupDefaults.mph;
    return val != null && Number.isFinite(val) && val > 0 ? val : 0;
  }, [warmupDefaults.mph]);

  const shouldApplyWarmup = useMemo(() => {
    if (!isFirstEntry) return false;
    if (!(warmupMinutes > 0)) return false;
    const defaultSync = tmDefault || "run_to_tm";
    const activeSync = tmSync || defaultSync;
    if (defaultSync === "run_equals_tm") return false;
    if (activeSync === "run_equals_tm") return false;
    return true;
  }, [isFirstEntry, warmupMinutes, tmDefault, tmSync]);

  const formattedTotalCompleted = useMemo(() => {
    const val = data?.total_completed;
    if (val === null || val === undefined) return "\u2014";
    const formatted = formatWithStep(val, workoutUnitRoundStep);
    return formatted !== "" ? formatted : "0";
  }, [data?.total_completed, workoutUnitRoundStep]);

  const effectivePrev = useMemo(
    () => {
      if (isFirstEntry) {
        return shouldApplyWarmup ? warmupMinutes : 0;
      }
      return prevTM;
    },
    [isFirstEntry, prevTM, shouldApplyWarmup, warmupMinutes]
  );

  const [addModalOpen, setAddModalOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);

  // add-one-interval form (we persist miles + mph to backend)
  const [row, setRow] = useState(emptyRow);

  // Fetch default TM sync for this workout
  useEffect(() => {
    const wid = data?.workout?.id;
    if (!wid) return;
    let ignore = false;
    const fetchDefault = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/cardio/tm-sync-defaults/?workout_id=${wid}`);
        if (!res.ok) return;
        const arr = await res.json();
        const val = Array.isArray(arr) && arr[0]?.default_tm_sync ? arr[0].default_tm_sync : "run_to_tm";
        if (!ignore) setTmDefault(val);
      } catch (_) { /* ignore */ }
    };
    fetchDefault();
    return () => { ignore = true; };
  }, [data?.workout?.id]);

  // ---- Display helpers for distance/speed in selected unit ----
  const displayDistance = useMemo(() => {
    const mi = n(row.running_miles);
    if (!mi || mi <= 0) return "";
    const units = mi / unitMilesFactor;
    if (!Number.isFinite(units)) return "";
    return formatWithStep(units, unitRoundStep);
  }, [row.running_miles, unitMilesFactor, unitRoundStep]);

  const displaySpeedOrPace = useMemo(() => {
    const mph = n(row.running_mph);
    if (!mph || mph <= 0) return "";

    let displayVal;
    if (isTimePerDist) {
      // pace: min per unit = (min per mile) * (miles per unit)
      displayVal = (60 / mph) * unitMilesFactor;
    } else if (speedLabelText === "mph") {
      // show mph directly
      displayVal = mph;
    } else {
      // else show units/hour
      displayVal = mph / unitMilesFactor;
    }

    if (!Number.isFinite(displayVal)) return "";
    if (isTimePerDist || speedLabelText !== "mph") {
      return formatWithStep(displayVal, unitRoundStep);
    }
    return formatNumber(displayVal, 3);
  }, [row.running_mph, unitMilesFactor, isTimePerDist, speedLabelText, unitRoundStep]);

  // exercises dropdown (for intervals)
  const exApi = useApi(`${API_BASE}/api/cardio/exercises/`, { deps: [] });
  const minExerciseId = useMemo(() => {
    const list = exApi.data || [];
    return list.length ? String(Math.min(...list.map(x => x.id))) : "";
  }, [exApi.data]);

  // defaults (exercise + initial TM baseline behavior)
  useEffect(() => {
    setRow(r => {
      const exercise_id = r.exercise_id || minExerciseId || "";

      // If treadmill fields are empty, decide how to prefill them:
      let tmM = r.treadmill_time_minutes;
      let tmS = r.treadmill_time_seconds;

      if (tmM === "" && tmS === "") {
        const intervalMin = toMinutes(r.running_minutes, r.running_seconds);

        if (isFirstEntry) {
          const baseWarmup = shouldApplyWarmup ? warmupMinutes : 0;
          const { m, s } = fromMinutes(baseWarmup + intervalMin);
          tmM = m; tmS = s;
          // Do NOT alter running_minutes/seconds here.
        } else {
          // Not first: TM = prevTM + interval
          if (intervalMin > 0) {
            const { m, s } = fromMinutes(prevTM + intervalMin);
            tmM = m; tmS = s;
          }
        }
      }

      return { ...r, exercise_id, treadmill_time_minutes: tmM, treadmill_time_seconds: tmS };
    });
  }, [minExerciseId, prevTM, isFirstEntry, addModalOpen, warmupMinutes, shouldApplyWarmup]);

  const setField = (patch) => setRow(r => ({ ...r, ...patch }));

  // ---- Handlers (miles/mins/seconds/TM/mph) ----
  const onChangeMinutes = (v) => {
    const mph = mphFrom(row.running_miles, v, row.running_seconds);
    const patch = { running_minutes: v, running_mph: mph };
  if (tmSync === "run_to_tm" || tmSync === "run_equals_tm") {
    const intervalMin = toMinutes(v, row.running_seconds);
    const { m, s } = fromMinutes(effectivePrev + intervalMin);
    patch.treadmill_time_minutes = m;
    patch.treadmill_time_seconds = s;
  }
    setField(patch);
  };
  const onChangeSeconds = (v) => {
    const mph = mphFrom(row.running_miles, row.running_minutes, v);
    const patch = { running_seconds: v, running_mph: mph };
  if (tmSync === "run_to_tm" || tmSync === "run_equals_tm") {
    const intervalMin = toMinutes(row.running_minutes, v);
    const { m, s } = fromMinutes(effectivePrev + intervalMin);
    patch.treadmill_time_minutes = m;
    patch.treadmill_time_seconds = s;
  }
    setField(patch);
  };

  // distance entry in SELECTED UNIT -> convert to miles
  const onChangeDistanceDisplay = (v) => {
    if (v === "") {
      setField({ running_miles: "", running_mph: mphFrom("", row.running_minutes, row.running_seconds) });
      return;
    }
    const val = Number(v);
    if (!Number.isFinite(val) || val < 0) return;
    const miles = val * unitMilesFactor;
    const mph = mphFrom(miles, row.running_minutes, row.running_seconds);
    setField({ running_miles: miles, running_mph: mph });
  };

  // MPH change via SELECTED UNIT speed/pace input
const onChangeSpeedDisplay = (v) => {
  if (v === "") {
    setField({ running_mph: "" });
    return;
  }
  const val = Number(v);
  if (!Number.isFinite(val) || val <= 0) return;

  let mph;
  if (isTimePerDist) {
    // pace (min per unit) -> mph
    mph = 60 * unitMilesFactor / val;
  } else {
    // distance/time
    mph = (speedLabelText === "mph") ? val : val * unitMilesFactor;
  }

  // drive the rest from mph
  const { m, s } = minsFrom(mph, row.running_miles);
  const patch = { running_mph: mph, running_minutes: m, running_seconds: s };
  if (tmSync === "run_to_tm" || tmSync === "run_equals_tm") {
    const intervalMin = toMinutes(m, s);
    const { m: tmM, s: tmS } = fromMinutes(effectivePrev + intervalMin);
    patch.treadmill_time_minutes = tmM;
    patch.treadmill_time_seconds = tmS;
  }
  setField(patch);
};


  const onChangeTmMinutes = (v) => {
    if (tmSync === "tm_to_run" || tmSync === "run_equals_tm") {
      const totalMins = toMinutes(v, row.treadmill_time_seconds);
      const interval = Math.max(0, totalMins - effectivePrev);
      const { m, s } = fromMinutes(interval);
      const mph = mphFrom(row.running_miles, m, s);
      setField({ treadmill_time_minutes: v, running_minutes: m, running_seconds: s, running_mph: mph });
    } else {
      setField({ treadmill_time_minutes: v });
    }
  };
  const onChangeTmSeconds = (v) => {
    if (tmSync === "tm_to_run" || tmSync === "run_equals_tm") {
      const totalMins = toMinutes(row.treadmill_time_minutes, v);
      const interval = Math.max(0, totalMins - effectivePrev);
      const { m, s } = fromMinutes(interval);
      const mph = mphFrom(row.running_miles, m, s);
      setField({ treadmill_time_seconds: v, running_minutes: m, running_seconds: s, running_mph: mph });
    } else {
      setField({ treadmill_time_seconds: v });
    }
  };

  const openModal = async () => {
    setEditingId(null);
    setTmSync(tmDefault || "run_to_tm");
    let base = { ...emptyRow, datetime: toIsoLocalNow() };
    try {
      const res = await fetch(`${API_BASE}/api/cardio/log/${id}/last-interval/`);
      if (res.ok) {
        const d = await res.json();
        base = {
          ...base,
          running_minutes: d.running_minutes ?? "",
          running_seconds: d.running_seconds ?? "",
          running_miles: d.running_miles ?? "",
          running_mph: d.running_mph ?? "",
        };
      }
    } catch (err) {
      console.error(err);
    }
    setRow(base);
    setAddModalOpen(true);
  };
  const openEdit = (detail) => {
    setEditingId(detail.id);
    const ex = (exApi.data || []).find(e => e.name === detail.exercise);
    setRow({
      datetime: toIsoLocal(detail.datetime),
      exercise_id: ex ? String(ex.id) : "",
      running_minutes: detail.running_minutes ?? "",
      running_seconds: detail.running_seconds ?? "",
      running_miles: detail.running_miles ?? "",
      running_mph: detail.running_mph ?? "",
      treadmill_time_minutes: detail.treadmill_time_minutes ?? "",
      treadmill_time_seconds: detail.treadmill_time_seconds ?? "",
    });
    setAddModalOpen(true);
    setTmSync(tmDefault || "run_to_tm");
  };
  const closeModal = () => {
    setAddModalOpen(false);
    setEditingId(null);
    setRow(emptyRow);
  };

  // create or update detail
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setSaveErr(null);
    try {
      const wasFirstEntry = isFirstEntry && !editingId;
      const payload = {
        datetime: new Date(row.datetime).toISOString(),
        exercise_id: row.exercise_id ? Number(row.exercise_id) : null,
        running_minutes: row.running_minutes === "" ? null : Number(row.running_minutes),
        running_seconds: row.running_seconds === "" ? null : Number(row.running_seconds),
        running_miles: row.running_miles === "" ? null : Number(row.running_miles),
        running_mph: row.running_mph === "" ? null : Number(row.running_mph),
        treadmill_time_minutes: row.treadmill_time_minutes === "" ? null : Number(row.treadmill_time_minutes),
        treadmill_time_seconds: row.treadmill_time_seconds === "" ? null : Number(row.treadmill_time_seconds),
      };
      const url = editingId
        ? `${API_BASE}/api/cardio/log/${id}/details/${editingId}/`
        : `${API_BASE}/api/cardio/log/${id}/details/`;
      const method = editingId ? "PATCH" : "POST";
      const body = editingId ? JSON.stringify(payload) : JSON.stringify({ details: [payload] });
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body,
      });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      await res.json();
      // If this was the first interval, compute Max MPH using warmup portion and patch the log
      if (wasFirstEntry) {
        const intervalMinutes = toMinutes(payload.running_minutes, payload.running_seconds);
        // Derive miles if not provided but mph + time are available
        let intervalMiles = payload.running_miles;
        if ((intervalMiles === null || intervalMiles === undefined) && payload.running_mph != null) {
          const mphVal = Number(payload.running_mph);
          if (Number.isFinite(mphVal) && mphVal > 0 && Number.isFinite(intervalMinutes) && intervalMinutes > 0) {
            intervalMiles = mphVal * (intervalMinutes / 60);
          }
        }

        const applyWarmup = shouldApplyWarmup && !editingId;
        const wuMin = applyWarmup ? warmupMinutes : 0;
        const wuMph = applyWarmup ? warmupMph : 0;
        const remMinutes = Math.max(0, (Number(intervalMinutes) || 0) - wuMin);
        const wuMiles = wuMin > 0 && wuMph > 0 ? (wuMin / 60) * wuMph : 0;
        const remMiles = Math.max(0, (Number(intervalMiles) || 0) - wuMiles);

        let computedMax = null;
        if (remMinutes > 0 && remMiles > 0) {
          computedMax = remMiles / (remMinutes / 60);
        } else if (Number.isFinite(payload.running_mph)) {
          computedMax = Number(payload.running_mph);
        }

        if (computedMax != null && Number.isFinite(computedMax) && computedMax > 0) {
          const rounded = Math.round(computedMax * 1000) / 1000;
          try {
            const patchRes = await fetch(`${API_BASE}/api/cardio/log/${id}/`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ max_mph: rounded }),
            });
            if (patchRes.ok) {
              await patchRes.json();
            }
          } catch (_) {
            // ignore
          }
        }
      }
      await refetch();
      refreshMphGoal();
      closeModal();
    } catch (err) {
      setSaveErr(err);
    } finally {
      setSaving(false);
    }
  };

  // delete interval
  const [deletingId, setDeletingId] = useState(null);
  const [deleteErr, setDeleteErr] = useState(null);
  const deleteDetail = async (detailId) => {
    if (!confirm("Delete this interval?")) return;
    setDeletingId(detailId);
    setDeleteErr(null);
    try {
      const res = await fetch(`${API_BASE}/api/cardio/log/${id}/details/${detailId}/delete/`, { method: "DELETE" });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      await refetch();
      refreshMphGoal();
    } catch (e) {
      setDeleteErr(e);
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div>
      <div style={{ marginBottom: 12 }}>
        <Link to="/cardio" style={{ textDecoration: "none" }}>← Back</Link>
      </div>
      <Card title={`Log #${id}`} action={null}>
        {loading && <div>Loading…</div>}
        {error && <div style={{ color: "#b91c1c" }}>Error: {String(error.message || error)}</div>}
        {deleteErr && <div style={{ color: "#b91c1c" }}>Delete error: {String(deleteErr.message || deleteErr)}</div>}

        {!loading && !error && data && (
          <>
              <div style={{ marginBottom: 8 }}>
                <div><strong>Workout:</strong> {data.workout?.name} <span style={{ opacity: 0.7 }}>({data.workout?.routine?.name})</span></div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, opacity: 0.8, fontSize: 12 }}>
                  <input type="datetime-local" value={startedAt} onChange={(e) => setStartedAt(e.target.value)} />
                  <button type="button" style={btnStyle} onClick={saveStart} disabled={updatingStart}>
                    {updatingStart ? "Saving…" : "Save"}
                  </button>
                </div>
                {updateStartErr && <div style={{ color: "#b91c1c", fontSize: 12 }}>Error: {String(updateStartErr.message || updateStartErr)}</div>}
              </div>
            <Row left="Goal" right={data.goal ?? "—"} />
            {unitTypeLower === "time" && (goalDistanceLabelForDisplay || goalDistanceLabel) && (
              <Row left={goalDistanceGoalHeading} right={goalDistanceLabelForDisplay || goalDistanceLabel} />
            )}
            <Row left="Total Completed" right={formattedTotalCompleted} />
            <Row
              left="MPH Goal (Max/Avg)"
              right={(() => {
                const maxVal = effectiveMphMax;
                const avgVal = effectiveMphAvg;
                const showDistributionButton = (isSprints || isFiveKPrep) && (maxVal != null || avgVal != null || mphGoalInfo);
                const maxInputValue = overrideMphMax !== "" ? overrideMphMax : (n(data?.mph_goal) ?? n(mphGoalInfo?.mph_goal) ?? "");
                const avgInputValue = overrideMphAvg !== "" ? overrideMphAvg : (n(data?.mph_goal_avg) ?? n(mphGoalInfo?.mph_goal_avg) ?? "");
                return (
                  <div style={{ textAlign: "right", display: "grid", gap: 6 }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 8 }}>
                      <div>
                        <span style={{ opacity: 0.8 }}>Max:</span> {maxVal ?? "—"}
                        {avgVal != null && (
                          <span>
                            {"  |  "}
                            <span style={{ opacity: 0.8 }}>Avg:</span> {avgVal}
                          </span>
                        )}
                      </div>
                      {showDistributionButton && (
                        <button type="button" style={distributionBtnStyle} onClick={handleViewDistribution}>View distribution</button>
                      )}
                    </div>
                    <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", alignItems: "center" }}>
                      <label style={{ display: "flex", alignItems: "center", gap: 4 }}>
                        <span style={{ fontSize: 12, opacity: 0.7 }}>Override Max</span>
                        <input
                          type="number"
                          step="0.1"
                          value={maxInputValue}
                          onChange={(e) => setOverrideMphMax(e.target.value)}
                          style={{ width: 90 }}
                        />
                      </label>
                      <label style={{ display: "flex", alignItems: "center", gap: 4 }}>
                        <span style={{ fontSize: 12, opacity: 0.7 }}>Override Avg</span>
                        <input
                          type="number"
                          step="0.1"
                          value={avgInputValue}
                          onChange={(e) => setOverrideMphAvg(e.target.value)}
                          style={{ width: 90 }}
                        />
                      </label>
                      <button
                        type="button"
                        style={distributionBtnStyle}
                        onClick={() => { setOverrideMphMax(""); setOverrideMphAvg(""); }}
                      >
                        Reset
                      </button>
                    </div>
                    {(computedMilesFromTime || mphGoalInfo) && (
                      unitTypeLower === "time" ? (
                        <>
                          {(computedMilesFromTime?.miles_avg != null || mphGoalInfo?.miles_avg != null || mphGoalInfo?.miles != null) && (
                            <div style={{ fontSize: 12 }}>Miles (Avg): {(computedMilesFromTime?.miles_avg ?? mphGoalInfo?.miles_avg ?? mphGoalInfo?.miles)}</div>
                          )}
                          <div style={{ fontSize: 12 }}>
                          Time: {(computedMilesFromTime?.minutes ?? mphGoalInfo?.minutes)} minutes{(computedMilesFromTime?.seconds ?? mphGoalInfo?.seconds) ? ` ${(computedMilesFromTime?.seconds ?? mphGoalInfo?.seconds)} seconds` : ""}
                          </div>
                        </>
                      ) : (
                        <>
                          <div style={{ fontSize: 12 }}>
                            {(data.workout?.unit?.name || "Distance")}: {(mphGoalInfo?.distance ?? goalValue)}
                          </div>
                          {(
                            (computedMphTimes && computedMphTimes.minutes_avg != null) ||
                            (mphGoalInfo?.minutes_avg != null) ||
                            (mphGoalInfo?.minutes != null)
                          ) && (
                            <div style={{ fontSize: 12 }}>
                              Time (Avg): {(computedMphTimes?.minutes_avg ?? mphGoalInfo?.minutes_avg ?? mphGoalInfo?.minutes)} minutes
                              {(computedMphTimes?.seconds_avg ?? mphGoalInfo?.seconds_avg ?? mphGoalInfo?.seconds) ? ` ${(computedMphTimes?.seconds_avg ?? mphGoalInfo?.seconds_avg ?? mphGoalInfo?.seconds)} seconds` : ""}
                            </div>
                          )}
                        </>
                      )
                    )}
                  </div>
                );
              })()}
            />
            {showGoalTime && (
              <Row
                left={goalTimeLabel ? `${goalTimeLabel} Goal` : "Goal Time Goal"}
                right={
                  <div style={{ textAlign: "right" }}>
                    <div>{goalTimeGoal != null ? formatMinutesValue(goalTimeGoal) : "—"}</div>
                  </div>
                }
              />
            )}
            {showGoalDistanceInput && (
              <Row
                left={goalDistanceHeading}
                right={
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <label style={{ display: "flex", alignItems: "center", gap: 4 }}>
                      <span style={{ fontSize: 12, opacity: 0.7 }}>Miles</span>
                      <input
                        type="number"
                        step="any"
                        value={goalDistanceInput}
                        onChange={(e) => setGoalDistanceInput(e.target.value)}
                        style={{ width: 90 }}
                      />
                    </label>
                    <button
                      type="button"
                      style={btnStyle}
                      onClick={saveGoalTime}
                      disabled={updatingGoalTime || !hasValidGoalInput}
                    >
                      {updatingGoalTime ? "Saving..." : "Save"}
                    </button>
                  </div>
                }
              />
            )}
            {showGoalTime && (
              <Row
                left={goalTimeLabel || "Goal Time"}
                right={
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <label style={{ display: "flex", alignItems: "center", gap: 4 }}>
                      <span style={{ fontSize: 12, opacity: 0.7 }}>Min</span>
                      <input
                        type="number"
                        step="1"
                        value={goalTimeMinutesInput}
                        onChange={(e) => setGoalTimeMinutesInput(e.target.value)}
                        style={{ width: 70 }}
                      />
                    </label>
                    <label style={{ display: "flex", alignItems: "center", gap: 4 }}>
                      <span style={{ fontSize: 12, opacity: 0.7 }}>Sec</span>
                      <input
                        type="number"
                        step="0.01"
                        value={goalTimeSecondsInput}
                        onChange={(e) => setGoalTimeSecondsInput(e.target.value)}
                        style={{ width: 80 }}
                      />
                    </label>
                    <button
                      type="button"
                      style={btnStyle}
                      onClick={saveGoalTime}
                      disabled={updatingGoalTime || !hasValidGoalInput}
                    >
                      {updatingGoalTime ? "Saving..." : "Save"}
                    </button>
                    {autoGoalTime !== null && (
                      <span style={{ fontSize: 12, opacity: 0.7 }}>Auto: {formatMinutesValue(autoGoalTime)}</span>
                    )}
                  </div>
                }
              />
            )}
            {(showGoalTime || showGoalDistanceInput) && updateGoalTimeErr && (
              <div style={{ color: "#b91c1c", fontSize: 12 }}>
                Error: {String(updateGoalTimeErr.message || updateGoalTimeErr)}
              </div>
            )}
            <Row
              left="Max MPH"
              right={
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <input
                    type="number"
                    step="any"
                    value={maxMphInput}
                    onChange={(e) => setMaxMphInput(e.target.value)}
                    style={{ width: 80 }}
                  />
                  <button
                    type="button"
                    style={btnStyle}
                    onClick={saveMax}
                    disabled={
                      updatingMax ||
                      n(maxMphInput) === null ||
                      (autoMax !== null && n(maxMphInput) < autoMax)
                    }
                  >
                    {updatingMax ? "Saving…" : "Save"}
                  </button>
                </div>
              }
            />
            {updateMaxErr && (
              <div style={{ color: "#b91c1c", fontSize: 12 }}>
                Error: {String(updateMaxErr.message || updateMaxErr)}
              </div>
            )}
            <Row left="Avg MPH" right={data.avg_mph ?? "—"} />
            <Row left="Minutes Elapsed" right={data.minutes_elapsed ?? "—"} />
            <Row
              left="Rest Timer"
              right={
                <span
                  title={`Rest Timer (${restColor.label})`}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 8,
                    fontSize: 12,
                    padding: "4px 8px",
                    borderRadius: 6,
                    background: restColor.bg,
                    color: restColor.fg,
                    border: `1px solid ${restColor.fg}20`,
                  }}
                >
                  {restTimerDisplay}
                </span>
              }
            />

            <div style={{ height: 8 }} />
            <div style={{ fontWeight: 600, marginBottom: 6 }}>Intervals</div>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left", padding: "4px 8px" }}>Time</th>
                  <th style={{ textAlign: "left", padding: "4px 8px" }}>Exercise</th>
                  <th style={{ textAlign: "left", padding: "4px 8px" }}>Run</th>
                  <th style={{ textAlign: "left", padding: "4px 8px" }}>TM</th>
                  <th style={{ textAlign: "left", padding: "4px 8px" }}>Miles</th>
                  <th style={{ textAlign: "left", padding: "4px 8px" }}>MPH</th>
                  <th style={{ padding: "4px 8px" }} />
                </tr>
              </thead>
              <tbody>
                {sortedDetails.map(d => (
                  <tr key={d.id}>
                    <td style={{ padding: "4px 8px" }}>{new Date(d.datetime).toLocaleString()}</td>
                    <td style={{ padding: "4px 8px" }}>{d.exercise}</td>
                    <td style={{ padding: "4px 8px" }}>
                      {d.running_minutes ? `${d.running_minutes} min` : ""}{d.running_seconds ? ` ${d.running_seconds}s` : ""}
                    </td>
                    <td style={{ padding: "4px 8px" }}>
                      {d.treadmill_time_minutes ? `${d.treadmill_time_minutes} min` : ""}{d.treadmill_time_seconds ? ` ${d.treadmill_time_seconds}s` : ""}
                    </td>
                    <td style={{ padding: "4px 8px" }}>{d.running_miles ? d.running_miles : ""}</td>
                    <td style={{ padding: "4px 8px" }}>{d.running_mph ? d.running_mph : ""}</td>
                    <td style={{ padding: "4px 8px" }}>
                      <button
                        type="button"
                        style={editBtnInline}
                        aria-label={`Edit interval ${d.id}`}
                        title="Edit interval"
                        onClick={() => openEdit(d)}
                      >
                        ✎
                      </button>
                      <button
                        type="button"
                        style={xBtnInline}
                        aria-label={`Delete interval ${d.id}`}
                        title="Delete interval"
                        onClick={() => deleteDetail(d.id)}
                        disabled={deletingId === d.id}
                      >
                        {deletingId === d.id ? "…" : "✕"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div style={{ height: 12 }} />
            <button type="button" style={btnStyle} onClick={openModal} disabled={unitsApi.loading}>Add interval</button>
            <Modal open={distributionOpen}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <div style={{ fontWeight: 600, fontSize: 16 }}>{distributionState.title || "Distribution"}</div>
                <button
                  type="button"
                  style={{ ...distributionBtnStyle, marginLeft: 0 }}
                  onClick={resetDistribution}
                >
                  Close
                </button>
              </div>
              {distributionState.meta.length > 0 && (
                <div style={{ fontSize: 13, marginBottom: 8, color: "#374151" }}>
                  {distributionState.meta.join(" | ")}
                </div>
              )}
              {distributionState.error ? (
                <div style={{ color: "#b91c1c", fontSize: 13 }}>{distributionState.error}</div>
              ) : distributionState.rows.length > 0 ? (
                <div style={{ display: "grid", rowGap: 4, fontSize: 13 }}>
                  {distributionState.rows.map((row, index) => (
                    <div
                      key={row?.label || index}
                      style={{ display: "flex", justifyContent: "space-between", gap: 16, padding: "6px 10px", border: "1px solid #e5e7eb", borderRadius: 6 }}
                    >
                      <span style={{ color: "#6b7280" }}>{row?.label ?? `Set ${index + 1}`}</span>
                      <div style={{ textAlign: "right" }}>
                        <div>{row?.primary ?? "-"}</div>
                        {row?.secondary && (
                          <div style={{ fontSize: 12, color: "#6b7280" }}>{row.secondary}</div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ fontSize: 13, color: "#6b7280" }}>No distribution to display.</div>
              )}
            </Modal>
            <Modal open={addModalOpen}>
            <form onSubmit={submit}>
              <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>

                {/* Unit selector */}
                <label>
                  <div>Units</div>
                  <select value={unitId} onChange={(e) => setUnitId(e.target.value)} disabled={unitsApi.loading || !distanceUnits.length}>
                    {unitsApi.loading && <option value="">Loading…</option>}
                    {!unitsApi.loading && distanceUnits.map(u => (
                      <option key={u.id} value={u.id}>{u.name}</option>
                    ))}
                  </select>
                </label>

                <label><div>Time (local)</div><input type="datetime-local" value={row.datetime} onChange={(e) => setField({ datetime: e.target.value })} /></label>

                {/* TM sync behavior */}
                <label>
                  <div>TM Sync</div>
                  <select value={tmSync} onChange={(e) => setTmSync(e.target.value)}>
                    <option value="run_to_tm">Run time → TM</option>
                    <option value="tm_to_run">TM → Run time</option>
                    <option value="run_equals_tm">Run time = TM</option>
                    <option value="none">No sync</option>
                  </select>
                </label>

                {/* Distance in selected unit */}
                <label>
                  <div>Distance ({selectedUnit?.name || "units"})</div>
                  <input
                    type="number"
                    step="any"
                    value={displayDistance}
                    onChange={(e) => onChangeDistanceDisplay(e.target.value)}
                  />
                </label>

                {/* Interval time */}
                <label><div>Running Minutes</div><input type="number" step="1" value={row.running_minutes} onChange={(e) => onChangeMinutes(e.target.value)} /></label>
                <label><div>Running Seconds</div><input type="number" step="any" value={row.running_seconds} onChange={(e) => onChangeSeconds(e.target.value)} /></label>

                {/* Speed or Pace in selected unit */}
                <label>
                  <div>
                    {isTimePerDist
                      ? `Pace (min / ${selectedUnit?.name || "unit"})`
                      : `Speed (${(selectedUnit?.speed_label || `${selectedUnit?.name || "unit"}/hr`)})`}
                  </div>

                  <input
                    type="number"
                    step="0.1"
                    value={displaySpeedOrPace}
                    onChange={(e) => onChangeSpeedDisplay(e.target.value)}
                  />
                </label>

                {/* Cumulative TM */}
                <label><div>TM Minutes (cumulative)</div><input type="number" step="1" value={row.treadmill_time_minutes} onChange={(e) => onChangeTmMinutes(e.target.value)} /></label>
                <label><div>TM Seconds (cumulative)</div><input type="number" step="any" value={row.treadmill_time_seconds} onChange={(e) => onChangeTmSeconds(e.target.value)} /></label>
              </div>

              <div style={{ marginTop: 8 }}>
                <button type="submit" style={btnStyle} disabled={saving || unitsApi.loading}>{saving ? "Saving…" : (editingId ? "Save interval" : "Add interval")}</button>
                <button type="button" style={{ ...btnStyle, marginLeft: 8 }} onClick={closeModal} disabled={saving}>Cancel</button>
                {saveErr && <span style={{ marginLeft: 8, color: "#b91c1c" }}>Error: {String(saveErr.message || saveErr)}</span>}
              </div>
            </form>
            </Modal>
          </>
        )}
      </Card>
    </div>
  );
}



