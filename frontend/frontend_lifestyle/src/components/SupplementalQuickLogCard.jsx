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


export default function SupplementalQuickLogCard({ ready = true, onLogged, defaultRoutineId = null }) {
  const { data: routinesData, loading: routinesLoading, error: routinesError, refetch: refetchRoutines } = useApi(
    `${API_BASE}/api/supplemental/routines/`,
    { deps: [ready], skip: !ready }
  );

  const routines = useMemo(() => Array.isArray(routinesData) ? routinesData : [], [routinesData]);

  const [routineId, setRoutineId] = useState(defaultRoutineId);
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

  const selectedRoutine = routines.find((r) => r.id === routineId);
  const isTime = (selectedRoutine?.unit || "").toLowerCase() === "time";
  const unitLabel = selectedRoutine?.unit === "Time" ? "Seconds" : "Reps";

  const goalApi = useApi(
    routineId ? `${API_BASE}/api/supplemental/goal/?routine_id=${routineId}` : "",
    { deps: [routineId], skip: !routineId }
  );
  const setTargets = Array.isArray(goalApi.data?.target_to_beat?.sets) ? goalApi.data.target_to_beat.sets : [];
  const restConfig = goalApi.data?.target_to_beat || {};
  const routineRestYellow = restConfig.rest_yellow_start_seconds ?? restConfig.yellow_start_seconds ?? selectedRoutine?.rest_yellow_start_seconds ?? 60;
  const routineRestRed = restConfig.rest_red_start_seconds ?? restConfig.red_start_seconds ?? selectedRoutine?.rest_red_start_seconds ?? 90;

  const formatUnitValue = (value) => {
    if (value == null) return "--";
    if (isTime) return formatSecondsClock(value);
    return formatNumber(value, selectedRoutine?.unit === "Reps" ? 0 : 2);
  };
  const formatWeightValue = (value) => {
    if (value == null || Number.isNaN(value)) return null;
    const formatted = formatNumber(value, 2);
    return formatted !== "" ? `${formatted} wt` : null;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!routineId) return;

    setSubmitting(true);
    setSubmitErr(null);

    try {
      const nowIso = new Date().toISOString();
      const goalSummary = goal || (
        setTargets.length
          ? setTargets
              .map((item) => {
                const unitPart = formatUnitValue(item.goal_unit);
                const weightPart = formatWeightValue(item.goal_weight);
                const parts = [unitPart, weightPart].filter(Boolean);
                return parts.length ? `Set ${item.set_number}: ${parts.join(" ")}` : null;
              })
              .filter(Boolean)
              .join("; ")
          : null
      );
      const payload = {
        routine_id: Number(routineId),
        datetime_started: nowIso,
        goal: goalSummary,
        rest_yellow_start_seconds: routineRestYellow,
        rest_red_start_seconds: routineRestRed,
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
              placeholder="Optional notes or cues for this session"
            />
          </label>

          <div style={{ fontSize: 12, color: "#6b7280", alignSelf: "end" }}>
            Rest timer: green 0-{routineRestYellow}s / yellow {routineRestYellow}-{routineRestRed}s / red {routineRestRed}+s
          </div>
        </div>

        {setTargets.length > 0 && (
          <div style={{ marginTop: 10 }}>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>Set Goals (based on last 6 months)</div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ textAlign: "left", borderBottom: "1px solid #e5e7eb" }}>
                    <th style={{ padding: 6 }}>Set</th>
                    <th style={{ padding: 6 }}>Best</th>
                    <th style={{ padding: 6 }}>Next Goal</th>
                  </tr>
                </thead>
                <tbody>
                  {setTargets.map((item) => (
                    <tr key={item.set_number} style={{ borderTop: "1px solid #f1f5f9" }}>
                      <td style={{ padding: 6 }}>Set {item.set_number}</td>
                      <td style={{ padding: 6 }}>
                        <div>{formatUnitValue(item.best_unit)}</div>
                        {item.best_weight != null && <div style={{ color: "#6b7280" }}>{formatWeightValue(item.best_weight)}</div>}
                      </td>
                      <td style={{ padding: 6 }}>
                        <div>
                          {formatUnitValue(item.goal_unit)}
                          {item.goal_weight != null && (
                            <span style={{ color: "#6b7280", marginLeft: 6 }}>{formatWeightValue(item.goal_weight)}</span>
                          )}
                        </div>
                        {item.using_weight && <div style={{ color: "#6b7280" }}>Progress with added weight</div>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

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
