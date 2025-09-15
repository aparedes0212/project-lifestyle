import { useEffect, useMemo, useState } from "react";
import Modal from "./ui/Modal";
import { API_BASE } from "../lib/config";

const btnStyle = { border: "1px solid #e5e7eb", background: "#f9fafb", borderRadius: 8, padding: "6px 10px", cursor: "pointer" };

const OPTIONS = [
  { value: "run_to_tm", label: "Run time → TM" },
  { value: "tm_to_run", label: "TM → Run time" },
  { value: "run_equals_tm", label: "Run time = TM" },
  { value: "none", label: "No sync" },
];

export default function TMSyncDefaultsModal({ open, onClose }) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);
  const [rows, setRows] = useState([]);
  const [dirty, setDirty] = useState(new Map()); // workout_id -> selected value

  useEffect(() => {
    if (!open) return;
    let ignore = false;
    const fetchAll = async () => {
      setLoading(true);
      setErr(null);
      try {
        const res = await fetch(`${API_BASE}/api/cardio/tm-sync-defaults/`);
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        const data = await res.json();
        if (!ignore) {
          setRows(Array.isArray(data) ? data : []);
          setDirty(new Map());
        }
      } catch (e) {
        if (!ignore) setErr(e);
      } finally {
        if (!ignore) setLoading(false);
      }
    };
    fetchAll();
    return () => { ignore = true; };
  }, [open]);

  const onChangeRow = (workoutId, value) => {
    setRows(prev => prev.map(r => r.workout === workoutId ? { ...r, default_tm_sync: value } : r));
    setDirty(prev => {
      const m = new Map(prev);
      m.set(workoutId, value);
      return m;
    });
  };

  const save = async () => {
    if (dirty.size === 0) { onClose?.(); return; }
    setSaving(true);
    setErr(null);
    try {
      // Save sequentially to avoid DB locked errors
      for (const [workoutId, value] of dirty.entries()) {
        const res = await fetch(`${API_BASE}/api/cardio/tm-sync-defaults/${workoutId}/`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ default_tm_sync: value }),
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
        <div style={{ fontWeight: 600, fontSize: 16 }}>TM Sync Defaults</div>
        <div>
          <button type="button" style={{ ...btnStyle, marginRight: 8 }} onClick={onClose}>Close</button>
          <button type="button" style={btnStyle} onClick={save} disabled={saving || loading}>{saving ? "Saving…" : "Save"}</button>
        </div>
      </div>
      {err && <div style={{ color: "#b91c1c", marginBottom: 8 }}>Error: {String(err.message || err)}</div>}
      {loading ? (
        <div>Loading…</div>
      ) : (
        <div style={{ maxHeight: 480, overflow: "auto", border: "1px solid #e5e7eb", borderRadius: 8 }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ position: "sticky", top: 0, background: "#f1f5f9" }}>
                <th style={{ textAlign: "left", padding: 8 }}>Routine</th>
                <th style={{ textAlign: "left", padding: 8 }}>Workout</th>
                <th style={{ textAlign: "left", padding: 8 }}>Default TM Sync</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.workout}>
                  <td style={{ padding: 8 }}>{r.routine_name}</td>
                  <td style={{ padding: 8 }}>{r.workout_name}</td>
                  <td style={{ padding: 8 }}>
                    <select value={r.default_tm_sync} onChange={(e) => onChangeRow(r.workout, e.target.value)}>
                      {OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                    </select>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={3} style={{ padding: 8, opacity: 0.7 }}>No workouts available.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}

