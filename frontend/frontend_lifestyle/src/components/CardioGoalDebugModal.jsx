import { useEffect, useMemo, useState } from "react";
import Modal from "./ui/Modal";
import { API_BASE } from "../lib/config";

const headerStyle = { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 };
const sectionStyle = { border: "1px solid #e5e7eb", borderRadius: 10, padding: 12, background: "#f9fafb" };
const closeBtnStyle = { border: "none", background: "transparent", color: "#2563eb", cursor: "pointer", padding: 4, fontSize: 14 };

const formatNumber = (value, digits = 2) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  const fixed = num.toFixed(digits);
  return fixed.replace(/\.0+$/, "").replace(/(\.\d*?[1-9])0+$/, "$1");
};

const formatTime = (minutes, seconds) => {
  const m = Number(minutes);
  const s = Number(seconds);
  if (!Number.isFinite(m)) return null;
  const secPart = Number.isFinite(s) && s > 0 ? ` ${s}s` : "";
  return `${m}m${secPart}`;
};

export default function CardioGoalDebugModal({ open, onClose, workoutId, goalValue, workoutName }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [data, setData] = useState(null);

  const numericGoal = useMemo(() => {
    const parsed = Number(goalValue);
    return Number.isFinite(parsed) ? parsed : null;
  }, [goalValue]);

  useEffect(() => {
    if (!open) return;
    if (!workoutId || numericGoal === null) {
      setData(null);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const params = new URLSearchParams({ workout_id: String(workoutId), value: String(numericGoal) });
        const res = await fetch(`${API_BASE}/api/cardio/goal-debug/?${params.toString()}`, { signal: controller.signal });
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        const json = await res.json();
        setData(json);
      } catch (err) {
        if (!controller.signal.aborted) {
          setError(err);
          setData(null);
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [open, workoutId, numericGoal]);

  if (!open) return null;

  const progression = data?.progression || {};
  const mph = data?.mph_goal || {};
  const conversion = mph?.conversion || {};
  const selectedLog = mph?.selected_log || null;
  const unitType = conversion?.unit_type || "";
  const goalInputDisplay = numericGoal != null ? formatNumber(numericGoal, 3) : null;

  const renderSourceLog = () => {
    if (!selectedLog?.id) {
      return (
        <div>No matching log was found; used most recent history.</div>
      );
    }
    return (
      <>
        <div>
          Selected log:{" "}
          <a href={`/logs/${selectedLog.id}`} target="_blank" rel="noreferrer">
            #{selectedLog.id}
          </a>
          {selectedLog.datetime_started ? ` (${selectedLog.datetime_started})` : ""}
        </div>
        <div>Max MPH: {formatNumber(selectedLog.max_mph, 3) ?? "--"} | Avg MPH: {formatNumber(selectedLog.avg_mph, 3) ?? "--"}</div>
        {selectedLog.total_completed != null && (
          <div>Goal/Total Completed: {formatNumber(selectedLog.total_completed, 3)}</div>
        )}
      </>
    );
  };

  return (
    <Modal open={open} contentStyle={{ maxWidth: 680 }}>
      <div style={headerStyle}>
        <div style={{ fontWeight: 700, fontSize: 16 }}>Debug Cardio Goal</div>
        <button type="button" style={closeBtnStyle} onClick={onClose}>Close</button>
      </div>

      {!workoutId || numericGoal === null ? (
        <div style={{ color: "#4b5563" }}>Pick a workout and enter a numeric goal to view debug details.</div>
      ) : loading ? (
        <div>Loading...</div>
      ) : error ? (
        <div style={{ color: "#b91c1c" }}>Error: {String(error.message || error)}</div>
      ) : (
        <div style={{ display: "grid", gap: 12 }}>
          <div style={sectionStyle}>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>Overview</div>
            <div>Workout: {data?.workout?.name || workoutName || "Unknown"}</div>
            <div>Routine: {data?.workout?.routine || "--"}</div>
            <div>Goal input: {goalInputDisplay ?? "--"}</div>
            <div>MPH Goal Strategy: {mph?.strategy || data?.workout?.mph_goal_strategy || "--"}</div>
          </div>

          <div style={sectionStyle}>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>Goal (Progression)</div>
            <div>Progression picked: {formatNumber(progression.progression, 3) ?? "--"}</div>
            <div>Reason: {progression.reason || "--"}</div>
            {Array.isArray(progression.steps) && progression.steps.length > 0 && (
              <div style={{ marginTop: 6 }}>
                <div style={{ fontWeight: 500, marginBottom: 4 }}>Steps</div>
                <ul style={{ margin: 0, paddingLeft: 18, color: "#374151" }}>
                  {progression.steps.map((step, idx) => (
                    <li key={idx}>{step}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          <div style={sectionStyle}>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>MPH Goals</div>
            <div>Scope: {mph.scope || "--"} | Criterion: {mph.criterion || "--"}</div>
            <div>Max MPH Goal: {formatNumber(mph.mph_goal, 3) ?? "--"}</div>
            <div>Avg MPH Goal: {formatNumber(mph.mph_goal_avg, 3) ?? "--"}</div>
            {unitType === "time" ? (
              <>
                <div>Miles @ Max: {formatNumber(conversion.miles_max, 3) ?? "--"}</div>
                <div>Miles @ Avg: {formatNumber(conversion.miles_avg, 3) ?? "--"}</div>
              </>
            ) : (
              <>
                <div>Distance Goal: {formatNumber(conversion.distance, 3) ?? "--"}</div>
                <div>Time @ Max: {formatTime(conversion.minutes_max, conversion.seconds_max) ?? "--"}</div>
                <div>Time @ Avg: {formatTime(conversion.minutes_avg, conversion.seconds_avg) ?? "--"}</div>
              </>
            )}
            {conversion.goal_time_goal != null && (
              <div>Goal Time (Max): {formatNumber(conversion.goal_time_goal, 2)}</div>
            )}
            {conversion.goal_time_goal_avg != null && (
              <div>Goal Time (Avg): {formatNumber(conversion.goal_time_goal_avg, 2)}</div>
            )}
          </div>

          <div style={sectionStyle}>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>MPH Goal Source</div>
            <div>Candidate logs inspected: {mph.candidate_count ?? "--"}</div>
            {mph.used_fallback && (
              <div style={{ color: "#92400e" }}>Used fallback to most recent log.</div>
            )}
            {renderSourceLog()}
          </div>
        </div>
      )}
    </Modal>
  );
}
