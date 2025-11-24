import { Link, useParams } from "react-router-dom";
import { useEffect, useMemo, useState } from "react";
import useApi from "../hooks/useApi";
import { API_BASE } from "../lib/config";
import Card from "../components/ui/Card";
import { formatNumber } from "../lib/numberFormat";
import { deriveRestColor } from "../lib/restColors";
import Modal from "../components/ui/Modal";

const btnStyle = { border: "1px solid #e5e7eb", background: "#f9fafb", borderRadius: 8, padding: "6px 10px", cursor: "pointer" };
const dangerBtn = { ...btnStyle, borderColor: "#fecaca", background: "#fef2f2", color: "#b91c1c" };

function toIsoLocal(date) {
  const d = date instanceof Date ? date : new Date(date);
  const tzOffset = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - tzOffset).toISOString().slice(0, 19);
}
function toIsoLocalNow() { return toIsoLocal(new Date()); }

function toLocalInputValue(raw) {
  if (!raw) return "";
  const hasTz = /[zZ]|[+-]\d{2}:\d{2}$/.test(raw);
  if (hasTz) return toIsoLocal(raw);
  // already local-ish; just trim to seconds
  return raw.slice(0, 19);
}

function toUtcISOString(localValue) {
  if (!localValue) return null;
  const d = new Date(localValue);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

export default function SupplementalLogDetailsPage() {
  const { id } = useParams();
  const logApi = useApi(`${API_BASE}/api/supplemental/log/${id}/`, { deps: [id] });
  const log = logApi.data;

  const routineId = log?.routine?.id;
  const workoutId = log?.workout?.id;

  const workoutsApi = useApi(
    routineId ? `${API_BASE}/api/supplemental/workouts/?routine_id=${routineId}` : "",
    { deps: [routineId], skip: !routineId }
  );
  const workouts = useMemo(() => Array.isArray(workoutsApi.data) ? workoutsApi.data : [], [workoutsApi.data]);
  const workoutDesc = useMemo(
    () => workouts.find((w) => w.workout?.id === workoutId),
    [workouts, workoutId]
  );

  const isTime = (log?.routine?.unit || "").toLowerCase() === "time";
  const unitLabel = isTime ? "Seconds" : "Reps";

  const [newUnit, setNewUnit] = useState("");
  const [newMinutes, setNewMinutes] = useState("");
  const [newSeconds, setNewSeconds] = useState("");
  const [newDatetime, setNewDatetime] = useState(toIsoLocalNow());
  const [err, setErr] = useState(null);
  const [saving, setSaving] = useState(false);
  const [plannedRestSeconds, setPlannedRestSeconds] = useState(90);

  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({ unit_count: "", minutes: "", seconds: "", datetime: "" });

  const [showStopwatch, setShowStopwatch] = useState(false);
  const [stopwatchRunning, setStopwatchRunning] = useState(false);
  const [stopwatchStartMs, setStopwatchStartMs] = useState(null);
  const [stopwatchElapsedMs, setStopwatchElapsedMs] = useState(0);

  const [restSeconds, setRestSeconds] = useState(0);

  const sortedDetails = useMemo(() => {
    if (!Array.isArray(log?.details)) return [];
    const arr = [...log.details];
    arr.sort((a, b) => new Date(b.datetime || 0) - new Date(a.datetime || 0));
    return arr;
  }, [log?.details]);

  useEffect(() => {
    if (!stopwatchRunning) return undefined;
    const tick = () => {
      if (!stopwatchStartMs) return;
      setStopwatchElapsedMs(Date.now() - stopwatchStartMs);
    };
    tick();
    const t = setInterval(tick, 100);
    return () => clearInterval(t);
  }, [stopwatchRunning, stopwatchStartMs]);

  useEffect(() => {
    const computeRest = () => {
      const now = Date.now();
      let baseTs = null;

      for (const detail of sortedDetails) {
        if (!detail?.datetime) continue;
        const ts = new Date(detail.datetime).getTime();
        if (!Number.isFinite(ts)) continue;
        if (ts <= now) {
          baseTs = ts;
          break;
        }
        if (baseTs == null) {
          baseTs = ts;
        }
      }

      if (baseTs == null && log?.datetime_started) {
        const startTs = new Date(log.datetime_started).getTime();
        if (Number.isFinite(startTs)) {
          baseTs = startTs;
        }
      }

      if (baseTs == null) {
        setRestSeconds(0);
        return;
      }

      const diff = now - baseTs;
      setRestSeconds(diff > 0 ? Math.floor(diff / 1000) : 0);
    };

    computeRest();
    const t = setInterval(computeRest, 1000);
    return () => clearInterval(t);
  }, [sortedDetails, log?.datetime_started]);

  const refresh = () => logApi.refetch();

  const toTimeParts = (value) => {
    const num = Number(value);
    if (!Number.isFinite(num) || num < 0) return { minutes: "", seconds: "" };
    const mins = Math.floor(num / 60);
    const secs = num - mins * 60;
    return {
      minutes: String(mins),
      seconds: secs ? String(Number(secs.toFixed(3))) : "0",
    };
  };

  const computeSeconds = (minutesStr, secondsStr) => {
    const m = Number(minutesStr || 0);
    const s = Number(secondsStr || 0);
    if (!Number.isFinite(m) || !Number.isFinite(s)) return null;
    const total = m * 60 + s;
    return Number.isFinite(total) && total >= 0 ? total : null;
  };

  const formatElapsed = (ms) => {
    const totalSec = Math.max(0, ms / 1000);
    const mins = Math.floor(totalSec / 60);
    const secs = totalSec - mins * 60;
    return `${String(mins).padStart(2, "0")}:${secs.toFixed(2).padStart(5, "0")}`;
  };

  const restDisplay = useMemo(() => {
    const mins = Math.floor(restSeconds / 60);
    const secs = restSeconds - mins * 60;
    return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }, [restSeconds]);

  const restColor = useMemo(() => {
    const base = Number(plannedRestSeconds) || 0;
    const thresholds = {
      yellow_start_seconds: base,
      red_start_seconds: base * 1.33,
      critical_start_seconds: base * 1.67,
    };
    return deriveRestColor(restSeconds, thresholds);
  }, [restSeconds, plannedRestSeconds]);

  const applyStopwatch = () => {
    const totalSec = Math.max(0, stopwatchElapsedMs / 1000);
    const mins = Math.floor(totalSec / 60);
    const secs = totalSec - mins * 60;
    setNewMinutes(String(mins));
    setNewSeconds(secs.toFixed(2));
    setShowStopwatch(false);
    setStopwatchRunning(false);
  };

  const resetStopwatch = () => {
    setStopwatchRunning(false);
    setStopwatchStartMs(null);
    setStopwatchElapsedMs(0);
  };

  const handleAdd = async (e) => {
    e.preventDefault();
    const unitVal = isTime ? computeSeconds(newMinutes, newSeconds) : Number(newUnit);
    if (unitVal === null || unitVal <= 0) {
      setErr(new Error("Enter minutes/seconds or reps greater than 0."));
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      const dtPayload = toUtcISOString(newDatetime) || new Date().toISOString();
      const payload = { details: [{ datetime: dtPayload, unit_count: unitVal }] };
      const res = await fetch(`${API_BASE}/api/supplemental/log/${id}/details/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`Add detail ${res.status}`);
      const data = await res.json();
      logApi.setData(data);
      setNewUnit("");
      setNewMinutes("");
      setNewSeconds("");
      setNewDatetime(toIsoLocalNow());
    } catch (e) {
      setErr(e);
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (detail) => {
    setEditingId(detail.id);
    const timeParts = isTime ? toTimeParts(detail.unit_count) : { minutes: "", seconds: "" };
      setEditForm({
        unit_count: detail.unit_count ?? "",
        minutes: timeParts.minutes,
        seconds: timeParts.seconds,
        datetime: detail.datetime ? toLocalInputValue(detail.datetime) : "",
      });
  };

  const saveEdit = async (detailId) => {
    setSaving(true);
    setErr(null);
    try {
      const unitVal = isTime
        ? computeSeconds(editForm.minutes, editForm.seconds)
        : (editForm.unit_count === "" ? null : Number(editForm.unit_count));
      if (unitVal === null || unitVal <= 0) {
        throw new Error("Enter minutes/seconds or reps greater than 0.");
      }
      const dtPayload = toUtcISOString(editForm.datetime);
      const res = await fetch(`${API_BASE}/api/supplemental/log/${id}/details/${detailId}/`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          unit_count: unitVal,
          datetime: dtPayload,
        }),
      });
      if (!res.ok) throw new Error(`Update detail ${res.status}`);
      const data = await res.json();
      logApi.setData(data);
      setEditingId(null);
    } catch (e) {
      setErr(e);
    } finally {
      setSaving(false);
    }
  };

  const deleteDetail = async (detailId) => {
    setSaving(true);
    setErr(null);
    try {
      const res = await fetch(`${API_BASE}/api/supplemental/log/${id}/details/${detailId}/delete/`, { method: "DELETE" });
      if (!res.ok) throw new Error(`Delete detail ${res.status}`);
      refresh();
    } catch (e) {
      setErr(e);
    } finally {
      setSaving(false);
    }
  };

  const deleteLog = async () => {
    setSaving(true);
    setErr(null);
    try {
      const res = await fetch(`${API_BASE}/api/supplemental/log/${id}/delete/`, { method: "DELETE" });
      if (!res.ok) throw new Error(`Delete log ${res.status}`);
      window.location.href = "/supplemental";
    } catch (e) {
      setErr(e);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <Card
        title="Supplemental Session"
        action={
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Link to="/supplemental" style={btnStyle}>Back</Link>
            <button onClick={refresh} style={btnStyle}>Refresh</button>
            <button onClick={deleteLog} style={dangerBtn} disabled={saving}>Delete Log</button>
          </div>
        }
      >
        {logApi.loading && <div>Loading...</div>}
        {err && <div style={{ color: "#b91c1c" }}>Error: {String(err.message || err)}</div>}
        {log && (
          <div style={{ display: "grid", gap: 12 }}>
            <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
              <div style={{ border: "1px solid #e5e7eb", borderRadius: 10, padding: 10 }}>
                <div style={{ fontSize: 12, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.04em" }}>Routine</div>
                <div style={{ fontWeight: 700 }}>{log.routine?.name ?? "--"}</div>
              </div>
              <div style={{ border: "1px solid #e5e7eb", borderRadius: 10, padding: 10 }}>
                <div style={{ fontSize: 12, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.04em" }}>Workout</div>
                <div style={{ fontWeight: 700 }}>{log.workout?.name ?? "Unspecified"}</div>
              </div>
              <div style={{ border: "1px solid #e5e7eb", borderRadius: 10, padding: 10 }}>
                <div style={{ fontSize: 12, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.04em" }}>Goal Metric</div>
                <div style={{ fontWeight: 700 }}>{log.goal_metric ?? "--"}</div>
              </div>
              <div style={{ border: "1px solid #e5e7eb", borderRadius: 10, padding: 10 }}>
                <div style={{ fontSize: 12, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.04em" }}>Target to Beat (6mo)</div>
                <div style={{ fontWeight: 700 }}>{formatNumber(log.target_to_beat, log.routine?.unit === "Reps" ? 0 : 2)}</div>
              </div>
              <div style={{ border: "1px solid #e5e7eb", borderRadius: 10, padding: 10 }}>
                <div style={{ fontSize: 12, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.04em" }}>Best Recent (6mo)</div>
                <div style={{ fontWeight: 700 }}>
                  {log.best_recent != null ? formatNumber(log.best_recent, log.routine?.unit === "Reps" ? 0 : 2) : "--"}
                </div>
              </div>
              <div style={{ border: "1px solid #e5e7eb", borderRadius: 10, padding: 10 }}>
                <div style={{ fontSize: 12, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.04em" }}>Total Completed</div>
                <div style={{ fontWeight: 700 }}>
                  {log.total_completed != null ? formatNumber(log.total_completed, log.routine?.unit === "Reps" ? 0 : 2) : "--"}
                </div>
              </div>
            </div>

            {workoutDesc?.description && (
              <div style={{ border: "1px solid #e5e7eb", borderRadius: 10, padding: 12, background: "#f8fafc" }}>
                <div style={{ fontWeight: 700, marginBottom: 6 }}>{workoutDesc.workout?.name}</div>
                <div style={{ fontSize: 14, lineHeight: 1.5 }}>{workoutDesc.description}</div>
              </div>
            )}
          </div>
        )}
      </Card>

      <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))" }}>
        <Card title="Add Interval" action={null}>
          <form onSubmit={handleAdd} style={{ display: "grid", gap: 10 }}>
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <div>Units ({unitLabel || "Units"})</div>
              {isTime ? (
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <div style={{ display: "flex", gap: 8, flex: 1 }}>
                    <input
                      type="number"
                      step="1"
                      placeholder="Min"
                      value={newMinutes}
                      onChange={(e) => setNewMinutes(e.target.value)}
                      style={{ flex: 1 }}
                    />
                    <input
                      type="number"
                      step="any"
                      placeholder="Sec"
                      value={newSeconds}
                      onChange={(e) => setNewSeconds(e.target.value)}
                      style={{ flex: 1 }}
                    />
                  </div>
                  <button type="button" style={btnStyle} onClick={() => { resetStopwatch(); setShowStopwatch(true); }}>
                    Use stopwatch
                  </button>
                </div>
              ) : (
                <input type="number" step="any" value={newUnit} onChange={(e) => setNewUnit(e.target.value)} />
              )}
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <div>Datetime</div>
              <input type="datetime-local" value={newDatetime} onChange={(e) => setNewDatetime(e.target.value)} />
            </label>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <button
                type="submit"
                style={btnStyle}
                disabled={
                  saving ||
                  (!isTime && !newUnit) ||
                  (isTime && !newMinutes && !newSeconds)
                }
              >
                Add Interval
              </button>
              <span style={{ fontSize: 12, color: "#6b7280" }}>
                Add the interval, then rest timer starts automatically from latest entry.
              </span>
            </div>
          </form>
        </Card>

        <Card
          title="Rest Timer"
          action={
            <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontSize: 12, color: "#475569" }}>Planned rest (sec)</span>
              <input
                type="number"
                min="0"
                step="1"
                value={plannedRestSeconds}
                onChange={(e) => setPlannedRestSeconds(e.target.value)}
                style={{ width: 90 }}
              />
            </label>
          }
        >
          <div
            style={{
              border: `1px solid ${restColor.fg}33`,
              background: restColor.bg,
              color: restColor.fg,
              padding: 12,
              borderRadius: 10,
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            <div style={{ fontSize: 32, fontWeight: 800 }}>{restDisplay}</div>
            <div style={{ fontSize: 12, textAlign: "right" }}>
              <div style={{ fontWeight: 700 }}>{restColor.label}</div>
              <div style={{ color: "#475569" }}>Starts at: {plannedRestSeconds || 0}s</div>
            </div>
          </div>
        </Card>
      </div>

      <Card title="Intervals" action={null}>
        {sortedDetails.length === 0 && <div>No details yet.</div>}
        {sortedDetails.length > 0 && (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid #e5e7eb", textAlign: "left" }}>
                  <th style={{ padding: 8 }}>Datetime</th>
                  <th style={{ padding: 8 }}>Units ({unitLabel || "Units"})</th>
                  <th style={{ padding: 8 }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {sortedDetails.map((detail) => {
                  const isEditing = editingId === detail.id;
                  return (
                    <tr key={detail.id} style={{ borderTop: "1px solid #f1f5f9" }}>
                      <td style={{ padding: 8 }}>
                        {isEditing ? (
                          <input
                            type="datetime-local"
                            value={editForm.datetime}
                            onChange={(e) => setEditForm((prev) => ({ ...prev, datetime: e.target.value }))}
                          />
                        ) : (
                          new Date(detail.datetime).toLocaleString()
                        )}
                      </td>
                      <td style={{ padding: 8 }}>
                        {isEditing ? (
                          isTime ? (
                            <div style={{ display: "flex", gap: 8 }}>
                              <input
                                type="number"
                                step="1"
                                value={editForm.minutes}
                                onChange={(e) => setEditForm((prev) => ({ ...prev, minutes: e.target.value }))}
                                style={{ flex: 1 }}
                              />
                              <input
                                type="number"
                                step="any"
                                value={editForm.seconds}
                                onChange={(e) => setEditForm((prev) => ({ ...prev, seconds: e.target.value }))}
                                style={{ flex: 1 }}
                              />
                            </div>
                          ) : (
                            <input
                              type="number"
                              step="any"
                              value={editForm.unit_count}
                              onChange={(e) => setEditForm((prev) => ({ ...prev, unit_count: e.target.value }))}
                            />
                          )
                        ) : (
                          isTime
                            ? (() => {
                                const num = Number(detail.unit_count);
                                if (!Number.isFinite(num)) return "--";
                                const mins = Math.floor(num / 60);
                                const secs = num - mins * 60;
                                return `${mins}m ${formatNumber(secs, 2)}s`;
                              })()
                            : formatNumber(detail.unit_count, unitLabel === "Reps" ? 0 : 2)
                        )}
                      </td>
                      <td style={{ padding: 8, display: "flex", gap: 8 }}>
                        {isEditing ? (
                          <>
                            <button style={btnStyle} onClick={() => saveEdit(detail.id)} disabled={saving}>Save</button>
                            <button style={btnStyle} onClick={() => setEditingId(null)} disabled={saving}>Cancel</button>
                          </>
                        ) : (
                          <>
                            <button style={btnStyle} onClick={() => startEdit(detail)}>Edit</button>
                            <button style={dangerBtn} onClick={() => deleteDetail(detail.id)} disabled={saving}>Delete</button>
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {showStopwatch && (
        <Modal open>
          <div style={{ display: "grid", gap: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ fontWeight: 600 }}>Stopwatch</div>
              <button style={btnStyle} onClick={() => { setShowStopwatch(false); resetStopwatch(); }}>Cancel</button>
            </div>
            <div style={{ fontSize: 32, textAlign: "center", fontVariantNumeric: "tabular-nums" }}>
              {formatElapsed(stopwatchElapsedMs)}
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
              {!stopwatchRunning && (
                <button style={btnStyle} onClick={() => { setStopwatchStartMs(Date.now()); setStopwatchRunning(true); }}>
                  Start
                </button>
              )}
              {stopwatchRunning && (
                <button style={btnStyle} onClick={() => setStopwatchRunning(false)}>
                  Stop
                </button>
              )}
              <button style={btnStyle} onClick={() => { resetStopwatch(); }}>
                Reset
              </button>
              {!stopwatchRunning && stopwatchElapsedMs > 0 && (
                <button style={btnStyle} onClick={applyStopwatch}>
                  Use time
                </button>
              )}
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
