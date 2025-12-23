import { useEffect, useMemo, useState } from "react";
import useApi from "../hooks/useApi";
import { API_BASE } from "../lib/config";
import Card from "./ui/Card";
import Modal from "./ui/Modal";
import {
  buildSprintsDistribution,
  buildFiveKDistribution,
  FIVE_K_PER_SET_MILES,
} from "../lib/runDistribution";

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
  const [distributionState, setDistributionState] = useState({ title: "", meta: [], rows: [], error: null });

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

  const goalDistanceMiles = useMemo(() => {
    if (unitTypeLower !== "time" && milesPerUnit > 0 && workoutGoalDistance != null && workoutGoalDistance > 0) {
      return workoutGoalDistance * milesPerUnit;
    }
    return null;
  }, [goal, predictedGoal, unitTypeLower, milesPerUnit, workoutGoalDistance]);

  const goalDistanceLabel = useMemo(() => {
    if (workoutGoalDistance == null || workoutGoalDistance <= 0) return null;
    const formatted = formatGoalLabel(workoutGoalDistance);
    if (!formatted) return null;
    const unitName = currentWorkout?.unit?.name;
    return unitName ? `${formatted} ${unitName}` : formatted;
  }, [currentWorkout?.unit?.name, workoutGoalDistance]);

  const showGoalTime = workoutGoalDistance != null && workoutGoalDistance > 0 && (unitTypeLower === "time" || goalDistanceMiles !== null);
  const goalTimeLabel = goalDistanceLabel ? `Goal Time (${goalDistanceLabel})` : "Goal Time";

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
      } catch (_) {
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

  const resetDistribution = () => {
    setDistributionState({ title: "", meta: [], rows: [], error: null });
    setDistributionOpen(false);
  };

  const getGoalNumber = () => {
    const candidates = [goal, predictedGoal];
    for (const candidate of candidates) {
      if (candidate === null || candidate === undefined || candidate === "") continue;
      const parsed = Number(candidate);
      if (Number.isFinite(parsed)) return parsed;
    }
    return null;
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
    const goalNumber = getGoalNumber();
    const maxCandidate = goalInfo?.mph_goal != null ? Number(goalInfo.mph_goal) : null;
    const avgCandidateRaw = goalInfo?.mph_goal_avg != null ? Number(goalInfo.mph_goal_avg) : maxCandidate;
    const distribution = buildSprintsDistribution({
      sets: goalNumber,
      maxMph: maxCandidate,
      avgMph: avgCandidateRaw,
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

    const goalNumber = getGoalNumber();
    const maxCandidate = goalInfo?.mph_goal != null ? Number(goalInfo.mph_goal) : null;
    const avgCandidateRaw = goalInfo?.mph_goal_avg != null ? Number(goalInfo.mph_goal_avg) : maxCandidate;

    let totalMiles = Number(goalInfo?.miles_max ?? goalInfo?.miles);
    let goalMinutesDisplay = null;
    let goalDistanceDisplay = null;

    if (unitTypeLower === "time") {
      if (!Number.isFinite(totalMiles) || totalMiles <= 0) {
        if (Number.isFinite(goalNumber) && Number.isFinite(maxCandidate) && maxCandidate > 0) {
          totalMiles = (maxCandidate * goalNumber) / 60;
        }
      }
      if (Number.isFinite(goalNumber) && goalNumber > 0) {
        const label = formatGoalLabel(goalNumber);
        if (label) goalMinutesDisplay = label;
      }
    } else if (milesPerUnit > 0) {
      if (Number.isFinite(goalNumber) && goalNumber > 0) {
        const label = formatGoalLabel(goalNumber);
        if (label) goalDistanceDisplay = label;
        totalMiles = goalNumber * milesPerUnit;
      } else {
        const distanceFromGoalInfo = Number(goalInfo?.distance);
        if (Number.isFinite(distanceFromGoalInfo) && distanceFromGoalInfo > 0) {
          const label = formatGoalLabel(distanceFromGoalInfo);
          if (label) goalDistanceDisplay = label;
          if (!Number.isFinite(totalMiles) || totalMiles <= 0) {
            totalMiles = distanceFromGoalInfo * milesPerUnit;
          }
        }
      }
    }

    const distribution = buildFiveKDistribution({
      totalMiles,
      maxMph: maxCandidate,
      avgMph: avgCandidateRaw,
      perSetMiles: FIVE_K_PER_SET_MILES,
      goalMinutesLabel: goalMinutesDisplay,
      goalDistanceLabel: unitTypeLower === "time" ? null : goalDistanceDisplay,
      goalUnitLabel: unitTypeLower === "time" ? null : (currentWorkout?.unit?.name || null),
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
    <Card title="Quick Log" action={null}>
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
              <div>
                <span>MPH Goal (Max): {goalInfo.mph_goal}</span>
                {(isSprints || isFiveKPrep) && goalInfo?.mph_goal != null && (
                  <button type="button" style={linkBtnStyle} onClick={handleViewDistribution}>View distribution</button>
                )}
              </div>
              {goalInfo.mph_goal_avg != null && (
                <div>MPH Goal (Avg): {goalInfo.mph_goal_avg}</div>
              )}
              {showGoalTime && goalInfo?.goal_time_goal != null && (
                <div>{goalTimeLabel}: {formatMinutesValue(goalInfo.goal_time_goal)}</div>
              )}
              {showGoalTime && goalInfo?.goal_time_goal_avg != null && (
                <div style={{ fontSize: "0.85rem" }}>{goalTimeLabel} (Avg): {formatMinutesValue(goalInfo.goal_time_goal_avg)}</div>
              )}
              {unitTypeLower === "time" ? (
                <>
                  <div>Miles (Max): {goalInfo.miles_max ?? goalInfo.miles}</div>
                  {goalInfo.miles_avg != null && (
                    <div>Miles (Avg): {goalInfo.miles_avg}</div>
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
                  <div>
                    Time (Max): {goalInfo.minutes_max ?? goalInfo.minutes} minutes{(goalInfo.seconds_max ?? goalInfo.seconds) ? ` ${goalInfo.seconds_max ?? goalInfo.seconds} seconds` : ""}
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
        </form>
      )}
    </Card>
  );
}
