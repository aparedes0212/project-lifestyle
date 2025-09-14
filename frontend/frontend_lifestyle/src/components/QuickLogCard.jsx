import { useEffect, useMemo, useState } from "react";
import useApi from "../hooks/useApi";
import { API_BASE } from "../lib/config";
import Card from "./ui/Card";

const btnStyle = { border: "1px solid #e5e7eb", background: "#f9fafb", borderRadius: 8, padding: "6px 10px", cursor: "pointer" };

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

  const currentWorkout = useMemo(() => {
    if (workoutId) {
      const fromList = (workoutOptions || []).find((w) => w.id === workoutId);
      if (fromList) return fromList;
    }
    return predictedWorkout;
  }, [workoutId, workoutOptions, predictedWorkout]);

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
              <div>MPH Goal (Max): {goalInfo.mph_goal}</div>
              {goalInfo.mph_goal_avg != null && (
                <div>MPH Goal (Avg): {goalInfo.mph_goal_avg}</div>
              )}
              {currentWorkout?.unit?.unit_type?.toLowerCase() === "time" ? (
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
        </form>
      )}
    </Card>
  );
}
