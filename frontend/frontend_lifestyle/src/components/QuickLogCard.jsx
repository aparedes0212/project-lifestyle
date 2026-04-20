import { useCallback, useEffect, useMemo, useState } from "react";
import useApi from "../hooks/useApi";
import { API_BASE } from "../lib/config";
import Card from "./ui/Card";
import CardioDistributionModal from "./CardioDistributionModal";
import { emptyCardioDistributionState, fetchCardioDistribution } from "../lib/cardioDistribution";

const btnStyle = { border: "1px solid #e5e7eb", background: "#f9fafb", borderRadius: 8, padding: "6px 10px", cursor: "pointer" };
const linkBtnStyle = { border: "none", background: "transparent", color: "#2563eb", cursor: "pointer", marginLeft: 8, fontSize: 12, padding: 0 };
const formatMinutesValue = (value) => {
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) return null;
  const totalSeconds = Math.round(num * 60);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  const totalMinutes = Math.floor(totalSeconds / 60);
  return `${totalMinutes}:${String(seconds).padStart(2, "0")}`;
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
const formatMphLabel = (value, decimals = 1) => {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return null;
  return Number(num.toFixed(decimals)).toString();
};
const roundToTenth = (value) => {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return null;
  return Math.round(num * 10) / 10;
};
const clampPercent = (value) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return 1;
  return Math.min(100, Math.max(1, Math.round(num)));
};
const clampLossPercent = (value) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  return Math.min(100, Math.max(0, Math.round(num)));
};
const formatLossSourceDate = (value) => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return null;
  return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
};
const getLossSource = (payload) => {
  if (!payload || typeof payload !== "object") return null;
  const workoutNameRaw = payload?.workout?.name;
  const workoutName = typeof workoutNameRaw === "string" && workoutNameRaw.trim() ? workoutNameRaw.trim() : null;
  const dateLabel = formatLossSourceDate(payload?.datetime_started);
  if (!workoutName && !dateLabel) return null;
  return { workoutName, dateLabel };
};
const formatLossSourceLabel = (source) => {
  if (!source) return null;
  const workoutName = source?.workoutName || null;
  const dateLabel = source?.dateLabel || null;
  if (workoutName && dateLabel) return `${workoutName} - ${dateLabel}`;
  return workoutName || dateLabel;
};
const emptyTrendlineState = () => ({
  loading: false,
  error: null,
  data: null,
  slider: 1,
});
const emptyPercentageLossState = () => ({
  loading: false,
  error: null,
  daily: null,
  weeklyMax: null,
  weeklyAvg: null,
  weeklyMaxSource: null,
  weeklyAvgSource: null,
});
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

export default function QuickLogCard({ onLogged, ready = true, routineName = null, title = "Quick Log", goalPlanOverride = null }) {
  const nextUrl = useMemo(() => {
    const params = new URLSearchParams({ include_skipped: "true" });
    if (routineName) params.set("routine_name", routineName);
    return `${API_BASE}/api/cardio/next/?${params.toString()}`;
  }, [routineName]);

  // Include skipped workouts so dropdown is comprehensive
  const { data: nextData, loading } = useApi(nextUrl, { deps: [ready, nextUrl], skip: !ready });

  const predictedWorkout = nextData?.next_workout ?? null;
  const predictedGoal = nextData?.next_progression?.progression ?? "";
  const workoutOptions = nextData?.workout_list ?? [];
  const workoutMetricPlans = Array.isArray(nextData?.workout_metric_plans) ? nextData.workout_metric_plans : [];
  // Reverse so predicted (last in API list) appears first in dropdown
  const workoutOptionsReversed = useMemo(() => {
    return [...(workoutOptions || [])].reverse();
  }, [workoutOptions]);

  const [workoutId, setWorkoutId] = useState(null);
  const [goal, setGoal] = useState("");
  const [goalInfo, setGoalInfo] = useState(null);

  useEffect(() => {
    if (predictedWorkout?.id) setWorkoutId(predictedWorkout.id);
    if (predictedGoal !== "") setGoal(String(predictedGoal));
  }, [predictedWorkout?.id, predictedGoal]);

  const [submitting, setSubmitting] = useState(false);
  const [submitErr, setSubmitErr] = useState(null);

  const [distributionOpen, setDistributionOpen] = useState(false);
  const [distributionState, setDistributionState] = useState(() => emptyCardioDistributionState());
  const [trendlineMax, setTrendlineMax] = useState(() => emptyTrendlineState());
  const [trendlineAvg, setTrendlineAvg] = useState(() => emptyTrendlineState());
  const [percentageLosses, setPercentageLosses] = useState(() => emptyPercentageLossState());

  const currentWorkout = useMemo(() => {
    if (workoutId) {
      const fromList = (workoutOptions || []).find((w) => w.id === workoutId);
      if (fromList) return fromList;
    }
    return predictedWorkout;
  }, [workoutId, workoutOptions, predictedWorkout]);
  const selectedMetricPlan = useMemo(() => {
    if (!workoutId) return null;
    const fromList = workoutMetricPlans.find((item) => Number(item?.workout_id) === Number(workoutId));
    if (fromList) return fromList;
    if (Number(predictedWorkout?.id) === Number(workoutId)) {
      return nextData?.selected_metric_plan ?? null;
    }
    return null;
  }, [nextData?.selected_metric_plan, predictedWorkout?.id, workoutId, workoutMetricPlans]);
  const activeGoalPlanOverride = useMemo(() => {
    if (!goalPlanOverride) return null;
    if (workoutId && Number(goalPlanOverride?.workoutId) === Number(workoutId)) {
      return goalPlanOverride;
    }
    if (!workoutId && predictedWorkout?.id && Number(goalPlanOverride?.workoutId) === Number(predictedWorkout.id)) {
      return goalPlanOverride;
    }
    return null;
  }, [goalPlanOverride, predictedWorkout?.id, workoutId]);

  const supportsDistribution = Boolean(workoutId);

  const unitTypeLower = (() => {
    const unitType = currentWorkout?.unit?.unit_type;
    if (!unitType) return "";
    if (typeof unitType === "string") return unitType.toLowerCase();
    if (typeof unitType?.name === "string") return unitType.name.toLowerCase();
    return "";
  })();

  const milesPerUnit = useMemo(() => {
    const unit = currentWorkout?.unit;
    const num = Number(unit?.mile_equiv_numerator || 0);
    const den = Number(unit?.mile_equiv_denominator || 1);
    if (!Number.isFinite(num) || !Number.isFinite(den) || den === 0) return 0;
    const value = num / den;
    return Number.isFinite(value) && value > 0 ? value : 0;
  }, [currentWorkout?.unit]);

  const workoutGoalDistance = useMemo(() => {
    const raw = Number(currentWorkout?.goal_distance);
    return Number.isFinite(raw) ? raw : null;
  }, [currentWorkout?.goal_distance]);

  // When workout changes, fetch its next goal and set it
  useEffect(() => {
    let ignore = false;
    const fetchGoal = async () => {
      if (!workoutId) return;
      try {
        const res = await fetch(`${API_BASE}/api/cardio/goal/?workout_id=${workoutId}`);
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        const data = await res.json();
        if (!ignore) {
          const prog = data?.progression;
          setGoal(prog !== undefined && prog !== null && prog !== "" ? String(prog) : "");
        }
      } catch {
        if (!ignore) setGoal("");
      }
    };
    fetchGoal();
    return () => { ignore = true; };
  }, [workoutId]);

  useEffect(() => {
    if (!workoutId || goal === "") {
      setGoalInfo(null);
      return;
    }
    const controller = new AbortController();
    const params = new URLSearchParams({ workout_id: String(workoutId), value: String(goal) });
    fetch(`${API_BASE}/api/cardio/mph-goal/?${params.toString()}`, {
      signal: controller.signal,
    })
      .then((res) => (res.ok ? res.json() : Promise.reject(res)))
      .then((data) => setGoalInfo(data))
      .catch(() => setGoalInfo(null));
    return () => controller.abort();
  }, [workoutId, goal]);

  useEffect(() => {
    if (!workoutId) {
      setTrendlineMax(emptyTrendlineState());
      setTrendlineAvg(emptyTrendlineState());
      setPercentageLosses(emptyPercentageLossState());
      return;
    }

    const controller = new AbortController();
    const signal = controller.signal;

    setTrendlineMax((prev) => ({ ...prev, loading: true, error: null, data: null }));
    setTrendlineAvg((prev) => ({ ...prev, loading: true, error: null, data: null }));
    setPercentageLosses((prev) => ({ ...prev, loading: true, error: null }));

    const fetchJsonStrict = async (url) => {
      const res = await fetch(url, { signal });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      return res.json();
    };

    const fetchJsonOptional = async (url, fallback) => {
      try {
        const res = await fetch(url, { signal });
        if (!res.ok) return fallback;
        return await res.json();
      } catch (err) {
        if (err?.name === "AbortError") throw err;
        return fallback;
      }
    };

    const trendlineMaxParams = new URLSearchParams({ workout_id: String(workoutId), max_avg_type: "max" });
    const trendlineAvgParams = new URLSearchParams({ workout_id: String(workoutId), max_avg_type: "avg" });

    const trendlineMaxPromise = fetchJsonStrict(`${API_BASE}/api/cardio/goals/trendline-fit/?${trendlineMaxParams.toString()}`)
      .then((data) => ({ data }))
      .catch((err) => {
        if (err?.name === "AbortError") throw err;
        return { error: err?.message || String(err) };
      });
    const trendlineAvgPromise = fetchJsonStrict(`${API_BASE}/api/cardio/goals/trendline-fit/?${trendlineAvgParams.toString()}`)
      .then((data) => ({ data }))
      .catch((err) => {
        if (err?.name === "AbortError") throw err;
        return { error: err?.message || String(err) };
      });

    const dailyLossPromise = fetchJsonOptional(
      `${API_BASE}/api/cardio/daily-based-percentage-loss/`,
      { daily_based_percentage_loss: 0 },
    );
    const weeklyMaxLossPromise = fetchJsonOptional(
      `${API_BASE}/api/cardio/best-completed-log/?workout_id=${workoutId}`,
      { weekly_based_max_percentage_loss: 0 },
    );
    const weeklyAvgLossPromise = fetchJsonOptional(
      `${API_BASE}/api/cardio/best-completed-avg-log/?workout_id=${workoutId}`,
      { weekly_based_avg_percentage_loss: 0 },
    );

    Promise.all([
      trendlineMaxPromise,
      trendlineAvgPromise,
      dailyLossPromise,
      weeklyMaxLossPromise,
      weeklyAvgLossPromise,
    ])
      .then(([maxResult, avgResult, dailyLossData, weeklyMaxLossData, weeklyAvgLossData]) => {
        if (signal.aborted) return;

        const dailyLoss = clampLossPercent(dailyLossData?.daily_based_percentage_loss);
        const weeklyMaxLoss = clampLossPercent(weeklyMaxLossData?.weekly_based_max_percentage_loss);
        const weeklyAvgLoss = clampLossPercent(weeklyAvgLossData?.weekly_based_avg_percentage_loss);
        const weeklyMaxSource = getLossSource(weeklyMaxLossData);
        const weeklyAvgSource = getLossSource(weeklyAvgLossData);

        setPercentageLosses({
          loading: false,
          error: null,
          daily: dailyLoss,
          weeklyMax: weeklyMaxLoss,
          weeklyAvg: weeklyAvgLoss,
          weeklyMaxSource,
          weeklyAvgSource,
        });

        if (maxResult?.error) {
          setTrendlineMax({
            loading: false,
            error: maxResult.error,
            data: null,
            slider: 1,
          });
        } else {
          const data = maxResult?.data || null;
          const defaultPct = clampPercent(data?.highest_goal_inter_rank_percentage);
          const adjustedPct = clampPercent(defaultPct - weeklyMaxLoss - dailyLoss);
          setTrendlineMax({
            loading: false,
            error: null,
            data,
            slider: adjustedPct,
          });
        }

        if (avgResult?.error) {
          setTrendlineAvg({
            loading: false,
            error: avgResult.error,
            data: null,
            slider: 1,
          });
        } else {
          const data = avgResult?.data || null;
          const defaultPct = clampPercent(data?.highest_goal_inter_rank_percentage);
          const adjustedPct = clampPercent(defaultPct - weeklyAvgLoss - dailyLoss);
          setTrendlineAvg({
            loading: false,
            error: null,
            data,
            slider: adjustedPct,
          });
        }
      })
      .catch((err) => {
        if (err?.name === "AbortError") return;
        const message = err?.message || String(err);
        setTrendlineMax({
          loading: false,
          error: message,
          data: null,
          slider: 1,
        });
        setTrendlineAvg({
          loading: false,
          error: message,
          data: null,
          slider: 1,
        });
        setPercentageLosses({
          loading: false,
          error: message,
          daily: null,
          weeklyMax: null,
          weeklyAvg: null,
          weeklyMaxSource: null,
          weeklyAvgSource: null,
        });
      });

    return () => controller.abort();
  }, [workoutId]);

  const trendlineMaxMph = useMemo(
    () => evalTrendlineMph(trendlineMax?.data?.best_fit_type, trendlineMax?.data?.model_params, trendlineMax?.slider),
    [trendlineMax?.data?.best_fit_type, trendlineMax?.data?.model_params, trendlineMax?.slider],
  );
  const trendlineAvgMph = useMemo(
    () => evalTrendlineMph(trendlineAvg?.data?.best_fit_type, trendlineAvg?.data?.model_params, trendlineAvg?.slider),
    [trendlineAvg?.data?.best_fit_type, trendlineAvg?.data?.model_params, trendlineAvg?.slider],
  );
  const trendlineMaxRounded = useMemo(() => roundToTenth(trendlineMaxMph), [trendlineMaxMph]);
  const trendlineAvgRounded = useMemo(() => roundToTenth(trendlineAvgMph), [trendlineAvgMph]);
  const fallbackMphMax = useMemo(() => roundToTenth(goalInfo?.mph_goal), [goalInfo?.mph_goal]);
  const fallbackMphAvg = useMemo(() => roundToTenth(goalInfo?.mph_goal_avg) ?? fallbackMphMax, [goalInfo?.mph_goal_avg, fallbackMphMax]);
  const selectedMetricPlanMax = useMemo(() => roundToTenth(selectedMetricPlan?.mph_goal), [selectedMetricPlan?.mph_goal]);
  const selectedMetricPlanAvg = useMemo(
    () => roundToTenth(selectedMetricPlan?.mph_goal_avg) ?? selectedMetricPlanMax,
    [selectedMetricPlan?.mph_goal_avg, selectedMetricPlanMax],
  );
  const overrideMphMax = useMemo(() => roundToTenth(activeGoalPlanOverride?.mph_goal), [activeGoalPlanOverride?.mph_goal]);
  const overrideMphAvg = useMemo(
    () => roundToTenth(activeGoalPlanOverride?.mph_goal_avg) ?? overrideMphMax,
    [activeGoalPlanOverride?.mph_goal_avg, overrideMphMax],
  );
  const effectiveMphMax = overrideMphMax ?? selectedMetricPlanMax ?? trendlineMaxRounded ?? fallbackMphMax;
  const effectiveMphAvg = overrideMphAvg ?? selectedMetricPlanAvg ?? trendlineAvgRounded ?? fallbackMphAvg ?? effectiveMphMax;
  const persistedGoalPctMax = useMemo(
    () => ((activeGoalPlanOverride || selectedMetricPlan) ? null : (trendlineMax?.data ? clampPercent(trendlineMax?.slider) : null)),
    [activeGoalPlanOverride, selectedMetricPlan, trendlineMax?.data, trendlineMax?.slider],
  );
  const persistedGoalPctAvg = useMemo(
    () => ((activeGoalPlanOverride || selectedMetricPlan) ? null : (trendlineAvg?.data ? clampPercent(trendlineAvg?.slider) : null)),
    [activeGoalPlanOverride, selectedMetricPlan, trendlineAvg?.data, trendlineAvg?.slider],
  );
  const weeklyMaxSourceLabel = useMemo(
    () => formatLossSourceLabel(percentageLosses?.weeklyMaxSource),
    [percentageLosses?.weeklyMaxSource],
  );
  const weeklyAvgSourceLabel = useMemo(
    () => formatLossSourceLabel(percentageLosses?.weeklyAvgSource),
    [percentageLosses?.weeklyAvgSource],
  );
  const totalGoalTarget = useMemo(() => {
    const parsed = Number(goal);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }, [goal]);

  const getTreadlineGoalMetric = useCallback((mphValue, goalTargetValue) => {
    const mph = roundToTenth(mphValue);
    const goalTarget = Number(goalTargetValue);
    if (mph == null || !Number.isFinite(goalTarget) || goalTarget <= 0) return null;

    if (unitTypeLower === "time") {
      const miles = mph * (goalTarget / 60.0);
      const milesLabel = formatMilesLabel(miles);
      return milesLabel ? `Goal Distance: ${milesLabel}` : null;
    }

    if (unitTypeLower === "distance" && milesPerUnit > 0) {
      const goalMiles = goalTarget * milesPerUnit;
      const goalMinutes = (goalMiles / mph) * 60.0;
      const timeLabel = formatMinutesValue(goalMinutes);
      return timeLabel ? `Goal Time: ${timeLabel}` : null;
    }

    return null;
  }, [unitTypeLower, milesPerUnit]);

  const renderTrendlineCard = (label, trendlineState, setTrendlineState, predictedMph, goalTargetValue) => {
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
    const mphRounded = roundToTenth(predictedMph);
    const mphLabel = formatMphLabel(mphRounded, 1);
    const goalMetricLabel = getTreadlineGoalMetric(mphRounded, goalTargetValue);
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
          <strong>{label} Treadline</strong>
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
          <div>Treadline MPH: {mphLabel ?? "-"}</div>
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

  const getGoalNumber = () => {
    const candidates = [goal, predictedGoal];
    for (const candidate of candidates) {
      if (candidate === null || candidate === undefined || candidate === "") continue;
      const parsed = Number(candidate);
      if (Number.isFinite(parsed)) return parsed;
    }
    return null;
  };

  const handleViewDistribution = () => {
    if (!supportsDistribution) return;
    const goalNumber = getGoalNumber();
    const maxCandidate = effectiveMphMax;
    const avgCandidateRaw = effectiveMphAvg ?? maxCandidate;
    const progressionUnit = unitTypeLower === "time" ? "minutes" : "miles";

    let progressionValue = null;
    if (goalNumber != null) {
      if (progressionUnit === "miles") {
        progressionValue = milesPerUnit > 0 ? goalNumber * milesPerUnit : goalNumber;
      } else {
        progressionValue = goalNumber;
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

    const payload = {
      workout_id: workoutId || currentWorkout?.id || null,
      workout_name: currentWorkout?.name || null,
      progression: progressionValue,
      progression_unit: progressionUnit,
      avg_mph_goal: avgCandidateRaw,
      max_mph_goal: maxCandidate,
      goal_distance: goalDistanceValue,
      already_complete: {},
    };
    const fallbackTitle = `${currentWorkout?.name || "Workout"} Recommendation`;
    void fetchDistribution(payload, fallbackTitle);
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!workoutId) return;
    setSubmitting(true);
    setSubmitErr(null);
    try {
      const payload = {
        datetime_started: new Date().toISOString(),
        workout_id: workoutId,
        goal: goal === "" ? null : Number(goal),
      };
      if (effectiveMphMax != null) payload.mph_goal = effectiveMphMax;
      if (effectiveMphAvg != null) payload.mph_goal_avg = effectiveMphAvg;
      if (persistedGoalPctMax != null) payload.mph_goal_percentage = persistedGoalPctMax;
      if (persistedGoalPctAvg != null) payload.mph_goal_avg_percentage = persistedGoalPctAvg;
      const res = await fetch(`${API_BASE}/api/cardio/log/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const created = await res.json();
      onLogged?.(created);
      if (predictedGoal !== "") setGoal(String(predictedGoal));
    } catch (err) {
      setSubmitErr(err);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card
      title={title}
      action={null}
    >
      {loading && <div>Loading defaults…</div>}
      {!loading && (
        <form onSubmit={submit}>
          <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))" }}>
            <label>
              <div>Workout</div>
              <select value={workoutId || ""} onChange={(e) => setWorkoutId(e.target.value ? Number(e.target.value) : null)}>
                {!predictedWorkout && (
                  <option value="">— pick —</option>
                )}
                {workoutOptionsReversed.map(w => (
                  <option key={w.id} value={w.id}>{w.name}</option>
                ))}
              </select>
            </label>
            <label>
              <div>Goal{currentWorkout?.unit?.name ? ` (${currentWorkout.unit.name})` : ""}</div>
              <input type="number" step="any" value={goal} onChange={(e) => setGoal(e.target.value)} placeholder={predictedGoal !== "" ? String(predictedGoal) : ""} />
            </label>
          </div>
          {workoutId && (
            <div style={{ marginTop: 12, display: "grid", gap: 8 }}>
              {(activeGoalPlanOverride || selectedMetricPlan) && (
                <div style={{ border: "1px solid #dbeafe", borderRadius: 8, padding: 10, background: "#eff6ff", color: "#1e3a8a", fontSize: 13 }}>
                  Using {activeGoalPlanOverride ? "Next Up selection" : "metrics selection"}: {(activeGoalPlanOverride?.period_label ?? selectedMetricPlan?.period_label) || "Custom"} | Max {formatMphLabel(effectiveMphMax, 1) ?? "-"} | Avg {formatMphLabel(effectiveMphAvg, 1) ?? "-"}
                </div>
              )}
              {supportsDistribution && (
                <div>
                  <button type="button" style={{ ...linkBtnStyle, marginLeft: 0, fontSize: 13 }} onClick={handleViewDistribution}>
                    View distribution
                  </button>
                </div>
              )}
              <div style={{ border: "1px solid #e5e7eb", borderRadius: 8, padding: 10 }}>
                  <strong style={{ display: "block", marginBottom: 6 }}>Percentage Loss</strong>
                  {percentageLosses.loading ? (
                    <div style={{ fontSize: 13, color: "#6b7280" }}>Loading loss values...</div>
                ) : percentageLosses.error ? (
                  <div style={{ fontSize: 13, color: "#b91c1c" }}>{percentageLosses.error}</div>
                ) : (
                  <div style={{ fontSize: 13, color: "#374151", display: "grid", gap: 3 }}>
                    <div>Daily: {percentageLosses.daily ?? "-"}%</div>
                    <div>
                      Weekly (Max): {percentageLosses.weeklyMax ?? "-"}%
                      {weeklyMaxSourceLabel ? ` (${weeklyMaxSourceLabel})` : ""}
                    </div>
                    <div>
                      Weekly (Avg): {percentageLosses.weeklyAvg ?? "-"}%
                      {weeklyAvgSourceLabel ? ` (${weeklyAvgSourceLabel})` : ""}
                    </div>
                    </div>
                  )}
              </div>
              {!selectedMetricPlan && renderTrendlineCard("Max", trendlineMax, setTrendlineMax, trendlineMaxMph, workoutGoalDistance)}
              {!selectedMetricPlan && renderTrendlineCard("Avg", trendlineAvg, setTrendlineAvg, trendlineAvgMph, totalGoalTarget)}
            </div>
          )}
          <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 8 }}>
            <button type="submit" style={btnStyle} disabled={submitting || !workoutId}>{submitting ? "Saving…" : "Save log"}</button>
            {submitErr && <span style={{ color: "#b91c1c" }}>Error: {String(submitErr.message || submitErr)}</span>}
          </div>
          <CardioDistributionModal
            open={distributionOpen}
            state={distributionState}
            onClose={resetDistribution}
          />
      </form>
      )}
    </Card>
  );
}
