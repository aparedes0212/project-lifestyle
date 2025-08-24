import { useEffect, useState } from "react";
import useApi from "../hooks/useApi";
import { API_BASE } from "../lib/config";
import Card from "./ui/Card";

const btnStyle = { border: "1px solid #e5e7eb", background: "#f9fafb", borderRadius: 8, padding: "6px 10px", cursor: "pointer" };

export default function StrengthQuickLogCard({ onLogged }) {
  const { data: nextData, loading } = useApi(`${API_BASE}/api/strength/next/`, { deps: [] });
  const predictedRoutine = nextData?.next_routine ?? null;
  const routineList = nextData?.routine_list ?? [];
  const predictedRepGoal = predictedRoutine?.hundred_points_reps ?? "";

  const [routineId, setRoutineId] = useState(null);
  const [repGoal, setRepGoal] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitErr, setSubmitErr] = useState(null);

  useEffect(() => {
    if (predictedRoutine?.id) setRoutineId(predictedRoutine.id);
    if (predictedRepGoal !== "") setRepGoal(String(predictedRepGoal));
  }, [predictedRoutine?.id, predictedRepGoal]);

  const submit = async (e) => {
    e.preventDefault();
    if (!routineId) return;
    setSubmitting(true);
    setSubmitErr(null);
    try {
      const payload = {
        datetime_started: new Date().toISOString(),
        routine_id: Number(routineId),
        rep_goal: repGoal === "" ? null : Number(repGoal),
      };
      const res = await fetch(`${API_BASE}/api/strength/log/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const created = await res.json();
      onLogged?.(created);
      if (predictedRepGoal !== "") setRepGoal(String(predictedRepGoal));
    } catch (err) {
      setSubmitErr(err);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card title="Quick Log (Strength)" action={null}>
      {loading && <div>Loading defaults…</div>}
      {!loading && (
        <form onSubmit={submit}>
          <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))" }}>
            <label>
              <div>Routine</div>
              <select
                value={routineId || ""}
                onChange={(e) => setRoutineId(e.target.value ? Number(e.target.value) : null)}
              >
                <option value="">{predictedRoutine ? `Default: ${predictedRoutine.name}` : "— pick —"}</option>
                {routineList.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <div>Rep Goal</div>
              <input
                type="number"
                value={repGoal}
                onChange={(e) => setRepGoal(e.target.value)}
                placeholder={predictedRepGoal !== "" ? String(predictedRepGoal) : ""}
              />
            </label>
          </div>
          <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 8 }}>
            <button type="submit" style={btnStyle} disabled={submitting || !routineId}>
              {submitting ? "Saving…" : "Save log"}
            </button>
            {submitErr && <span style={{ color: "#b91c1c" }}>Error: {String(submitErr.message || submitErr)}</span>}
          </div>
        </form>
      )}
    </Card>
  );
}

