import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import useApi from "../hooks/useApi";
import { API_BASE } from "../lib/config";
import Card from "../components/ui/Card";
import Row from "../components/ui/Row";
import Modal from "../components/ui/Modal";

const btnStyle = { border: "1px solid #e5e7eb", background: "#f9fafb", borderRadius: 8, padding: "6px 10px", cursor: "pointer" };
const xBtnInline = { border: "none", background: "transparent", color: "#b91c1c", cursor: "pointer", fontSize: 14, lineHeight: 1, padding: 2, marginLeft: 8 };
const editBtnInline = { border: "none", background: "transparent", color: "#1d4ed8", cursor: "pointer", fontSize: 14, lineHeight: 1, padding: 2 };

function toIsoLocal(date) {
  const d = date instanceof Date ? date : new Date(date);
  const tzOffset = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - tzOffset).toISOString().slice(0, 19);
}
function toIsoLocalNow() { return toIsoLocal(new Date()); }
function n(v) { const x = Number(v); return Number.isFinite(x) ? x : null; }
function toMinutes(mins, secs) { return (n(mins) || 0) + (n(secs) || 0) / 60; }
function fromMinutes(total) {
  const t = Math.max(0, Number(total) || 0);
  const m = Math.floor(t);
  const s = (t - m) * 60;
  return { m, s: Math.round(s * 1000) / 1000 };
}
function mphFrom(miles, mins, secs) {
  const mi = n(miles); const total = toMinutes(mins, secs);
  if (!mi || mi <= 0 || !total || total <= 0) return "";
  return String(Math.round((mi / (total / 60)) * 1000) / 1000);
}
function minsFrom(mph, miles) {
  const vMph = n(mph); const vMi = n(miles);
  if (!vMph || vMph <= 0 || !vMi || vMi <= 0) return { m: "", s: "" };
  return fromMinutes((vMi / vMph) * 60);
}

const emptyRow = {
  datetime: "",
  exercise_id: "",
  running_minutes: "",
  running_seconds: "",
  running_miles: "",
  running_mph: "",
  treadmill_time_minutes: "",
  treadmill_time_seconds: "",
};

export default function LogDetailsPage() {
  const { id } = useParams();

  // log + intervals
  const { data, loading, error, refetch } = useApi(`${API_BASE}/api/cardio/log/${id}/`, { deps: [id] });

  const [startedAt, setStartedAt] = useState("");
  useEffect(() => {
    if (data?.datetime_started) {
      setStartedAt(toIsoLocal(new Date(data.datetime_started)));
    }
  }, [data?.datetime_started]);

  const [updatingStart, setUpdatingStart] = useState(false);
  const [updateStartErr, setUpdateStartErr] = useState(null);
  const saveStart = async () => {
    setUpdatingStart(true);
    setUpdateStartErr(null);
    try {
      const payload = { datetime_started: new Date(startedAt).toISOString() };
      const res = await fetch(`${API_BASE}/api/cardio/log/${id}/`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      await res.json();
      await refetch();
    } catch (err) {
      setUpdateStartErr(err);
    } finally {
      setUpdatingStart(false);
    }
  };

  const [maxMphInput, setMaxMphInput] = useState("");
  useEffect(() => {
    if (data?.max_mph != null) {
      setMaxMphInput(String(data.max_mph));
    }
  }, [data?.max_mph]);

  const [updatingMax, setUpdatingMax] = useState(false);
  const [updateMaxErr, setUpdateMaxErr] = useState(null);
  const saveMax = async () => {
    setUpdatingMax(true);
    setUpdateMaxErr(null);
    try {
      const payload = { max_mph: n(maxMphInput) };
      const res = await fetch(`${API_BASE}/api/cardio/log/${id}/`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      await res.json();
      await refetch();
    } catch (err) {
      setUpdateMaxErr(err);
    } finally {
      setUpdatingMax(false);
    }
  };

  const autoMax = useMemo(() => {
    const details = data?.details || [];
    if (!details.length) return null;
    let max = null;
    for (const d of details) {
      const v = n(d.running_mph);
      if (v !== null && (max === null || v > max)) max = v;
    }
    return max !== null ? Math.round(max * 1000) / 1000 : null;
  }, [data?.details]);

  // sync auto-calculated max to backend only when greater than stored value
  useEffect(() => {
    if (autoMax === null) return;
    const current = n(data?.max_mph);
    if (autoMax > (current ?? 0)) {
      (async () => {
        try {
          await fetch(`${API_BASE}/api/cardio/log/${id}/`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ max_mph: autoMax }),
          });
          await refetch();
        } catch (err) {
          console.error(err);
        }
      })();
    }
  }, [autoMax, data?.max_mph, id, refetch]);

  // prevTM FIRST (used by others)
  const prevTM = useMemo(() => {
    const details = data?.details || [];
    if (!details.length) return 0;
    const last = details[details.length - 1];
    const m = n(last.treadmill_time_minutes) || 0;
    const s = n(last.treadmill_time_seconds) || 0;
    return m + s / 60;
  }, [data?.details]);

  const isFirstEntry = useMemo(() => (data?.details?.length || 0) === 0, [data?.details]);
  const routineName = (data?.workout?.routine?.name || "").toLowerCase();

  // ---- Units ----
  // Fetch all CardioUnits
  const unitsApi = useApi(`${API_BASE}/api/cardio/units/`, { deps: [] });

  // Only distance units should be available for selection
  const distanceUnits = useMemo(() => (
    (unitsApi.data || []).filter(u => (u.unit_type || "").toLowerCase() === "distance")
  ), [unitsApi.data]);

  // default unit = workout.unit if it's distance; else the smallest distance unit id
  const defaultUnitId = useMemo(() => {
    const list = distanceUnits;
    if (!list.length) return "";
    const workoutUnit = data?.workout?.unit;
    if (workoutUnit && (workoutUnit.unit_type || "").toLowerCase() === "distance") {
      return String(workoutUnit.id);
    }
    return String(Math.min(...list.map(u => u.id)));
  }, [distanceUnits, data?.workout?.unit]);

  const [unitId, setUnitId] = useState("");
  useEffect(() => { if (!unitId && defaultUnitId) setUnitId(defaultUnitId); }, [unitId, defaultUnitId]);

  const selectedUnit = useMemo(() => {
    return distanceUnits.find(u => String(u.id) === String(unitId));
  }, [distanceUnits, unitId]);

  // miles per 1 "unit" (e.g., 400m ≈ 0.248548 mi)
  const unitMilesFactor = useMemo(() => {
    if (!selectedUnit) return 1;
    const num = Number(selectedUnit.mile_equiv_numerator);
    const den = Number(selectedUnit.mile_equiv_denominator || 1);
    const f = num / den;
    return Number.isFinite(f) && f > 0 ? f : 1;
  }, [selectedUnit]);

  const isTimePerDist = (selectedUnit?.speed_type || "").toLowerCase() === "time/distance";
  const speedLabelText = (selectedUnit?.speed_label || "").toLowerCase(); // e.g., "mph"

  // first-entry baseline: 5 for Sprints, else 0
  const sprintBaseline = useMemo(
    () => (isFirstEntry && routineName === "sprints" ? 5 : 0),
    [isFirstEntry, routineName]
  );

  // effective "previous cumulative" (baseline for first entry)
  const effectivePrev = useMemo(
    () => (isFirstEntry ? sprintBaseline : prevTM),
    [isFirstEntry, sprintBaseline, prevTM]
  );

  const [addModalOpen, setAddModalOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);

  // add-one-interval form (we persist miles + mph to backend)
  const [row, setRow] = useState(emptyRow);

  // ---- Display helpers for distance/speed in selected unit ----
  const displayDistance = useMemo(() => {
    const mi = n(row.running_miles);
    if (!mi || mi <= 0) return "";
    return Math.round((mi / unitMilesFactor) * 1000) / 1000;
  }, [row.running_miles, unitMilesFactor]);

const displaySpeedOrPace = useMemo(() => {
  const mph = n(row.running_mph);
  if (!mph || mph <= 0) return "";

  if (isTimePerDist) {
    // pace: min per unit = (min per mile) * (miles per unit)
    const pace = (60 / mph) * unitMilesFactor;
    return Math.round(pace * 1000) / 1000;
  }

  // distance/time
  if (speedLabelText === "mph") {
    // show mph directly
    return Math.round(mph * 1000) / 1000;
  }
  // else show units/hour
  return Math.round((mph / unitMilesFactor) * 1000) / 1000;
}, [row.running_mph, unitMilesFactor, isTimePerDist, speedLabelText]);

  // exercises dropdown (for intervals)
  const exApi = useApi(`${API_BASE}/api/cardio/exercises/`, { deps: [] });
  const minExerciseId = useMemo(() => {
    const list = exApi.data || [];
    return list.length ? String(Math.min(...list.map(x => x.id))) : "";
  }, [exApi.data]);

  // defaults (exercise + initial TM baseline behavior)
  useEffect(() => {
    setRow(r => {
      const exercise_id = r.exercise_id || minExerciseId || "";

      // If treadmill fields are empty, decide how to prefill them:
      let tmM = r.treadmill_time_minutes;
      let tmS = r.treadmill_time_seconds;

      if (tmM === "" && tmS === "") {
        const intervalMin = toMinutes(r.running_minutes, r.running_seconds);

        if (isFirstEntry) {
          // First entry:
          // - Sprints: TM = 5:00 + interval
          // - Others:  TM = interval
          const base = sprintBaseline; // 5 for Sprints, 0 otherwise
          const { m, s } = fromMinutes(base + intervalMin);
          tmM = m; tmS = s;
          // Do NOT alter running_minutes/seconds here.
        } else {
          // Not first: TM = prevTM + interval
          if (intervalMin > 0) {
            const { m, s } = fromMinutes(prevTM + intervalMin);
            tmM = m; tmS = s;
          }
        }
      }

      return { ...r, exercise_id, treadmill_time_minutes: tmM, treadmill_time_seconds: tmS };
    });
  }, [minExerciseId, prevTM, isFirstEntry, sprintBaseline, addModalOpen]);

  const setField = (patch) => setRow(r => ({ ...r, ...patch }));

  // ---- Handlers (miles/mins/seconds/TM/mph) ----
  const onChangeMinutes = (v) => {
    const mph = mphFrom(row.running_miles, v, row.running_seconds);
    const intervalMin = toMinutes(v, row.running_seconds);
    const { m, s } = fromMinutes(effectivePrev + intervalMin);
    setField({ running_minutes: v, running_mph: mph, treadmill_time_minutes: m, treadmill_time_seconds: s });
  };
  const onChangeSeconds = (v) => {
    const mph = mphFrom(row.running_miles, row.running_minutes, v);
    const intervalMin = toMinutes(row.running_minutes, v);
    const { m, s } = fromMinutes(effectivePrev + intervalMin);
    setField({ running_seconds: v, running_mph: mph, treadmill_time_minutes: m, treadmill_time_seconds: s });
  };

  // distance entry in SELECTED UNIT -> convert to miles
  const onChangeDistanceDisplay = (v) => {
    if (v === "") {
      setField({ running_miles: "", running_mph: mphFrom("", row.running_minutes, row.running_seconds) });
      return;
    }
    const val = Number(v);
    if (!Number.isFinite(val) || val < 0) return;
    const miles = val * unitMilesFactor;
    const mph = mphFrom(miles, row.running_minutes, row.running_seconds);
    setField({ running_miles: miles, running_mph: mph });
  };

  // MPH change via SELECTED UNIT speed/pace input
const onChangeSpeedDisplay = (v) => {
  if (v === "") {
    setField({ running_mph: "" });
    return;
  }
  const val = Number(v);
  if (!Number.isFinite(val) || val <= 0) return;

  let mph;
  if (isTimePerDist) {
    // pace (min per unit) -> mph
    mph = 60 * unitMilesFactor / val;
  } else {
    // distance/time
    mph = (speedLabelText === "mph") ? val : val * unitMilesFactor;
  }

  // drive the rest from mph
  const { m, s } = minsFrom(mph, row.running_miles);
  const intervalMin = toMinutes(m, s);
  const { m: tmM, s: tmS } = fromMinutes(effectivePrev + intervalMin);
  setField({ running_mph: mph, running_minutes: m, running_seconds: s, treadmill_time_minutes: tmM, treadmill_time_seconds: tmS });
};


  const onChangeTmMinutes = (v) => {
    const totalMins = toMinutes(v, row.treadmill_time_seconds);
    const interval = Math.max(0, totalMins - effectivePrev);
    const { m, s } = fromMinutes(interval);
    const mph = mphFrom(row.running_miles, m, s);
    setField({ treadmill_time_minutes: v, running_minutes: m, running_seconds: s, running_mph: mph });
  };
  const onChangeTmSeconds = (v) => {
    const totalMins = toMinutes(row.treadmill_time_minutes, v);
    const interval = Math.max(0, totalMins - effectivePrev);
    const { m, s } = fromMinutes(interval);
    const mph = mphFrom(row.running_miles, m, s);
    setField({ treadmill_time_seconds: v, running_minutes: m, running_seconds: s, running_mph: mph });
  };

  const openModal = () => {
    setEditingId(null);
    setAddModalOpen(true);
    setRow({ ...emptyRow, datetime: toIsoLocalNow() });
  };
  const openEdit = (detail) => {
    setEditingId(detail.id);
    const ex = (exApi.data || []).find(e => e.name === detail.exercise);
    setRow({
      datetime: toIsoLocal(detail.datetime),
      exercise_id: ex ? String(ex.id) : "",
      running_minutes: detail.running_minutes ?? "",
      running_seconds: detail.running_seconds ?? "",
      running_miles: detail.running_miles ?? "",
      running_mph: detail.running_mph ?? "",
      treadmill_time_minutes: detail.treadmill_time_minutes ?? "",
      treadmill_time_seconds: detail.treadmill_time_seconds ?? "",
    });
    setAddModalOpen(true);
  };
  const closeModal = () => {
    setAddModalOpen(false);
    setEditingId(null);
    setRow(emptyRow);
  };

  // create or update detail
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setSaveErr(null);
    try {
      const payload = {
        datetime: new Date(row.datetime).toISOString(),
        exercise_id: row.exercise_id ? Number(row.exercise_id) : null,
        running_minutes: row.running_minutes === "" ? null : Number(row.running_minutes),
        running_seconds: row.running_seconds === "" ? null : Number(row.running_seconds),
        running_miles: row.running_miles === "" ? null : Number(row.running_miles),
        running_mph: row.running_mph === "" ? null : Number(row.running_mph),
        treadmill_time_minutes: row.treadmill_time_minutes === "" ? null : Number(row.treadmill_time_minutes),
        treadmill_time_seconds: row.treadmill_time_seconds === "" ? null : Number(row.treadmill_time_seconds),
      };
      const url = editingId
        ? `${API_BASE}/api/cardio/log/${id}/details/${editingId}/`
        : `${API_BASE}/api/cardio/log/${id}/details/`;
      const method = editingId ? "PATCH" : "POST";
      const body = editingId ? JSON.stringify(payload) : JSON.stringify({ details: [payload] });
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body,
      });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      await res.json();
      await refetch();
      closeModal();
    } catch (err) {
      setSaveErr(err);
    } finally {
      setSaving(false);
    }
  };

  // delete interval
  const [deletingId, setDeletingId] = useState(null);
  const [deleteErr, setDeleteErr] = useState(null);
  const deleteDetail = async (detailId) => {
    if (!confirm("Delete this interval?")) return;
    setDeletingId(detailId);
    setDeleteErr(null);
    try {
      const res = await fetch(`${API_BASE}/api/cardio/log/${id}/details/${detailId}/delete/`, { method: "DELETE" });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      await refetch();
    } catch (e) {
      setDeleteErr(e);
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div>
      <div style={{ marginBottom: 12 }}>
        <Link to="/" style={{ textDecoration: "none" }}>← Back</Link>
      </div>
      <Card title={`Log #${id}`} action={null}>
        {loading && <div>Loading…</div>}
        {error && <div style={{ color: "#b91c1c" }}>Error: {String(error.message || error)}</div>}
        {deleteErr && <div style={{ color: "#b91c1c" }}>Delete error: {String(deleteErr.message || deleteErr)}</div>}

        {!loading && !error && data && (
          <>
              <div style={{ marginBottom: 8 }}>
                <div><strong>Workout:</strong> {data.workout?.name} <span style={{ opacity: 0.7 }}>({data.workout?.routine?.name})</span></div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, opacity: 0.8, fontSize: 12 }}>
                  <input type="datetime-local" value={startedAt} onChange={(e) => setStartedAt(e.target.value)} />
                  <button type="button" style={btnStyle} onClick={saveStart} disabled={updatingStart}>
                    {updatingStart ? "Saving…" : "Save"}
                  </button>
                </div>
                {updateStartErr && <div style={{ color: "#b91c1c", fontSize: 12 }}>Error: {String(updateStartErr.message || updateStartErr)}</div>}
              </div>
            <Row left="Goal" right={data.goal ?? "—"} />
            <Row left="Total Completed" right={data.total_completed ?? "—"} />
            <Row
              left="Max MPH"
              right={
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <input
                    type="number"
                    step="any"
                    value={maxMphInput}
                    onChange={(e) => setMaxMphInput(e.target.value)}
                    style={{ width: 80 }}
                  />
                  <button
                    type="button"
                    style={btnStyle}
                    onClick={saveMax}
                    disabled={
                      updatingMax ||
                      n(maxMphInput) === null ||
                      (autoMax !== null && n(maxMphInput) < autoMax)
                    }
                  >
                    {updatingMax ? "Saving…" : "Save"}
                  </button>
                </div>
              }
            />
            {updateMaxErr && (
              <div style={{ color: "#b91c1c", fontSize: 12 }}>
                Error: {String(updateMaxErr.message || updateMaxErr)}
              </div>
            )}
            <Row left="Avg MPH" right={data.avg_mph ?? "—"} />
            <Row left="Minutes Elapsed" right={data.minutes_elapsed ?? "—"} />

            <div style={{ height: 8 }} />
            <div style={{ fontWeight: 600, marginBottom: 6 }}>Intervals</div>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left", padding: "4px 8px" }}>Time</th>
                  <th style={{ textAlign: "left", padding: "4px 8px" }}>Exercise</th>
                  <th style={{ textAlign: "left", padding: "4px 8px" }}>Run</th>
                  <th style={{ textAlign: "left", padding: "4px 8px" }}>TM</th>
                  <th style={{ textAlign: "left", padding: "4px 8px" }}>Miles</th>
                  <th style={{ textAlign: "left", padding: "4px 8px" }}>MPH</th>
                  <th style={{ padding: "4px 8px" }} />
                </tr>
              </thead>
              <tbody>
                {(data.details || []).map(d => (
                  <tr key={d.id}>
                    <td style={{ padding: "4px 8px" }}>{new Date(d.datetime).toLocaleString()}</td>
                    <td style={{ padding: "4px 8px" }}>{d.exercise}</td>
                    <td style={{ padding: "4px 8px" }}>
                      {d.running_minutes ? `${d.running_minutes} min` : ""}{d.running_seconds ? ` ${d.running_seconds}s` : ""}
                    </td>
                    <td style={{ padding: "4px 8px" }}>
                      {d.treadmill_time_minutes ? `${d.treadmill_time_minutes} min` : ""}{d.treadmill_time_seconds ? ` ${d.treadmill_time_seconds}s` : ""}
                    </td>
                    <td style={{ padding: "4px 8px" }}>{d.running_miles ? d.running_miles : ""}</td>
                    <td style={{ padding: "4px 8px" }}>{d.running_mph ? d.running_mph : ""}</td>
                    <td style={{ padding: "4px 8px" }}>
                      <button
                        type="button"
                        style={editBtnInline}
                        aria-label={`Edit interval ${d.id}`}
                        title="Edit interval"
                        onClick={() => openEdit(d)}
                      >
                        ✎
                      </button>
                      <button
                        type="button"
                        style={xBtnInline}
                        aria-label={`Delete interval ${d.id}`}
                        title="Delete interval"
                        onClick={() => deleteDetail(d.id)}
                        disabled={deletingId === d.id}
                      >
                        {deletingId === d.id ? "…" : "✕"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div style={{ height: 12 }} />
            <button type="button" style={btnStyle} onClick={openModal} disabled={unitsApi.loading}>Add interval</button>
            <Modal open={addModalOpen} onClose={closeModal}>
            <form onSubmit={submit}>
              <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>

                {/* Unit selector */}
                <label>
                  <div>Units</div>
                  <select value={unitId} onChange={(e) => setUnitId(e.target.value)} disabled={unitsApi.loading || !distanceUnits.length}>
                    {unitsApi.loading && <option value="">Loading…</option>}
                    {!unitsApi.loading && distanceUnits.map(u => (
                      <option key={u.id} value={u.id}>{u.name}</option>
                    ))}
                  </select>
                </label>

                <label><div>Time (local)</div><input type="datetime-local" value={row.datetime} onChange={(e) => setField({ datetime: e.target.value })} /></label>

                {/* Distance in selected unit */}
                <label>
                  <div>Distance ({selectedUnit?.name || "units"})</div>
                  <input
                    type="number"
                    step="any"
                    value={displayDistance}
                    onChange={(e) => onChangeDistanceDisplay(e.target.value)}
                  />
                </label>

                {/* Interval time */}
                <label><div>Running Minutes</div><input type="number" step="1" value={row.running_minutes} onChange={(e) => onChangeMinutes(e.target.value)} /></label>
                <label><div>Running Seconds</div><input type="number" step="any" value={row.running_seconds} onChange={(e) => onChangeSeconds(e.target.value)} /></label>

                {/* Speed or Pace in selected unit */}
                <label>
                  <div>
                    {isTimePerDist
                      ? `Pace (min / ${selectedUnit?.name || "unit"})`
                      : `Speed (${(selectedUnit?.speed_label || `${selectedUnit?.name || "unit"}/hr`)})`}
                  </div>

                  <input
                    type="number"
                    step="any"
                    value={displaySpeedOrPace}
                    onChange={(e) => onChangeSpeedDisplay(e.target.value)}
                  />
                </label>

                {/* Cumulative TM */}
                <label><div>TM Minutes (cumulative)</div><input type="number" step="1" value={row.treadmill_time_minutes} onChange={(e) => onChangeTmMinutes(e.target.value)} /></label>
                <label><div>TM Seconds (cumulative)</div><input type="number" step="any" value={row.treadmill_time_seconds} onChange={(e) => onChangeTmSeconds(e.target.value)} /></label>
              </div>

              <div style={{ marginTop: 8 }}>
                <button type="submit" style={btnStyle} disabled={saving || unitsApi.loading}>{saving ? "Saving…" : (editingId ? "Save interval" : "Add interval")}</button>
                <button type="button" style={{ ...btnStyle, marginLeft: 8 }} onClick={closeModal} disabled={saving}>Cancel</button>
                {saveErr && <span style={{ marginLeft: 8, color: "#b91c1c" }}>Error: {String(saveErr.message || saveErr)}</span>}
              </div>
            </form>
            </Modal>
          </>
        )}
      </Card>
    </div>
  );
}
