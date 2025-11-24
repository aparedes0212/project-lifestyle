import { Link, useParams } from "react-router-dom";
import { useMemo, useState } from "react";
import useApi from "../hooks/useApi";
import { API_BASE } from "../lib/config";
import Card from "../components/ui/Card";
import { formatNumber } from "../lib/numberFormat";

const btnStyle = { border: "1px solid #e5e7eb", background: "#f9fafb", borderRadius: 8, padding: "6px 10px", cursor: "pointer" };
const dangerBtn = { ...btnStyle, borderColor: "#fecaca", background: "#fef2f2", color: "#b91c1c" };

function toIsoLocal(date) {
  const d = date instanceof Date ? date : new Date(date);
  const tzOffset = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - tzOffset).toISOString().slice(0, 19);
}
function toIsoLocalNow() { return toIsoLocal(new Date()); }

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

  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({ unit_count: "", minutes: "", seconds: "", datetime: "" });

  const sortedDetails = useMemo(() => {
    if (!Array.isArray(log?.details)) return [];
    const arr = [...log.details];
    arr.sort((a, b) => new Date(b.datetime || 0) - new Date(a.datetime || 0));
    return arr;
  }, [log?.details]);

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
      const payload = { details: [{ datetime: newDatetime || new Date().toISOString(), unit_count: unitVal }] };
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
      datetime: detail.datetime ? toIsoLocal(detail.datetime) : "",
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
      const res = await fetch(`${API_BASE}/api/supplemental/log/${id}/details/${detailId}/`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          unit_count: unitVal,
          datetime: editForm.datetime || null,
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
        title="Supplemental Log Detail"
        action={
          <div style={{ display: "flex", gap: 8 }}>
            <Link to="/supplemental" style={btnStyle}>Back to Supplemental</Link>
            <button onClick={refresh} style={btnStyle}>Refresh</button>
            <button onClick={deleteLog} style={dangerBtn} disabled={saving}>Delete Log</button>
          </div>
        }
      >
        {logApi.loading && <div>Loading...</div>}
        {err && <div style={{ color: "#b91c1c" }}>Error: {String(err.message || err)}</div>}
        {log && (
          <div style={{ display: "grid", gap: 8 }}>
            <div><strong>Routine:</strong> {log.routine?.name ?? "--"}</div>
            <div><strong>Workout:</strong> {log.workout?.name ?? "Unspecified"}</div>
            <div><strong>Goal Metric:</strong> {log.goal_metric ?? "--"}</div>
            <div><strong>Target to beat (6mo):</strong> {formatNumber(log.target_to_beat, log.routine?.unit === "Reps" ? 0 : 2)}</div>
            <div><strong>Best recent (6mo):</strong> {log.best_recent != null ? formatNumber(log.best_recent, log.routine?.unit === "Reps" ? 0 : 2) : "--"}</div>
            <div><strong>Total completed:</strong> {log.total_completed != null ? formatNumber(log.total_completed, log.routine?.unit === "Reps" ? 0 : 2) : "--"}</div>
            {workoutDesc?.description && (
              <div style={{ border: "1px solid #e5e7eb", borderRadius: 8, padding: 10, background: "#f8fafc" }}>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>{workoutDesc.workout?.name}</div>
                <div style={{ fontSize: 14, lineHeight: 1.5 }}>{workoutDesc.description}</div>
              </div>
            )}
          </div>
        )}
      </Card>

      <Card title="Add Detail" action={null}>
        <form onSubmit={handleAdd} style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <div>Units ({unitLabel || "Units"})</div>
            {isTime ? (
              <div style={{ display: "flex", gap: 8 }}>
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
            ) : (
              <input type="number" step="any" value={newUnit} onChange={(e) => setNewUnit(e.target.value)} />
            )}
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <div>Datetime</div>
            <input type="datetime-local" value={newDatetime} onChange={(e) => setNewDatetime(e.target.value)} />
          </label>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 8 }}>
            <button
              type="submit"
              style={btnStyle}
              disabled={
                saving ||
                (!isTime && !newUnit) ||
                (isTime && !newMinutes && !newSeconds)
              }
            >
              Add
            </button>
          </div>
        </form>
      </Card>

      <Card title="Details" action={null}>
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
    </div>
  );
}
