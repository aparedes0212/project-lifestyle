import { useEffect, useState } from "react";
import Modal from "./ui/Modal";
import { API_BASE } from "../lib/config";

const btnStyle = { border: "1px solid #e5e7eb", background: "#f9fafb", borderRadius: 8, padding: "6px 10px", cursor: "pointer" };
const linkBtnStyle = { ...btnStyle, padding: "4px 8px" };

export default function CardioProgressionsModal({ open, onClose }) {
  const [routines, setRoutines] = useState([]);
  const [routineId, setRoutineId] = useState(null);
  const [workouts, setWorkouts] = useState([]);
  const [workoutId, setWorkoutId] = useState(null);
  const [rows, setRows] = useState([]);
  const [routinesLoading, setRoutinesLoading] = useState(false);
  const [workoutsLoading, setWorkoutsLoading] = useState(false);
  const [progressionsLoading, setProgressionsLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!open) {
      setRoutines([]);
      setRoutineId(null);
      setWorkouts([]);
      setWorkoutId(null);
      setRows([]);
      setErr(null);
      setDirty(false);
      setRoutinesLoading(false);
      setWorkoutsLoading(false);
      setProgressionsLoading(false);
      return;
    }

    let ignore = false;
    const fetchRoutines = async () => {
      setRoutinesLoading(true);
      setErr(null);
      try {
        const res = await fetch(`${API_BASE}/api/cardio/routines-ordered/`);
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        const data = await res.json();
        if (!ignore) {
          const list = Array.isArray(data) ? data : [];
          setRoutines(list);
          setRoutineId((prev) => (prev != null ? prev : (list[0]?.id ?? null)));
        }
      } catch (error) {
        if (!ignore) setErr(error);
      } finally {
        if (!ignore) setRoutinesLoading(false);
      }
    };
    fetchRoutines();
    return () => { ignore = true; };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (!routineId) {
      setWorkouts([]);
      setWorkoutId(null);
      setRows([]);
      setDirty(false);
      return;
    }
    let ignore = false;
    const fetchWorkouts = async () => {
      setWorkoutsLoading(true);
      setErr(null);
      try {
        const res = await fetch(`${API_BASE}/api/cardio/workouts-ordered/?routine_id=${routineId}&include_skipped=true`);
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        const data = await res.json();
        if (!ignore) {
          const list = Array.isArray(data) ? data : [];
          setWorkouts(list);
          setWorkoutId((prev) => {
            if (prev && list.some((w) => w.id === prev)) return prev;
            return list.length > 0 ? list[0].id : null;
          });
        }
      } catch (error) {
        if (!ignore) setErr(error);
      } finally {
        if (!ignore) setWorkoutsLoading(false);
      }
    };
    fetchWorkouts();
    return () => { ignore = true; };
  }, [routineId, open]);

  useEffect(() => {
    if (!open) return;
    if (!workoutId) {
      setRows([]);
      setDirty(false);
      return;
    }
    let ignore = false;
    const fetchProgressions = async () => {
      setProgressionsLoading(true);
      setErr(null);
      try {
        const res = await fetch(`${API_BASE}/api/cardio/progressions/?workout_id=${workoutId}`);
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        const data = await res.json();
        if (!ignore) {
          const mapped = Array.isArray(data)
            ? data.map((item) => makeRow(item))
            : [];
          mapped.sort((a, b) => compareOrder(a.progression_order, b.progression_order));
          setRows(mapped);
          setDirty(false);
        }
      } catch (error) {
        if (!ignore) setErr(error);
      } finally {
        if (!ignore) setProgressionsLoading(false);
      }
    };
    fetchProgressions();
    return () => { ignore = true; };
  }, [workoutId, open]);

  const updateRow = (localId, field, value) => {
    setRows((prev) => prev.map((row) => (row.localId === localId ? { ...row, [field]: value } : row)));
    setDirty(true);
    setErr(null);
  };

  const removeRow = (localId) => {
    setRows((prev) => prev.filter((row) => row.localId !== localId));
    setDirty(true);
    setErr(null);
  };

  const addRow = () => {
    const nextOrder = rows.reduce((max, row) => {
      const n = Number(row.progression_order);
      return Number.isFinite(n) ? Math.max(max, n) : max;
    }, 0) + 1;
    setRows((prev) => [...prev, makeRow({ progression_order: nextOrder, progression: "" })]);
    setDirty(true);
    setErr(null);
  };

  const save = async () => {
    if (!workoutId) return;
    const payload = [];
    setErr(null);
    for (const row of rows) {
      const orderNum = Number(row.progression_order);
      if (!Number.isFinite(orderNum) || orderNum <= 0 || Math.floor(orderNum) !== orderNum) {
        setErr(new Error("Progression order must be a positive integer."));
        return;
      }
      const progNum = Number(row.progression);
      if (!Number.isFinite(progNum)) {
        setErr(new Error("Progression value must be numeric."));
        return;
      }
      payload.push({ progression_order: orderNum, progression: progNum });
    }
    const seenOrders = new Set();
    for (const item of payload) {
      if (seenOrders.has(item.progression_order)) {
        setErr(new Error("Progression order values must be unique."));
        return;
      }
      seenOrders.add(item.progression_order);
    }

    setSaving(true);
    try {
      const res = await fetch(`${API_BASE}/api/cardio/progressions/?workout_id=${workoutId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ progressions: payload }),
      });
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`Save failed: ${res.status} ${txt}`);
      }
      const data = await res.json();
      const mapped = Array.isArray(data)
        ? data.map((item) => makeRow(item))
        : [];
      mapped.sort((a, b) => compareOrder(a.progression_order, b.progression_order));
      setRows(mapped);
      setDirty(false);
    } catch (error) {
      setErr(error);
    } finally {
      setSaving(false);
    }
  };

  const canSave = Boolean(workoutId) && dirty && !saving && !progressionsLoading;

  return (
    <Modal open={open}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <div style={{ fontWeight: 600, fontSize: 16 }}>Cardio Progressions</div>
        <div>
          <button type="button" style={{ ...btnStyle, marginRight: 8 }} onClick={onClose}>
            Close
          </button>
          <button
            type="button"
            style={btnStyle}
            onClick={save}
            disabled={!canSave}
          >
            {saving ? "Saving." : "Save"}
          </button>
        </div>
      </div>
      <p style={{ marginTop: 0, marginBottom: 12, opacity: 0.8, fontSize: 13 }}>
        Adjust the progression ladder (goal values per level) for each cardio workout.
      </p>
      {err && (
        <div style={{ color: "#b91c1c", marginBottom: 8 }}>
          Error: {String(err?.message || err)}
        </div>
      )}
      {routinesLoading ? (
        <div>Loading routines.</div>
      ) : routines.length === 0 ? (
        <div>No cardio routines available.</div>
      ) : (
        <div style={{ display: "grid", gap: 12, marginBottom: 12 }}>
          <label>
            <div>Routine</div>
            <select
              value={routineId ?? ""}
              onChange={(e) => setRoutineId(e.target.value ? Number(e.target.value) : null)}
              disabled={routinesLoading}
            >
              {routines.map((routine) => (
                <option key={routine.id} value={routine.id}>
                  {routine.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <div>Workout</div>
            <select
              value={workoutId ?? ""}
              onChange={(e) => setWorkoutId(e.target.value ? Number(e.target.value) : null)}
              disabled={workoutsLoading || !routineId}
            >
              {workouts.map((workout) => (
                <option key={workout.id} value={workout.id}>
                  {workout.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      {workoutsLoading && <div>Loading workouts.</div>}

      {!workoutsLoading && workoutId && (
        <div>
          {progressionsLoading ? (
            <div>Loading progressions.</div>
          ) : (
            <div>
              <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 8 }}>
                <thead>
                  <tr style={{ background: "#f1f5f9" }}>
                    <th style={{ textAlign: "left", padding: 6, width: "30%" }}>Order</th>
                    <th style={{ textAlign: "left", padding: 6, width: "50%" }}>Goal</th>
                    <th style={{ textAlign: "left", padding: 6, width: "20%" }}></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.localId}>
                      <td style={{ padding: 6 }}>
                        <input
                          type="number"
                          value={row.progression_order}
                          min={1}
                          step={1}
                          onChange={(e) => updateRow(row.localId, "progression_order", e.target.value)}
                          disabled={saving}
                          style={{ width: "100%" }}
                        />
                      </td>
                      <td style={{ padding: 6 }}>
                        <input
                          type="number"
                          step="any"
                          value={row.progression}
                          onChange={(e) => updateRow(row.localId, "progression", e.target.value)}
                          disabled={saving}
                          style={{ width: "100%" }}
                        />
                      </td>
                      <td style={{ padding: 6 }}>
                        <button
                          type="button"
                          style={linkBtnStyle}
                          onClick={() => removeRow(row.localId)}
                          disabled={saving}
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))}
                  {rows.length === 0 && (
                    <tr>
                      <td colSpan={3} style={{ padding: 6, opacity: 0.7 }}>
                        No progressions defined. Use “Add level” to create one.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
              <button type="button" style={btnStyle} onClick={addRow} disabled={saving}>
                Add level
              </button>
            </div>
          )}
        </div>
      )}

      {!workoutsLoading && !workoutId && routines.length > 0 && (
        <div>Select a workout to edit its progression ladder.</div>
      )}
    </Modal>
  );
}

function toNumStr(value) {
  if (value === null || value === undefined || value === "") return "";
  const num = Number(value);
  return Number.isFinite(num) ? String(num) : "";
}

function makeRow(item = {}) {
  const baseId = item.id != null ? `existing-${item.id}` : `draft-${Math.random().toString(36).slice(2)}`;
  return {
    id: item.id ?? null,
    localId: baseId,
    progression_order: toNumStr(item.progression_order),
    progression: toNumStr(item.progression),
  };
}

function compareOrder(a, b) {
  const left = Number(a);
  const right = Number(b);
  if (!Number.isFinite(left) && !Number.isFinite(right)) return 0;
  if (!Number.isFinite(left)) return 1;
  if (!Number.isFinite(right)) return -1;
  return left - right;
}
