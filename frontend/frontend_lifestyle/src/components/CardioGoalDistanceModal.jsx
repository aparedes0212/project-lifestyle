import { useEffect, useState } from "react";
import Modal from "./ui/Modal";
import { API_BASE } from "../lib/config";

const btnStyle = { border: "1px solid #e5e7eb", background: "#f9fafb", borderRadius: 8, padding: "6px 10px", cursor: "pointer" };

export default function CardioGoalDistanceModal({ open, onClose }) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);
  const [rows, setRows] = useState([]);
  const [dirtyIds, setDirtyIds] = useState(() => new Set());

  useEffect(() => {
    if (!open) return;
    let ignore = false;
    const fetchWorkouts = async () => {
      setLoading(true);
      setErr(null);
      try {
        const res = await fetch(`${API_BASE}/api/cardio/goal-distances/`);
        if (!res.ok) throw new Error(`Goal distances ${res.status}`);
        const data = await res.json();
        if (!ignore) {
          const mapped = Array.isArray(data)
            ? data.map((item) => ({
                workout: item.id,
                routine_name: item.routine_name || "",
                workout_name: item.workout_name || "",
                unit_name: item.unit_name || "",
                unit_type: item.unit_type || "",
                goal_distance: toNumStr(item.goal_distance),
              }))
            : [];
          setRows(mapped);
          setDirtyIds(() => new Set());
        }
      } catch (e) {
        if (!ignore) setErr(e);
      } finally {
        if (!ignore) setLoading(false);
      }
    };
    fetchWorkouts();
    return () => { ignore = true; };
  }, [open]);

  const onChangeRow = (workoutId, value) => {
    setRows((prev) => prev.map((row) => (row.workout === workoutId ? { ...row, goal_distance: value } : row)));
    setDirtyIds((prev) => {
      const next = new Set(prev);
      next.add(workoutId);
      return next;
    });
  };

  const save = async () => {
    if ((dirtyIds?.size || 0) === 0) {
      onClose?.();
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      for (const workoutId of Array.from(dirtyIds)) {
        const row = rows.find((r) => r.workout === workoutId);
        if (!row) continue;
        const payload = {
          goal_distance: toNumOrNull(row.goal_distance) ?? 0,
        };
        const res = await fetch(`${API_BASE}/api/cardio/goal-distances/${workoutId}/`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const txt = await res.text();
          throw new Error(`Save failed for workout ${workoutId}: ${res.status} ${txt}`);
        }
      }
      onClose?.();
    } catch (e) {
      setErr(e);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <div style={{ fontWeight: 600, fontSize: 16 }}>Goal Distances</div>
        <div>
          <button type="button" style={{ ...btnStyle, marginRight: 8 }} onClick={onClose}>Close</button>
          <button type="button" style={btnStyle} onClick={save} disabled={saving || loading}>{saving ? "Saving." : "Save"}</button>
        </div>
      </div>
      {err && <div style={{ color: "#b91c1c", marginBottom: 8 }}>Error: {String(err.message || err)}</div>}
      {loading ? (
        <div>Loading.</div>
      ) : (
        <div style={{ maxHeight: 480, overflow: "auto", border: "1px solid #e5e7eb", borderRadius: 8 }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ position: "sticky", top: 0, background: "#f1f5f9" }}>
                <th style={{ textAlign: "left", padding: 8 }}>Routine</th>
                <th style={{ textAlign: "left", padding: 8 }}>Workout</th>
                <th style={{ textAlign: "left", padding: 8 }}>Unit</th>
                <th style={{ textAlign: "left", padding: 8 }}>Goal Distance</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.workout}>
                  <td style={{ padding: 8 }}>{row.routine_name}</td>
                  <td style={{ padding: 8 }}>{row.workout_name}</td>
                  <td style={{ padding: 8 }}>{row.unit_name}{row.unit_type ? ` (${row.unit_type})` : ""}</td>
                  <td style={{ padding: 8 }}>
                    <input
                      type="number"
                      step="any"
                      value={row.goal_distance}
                      onChange={(e) => onChangeRow(row.workout, e.target.value)}
                    />
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={4} style={{ padding: 8, opacity: 0.7 }}>No workouts available.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}

function toNumStr(v) {
  if (v === null || v === undefined) return "";
  const n = Number(v);
  return Number.isFinite(n) ? String(n) : "";
}

function toNumOrNull(v) {
  if (v === "" || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
