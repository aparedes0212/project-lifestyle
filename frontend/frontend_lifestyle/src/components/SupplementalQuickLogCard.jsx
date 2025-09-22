import { useEffect, useMemo, useState } from "react";
import useApi from "../hooks/useApi";
import { API_BASE } from "../lib/config";
import Card from "./ui/Card";

const btnStyle = { border: "1px solid #e5e7eb", background: "#f9fafb", borderRadius: 8, padding: "6px 10px", cursor: "pointer" };

export default function SupplementalQuickLogCard({ ready = true, onLogged }) {
  const { data: routinesData, loading: routinesLoading, error: routinesError, refetch: refetchRoutines } = useApi(
    `${API_BASE}/api/supplemental/routines/`,
    { deps: [ready], skip: !ready }
  );

  const routines = useMemo(() => Array.isArray(routinesData) ? routinesData : [], [routinesData]);

  const [routineId, setRoutineId] = useState(null);
  const [goal, setGoal] = useState("");
  const [total, setTotal] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitErr, setSubmitErr] = useState(null);

  useEffect(() => {
    if (routines.length > 0 && routineId === null) {
      setRoutineId(routines[0].id);
    }
  }, [routines, routineId]);

  const selectedRoutine = routines.find((r) => r.id === routineId);
  const unitLabel = selectedRoutine?.unit === "Time" ? "Seconds" : "Reps";

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!routineId) return;
    const totalNumber = total === "" ? null : Number(total);
    if (totalNumber !== null && !Number.isFinite(totalNumber)) {
      setSubmitErr(new Error("Total completed must be a number"));
      return;
    }

    setSubmitting(true);
    setSubmitErr(null);

    try {
      const nowIso = new Date().toISOString();
      const payload = {
        routine_id: Number(routineId),
        datetime_started: nowIso,
        goal: goal || null,
        total_completed: totalNumber,
        details: totalNumber !== null ? [{ datetime: nowIso, unit_count: totalNumber }] : [],
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
      setTotal("");
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
            <div>Goal / Notes</div>
            <input
              type="text"
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              placeholder="Optional"
            />
          </label>

          <label>
            <div>Total Completed ({unitLabel || "Units"})</div>
            <input
              type="number"
              value={total}
              onChange={(e) => setTotal(e.target.value)}
              min="0"
              step="any"
            />
          </label>
        </div>

        <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 8 }}>
          <button type="submit" style={btnStyle} disabled={submitting || !routineId}>
            {submitting ? "Saving..." : "Save supplemental log"}
          </button>
          {submitErr && <span style={{ color: "#b91c1c" }}>Error: {String(submitErr.message || submitErr)}</span>}
        </div>
      </form>
    </Card>
  );
}
