import { useCallback, useEffect, useMemo, useState } from "react";
import useApi from "../hooks/useApi";
import { API_BASE } from "../lib/config";
import Card from "./ui/Card";
import Modal from "./ui/Modal";
import CardioGoalDebugModal from "./CardioGoalDebugModal";

const btnStyle = { border: "1px solid #e5e7eb", background: "#f9fafb", borderRadius: 8, padding: "6px 10px", cursor: "pointer" };
const linkBtnStyle = { border: "none", background: "transparent", color: "#2563eb", cursor: "pointer", marginLeft: 8, fontSize: 12, padding: 0 };
const formatMinutesValue = (value) => {
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) return null;
  const mins = Math.floor(num);
  const secs = Math.round((num - mins) * 60);
  return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
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
const formatMphLabel = (value) => {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return null;
  return Number(num.toFixed(2)).toString();
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

export default function QuickLogCard({ onLogged, ready = true }) {
  // Include skipped workouts so dropdown is comprehensive
  const { data: nextData, loading } = useApi(`${API_BASE}/api/cardio/next/?include_skipped=true`, { deps: [ready], skip: !ready });

  const predictedWorkout = nextData?.next_workout ?? null;
  const predictedGoal = nextData?.next_progression?.progression ?? "";
  const workoutOptions = nextData?.workout_list ?? [];
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
  const [distributionState, setDistributionState] = useState({ title: "", meta: [], rows: [], rowsCompleted: [], rowsRemaining: [], error: null });
  const [debugOpen, setDebugOpen] = useState(false);
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

  const isSprints = ((currentWorkout?.routine?.name || "").toLowerCase() === "sprints");
  const isFiveKPrep = ((currentWorkout?.routine?.name || "").toLowerCase() === "5k prep");

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

  const goalDistanceMilesMax = useMemo(() => {
    if (unitTypeLower !== "time" || workoutGoalDistance == null || workoutGoalDistance <= 0) return null;
    const mph = Number(goalInfo?.mph_goal);
    if (!Number.isFinite(mph) || mph <= 0) return null;
    return (mph * workoutGoalDistance) / 60;
  }, [unitTypeLower, workoutGoalDistance, goalInfo?.mph_goal]);
  const goalDistanceMiles = useMemo(() => {
    if (unitTypeLower === "time") return goalDistanceMilesMax;
    if (workoutGoalDistance == null || workoutGoalDistance <= 0 || milesPerUnit <= 0) return null;
    return workoutGoalDistance * milesPerUnit;
  }, [unitTypeLower, goalDistanceMilesMax, milesPerUnit, workoutGoalDistance]);

  const goalDistanceLabel = useMemo(() => {
    if (workoutGoalDistance == null || workoutGoalDistance <= 0) return null;
    const formatted = formatGoalLabel(workoutGoalDistance);
    if (!formatted) return null;
    const unitName = currentWorkout?.unit?.name || currentWorkout?.unit?.unit_type;
    return unitName ? `${formatted} ${unitName}` : formatted;
  }, [currentWorkout?.unit?.name, currentWorkout?.unit?.unit_type, workoutGoalDistance]);
  const goalDistanceHeading = goalDistanceLabel ? `Goal Distance (${goalDistanceLabel})` : "Goal Distance";
  const goalDistanceMilesMaxLabel = useMemo(() => formatMilesLabel(goalDistanceMilesMax), [goalDistanceMilesMax]);
  const goalDistanceLabelForDisplay = goalDistanceMilesMaxLabel ?? goalDistanceLabel;

  const showGoalTime = workoutGoalDistance != null && workoutGoalDistance > 0 && (unitTypeLower === "time" || goalDistanceMiles !== null);
  const goalTimeLabel = goalDistanceLabel ? `Goal Time (${goalDistanceLabel})` : "Goal Time";
  const debugGoalValue = useMemo(() => {
    const parsed = Number(goal);
    if (Number.isFinite(parsed)) return parsed;
    const predictedParsed = Number(predictedGoal);
    if (Number.isFinite(predictedParsed)) return predictedParsed;
    return null;
  }, [goal, predictedGoal]);
  const canDebug = !!workoutId && Number.isFinite(debugGoalValue);

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

        setPercentageLosses({
          loading: false,
          error: null,
          daily: dailyLoss,
          weeklyMax: weeklyMaxLoss,
          weeklyAvg: weeklyAvgLoss,
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
  const renderTrendlineCard = (label, trendlineState, setTrendlineState, predictedMph) => {
    if (trendlineState.loading) {
      return (
        <div style={{ border: "1px solid #e5e7eb", borderRadius: 8, padding: 10, fontSize: 13, color: "#6b7280" }}>
          {label} trendline: loading...
        </div>
      );
    }
    if (trendlineState.error) {
      return (
        <div style={{ border: "1px solid #fecaca", borderRadius: 8, padding: 10, fontSize: 13, color: "#b91c1c" }}>
          {label} trendline error: {trendlineState.error}
        </div>
      );
    }
    if (!trendlineState.data) {
      return (
        <div style={{ border: "1px solid #e5e7eb", borderRadius: 8, padding: 10, fontSize: 13, color: "#6b7280" }}>
          {label} trendline unavailable.
        </div>
      );
    }
    const mphLabel = formatMphLabel(predictedMph);
    const defaultPct = clampPercent(trendlineState.data?.highest_goal_inter_rank_percentage);
    return (
      <div style={{ border: "1px solid #e5e7eb", borderRadius: 8, padding: 10 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <strong>{label} Trendline</strong>
          <span style={{ fontSize: 13, color: "#374151" }}>{trendlineState.slider}%</span>
        </div>
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
          style={{ width: "100%" }}
        />
        <div style={{ marginTop: 8, fontSize: 13, color: "#374151", display: "grid", gap: 3 }}>
          <div>Trendline MPH: {mphLabel ?? "-"}</div>
          <div>Fit: {trendlineState.data.best_fit_type || "-"}</div>
          <div style={{ fontSize: 12, color: "#6b7280" }}>
            Formula: {trendlineState.data.formula || "-"}
          </div>
          <div style={{ fontSize: 12, color: "#6b7280" }}>
            Default goal %: {defaultPct}%
          </div>
        </div>
      </div>
    );
  };

  const resetDistribution = () => {
    setDistributionState({ title: "", meta: [], rows: [], rowsCompleted: [], rowsRemaining: [], error: null });
    setDistributionOpen(false);
  };

  const fetchDistribution = useCallback(async (payload, fallbackTitle = "Distribution") => {
    try {
      const res = await fetch(`${API_BASE}/api/cardio/distribution/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const json = await res.json();
      setDistributionState({
        title: json?.title || fallbackTitle,
        meta: Array.isArray(json?.meta) ? json.meta : [],
        rows: Array.isArray(json?.rows) ? json.rows : [],
        rowsCompleted: Array.isArray(json?.rows_completed) ? json.rows_completed : [],
        rowsRemaining: Array.isArray(json?.rows_remaining) ? json.rows_remaining : (Array.isArray(json?.rows) ? json.rows : []),
        error: json?.error ?? null,
      });
    } catch (err) {
      setDistributionState({
        title: fallbackTitle,
        meta: [],
        rows: [],
        rowsCompleted: [],
        rowsRemaining: [],
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

  const openSprintDistribution = async () => {
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
    const goalNumber = getGoalNumber();
    const maxCandidate = goalInfo?.mph_goal != null ? Number(goalInfo.mph_goal) : null;
    const avgCandidateRaw = goalInfo?.mph_goal_avg != null ? Number(goalInfo.mph_goal_avg) : maxCandidate;
    const payload = {
      workout_id: workoutId || currentWorkout?.id || null,
      goal_override: goalNumber,
      goal_time_override: unitTypeLower === "time" ? goalNumber : null,
      max_mph_override: maxCandidate,
      avg_mph_override: avgCandidateRaw,
      remaining_only: false,
    };
    await fetchDistribution(payload, "Sprint MPH Distribution");
  };

  const openFiveKDistribution = async () => {
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

    const goalNumber = getGoalNumber();
    const maxCandidate = goalInfo?.mph_goal != null ? Number(goalInfo.mph_goal) : null;
    const avgCandidateRaw = goalInfo?.mph_goal_avg != null ? Number(goalInfo.mph_goal_avg) : maxCandidate;
    const payload = {
      workout_id: workoutId || currentWorkout?.id || null,
      goal_override: goalNumber,
      goal_time_override: unitTypeLower === "time" ? goalNumber : null,
      max_mph_override: maxCandidate,
      avg_mph_override: avgCandidateRaw,
      remaining_only: false,
    };
    await fetchDistribution(payload, "5K Prep Distribution");
  };

  const handleViewDistribution = () => {
    if (isSprints) {
      void openSprintDistribution();
    } else if (isFiveKPrep) {
      void openFiveKDistribution();
    }
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
      if (goalInfo?.mph_goal != null) payload.mph_goal = Number(goalInfo.mph_goal);
      if (goalInfo?.mph_goal_avg != null) payload.mph_goal_avg = Number(goalInfo.mph_goal_avg);
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
      title="Quick Log"
      action={
        <button
          type="button"
          style={btnStyle}
          onClick={() => setDebugOpen(true)}
          disabled={!canDebug}
        >
          Debug Cardio Goal
        </button>
      }
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
          {goalInfo && (
            <div style={{ marginTop: 8, fontSize: "0.9rem", color: "#374151" }}>
              {goalInfo.mph_goal_avg != null && (
                <div>MPH Goal (Avg): {goalInfo.mph_goal_avg}</div>
              )}
              {unitTypeLower === "time" && (goalDistanceLabelForDisplay || goalDistanceLabel) && (
                <div>{goalDistanceHeading}: {goalDistanceLabelForDisplay || goalDistanceLabel}</div>
              )}
              {showGoalTime && goalInfo?.mph_goal != null && (
                <div>
                  <span>MPH Goal (Max): {goalInfo.mph_goal}</span>
                  {(isSprints || isFiveKPrep) && (
                    <button type="button" style={linkBtnStyle} onClick={handleViewDistribution}>View distribution</button>
                  )}
                </div>
              )}
              {showGoalTime && goalInfo?.goal_time_goal != null && (
                <div>{goalTimeLabel}: {formatMinutesValue(goalInfo.goal_time_goal)}</div>
              )}
              {unitTypeLower === "time" ? (
                <>
                  {(goalInfo.miles_avg != null || goalInfo.miles != null) && (
                    <div>Miles (Avg): {goalInfo.miles_avg ?? goalInfo.miles}</div>
                  )}
                  <div>
                    Time: {goalInfo.minutes} minutes{goalInfo.seconds ? ` ${goalInfo.seconds} seconds` : ""}
                  </div>
                </>
              ) : (
                <>
                  <div>
                    {currentWorkout?.unit?.name || "Distance"}: {goalInfo.distance}
                  </div>
                  {goalInfo.minutes_avg != null && (
                    <div>
                      Time (Avg): {goalInfo.minutes_avg} minutes{goalInfo.seconds_avg ? ` ${goalInfo.seconds_avg} seconds` : ""}
                    </div>
                  )}
                </>
              )}
            </div>
          )}
          {workoutId && (
            <div style={{ marginTop: 12, display: "grid", gap: 8 }}>
              <div style={{ border: "1px solid #e5e7eb", borderRadius: 8, padding: 10 }}>
                <strong style={{ display: "block", marginBottom: 6 }}>Percentage Loss</strong>
                {percentageLosses.loading ? (
                  <div style={{ fontSize: 13, color: "#6b7280" }}>Loading loss values...</div>
                ) : percentageLosses.error ? (
                  <div style={{ fontSize: 13, color: "#b91c1c" }}>{percentageLosses.error}</div>
                ) : (
                  <div style={{ fontSize: 13, color: "#374151", display: "grid", gap: 3 }}>
                    <div>Daily: {percentageLosses.daily ?? "-"}%</div>
                    <div>Weekly (Max): {percentageLosses.weeklyMax ?? "-"}%</div>
                    <div>Weekly (Avg): {percentageLosses.weeklyAvg ?? "-"}%</div>
                  </div>
                )}
              </div>
              {renderTrendlineCard("Max", trendlineMax, setTrendlineMax, trendlineMaxMph)}
              {renderTrendlineCard("Avg", trendlineAvg, setTrendlineAvg, trendlineAvgMph)}
            </div>
          )}
          <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 8 }}>
            <button type="submit" style={btnStyle} disabled={submitting || !workoutId}>{submitting ? "Saving…" : "Save log"}</button>
            {submitErr && <span style={{ color: "#b91c1c" }}>Error: {String(submitErr.message || submitErr)}</span>}
          </div>
          <Modal open={distributionOpen}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <div style={{ fontWeight: 600, fontSize: 16 }}>{distributionState.title || "Distribution"}</div>
              <button
                type="button"
                style={{ ...linkBtnStyle, marginLeft: 0 }}
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
            ) : (
              <>
                {distributionState.rowsCompleted.length > 0 && (
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ fontWeight: 600, marginBottom: 6, fontSize: 13 }}>Completed</div>
                    <div style={{ display: "grid", rowGap: 4, fontSize: 13 }}>
                      {distributionState.rowsCompleted.map((row, index) => (
                        <div
                          key={`done-${row?.label || index}`}
                          style={{ display: "flex", justifyContent: "space-between", gap: 16, padding: "6px 10px", border: "1px solid #e5e7eb", borderRadius: 6 }}
                        >
                          <span style={{ color: "#6b7280" }}>{row?.label ?? `Completed ${index + 1}`}</span>
                          <div style={{ textAlign: "right" }}>
                            <div>{row?.primary ?? "-"}</div>
                            {row?.secondary && (
                              <div style={{ fontSize: 12, color: "#6b7280" }}>{row.secondary}</div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {distributionState.rowsRemaining.length > 0 ? (
                  <div style={{ display: "grid", rowGap: 4, fontSize: 13 }}>
                    {distributionState.rowsRemaining.map((row, index) => (
                      <div
                        key={`remain-${row?.label || index}`}
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
              </>
            )}
          </Modal>
      </form>
      )}
      <CardioGoalDebugModal
        open={debugOpen}
        onClose={() => setDebugOpen(false)}
        workoutId={workoutId}
        goalValue={debugGoalValue}
        workoutName={currentWorkout?.name}
      />
    </Card>
  );
}
