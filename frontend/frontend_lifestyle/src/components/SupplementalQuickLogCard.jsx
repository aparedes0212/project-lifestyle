import { useEffect, useMemo, useState } from "react";
import useApi from "../hooks/useApi";
import { API_BASE } from "../lib/config";
import Card from "./ui/Card";
import { formatNumber } from "../lib/numberFormat";

const btnStyle = { border: "1px solid #e5e7eb", background: "#f9fafb", borderRadius: 8, padding: "6px 10px", cursor: "pointer" };

const formatSecondsClock = (value) => {
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) return "--";
  const minutes = Math.floor(num / 60);
  const seconds = num - minutes * 60;
  const secStr = Number.isInteger(seconds)
    ? String(seconds).padStart(2, "0")
    : seconds.toFixed(2).padStart(5, "0");
  return `${String(minutes).padStart(2, "0")}:${secStr}`;
};

export default function SupplementalQuickLogCard({ ready = true, onLogged, defaultRoutineId = null, defaultWorkoutId = null }) {
  const { data: routinesData, loading: routinesLoading, error: routinesError, refetch: refetchRoutines } = useApi(
    `${API_BASE}/api/supplemental/routines/`,
    { deps: [ready], skip: !ready }
  );

  const routines = useMemo(() => Array.isArray(routinesData) ? routinesData : [], [routinesData]);

  const [routineId, setRoutineId] = useState(defaultRoutineId);
  const [workoutId, setWorkoutId] = useState(defaultWorkoutId);
  const [goal, setGoal] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitErr, setSubmitErr] = useState(null);

  useEffect(() => {
    if (routines.length === 0) return;
    if (routineId !== null) return;
    if (defaultRoutineId && routines.find((r) => r.id === defaultRoutineId)) {
      setRoutineId(defaultRoutineId);
    } else {
      setRoutineId(routines[0].id);
    }
  }, [routines, routineId, defaultRoutineId]);

  const workoutsApi = useApi(
    routineId ? `${API_BASE}/api/supplemental/workouts/?routine_id=${routineId}` : "",
    { deps: [routineId], skip: !routineId }
  );
  const workouts = useMemo(() => Array.isArray(workoutsApi.data) ? workoutsApi.data : [], [workoutsApi.data]);

  useEffect(() => {
    if (!routineId || workouts.length === 0) {
      setWorkoutId(null);
      return;
    }
    const preferred = workouts.find((w) => w.workout?.id === defaultWorkoutId);
    const next = preferred || workouts[0];
    setWorkoutId(next?.workout?.id ?? null);
  }, [workouts, routineId, defaultWorkoutId]);

  const selectedRoutine = routines.find((r) => r.id === routineId);
  const selectedWorkoutDesc = workouts.find((w) => w.workout?.id === workoutId);
  const goalMetric = selectedWorkoutDesc?.goal_metric || null;

  const isTime = (selectedRoutine?.unit || "").toLowerCase() === "time";
  const unitLabel = selectedRoutine?.unit === "Time" ? "Seconds" : "Reps";

  const goalApi = useApi(
    routineId ? `${API_BASE}/api/supplemental/goal/?routine_id=${routineId}${goalMetric ? `&goal_metric=${encodeURIComponent(goalMetric)}` : ""}` : "",
    { deps: [routineId, goalMetric], skip: !routineId }
  );
  const targetToBeat = goalApi.data?.target_to_beat ?? null;
  const bestRecent = goalApi.data?.best_recent ?? null;

  const formatTargetDisplay = (value) => {
    if (value == null) return "--";
    if (isTime) return formatSecondsClock(value);
    return formatNumber(value, selectedRoutine?.unit === "Reps" ? 0 : 2);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!routineId) return;

    setSubmitting(true);
    setSubmitErr(null);

    try {
      const nowIso = new Date().toISOString();
      const payload = {
        routine_id: Number(routineId),
        workout_id: workoutId ? Number(workoutId) : null,
        goal_metric: goalMetric || null,
        datetime_started: nowIso,
        goal: goal || (targetToBeat != null ? String(targetToBeat) : null),
      };

      const res = await fetch(`${API_BASE}/api/supplemental/log/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const created = await res.json();
      onLogged?.(created);
      setGoal("");
      setGoal("");
    } catch (err) {
      setSubmitErr(err);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card
      title="Quick Log (Supplemental)"
      action={
        <button onClick={refetchRoutines} style={btnStyle} disabled={routinesLoading}>
          Refresh Routines
        </button>
      }
    >
      {routinesError && <div style={{ color: "#b91c1c", marginBottom: 8 }}>Error loading routines: {String(routinesError.message || routinesError)}</div>}

      <form onSubmit={handleSubmit}>
        <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
          <label>
            <div>Routine</div>
            <select
              value={routineId ?? ""}
              onChange={(e) => setRoutineId(e.target.value ? Number(e.target.value) : null)}
            >
              {routines.map((routine) => (
                <option key={routine.id} value={routine.id}>
                  {routine.name}
                </option>
              ))}
              {routines.length === 0 && <option value="">--</option>}
            </select>
          </label>

          <label>
            <div>Workout</div>
            <select
              value={workoutId ?? ""}
              onChange={(e) => setWorkoutId(e.target.value ? Number(e.target.value) : null)}
              disabled={!routineId || workoutsApi.loading}
            >
              {workouts.map((item) => (
                <option key={item.id} value={item.workout?.id ?? ""}>
                  {item.workout?.name ?? "Workout"}
                </option>
              ))}
              {workouts.length === 0 && <option value="">--</option>}
            </select>
            {selectedWorkoutDesc?.description && (
              <div style={{ fontSize: 12, color: "#475569", marginTop: 4, lineHeight: 1.4 }}>{selectedWorkoutDesc.description}</div>
            )}
          </label>

          <label>
            <div>Goal / Notes</div>
            <input
              type="text"
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              placeholder={targetToBeat != null ? `Beat ${formatTargetDisplay(targetToBeat)}` : "Optional"}
            />
          </label>

          <div style={{ fontSize: 12, color: "#6b7280", alignSelf: "end" }}>
            Goal metric: {goalMetric ?? "--"} | Target to beat (6mo): {formatTargetDisplay(targetToBeat)} | Best recent: {formatTargetDisplay(bestRecent)}
          </div>
        </div>

        <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <button type="submit" style={btnStyle} disabled={submitting || !routineId}>
            {submitting ? "Saving..." : "Save supplemental log"}
          </button>
          {submitErr && <span style={{ color: "#b91c1c" }}>Error: {String(submitErr.message || submitErr)}</span>}
          <span style={{ fontSize: 12, color: "#475569" }}>
            After saving, open the log to add sets/reps/seconds.
          </span>
        </div>
      </form>
    </Card>
  );
}
