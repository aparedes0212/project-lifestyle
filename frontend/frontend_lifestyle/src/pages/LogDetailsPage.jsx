import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import useApi from "../hooks/useApi";
import { API_BASE } from "../lib/config";
import Card from "../components/ui/Card";
import Row from "../components/ui/Row";
import Modal from "../components/ui/Modal";
import CardioDistributionModal from "../components/CardioDistributionModal";
import { formatWithStep, formatNumber } from "../lib/numberFormat";
import { deriveRestColor } from "../lib/restColors";
import { emptyCardioDistributionState, fetchCardioDistribution } from "../lib/cardioDistribution";
import { cardioRouteForRoutineName } from "../lib/routineRoutes";
import { tableActionButtonStyle, tableDangerButtonStyle } from "../lib/tableActions";

const btnStyle = { border: "1px solid #e5e7eb", background: "#f9fafb", borderRadius: 8, padding: "6px 10px", cursor: "pointer" };
const distributionBtnStyle = { border: "none", background: "transparent", color: "#2563eb", cursor: "pointer", fontSize: 12, padding: 0, marginLeft: 8 };
const goalsTableStyle = { width: "auto", display: "inline-table", borderCollapse: "collapse", marginBottom: 8, tableLayout: "fixed", fontSize: 18, fontWeight: 600, border: "1px solid #e5e7eb" };
const goalsTableHeaderCellStyle = { textAlign: "left", padding: "6px 8px", fontSize: 16, fontWeight: 700, color: "#374151", border: "1px solid #e5e7eb" };
const goalsTableCellStyle = { padding: "6px 8px", border: "1px solid #e5e7eb", whiteSpace: "nowrap" };
const goalTypeIndicatorColors = [
  "#1d4ed8",
  "#059669",
  "#b45309",
  "#be123c",
  "#7c3aed",
  "#0f766e",
  "#475569",
  "#0ea5e9",
];
const clampPercent = (value) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return 1;
  return Math.min(100, Math.max(1, Math.round(num)));
};
const emptyTrendlineState = () => ({
  loading: false,
  error: null,
  data: null,
  slider: 1,
});
const evalTrendlineMph = (fitType, params, percent) => {
  const x = Number(percent);
  if (!Number.isFinite(x) || x <= 0) return null;
  try {
    if (fitType === "linear") {
      const a = Number(params?.a);
      const b = Number(params?.b);
      const y = (a * x) + b;
      return Number.isFinite(y) && y > 0 ? y : null;
    }
    if (fitType === "exponential") {
      const a = Number(params?.a);
      const b = Number(params?.b);
      const y = a * Math.exp(b * x);
      return Number.isFinite(y) && y > 0 ? y : null;
    }
    if (fitType === "logarithmic") {
      const a = Number(params?.a);
      const b = Number(params?.b);
      const y = (a * Math.log(x)) + b;
      return Number.isFinite(y) && y > 0 ? y : null;
    }
    if (fitType === "power") {
      const a = Number(params?.a);
      const b = Number(params?.b);
      const y = a * (x ** b);
      return Number.isFinite(y) && y > 0 ? y : null;
    }
  } catch {
    return null;
  }
  return null;
};
const trendlinePercentForMph = (fitType, params, mph) => {
  const y = Number(mph);
  if (!Number.isFinite(y) || y <= 0) return null;
  try {
    let x = null;
    if (fitType === "linear") {
      const a = Number(params?.a);
      const b = Number(params?.b);
      if (!Number.isFinite(a) || !Number.isFinite(b) || Math.abs(a) < 1e-12) return null;
      x = (y - b) / a;
    } else if (fitType === "exponential") {
      const a = Number(params?.a);
      const b = Number(params?.b);
      if (!Number.isFinite(a) || !Number.isFinite(b) || a <= 0 || Math.abs(b) < 1e-12) return null;
      const ratio = y / a;
      if (!Number.isFinite(ratio) || ratio <= 0) return null;
      x = Math.log(ratio) / b;
    } else if (fitType === "logarithmic") {
      const a = Number(params?.a);
      const b = Number(params?.b);
      if (!Number.isFinite(a) || !Number.isFinite(b) || Math.abs(a) < 1e-12) return null;
      x = Math.exp((y - b) / a);
    } else if (fitType === "power") {
      const a = Number(params?.a);
      const b = Number(params?.b);
      if (!Number.isFinite(a) || !Number.isFinite(b) || Math.abs(b) < 1e-12 || Math.abs(a) < 1e-12) return null;
      const base = y / a;
      if (!Number.isFinite(base) || base <= 0) return null;
      x = Math.pow(base, 1 / b);
    }
    if (!Number.isFinite(x)) return null;
    return Math.min(100, Math.max(1, x));
  } catch {
    return null;
  }
};

function toIsoLocal(date) {
  const d = date instanceof Date ? date : new Date(date);
  const tzOffset = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - tzOffset).toISOString().slice(0, 19);
}
function toIsoLocalNow() { return toIsoLocal(new Date()); }
function n(v) { const x = Number(v); return Number.isFinite(x) ? x : null; }
function roundToTenth(v) {
  const x = Number(v);
  if (!Number.isFinite(x) || x <= 0) return null;
  return Math.round(x * 10) / 10;
}
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
function formatMinutesClock(total) {
  const val = n(total);
  if (val === null || val < 0) return "-";
  const totalSeconds = Math.round(val * 60);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  const totalMinutes = Math.floor(totalSeconds / 60);
  return `${totalMinutes}:${String(seconds).padStart(2, "0")}`;
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
  const backPath = cardioRouteForRoutineName(data?.workout?.routine?.name);

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
  const goalTimeValue = useMemo(() => n(data?.goal_time), [data?.goal_time]);
  const workoutGoalDistance = useMemo(() => n(data?.workout?.goal_distance), [data?.workout?.goal_distance]);
  const targetGoalValue = useMemo(() => {
    if (unitTypeLower === "time") {
      if (goalTimeValue != null && goalTimeValue > 0) return goalTimeValue;
      if (goalValue != null && goalValue > 0) return goalValue;
      if (workoutGoalDistance != null && workoutGoalDistance > 0) return workoutGoalDistance;
      return null;
    }
    if (goalValue != null && goalValue > 0) return goalValue;
    if (workoutGoalDistance != null && workoutGoalDistance > 0) return workoutGoalDistance;
    return null;
  }, [unitTypeLower, goalTimeValue, workoutGoalDistance, goalValue]);
  const supportsDistribution = useMemo(() => Boolean(data?.workout?.id), [data?.workout?.id]);

  const [mphGoalInfo, setMphGoalInfo] = useState(null);
  const [distributionOpen, setDistributionOpen] = useState(false);
  const [distributionState, setDistributionState] = useState(() => emptyCardioDistributionState());
  const [overrideMphMax, setOverrideMphMax] = useState("");
  const [overrideMphAvg, setOverrideMphAvg] = useState("");
  const [mphAdjustOpen, setMphAdjustOpen] = useState(false);
  const [mphAdjustSaving, setMphAdjustSaving] = useState(false);
  const [mphAdjustErr, setMphAdjustErr] = useState(null);
  const [trendlineMaxState, setTrendlineMaxState] = useState(() => emptyTrendlineState());
  const [trendlineAvgState, setTrendlineAvgState] = useState(() => emptyTrendlineState());

  useEffect(() => {
    // Reset overrides when navigating to a new log
    setOverrideMphMax("");
    setOverrideMphAvg("");
    setMphAdjustOpen(false);
    setMphAdjustErr(null);
    setTrendlineMaxState(emptyTrendlineState());
    setTrendlineAvgState(emptyTrendlineState());
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
    const valueForGoal = (goalValue != null && goalValue > 0)
      ? goalValue
      : ((targetGoalValue != null && targetGoalValue > 0) ? targetGoalValue : goalValue);
    if (!wid || valueForGoal === null || valueForGoal <= 0) {
      setMphGoalInfo(null);
      return null;
    }
    const controller = new AbortController();
    const params = new URLSearchParams({ workout_id: String(wid), value: String(valueForGoal) });
    fetch(`${API_BASE}/api/cardio/mph-goal/?${params.toString()}`, {
      signal: controller.signal,
    })
      .then((res) => (res.ok ? res.json() : Promise.reject(res)))
      .then((info) => setMphGoalInfo(info))
      .catch(() => setMphGoalInfo(null));
    return controller;
  }, [data?.workout?.id, goalValue, targetGoalValue]);

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

  useEffect(() => {
    if (!mphAdjustOpen) return undefined;
    const workoutId = data?.workout?.id;
    if (!workoutId) {
      setTrendlineMaxState({
        loading: false,
        error: "Workout is missing for this log.",
        data: null,
        slider: 1,
      });
      setTrendlineAvgState({
        loading: false,
        error: "Workout is missing for this log.",
        data: null,
        slider: 1,
      });
      return undefined;
    }

    const controller = new AbortController();
    const signal = controller.signal;
    setTrendlineMaxState((prev) => ({ ...prev, loading: true, error: null, data: null }));
    setTrendlineAvgState((prev) => ({ ...prev, loading: true, error: null, data: null }));

    const fetchJsonStrict = async (url) => {
      const res = await fetch(url, { signal });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      return res.json();
    };

    const trendlineMaxParams = new URLSearchParams({ workout_id: String(workoutId), max_avg_type: "max" });
    const trendlineAvgParams = new URLSearchParams({ workout_id: String(workoutId), max_avg_type: "avg" });
    const currentMax = n(effectiveMphMax);
    const currentAvg = n(effectiveMphAvg) ?? currentMax;
    const currentMaxPctRaw = Number(data?.mph_goal_percentage);
    const currentAvgPctRaw = Number(data?.mph_goal_avg_percentage);
    const currentMaxPct = Number.isFinite(currentMaxPctRaw) && currentMaxPctRaw > 0
      ? clampPercent(currentMaxPctRaw)
      : null;
    const currentAvgPct = Number.isFinite(currentAvgPctRaw) && currentAvgPctRaw > 0
      ? clampPercent(currentAvgPctRaw)
      : null;

    const trendlineMaxPromise = fetchJsonStrict(`${API_BASE}/api/cardio/goals/trendline-fit/?${trendlineMaxParams.toString()}`)
      .then((payload) => ({ data: payload }))
      .catch((err) => {
        if (err?.name === "AbortError") throw err;
        return { error: err?.message || String(err) };
      });
    const trendlineAvgPromise = fetchJsonStrict(`${API_BASE}/api/cardio/goals/trendline-fit/?${trendlineAvgParams.toString()}`)
      .then((payload) => ({ data: payload }))
      .catch((err) => {
        if (err?.name === "AbortError") throw err;
        return { error: err?.message || String(err) };
      });

    Promise.all([trendlineMaxPromise, trendlineAvgPromise])
      .then(([maxResult, avgResult]) => {
        if (signal.aborted) return;

        const hydrateState = (result, currentMph, persistedPct) => {
          if (result?.error) {
            return {
              loading: false,
              error: result.error,
              data: null,
              slider: 1,
            };
          }
          const payload = result?.data || null;
          const defaultPct = clampPercent(payload?.highest_goal_inter_rank_percentage);
          const fittedPct = trendlinePercentForMph(payload?.best_fit_type, payload?.model_params, currentMph);
          const initialPct = persistedPct != null ? persistedPct : fittedPct;
          return {
            loading: false,
            error: null,
            data: payload,
            slider: clampPercent(initialPct ?? defaultPct),
          };
        };

        setTrendlineMaxState(hydrateState(maxResult, currentMax, currentMaxPct));
        setTrendlineAvgState(hydrateState(avgResult, currentAvg, currentAvgPct));
      })
      .catch((err) => {
        if (err?.name === "AbortError") return;
        const message = err?.message || String(err);
        setTrendlineMaxState({
          loading: false,
          error: message,
          data: null,
          slider: 1,
        });
        setTrendlineAvgState({
          loading: false,
          error: message,
          data: null,
          slider: 1,
        });
      });

    return () => controller.abort();
  }, [
    mphAdjustOpen,
    data?.workout?.id,
    effectiveMphMax,
    effectiveMphAvg,
    data?.mph_goal_percentage,
    data?.mph_goal_avg_percentage,
  ]);

  const trendlineModalMaxMph = useMemo(
    () => roundToTenth(evalTrendlineMph(
      trendlineMaxState?.data?.best_fit_type,
      trendlineMaxState?.data?.model_params,
      trendlineMaxState?.slider,
    )),
    [trendlineMaxState?.data?.best_fit_type, trendlineMaxState?.data?.model_params, trendlineMaxState?.slider]
  );
  const trendlineModalAvgMph = useMemo(
    () => roundToTenth(evalTrendlineMph(
      trendlineAvgState?.data?.best_fit_type,
      trendlineAvgState?.data?.model_params,
      trendlineAvgState?.slider,
    )),
    [trendlineAvgState?.data?.best_fit_type, trendlineAvgState?.data?.model_params, trendlineAvgState?.slider]
  );

  const saveTrendlineMph = useCallback(async () => {
    setMphAdjustSaving(true);
    setMphAdjustErr(null);
    try {
      const maxValue = n(trendlineModalMaxMph);
      const avgValue = n(trendlineModalAvgMph);
      if (maxValue == null || maxValue <= 0 || avgValue == null || avgValue <= 0) {
        throw new Error("Both Max and Avg treadline goal values must be valid before saving.");
      }
      const payload = {
        mph_goal: Math.round(maxValue * 10) / 10,
        mph_goal_avg: Math.round(avgValue * 10) / 10,
        mph_goal_percentage: clampPercent(trendlineMaxState?.slider),
        mph_goal_avg_percentage: clampPercent(trendlineAvgState?.slider),
      };
      const res = await fetch(`${API_BASE}/api/cardio/log/${id}/`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      await res.json();
      setMphAdjustOpen(false);
      await refetch();
      refreshMphGoal();
    } catch (err) {
      setMphAdjustErr(err);
    } finally {
      setMphAdjustSaving(false);
    }
  }, [
    trendlineModalMaxMph,
    trendlineModalAvgMph,
    trendlineMaxState?.slider,
    trendlineAvgState?.slider,
    id,
    refetch,
    refreshMphGoal,
  ]);

  const renderTrendlineAdjustCard = (label, trendlineState, setTrendlineState, predictedMph, goalTargetValue) => {
    if (trendlineState.loading) {
      return (
        <div style={{ border: "1px solid #e5e7eb", borderRadius: 8, padding: 10, fontSize: 13, color: "#6b7280" }}>
          {label} treadline: loading...
        </div>
      );
    }
    if (trendlineState.error) {
      return (
        <div style={{ border: "1px solid #fecaca", borderRadius: 8, padding: 10, fontSize: 13, color: "#b91c1c" }}>
          {label} treadline error: {trendlineState.error}
        </div>
      );
    }
    if (!trendlineState.data) {
      return (
        <div style={{ border: "1px solid #e5e7eb", borderRadius: 8, padding: 10, fontSize: 13, color: "#6b7280" }}>
          {label} treadline unavailable.
        </div>
      );
    }
    const mphLabel = Number.isFinite(Number(predictedMph)) && Number(predictedMph) > 0
      ? Number(predictedMph).toFixed(1)
      : "-";
    let goalMetricLabel = null;
    const mphValue = Number(predictedMph);
    const goalTarget = Number(goalTargetValue);
    if (Number.isFinite(mphValue) && mphValue > 0 && Number.isFinite(goalTarget) && goalTarget > 0) {
      if (unitTypeLower === "time") {
        const goalMiles = mphValue * (goalTarget / 60.0);
        if (Number.isFinite(goalMiles) && goalMiles > 0) {
          goalMetricLabel = `Goal Distance: ${Number(goalMiles.toFixed(2)).toString()} mi`;
        }
      } else if (unitTypeLower === "distance") {
        const unitNum = Number(data?.workout?.unit?.mile_equiv_numerator || 0);
        const unitDen = Number(data?.workout?.unit?.mile_equiv_denominator || 1);
        const milesPerUnitForGoal = unitDen ? (unitNum / unitDen) : 0;
        if (Number.isFinite(milesPerUnitForGoal) && milesPerUnitForGoal > 0) {
          const goalMiles = goalTarget * milesPerUnitForGoal;
          const goalMinutes = (goalMiles / mphValue) * 60.0;
          const clock = formatMinutesClock(goalMinutes);
          if (clock && clock !== "-") goalMetricLabel = `Goal Time: ${clock}`;
        }
      }
    }
    const defaultPct = clampPercent(trendlineState.data?.highest_goal_inter_rank_percentage);
    const r2Value = Number(trendlineState.data?.r2 ?? trendlineState.data?.trendline_r2);
    const r2Label = Number.isFinite(r2Value) ? r2Value.toFixed(4) : "-";
    const goalTypeIndicators = Array.isArray(trendlineState.data?.goal_type_indicators)
      ? trendlineState.data.goal_type_indicators
      : [];
    const positionedGoalTypeIndicators = goalTypeIndicators.map((item, index) => {
      const rawPct = Number(item?.inter_rank_percentage);
      let pct = Number.isFinite(rawPct) ? Math.min(100, Math.max(1, rawPct)) : null;
      if (pct == null) {
        const denom = goalTypeIndicators.length + 1;
        pct = ((index + 1) / denom) * 100;
      }
      return { ...item, sliderPct: pct };
    });

    return (
      <div style={{ border: "1px solid #e5e7eb", borderRadius: 8, padding: 10 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <strong>{label} Goal Treadline</strong>
          <span style={{ fontSize: 13, color: "#374151" }}>{trendlineState.slider}%</span>
        </div>
        <div style={{ position: "relative" }}>
          <input
            type="range"
            min={1}
            max={100}
            step={1}
            value={trendlineState.slider}
            onChange={(e) => {
              const slider = clampPercent(e.target.value);
              setTrendlineState((prev) => ({ ...prev, slider }));
            }}
            style={{ width: "100%", position: "relative", zIndex: 2 }}
          />
          {positionedGoalTypeIndicators.map((item, index) => {
            const displayName = String(item?.display_name || item?.goal_type || "Goal type");
            const color = goalTypeIndicatorColors[index % goalTypeIndicatorColors.length];
            return (
              <span
                key={`${item?.goal_type || "goal"}-${index}`}
                title={displayName}
                aria-label={displayName}
                style={{
                  position: "absolute",
                  left: `${item.sliderPct}%`,
                  top: "50%",
                  transform: "translate(-50%, -50%)",
                  width: 10,
                  height: 10,
                  borderRadius: "50%",
                  background: color,
                  border: "1px solid rgba(15, 23, 42, 0.22)",
                  boxShadow: "0 0 0 1px #fff",
                  cursor: "help",
                  zIndex: 3,
                }}
              />
            );
          })}
        </div>
        <div style={{ marginTop: 8, fontSize: 13, color: "#374151", display: "grid", gap: 3 }}>
          <div>Goal MPH (Treadline): {mphLabel}</div>
          {goalMetricLabel && <div>{goalMetricLabel}</div>}
          <div>Fit: {trendlineState.data.best_fit_type || "-"}</div>
          <div style={{ fontSize: 12, color: "#6b7280" }}>
            Formula: {trendlineState.data.formula || "-"} | R^2: {r2Label}
          </div>
          <div style={{ fontSize: 12, color: "#6b7280" }}>
            Default goal %: {defaultPct}%
          </div>
        </div>
      </div>
    );
  };

  const resetDistribution = () => {
    setDistributionState(emptyCardioDistributionState());
    setDistributionOpen(false);
  };

  const fetchDistribution = useCallback(async (payload, fallbackTitle = "Distribution") => {
    try {
      const normalized = await fetchCardioDistribution(payload, fallbackTitle);
      setDistributionState(normalized);
    } catch (err) {
      setDistributionState({
        ...emptyCardioDistributionState(),
        title: fallbackTitle || "Distribution",
        error: err?.message || String(err),
      });
    } finally {
      setDistributionOpen(true);
    }
  }, []);

  const formatGoalLabel = (value) => {
    if (!Number.isFinite(value)) return null;
    return Number(value.toFixed(2)).toString();
  };
  const formatUnitValue = (value, unitLabel) => {
    const val = formatGoalLabel(value);
    const unit = unitLabel || "";
    if (!val && !unit) return "-";
    return `${val ?? ""}${val && unit ? " " : ""}${unit}`;
  };

  const handleViewDistribution = () => {
    const progressionUnit = unitTypeLower === "time" ? "minutes" : "miles";
    const baseGoal = (targetGoalValue != null && targetGoalValue > 0) ? targetGoalValue : goalValue;

    let progressionValue = null;
    if (baseGoal != null && baseGoal > 0) {
      if (progressionUnit === "miles") {
        progressionValue = milesPerUnit > 0 ? baseGoal * milesPerUnit : baseGoal;
      } else {
        progressionValue = baseGoal;
      }
    }

    let goalDistanceValue = null;
    if (workoutGoalDistance != null && workoutGoalDistance > 0) {
      if (progressionUnit === "miles") {
        goalDistanceValue = milesPerUnit > 0 ? workoutGoalDistance * milesPerUnit : workoutGoalDistance;
      } else {
        goalDistanceValue = workoutGoalDistance;
      }
    }

    const maxCandidate = effectiveMphMax;
    const avgCandidate = effectiveMphAvg ?? maxCandidate;
    const fallbackTitle = `${data?.workout?.name || "Workout"} Recommendation`;
    const payload = {
      log_id: Number(id),
      workout_id: data?.workout?.id ?? null,
      progression: progressionValue,
      progression_unit: progressionUnit,
      avg_mph_goal: avgCandidate,
      max_mph_goal: maxCandidate,
      goal_distance: goalDistanceValue,
    };
    void fetchDistribution(payload, fallbackTitle);
  };

  // Compute times client-side to avoid rare server rounding/field issues
  const milesPerUnit = useMemo(() => {
    const u = data?.workout?.unit;
    const num = Number(u?.mile_equiv_numerator || 0);
    const den = Number(u?.mile_equiv_denominator || 1);
    const mpu = den ? num / den : 0;
    return Number.isFinite(mpu) && mpu > 0 ? mpu : 0;
  }, [data?.workout?.unit?.mile_equiv_numerator, data?.workout?.unit?.mile_equiv_denominator]);

  const totalCompletedUnits = useMemo(() => {
    const total = n(data?.total_completed);
    return total != null ? total : null;
  }, [data?.total_completed]);

  const detailAggregates = useMemo(() => {
    const list = Array.isArray(data?.details) ? data.details : [];
    let miles = 0;
    let minutes = 0;
    let treadmill = null;
    let hasMiles = false;
    let hasMinutes = false;
    list.forEach((d) => {
      const mi = n(d.running_miles);
      if (mi != null && mi > 0) {
        miles += mi;
        hasMiles = true;
      }
      const minVal = toMinutes(d.running_minutes, d.running_seconds);
      if (minVal > 0) {
        minutes += minVal;
        hasMinutes = true;
      }
      const tmVal = toMinutes(d.treadmill_time_minutes, d.treadmill_time_seconds);
      if (tmVal > 0) {
        treadmill = tmVal;
      }
    });
    return {
      miles: hasMiles ? miles : null,
      minutes: hasMinutes ? minutes : null,
      treadmill,
    };
  }, [data?.details]);

  const minutesElapsedValue = useMemo(() => {
    const direct = n(data?.minutes_elapsed);
    if (direct != null && direct > 0) return direct;
    if (detailAggregates.treadmill != null && detailAggregates.treadmill > 0) return detailAggregates.treadmill;
    if (detailAggregates.minutes != null && detailAggregates.minutes > 0) return detailAggregates.minutes;
    return null;
  }, [data?.minutes_elapsed, detailAggregates]);

  const completedMilesValue = useMemo(() => {
    if (detailAggregates.miles != null && detailAggregates.miles > 0) return detailAggregates.miles;
    if (unitTypeLower === "distance" && milesPerUnit > 0) {
      const unitsDone = totalCompletedUnits;
      if (unitsDone != null && unitsDone > 0) return unitsDone * milesPerUnit;
    }
    const avg = n(data?.avg_mph);
    if (avg != null && avg > 0 && minutesElapsedValue != null && minutesElapsedValue > 0) {
      return (avg * minutesElapsedValue) / 60;
    }
    return null;
  }, [detailAggregates.miles, unitTypeLower, milesPerUnit, totalCompletedUnits, data?.avg_mph, minutesElapsedValue]);

  const targetAvgMphValue = useMemo(
    () => (effectiveMphAvg ?? effectiveMphMax ?? null),
    [effectiveMphAvg, effectiveMphMax]
  );

  const targetMilesTotalValue = useMemo(() => {
    if (targetGoalValue == null || targetGoalValue <= 0) return null;
    if (unitTypeLower === "distance") {
      return milesPerUnit > 0 ? targetGoalValue * milesPerUnit : null;
    }
    const milesFromInfo = n(mphGoalInfo?.miles_avg) ?? n(mphGoalInfo?.miles);
    if (milesFromInfo != null && milesFromInfo > 0) return milesFromInfo;
    if (targetAvgMphValue != null && targetAvgMphValue > 0) {
      return (targetAvgMphValue * targetGoalValue) / 60;
    }
    return null;
  }, [targetGoalValue, unitTypeLower, milesPerUnit, mphGoalInfo?.miles_avg, mphGoalInfo?.miles, targetAvgMphValue]);

  const remainingMilesValue = useMemo(() => {
    if (targetMilesTotalValue == null) return null;
    const completed = completedMilesValue;
    if (completed == null || completed < 0) return targetMilesTotalValue;
    const remaining = targetMilesTotalValue - completed;
    return remaining > 0 ? remaining : 0;
  }, [targetMilesTotalValue, completedMilesValue]);

  const remainingMinutesForAvg = useMemo(() => {
    if (unitTypeLower === "time") {
      if (targetGoalValue == null || targetGoalValue <= 0) return null;
      const done = minutesElapsedValue ?? 0;
      const remaining = targetGoalValue - done;
      return remaining > 0 ? remaining : 0;
    }
    const totalMinutesForAvg = (targetAvgMphValue != null && targetAvgMphValue > 0 && targetMilesTotalValue != null)
      ? (targetMilesTotalValue / targetAvgMphValue) * 60
      : null;
    if (totalMinutesForAvg == null) return null;
    if (minutesElapsedValue == null) return totalMinutesForAvg;
    const remaining = totalMinutesForAvg - minutesElapsedValue;
    return remaining > 0 ? remaining : 0;
  }, [unitTypeLower, targetGoalValue, minutesElapsedValue, targetAvgMphValue, targetMilesTotalValue]);

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
  const goalTimeLabel = goalDistanceLabel ? `Goal Time (${goalDistanceLabel})` : "Goal Time";

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

  const goalTableData = useMemo(() => {
    if (!unitTypeLower) return null;
    const unitLabel = data?.workout?.unit?.name || (unitTypeLower === "time" ? "Minutes" : "Units");

    if (unitTypeLower === "time") {
      const totalMph = effectiveMphAvg ?? effectiveMphMax;
      let totalMiles = n(computedMilesFromTime?.miles_avg) ?? n(mphGoalInfo?.miles_avg) ?? n(mphGoalInfo?.miles);
      if ((totalMiles == null || totalMiles <= 0) && totalMph != null && goalValue != null && goalValue > 0) {
        totalMiles = (totalMph * goalValue) / 60;
      }

      const goalMph = effectiveMphMax ?? effectiveMphAvg;
      let goalMiles = n(goalDistanceMilesMax);
      if ((goalMiles == null || goalMiles <= 0) && goalMph != null && workoutGoalDistance != null && workoutGoalDistance > 0) {
        goalMiles = (goalMph * workoutGoalDistance) / 60;
      }

      return {
        unitLabel,
        lastLabel: "Miles",
        lastIsTime: false,
        total: { unitValue: goalValue, mph: totalMph, last: totalMiles },
        goal: { unitValue: workoutGoalDistance, mph: goalMph, last: goalMiles },
      };
    }

    const totalMph = effectiveMphAvg ?? effectiveMphMax;
    const totalUnits = goalValue;
    let totalMinutes = null;
    if (totalMph != null && totalUnits != null && totalUnits > 0 && milesPerUnit > 0) {
      const miles = totalUnits * milesPerUnit;
      totalMinutes = (miles / totalMph) * 60;
    }

    const goalMph = effectiveMphMax ?? effectiveMphAvg;
    const goalUnits = workoutGoalDistance;
    let goalMinutes = null;
    if (goalMph != null && goalUnits != null && goalUnits > 0 && milesPerUnit > 0) {
      const miles = goalUnits * milesPerUnit;
      goalMinutes = (miles / goalMph) * 60;
    }

    return {
      unitLabel,
      lastLabel: "Time",
      lastIsTime: true,
      total: { unitValue: totalUnits, mph: totalMph, last: totalMinutes },
      goal: { unitValue: goalUnits, mph: goalMph, last: goalMinutes },
    };
  }, [
    unitTypeLower,
    data?.workout?.unit?.name,
    effectiveMphAvg,
    effectiveMphMax,
    computedMilesFromTime?.miles_avg,
    mphGoalInfo?.miles_avg,
    mphGoalInfo?.miles,
    goalValue,
    goalDistanceMilesMax,
    workoutGoalDistance,
    milesPerUnit,
  ]);

  const autoMax = useMemo(() => {
    const details = data?.details || [];
    if (!details.length) return null;

    let minMiles = null;
    let minMinutes = null;
    if (workoutGoalDistance != null && workoutGoalDistance > 0) {
      if (unitTypeLower === "distance") {
        if (goalDistanceMiles == null || goalDistanceMiles <= 0) return null;
        minMiles = goalDistanceMiles;
      } else if (unitTypeLower === "time") {
        minMinutes = workoutGoalDistance;
      }
    }

    let max = null;
    for (const d of details) {
      const v = n(d.running_mph);
      if (v === null) continue;

      if (minMiles != null) {
        const miles = n(d.running_miles);
        if (miles == null || (miles + 1e-9) < minMiles) continue;
      }
      if (minMinutes != null) {
        const minutes = toMinutes(d.running_minutes, d.running_seconds);
        if (!Number.isFinite(minutes) || (minutes + 1e-9) < minMinutes) continue;
      }

      if (max === null || v > max) max = v;
    }
    return max !== null ? Math.round(max * 1000) / 1000 : null;
  }, [data?.details, goalDistanceMiles, unitTypeLower, workoutGoalDistance]);

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
    let bestIntervalEstimate = null;
    for (const d of details) {
      const mins = toMinutes(d.running_minutes, d.running_seconds);
      if (!(mins > 0)) continue;

      const milesRaw = n(d.running_miles);
      const mphRaw = n(d.running_mph);
      const miles = (milesRaw != null && milesRaw > 0)
        ? milesRaw
        : ((mphRaw != null && mphRaw > 0) ? ((mphRaw * mins) / 60.0) : null);
      if (!(miles > 0)) continue;

      milesFromDetails += miles;
      minutesFromDetails += mins;

      // Prefer the fastest qualifying interval pace for the target distance.
      if ((miles + 1e-9) >= targetMiles) {
        const estimate = (mins / miles) * targetMiles;
        if (estimate > 0 && (bestIntervalEstimate == null || estimate < bestIntervalEstimate)) {
          bestIntervalEstimate = estimate;
        }
      }
    }
    if (bestIntervalEstimate != null) {
      return Math.round(bestIntervalEstimate * 1000) / 1000;
    }
    if (milesFromDetails > 0 && minutesFromDetails > 0) {
      const estimate = (minutesFromDetails / milesFromDetails) * targetMiles;
      return Math.round(estimate * 1000) / 1000;
    }
    const totalCompletedUnits = unitTypeLower !== "time" ? n(data?.total_completed) : null;
    if (totalCompletedUnits != null && totalCompletedUnits > 0 && milesPerUnit > 0) {
      const milesDone = totalCompletedUnits * milesPerUnit;
      const minutesValue = n(data?.minutes_elapsed);
      if (minutesValue != null && minutesValue > 0 && milesDone > 0) {
        const estimate = (minutesValue / milesDone) * targetMiles;
        return Math.round(estimate * 1000) / 1000;
      }
    }
    return null;
  }, [data?.details, data?.minutes_elapsed, data?.total_completed, goalDistanceMiles, milesPerUnit, showGoalTime, unitTypeLower]);

  const legacyAutoGoalTime = useMemo(() => {
    if (!showGoalTime || unitTypeLower === "time") return null;
    const targetMiles = goalDistanceMiles;
    if (targetMiles == null || targetMiles <= 0) return null;

    const totalCompletedUnits = unitTypeLower !== "time" ? n(data?.total_completed) : null;
    const milesFromTotal = totalCompletedUnits != null && milesPerUnit > 0
      ? totalCompletedUnits * milesPerUnit
      : null;
    if (milesFromTotal == null || milesFromTotal <= 0) return null;

    const minutesValue = n(data?.minutes_elapsed);
    if (minutesValue == null || minutesValue <= 0) return null;

    const estimate = (minutesValue / milesFromTotal) * targetMiles;
    return Math.round(estimate * 1000) / 1000;
  }, [data?.minutes_elapsed, data?.total_completed, goalDistanceMiles, milesPerUnit, showGoalTime, unitTypeLower]);

  useEffect(() => {
    if (autoGoalTime === null || !showGoalTime) return;
    const current = n(data?.goal_time);
    const isLegacyMismatch = (
      current !== null
      && legacyAutoGoalTime != null
      && Math.abs(current - legacyAutoGoalTime) <= 0.02
      && autoGoalTime > current + 0.02
    );
    if (current !== null && autoGoalTime >= current && !isLegacyMismatch) return;
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
  }, [autoGoalTime, data?.goal_time, id, legacyAutoGoalTime, refetch, showGoalTime]);

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

  const formattedTotalCompleted = useMemo(() => {
    const val = data?.total_completed;
    if (val === null || val === undefined) return "\u2014";
    const formatted = formatWithStep(val, workoutUnitRoundStep);
    return formatted !== "" ? formatted : "0";
  }, [data?.total_completed, workoutUnitRoundStep]);

  const effectivePrev = useMemo(
    () => {
      if (isFirstEntry) return 0;
      return prevTM;
    },
    [isFirstEntry, prevTM]
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
          const { m, s } = fromMinutes(intervalMin);
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
  }, [minExerciseId, prevTM, isFirstEntry, addModalOpen]);

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

        const remMinutes = Math.max(0, Number(intervalMinutes) || 0);
        const remMiles = Math.max(0, Number(intervalMiles) || 0);

        let computedMax = null;
        if (remMinutes > 0 && remMiles > 0) {
          computedMax = remMiles / (remMinutes / 60);
        } else if (Number.isFinite(payload.running_mph)) {
          computedMax = Number(payload.running_mph);
        }

        let qualifiesGoalThreshold = true;
        if (unitTypeLower === "distance" && goalDistanceMiles != null && goalDistanceMiles > 0) {
          qualifiesGoalThreshold = remMiles + 1e-9 >= goalDistanceMiles;
        } else if (unitTypeLower === "time" && workoutGoalDistance != null && workoutGoalDistance > 0) {
          qualifiesGoalThreshold = remMinutes + 1e-9 >= workoutGoalDistance;
        }

        if (qualifiesGoalThreshold && computedMax != null && Number.isFinite(computedMax) && computedMax > 0) {
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
        <Link to={backPath} style={{ textDecoration: "none" }}>Back</Link>
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
                  {updatingStart ? "Saving..." : "Save"}
                </button>
              </div>
              {updateStartErr && <div style={{ color: "#b91c1c", fontSize: 12 }}>Error: {String(updateStartErr.message || updateStartErr)}</div>}
            </div>
            <div style={{ marginBottom: 8 }}>
              <table style={goalsTableStyle}>
                <thead>
                  <tr>
                    <th style={goalsTableHeaderCellStyle}>Goal Type</th>
                    <th style={goalsTableHeaderCellStyle}>Unit</th>
                    <th style={goalsTableHeaderCellStyle}>Goal MPH</th>
                    <th style={goalsTableHeaderCellStyle}>{`Goal ${goalTableData?.lastLabel ?? (unitTypeLower === "time" ? "Miles" : "Time")}`}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td style={goalsTableCellStyle}>Goal Total</td>
                    <td style={goalsTableCellStyle}>{formatUnitValue(goalTableData?.total.unitValue, goalTableData?.unitLabel)}</td>
                    <td style={goalsTableCellStyle}>{formatGoalLabel(goalTableData?.total.mph) ?? "-"}</td>
                    <td style={goalsTableCellStyle}>
                      {goalTableData?.lastIsTime
                        ? (goalTableData?.total.last != null ? formatMinutesClock(goalTableData?.total.last) : "-")
                        : (formatGoalLabel(goalTableData?.total.last) ?? "-")}
                    </td>
                  </tr>
                  <tr>
                    <td style={goalsTableCellStyle}>Goal Workout Target</td>
                    <td style={goalsTableCellStyle}>{formatUnitValue(goalTableData?.goal.unitValue, goalTableData?.unitLabel)}</td>
                    <td style={goalsTableCellStyle}>{formatGoalLabel(goalTableData?.goal.mph) ?? "-"}</td>
                    <td style={goalsTableCellStyle}>
                      {goalTableData?.lastIsTime
                        ? (goalTableData?.goal.last != null ? formatMinutesClock(goalTableData?.goal.last) : "-")
                        : (formatGoalLabel(goalTableData?.goal.last) ?? "-")}
                    </td>
                  </tr>
                </tbody>
              </table>
            {supportsDistribution && (effectiveMphMax != null || effectiveMphAvg != null || mphGoalInfo) && (
              <div style={{ marginBottom: 8 }}>
                <button type="button" style={distributionBtnStyle} onClick={handleViewDistribution}>View goal distribution</button>
              </div>
            )}
            </div>
            <Row left="Actual Total Completed" right={formattedTotalCompleted} />
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
              left="Actual Max MPH"
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
            <Row left="Actual Avg MPH" right={data.avg_mph ?? "—"} />
            <Row
              left="Goal Treadline Adjust"
              right={(
                <button
                  type="button"
                  style={btnStyle}
                  onClick={() => {
                    setMphAdjustErr(null);
                    setMphAdjustOpen(true);
                  }}
                >
                  Edit Max/Avg Goal MPH
                </button>
              )}
            />
            <Row left="Actual Minutes Elapsed" right={data.minutes_elapsed ?? "—"} />
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
                  <th style={{ textAlign: "left", padding: "4px 8px" }}>Actual MPH</th>
                  <th style={{ textAlign: "left", padding: "4px 8px" }}>Actions</th>
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
                        style={tableActionButtonStyle}
                        aria-label={`Edit interval ${d.id}`}
                        title="Edit interval"
                        onClick={() => openEdit(d)}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        style={{ ...tableDangerButtonStyle, marginLeft: 8 }}
                        aria-label={`Delete interval ${d.id}`}
                        title="Delete interval"
                        onClick={() => deleteDetail(d.id)}
                        disabled={deletingId === d.id}
                      >
                        {deletingId === d.id ? "Deleting..." : "Delete"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div style={{ height: 12 }} />
            <button type="button" style={btnStyle} onClick={openModal} disabled={unitsApi.loading}>Add interval</button>
            <CardioDistributionModal
              open={distributionOpen}
              state={distributionState}
              onClose={resetDistribution}
            />
            <Modal open={mphAdjustOpen} contentStyle={{ maxWidth: 720 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <div style={{ fontWeight: 600, fontSize: 16 }}>Adjust Max/Avg Goal MPH (Treadline)</div>
                <button
                  type="button"
                  style={{ ...distributionBtnStyle, marginLeft: 0 }}
                  onClick={() => setMphAdjustOpen(false)}
                  disabled={mphAdjustSaving}
                >
                  Close
                </button>
              </div>
              <div style={{ display: "grid", gap: 8 }}>
                {renderTrendlineAdjustCard("Max", trendlineMaxState, setTrendlineMaxState, trendlineModalMaxMph, workoutGoalDistance)}
                {renderTrendlineAdjustCard("Avg", trendlineAvgState, setTrendlineAvgState, trendlineModalAvgMph, goalValue)}
              </div>
              <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 8 }}>
                <button
                  type="button"
                  style={btnStyle}
                  onClick={saveTrendlineMph}
                  disabled={mphAdjustSaving || trendlineMaxState.loading || trendlineAvgState.loading}
                >
                  {mphAdjustSaving ? "Saving..." : "Save Goal MPH"}
                </button>
                {mphAdjustErr && (
                  <span style={{ color: "#b91c1c", fontSize: 13 }}>
                    Error: {String(mphAdjustErr.message || mphAdjustErr)}
                  </span>
                )}
              </div>
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



