import { useEffect, useMemo, useState } from "react";
import Modal from "./ui/Modal";
import { API_BASE } from "../lib/config";

const btnStyle = { border: "1px solid #e5e7eb", background: "#f9fafb", borderRadius: 8, padding: "6px 10px", cursor: "pointer" };
const tableContainerStyle = { maxHeight: 320, overflow: "auto", border: "1px solid #e5e7eb", borderRadius: 8 };
const thStyle = { textAlign: "left", padding: 8, fontSize: 12, textTransform: "uppercase", letterSpacing: "0.04em", color: "#6b7280", background: "#f8fafc", position: "sticky", top: 0 };
const tdStyle = { padding: 8, borderTop: "1px solid #f1f5f9", fontSize: 13 };

function toNumStr(value) {
  if (value === null || value === undefined) return "";
  const num = Number(value);
  return Number.isFinite(num) ? String(num) : "";
}

function clampThresholds(row, label) {
  const yellow = Number(row.yellow_start_seconds);
  const red = Number(row.red_start_seconds);
  const critical = Number(row.critical_start_seconds);
  const context = label ? ` for ${label}` : "";
  if (!Number.isFinite(yellow) || yellow <= 0) {
    throw new Error(`Yellow threshold must be a positive number${context}.`);
  }
  if (!Number.isFinite(red) || red <= 0) {
    throw new Error(`Red threshold must be a positive number${context}.`);
  }
  if (!Number.isFinite(critical) || critical <= 0) {
    throw new Error(`Critical threshold must be a positive number${context}.`);
  }
  const yy = Math.round(yellow);
  const rr = Math.round(red);
  const cc = Math.round(critical);
  if (!(yy < rr && rr < cc)) {
    throw new Error(`Thresholds must increase (yellow < red < critical)${context}.`);
  }
  return { yellow_start_seconds: yy, red_start_seconds: rr, critical_start_seconds: cc };
}

export default function RestThresholdsModal({ open, onClose }) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);
  const [strengthRows, setStrengthRows] = useState([]);
  const [cardioRows, setCardioRows] = useState([]);
  const [dirtyStrength, setDirtyStrength] = useState(() => new Set());
  const [dirtyCardio, setDirtyCardio] = useState(() => new Set());

  useEffect(() => {
    if (!open) return;
    let ignore = false;
    const fetchAll = async () => {
      setLoading(true);
      setErr(null);
      try {
        const [strengthRes, cardioRes] = await Promise.all([
          fetch(`${API_BASE}/api/strength/rest-thresholds/`),
          fetch(`${API_BASE}/api/cardio/rest-thresholds/`),
        ]);
        if (!strengthRes.ok) {
          throw new Error(`Strength thresholds ${strengthRes.status}`);
        }
        if (!cardioRes.ok) {
          throw new Error(`Cardio thresholds ${cardioRes.status}`);
        }
        const [strengthData, cardioData] = await Promise.all([
          strengthRes.json(),
          cardioRes.json(),
        ]);
        if (ignore) return;
        const mappedStrength = Array.isArray(strengthData)
          ? strengthData.map(item => ({
              exercise: item.exercise,
              exercise_name: item.exercise_name,
              routine_name: item.routine_name,
              yellow_start_seconds: toNumStr(item.yellow_start_seconds),
              red_start_seconds: toNumStr(item.red_start_seconds),
              critical_start_seconds: toNumStr(item.critical_start_seconds),
            }))
          : [];
        const mappedCardio = Array.isArray(cardioData)
          ? cardioData.map(item => ({
              workout: item.workout,
              workout_name: item.workout_name,
              routine_name: item.routine_name,
              yellow_start_seconds: toNumStr(item.yellow_start_seconds),
              red_start_seconds: toNumStr(item.red_start_seconds),
              critical_start_seconds: toNumStr(item.critical_start_seconds),
            }))
          : [];
        setStrengthRows(mappedStrength);
        setCardioRows(mappedCardio);
        setDirtyStrength(() => new Set());
        setDirtyCardio(() => new Set());
      } catch (e) {
        if (!ignore) setErr(e);
      } finally {
        if (!ignore) setLoading(false);
      }
    };
    fetchAll();
    return () => { ignore = true; };
  }, [open]);

  const onChangeStrength = (exerciseId, field, value) => {
    setStrengthRows(prev => prev.map(row => (
      row.exercise === exerciseId ? { ...row, [field]: value } : row
    )));
    setDirtyStrength(prev => {
      const next = new Set(prev);
      next.add(exerciseId);
      return next;
    });
  };

  const onChangeCardio = (workoutId, field, value) => {
    setCardioRows(prev => prev.map(row => (
      row.workout === workoutId ? { ...row, [field]: value } : row
    )));
    setDirtyCardio(prev => {
      const next = new Set(prev);
      next.add(workoutId);
      return next;
    });
  };

  const dirtyCount = useMemo(() => dirtyStrength.size + dirtyCardio.size, [dirtyStrength, dirtyCardio]);

  const save = async () => {
    if (dirtyCount === 0) {
      onClose?.();
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      for (const exerciseId of Array.from(dirtyStrength)) {
        const row = strengthRows.find(r => r.exercise === exerciseId);
        if (!row) continue;
        const payload = clampThresholds(row, `${row.routine_name} / ${row.exercise_name}`);
        const res = await fetch(`${API_BASE}/api/strength/rest-thresholds/${exerciseId}/`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const txt = await res.text();
          throw new Error(`Strength save failed (${exerciseId}): ${res.status} ${txt}`);
        }
      }
      for (const workoutId of Array.from(dirtyCardio)) {
        const row = cardioRows.find(r => r.workout === workoutId);
        if (!row) continue;
        const payload = clampThresholds(row, `${row.routine_name} / ${row.workout_name}`);
        const res = await fetch(`${API_BASE}/api/cardio/rest-thresholds/${workoutId}/`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const txt = await res.text();
          throw new Error(`Cardio save failed (${workoutId}): ${res.status} ${txt}`);
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
        <div style={{ fontWeight: 600, fontSize: 16 }}>Rest Color Thresholds</div>
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" style={btnStyle} onClick={onClose} disabled={saving}>Close</button>
          <button type="button" style={btnStyle} onClick={save} disabled={saving || loading}>
            {saving ? "Saving." : "Save"}
          </button>
        </div>
      </div>
      <p style={{ marginTop: 0, marginBottom: 8, fontSize: 13, color: "#475569" }}>
        Thresholds are in seconds and apply to the rest colors (green, yellow, red, critical) for strength sets and cardio workouts.
      </p>
      {err && <div style={{ color: "#b91c1c", marginBottom: 8 }}>Error: {String(err.message || err)}</div>}
      {loading ? (
        <div>Loading.</div>
      ) : (
        <div style={{ display: "grid", gap: 16 }}>
          <fieldset style={{ border: "1px solid #e5e7eb", borderRadius: 8, padding: 12 }}>
            <legend style={{ padding: "0 6px" }}>Strength Exercises</legend>
            <div style={tableContainerStyle}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={thStyle}>Routine</th>
                    <th style={thStyle}>Exercise</th>
                    <th style={thStyle}>Yellow (s)</th>
                    <th style={thStyle}>Red (s)</th>
                    <th style={thStyle}>Critical (s)</th>
                  </tr>
                </thead>
                <tbody>
                  {strengthRows.map(row => (
                    <tr key={row.exercise}>
                      <td style={tdStyle}>{row.routine_name}</td>
                      <td style={tdStyle}>{row.exercise_name}</td>
                      <td style={tdStyle}>
                        <input
                          type="number"
                          min="1"
                          step="1"
                          value={row.yellow_start_seconds}
                          onChange={(e) => onChangeStrength(row.exercise, "yellow_start_seconds", e.target.value)}
                          disabled={saving}
                        />
                      </td>
                      <td style={tdStyle}>
                        <input
                          type="number"
                          min="1"
                          step="1"
                          value={row.red_start_seconds}
                          onChange={(e) => onChangeStrength(row.exercise, "red_start_seconds", e.target.value)}
                          disabled={saving}
                        />
                      </td>
                      <td style={tdStyle}>
                        <input
                          type="number"
                          min="1"
                          step="1"
                          value={row.critical_start_seconds}
                          onChange={(e) => onChangeStrength(row.exercise, "critical_start_seconds", e.target.value)}
                          disabled={saving}
                        />
                      </td>
                    </tr>
                  ))}
                  {strengthRows.length === 0 && (
                    <tr><td colSpan={5} style={{ ...tdStyle, textAlign: "center", color: "#6b7280" }}>No strength exercises available.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </fieldset>

          <fieldset style={{ border: "1px solid #e5e7eb", borderRadius: 8, padding: 12 }}>
            <legend style={{ padding: "0 6px" }}>Cardio Workouts</legend>
            <div style={tableContainerStyle}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={thStyle}>Routine</th>
                    <th style={thStyle}>Workout</th>
                    <th style={thStyle}>Yellow (s)</th>
                    <th style={thStyle}>Red (s)</th>
                    <th style={thStyle}>Critical (s)</th>
                  </tr>
                </thead>
                <tbody>
                  {cardioRows.map(row => (
                    <tr key={row.workout}>
                      <td style={tdStyle}>{row.routine_name}</td>
                      <td style={tdStyle}>{row.workout_name}</td>
                      <td style={tdStyle}>
                        <input
                          type="number"
                          min="1"
                          step="1"
                          value={row.yellow_start_seconds}
                          onChange={(e) => onChangeCardio(row.workout, "yellow_start_seconds", e.target.value)}
                          disabled={saving}
                        />
                      </td>
                      <td style={tdStyle}>
                        <input
                          type="number"
                          min="1"
                          step="1"
                          value={row.red_start_seconds}
                          onChange={(e) => onChangeCardio(row.workout, "red_start_seconds", e.target.value)}
                          disabled={saving}
                        />
                      </td>
                      <td style={tdStyle}>
                        <input
                          type="number"
                          min="1"
                          step="1"
                          value={row.critical_start_seconds}
                          onChange={(e) => onChangeCardio(row.workout, "critical_start_seconds", e.target.value)}
                          disabled={saving}
                        />
                      </td>
                    </tr>
                  ))}
                  {cardioRows.length === 0 && (
                    <tr><td colSpan={5} style={{ ...tdStyle, textAlign: "center", color: "#6b7280" }}>No cardio workouts available.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </fieldset>
        </div>
      )}
    </Modal>
  );
}
