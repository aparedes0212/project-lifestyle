import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import useApi from "../hooks/useApi";
import { API_BASE } from "../lib/config";
import Card from "../components/ui/Card";
import Row from "../components/ui/Row";

const btnStyle = { border: "1px solid #e5e7eb", background: "#f9fafb", borderRadius: 8, padding: "6px 10px", cursor: "pointer" };
const xBtnInline = { border: "none", background: "transparent", color: "#b91c1c", cursor: "pointer", fontSize: 14, lineHeight: 1, padding: 2, marginLeft: 8 };

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

function calcMaxMph(details) {
  let max = null;
  for (const d of details || []) {
    const mph = n(d.running_mph);
    if (mph !== null) {
      max = max === null ? mph : Math.max(max, mph);
    }
  }
  return max;
}

export default function LogDetailsPage() {
  const { id } = useParams();

  // log + intervals
  const { data, loading, error, refetch, setData } = useApi(`${API_BASE}/api/cardio/log/${id}/`, { deps: [id] });

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

  useEffect(() => {
    if (!data?.details) return;
    const computed = calcMaxMph(data.details);
    const current = n(data.max_mph);
    if (computed === current || (computed === null && current === null)) return;
    const update = async () => {
      try {
        await fetch(`${API_BASE}/api/cardio/log/${id}/`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ max_mph: computed }),
        });
        setData(d => ({ ...d, max_mph: computed }));
      } catch (err) {
        console.error(err);
      }
    };
    update();
  }, [data?.details, id, setData]);

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

  // default unit = workout.unit if present; else "Miles" if available; else first unit
  const defaultUnitId = useMemo(() => {
    const list = unitsApi.data || [];
    if (!list.length) return "";
    const fromWorkout = data?.workout?.unit?.id;
    if (fromWorkout) return String(fromWorkout);
    const milesRow = list.find(u => (u.name || "").toLowerCase() === "miles");
    return String((milesRow?.id ?? list[0].id));
  }, [unitsApi.data, data?.workout?.unit?.id]);

  const [unitId, setUnitId] = useState("");
  useEffect(() => { if (!unitId && defaultUnitId) setUnitId(defaultUnitId); }, [unitId, defaultUnitId]);

  const selectedUnit = useMemo(() => {
    const list = unitsApi.data || [];
    return list.find(u => String(u.id) === String(unitId));
  }, [unitsApi.data, unitId]);

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

  // add-one-interval form (we persist miles + mph to backend)
  const [row, setRow] = useState({
    datetime: toIsoLocalNow(),
    exercise_id: "",
    running_minutes: "",
    running_seconds: "",
    running_miles: "",   // internal (miles)
    running_mph: "",     // internal (mph)
    treadmill_time_minutes: "",
    treadmill_time_seconds: "",
  });

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
  }, [minExerciseId, prevTM, isFirstEntry, sprintBaseline]);

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

  // create detail
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setSaveErr(null);
    try {
      const payload = {
        details: [{
          datetime: new Date(row.datetime).toISOString(),
          exercise_id: row.exercise_id ? Number(row.exercise_id) : null,
          running_minutes: row.running_minutes === "" ? null : Number(row.running_minutes),
          running_seconds: row.running_seconds === "" ? null : Number(row.running_seconds),
          running_miles: row.running_miles === "" ? null : Number(row.running_miles),
          running_mph: row.running_mph === "" ? null : Number(row.running_mph),
          treadmill_time_minutes: row.treadmill_time_minutes === "" ? null : Number(row.treadmill_time_minutes),
          treadmill_time_seconds: row.treadmill_time_seconds === "" ? null : Number(row.treadmill_time_seconds),
        }],
      };
      const res = await fetch(`${API_BASE}/api/cardio/log/${id}/details/`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      await res.json();
      await refetch();
      setRow(r => ({
        ...r,
        datetime: toIsoLocalNow(),
        running_minutes: "", running_seconds: "", running_miles: "", running_mph: "",
        treadmill_time_minutes: "", treadmill_time_seconds: "",
      }));
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
            <Row left="Max MPH" right={data.max_mph ?? "—"} />
            <Row left="Avg MPH" right={data.avg_mph ?? "—"} />
            <Row left="Minutes Elapsed" right={data.minutes_elapsed ?? "—"} />

            <div style={{ height: 8 }} />
            <div style={{ fontWeight: 600, marginBottom: 6 }}>Intervals</div>
            <ol style={{ margin: 0, paddingInlineStart: 18 }}>
              {(data.details || []).map(d => (
                <li key={d.id} style={{ padding: "4px 0" }}>
                  {new Date(d.datetime).toLocaleString()} — {d.exercise} •
                  {d.running_minutes ? ` ${d.running_minutes} min` : ""}{d.running_seconds ? ` ${d.running_seconds}s` : ""}
                  {d.treadmill_time_minutes ? ` | TM ${d.treadmill_time_minutes} min` : ""}{d.treadmill_time_seconds ? ` ${d.treadmill_time_seconds}s` : ""}
                  {d.running_miles ? ` | ${d.running_miles} mi` : ""}{d.running_mph ? ` @ ${d.running_mph} mph` : ""}
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
                </li>
              ))}
            </ol>

            <div style={{ height: 12 }} />
            <form onSubmit={submit}>
              <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>

                {/* Unit selector */}
                <label>
                  <div>Units</div>
                  <select value={unitId} onChange={(e) => setUnitId(e.target.value)} disabled={unitsApi.loading || !(unitsApi.data || []).length}>
                    {unitsApi.loading && <option value="">Loading…</option>}
                    {!unitsApi.loading && (unitsApi.data || []).map(u => (
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
                <button type="submit" style={btnStyle} disabled={saving || unitsApi.loading}>{saving ? "Saving…" : "Add interval"}</button>
                {saveErr && <span style={{ marginLeft: 8, color: "#b91c1c" }}>Error: {String(saveErr.message || saveErr)}</span>}
              </div>
            </form>
          </>
        )}
      </Card>
    </div>
  );
}
