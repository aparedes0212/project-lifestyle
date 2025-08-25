import { useEffect, useMemo, useState } from "react";
import useApi from "../hooks/useApi";
import { API_BASE } from "../lib/config";
import Card from "./ui/Card";

const btnStyle = { border: "1px solid #e5e7eb", background: "#f9fafb", borderRadius: 8, padding: "6px 10px", cursor: "pointer" };

export default function QuickLogCard({ onLogged, ready = true }) {
  const { data: nextData, loading } = useApi(`${API_BASE}/api/cardio/next/`, { deps: [ready], skip: !ready });

  const predictedWorkout = nextData?.next_workout ?? null;
  const predictedGoal = nextData?.next_progression?.progression ?? "";

  const [routineId, setRoutineId] = useState(null);
  const [workoutId, setWorkoutId] = useState(null);
  const [goal, setGoal] = useState("");

  useEffect(() => {
    if (predictedWorkout?.routine?.id) setRoutineId(predictedWorkout.routine.id);
    if (predictedWorkout?.id) setWorkoutId(predictedWorkout.id);
    if (predictedGoal !== "") setGoal(String(predictedGoal));
  }, [predictedWorkout?.id, predictedWorkout?.routine?.id, predictedGoal]);

  const workoutsUrl = useMemo(() => {
    if (!routineId) return null;
    const params = new URLSearchParams({ routine_id: String(routineId), include_skipped: "true" });
    return `${API_BASE}/api/cardio/workouts-ordered/?${params.toString()}`;
  }, [routineId]);
  const workouts = useApi(workoutsUrl || "", { skip: !workoutsUrl, deps: [workoutsUrl] });

  const [submitting, setSubmitting] = useState(false);
  const [submitErr, setSubmitErr] = useState(null);

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
              <select value={workoutId || ""} onChange={(e) => setWorkoutId(e.target.value ? Number(e.target.value) : null)} disabled={workouts.loading}>
                <option value="">{predictedWorkout ? `Default: ${predictedWorkout.name}` : "— pick —"}</option>
                {(workouts.data || []).map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
            </label>
            <label>
              <div>Goal</div>
              <input type="number" step="any" value={goal} onChange={(e) => setGoal(e.target.value)} placeholder={predictedGoal !== "" ? String(predictedGoal) : ""} />
            </label>
          </div>
          <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 8 }}>
            <button type="submit" style={btnStyle} disabled={submitting || !workoutId}>{submitting ? "Saving…" : "Save log"}</button>
            {submitErr && <span style={{ color: "#b91c1c" }}>Error: {String(submitErr.message || submitErr)}</span>}
          </div>
        </form>
      )}
    </Card>
  );
}
