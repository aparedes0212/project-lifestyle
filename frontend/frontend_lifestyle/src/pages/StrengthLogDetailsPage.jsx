import { useParams } from "react-router-dom";
import { useEffect, useMemo, useState } from "react";
import useApi from "../hooks/useApi";
import { API_BASE } from "../lib/config";
import Card from "../components/ui/Card";
import Modal from "../components/ui/Modal";
import ProgressBar from "../components/ui/ProgressBar";

const btnStyle = { border: "1px solid #e5e7eb", background: "#f9fafb", borderRadius: 8, padding: "6px 10px", cursor: "pointer" };
const xBtnInline = { border: "none", background: "transparent", color: "#b91c1c", cursor: "pointer", fontSize: 14, lineHeight: 1, padding: 2, marginLeft: 8 };
const editBtnInline = { border: "none", background: "transparent", color: "#1d4ed8", cursor: "pointer", fontSize: 14, lineHeight: 1, padding: 2 };

function toIsoLocal(date) {
  const d = date instanceof Date ? date : new Date(date);
  const tzOffset = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - tzOffset).toISOString().slice(0, 19);
}
function toIsoLocalNow() { return toIsoLocal(new Date()); }
const emptyRow = { datetime: "", exercise_id: "", reps: "", standard_weight: "", extra_weight: "" };

export default function StrengthLogDetailsPage() {
  const { id } = useParams();
  const { data, loading, error, refetch } = useApi(`${API_BASE}/api/strength/log/${id}/`, { deps: [id] });
  const exApiUrl = useMemo(() => {
    const rid = data?.routine?.id;
    return rid ? `${API_BASE}/api/strength/exercises/?routine_id=${rid}` : null;
  }, [data?.routine?.id]);
  const exApi = useApi(exApiUrl || "", { deps: [exApiUrl], skip: !exApiUrl });

  const lastDetailTime = useMemo(() => {
    const details = data?.details || [];
    if (details.length) return new Date(details[details.length - 1].datetime).getTime();
    return data?.datetime_started ? new Date(data.datetime_started).getTime() : null;
  }, [data?.details, data?.datetime_started]);

  const [restSeconds, setRestSeconds] = useState(0);
  useEffect(() => {
    if (!lastDetailTime) return;
    const update = () => setRestSeconds(Math.floor((Date.now() - lastDetailTime) / 1000));
    update();
    const t = setInterval(update, 1000);
    return () => clearInterval(t);
  }, [lastDetailTime]);

  const restTimerDisplay = useMemo(() => {
    const m = Math.floor(restSeconds / 60);
    const s = String(restSeconds % 60).padStart(2, "0");
    return `${m}:${s}`;
  }, [restSeconds]);

  const [addModalOpen, setAddModalOpen] = useState(false);

  // Fetch strength progression level for this log's goal
  const levelApiUrl = useMemo(() => {
    const rid = data?.routine?.id;
    const vol = data?.rep_goal;
    if (!rid || vol == null) return null;
    const qs = new URLSearchParams({ routine_id: String(rid), volume: String(vol) }).toString();
    return `${API_BASE}/api/strength/level/?${qs}`;
  }, [data?.routine?.id, data?.rep_goal]);
  const levelApi = useApi(levelApiUrl || "", { deps: [levelApiUrl], skip: !levelApiUrl });

  // Compute points as rounded percentage of level over 23 (fixed denominator)
  const levelPoints = useMemo(() => {
    const order = levelApi.data?.progression_order;
    if (order == null) return null;
    return Math.round((Number(order) / 23) * 100);
  }, [levelApi.data?.progression_order]);
  const [editingId, setEditingId] = useState(null);
  const [row, setRow] = useState(emptyRow);
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const [deleteErr, setDeleteErr] = useState(null);
  const [selectedExerciseId, setSelectedExerciseId] = useState("");

  const setField = (patch) => setRow(r => ({ ...r, ...patch }));

  // Default the per-exercise dropdown to the most recent exercise in this log
  useEffect(() => {
    const last = (data?.details || []).slice(-1)[0];
    if (last?.exercise_id != null) setSelectedExerciseId(String(last.exercise_id));
  }, [data?.details?.length]);

  const openModal = async () => {
    setEditingId(null);
    let base = { ...emptyRow, datetime: toIsoLocalNow() };
    const detailCount = data?.details?.length ?? 0;
    try {
      const res = await fetch(`${API_BASE}/api/strength/log/${id}/last-set/`);
      if (res.ok) {
        const d = await res.json();
        const ex = (exApi.data || []).find(e => e.id === d.exercise_id);
        const std = ex ? ex.standard_weight ?? 0 : "";
        const extra = d.weight != null && std !== "" ? d.weight - std : "";
        base = {
          ...base,
          reps: d.reps ?? "",
          standard_weight: std === "" ? "" : String(std),
          extra_weight: extra === "" ? "" : String(extra),
        };
        // Always prefer the last set's exercise for the first set of this log
        // (endpoint already falls back to the previous daily log if this one has none)
        base.exercise_id = d.exercise_id ? String(d.exercise_id) : base.exercise_id || "";
      }
    } catch (err) {
      console.error(err);
    }
    // If no prior detail, default exercise to the first available
    if (!base.exercise_id) {
      const first = (exApi.data || [])[0];
      if (first) {
        base.exercise_id = String(first.id);
        base.standard_weight = first.standard_weight == null ? "" : String(first.standard_weight);
        base.extra_weight = "";
      }
    }
    setRow(base);
    setAddModalOpen(true);
  };
  const openEdit = (detail) => {
    setEditingId(detail.id);
    const ex = (exApi.data || []).find(e => e.id === detail.exercise_id);
    const std = ex ? ex.standard_weight ?? 0 : "";
    const extra = detail.weight != null && std !== "" ? detail.weight - std : "";
    setRow({
      datetime: toIsoLocal(detail.datetime),
      exercise_id: detail.exercise_id ? String(detail.exercise_id) : "",
      reps: detail.reps ?? "",
      standard_weight: std === "" ? "" : String(std),
      extra_weight: extra === "" ? "" : String(extra),
    });
    setAddModalOpen(true);
  };
  const closeModal = () => {
    setAddModalOpen(false);
    setEditingId(null);
    setRow(emptyRow);
  };

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setSaveErr(null);
    try {
      if (!row.exercise_id) {
        throw new Error("Please pick an exercise.");
      }
      const std = row.standard_weight === "" ? 0 : Number(row.standard_weight);
      const extra = row.extra_weight === "" ? 0 : Number(row.extra_weight);
      const weight = std + extra;
      const payload = {
        datetime: new Date(row.datetime).toISOString(),
        exercise_id: row.exercise_id ? Number(row.exercise_id) : null,
        reps: row.reps === "" ? null : Number(row.reps),
        weight: row.standard_weight === "" && row.extra_weight === "" ? null : weight,
      };
      const url = editingId
        ? `${API_BASE}/api/strength/log/${id}/details/${editingId}/`
        : `${API_BASE}/api/strength/log/${id}/details/`;
      const method = editingId ? "PATCH" : "POST";
      const body = editingId ? JSON.stringify(payload) : JSON.stringify({ details: [payload] });
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body,
      });
      if (!res.ok) {
        let msg = `${res.status} ${res.statusText}`;
        try {
          const errBody = await res.json();
          msg += `: ${JSON.stringify(errBody)}`;
        } catch (_) {
          // ignore
        }
        throw new Error(msg);
      }
      await res.json();
      await refetch();
      closeModal();
    } catch (err) {
      setSaveErr(err);
    } finally {
      setSaving(false);
    }
  };

  const deleteDetail = async (detailId) => {
    if (!confirm("Delete this set?")) return;
    setDeletingId(detailId);
    setDeleteErr(null);
    try {
      const res = await fetch(`${API_BASE}/api/strength/log/${id}/details/${detailId}/delete/`, { method: "DELETE" });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      await refetch();
    } catch (err) {
      setDeleteErr(err);
    } finally {
      setDeletingId(null);
    }
  };

  const repGoal = data?.rep_goal ?? null;
  const totalReps = data?.total_reps_completed ?? null;
  let remaining25 = null;
  let remaining7 = null;
  let pctComplete = null;
  let pctRemaining25 = null;
  let pctRemaining7 = null;
  if (repGoal != null && repGoal > 0) {
    const quarter = repGoal * 0.25;
    const seventh = repGoal / 7;
    const tr = totalReps != null ? Number(totalReps) : null;
    if (tr == null || tr <= 0) {
      // No sets yet: next markers are the first thresholds
      remaining25 = Math.ceil(quarter);
      remaining7 = Math.ceil(seventh);
      pctComplete = tr == null ? null : (tr / repGoal) * 100;
      pctRemaining25 = (remaining25 / repGoal) * 100;
      pctRemaining7 = (remaining7 / repGoal) * 100;
    } else {
      const nextQuarter = Math.ceil(tr / quarter) * quarter;
      const nextSeventh = Math.ceil(tr / seventh) * seventh;
      remaining25 = Math.max(0, Math.ceil(nextQuarter - tr));
      remaining7 = Math.max(0, Math.ceil(nextSeventh - tr));
      pctComplete = (tr / repGoal) * 100;
      pctRemaining25 = (remaining25 / repGoal) * 100;
      pctRemaining7 = (remaining7 / repGoal) * 100;
    }
  }

  // Convert the remaining standard-reps into reps for a selected exercise
  const routineHPW = data?.routine?.hundred_points_weight || null;
  const selectedExercise = (exApi.data || []).find(e => String(e.id) === String(selectedExerciseId)) || null;
  // Prefer the most recent set's weight for the selected exercise; fallback to the exercise's standard_weight
  const lastSetForExercise = (data?.details || []).filter(d => String(d.exercise_id) === String(selectedExerciseId)).slice(-1)[0] || null;
  const exerciseWeight = lastSetForExercise?.weight ?? selectedExercise?.standard_weight ?? null;
  const perRepStd = routineHPW && exerciseWeight ? exerciseWeight / routineHPW : null;
  const remaining25ForExercise = perRepStd ? Math.ceil(remaining25 / perRepStd) : remaining25;
  const remaining7ForExercise = perRepStd ? Math.ceil(remaining7 / perRepStd) : remaining7;

  // If a cardio "Sprints" workout happens the same day, add a 1/x marker where x is its goal
  const cardioLogsApi = useApi(`${API_BASE}/api/cardio/logs/?weeks=1`, { deps: [] });
  const sprintGoalX = useMemo(() => {
    try {
      if (!data?.datetime_started) return null;
      const day = new Date(data.datetime_started);
      const y = day.getFullYear();
      const m = day.getMonth();
      const d = day.getDate();
      const logs = cardioLogsApi.data || [];
      const sameDay = logs.filter(l => {
        const t = new Date(l.datetime_started);
        return t.getFullYear() === y && t.getMonth() === m && t.getDate() === d;
      });
      // Only consider Sprints where total_completed < goal
      const sprintsIncomplete = sameDay.filter(l => {
        const isSprints = (l?.workout?.routine?.name || "").toLowerCase() === "sprints";
        const g = Number(l.goal);
        const tc = Number(l.total_completed);
        return isSprints && Number.isFinite(g) && Number.isFinite(tc) && tc < g && g > 0;
      });
      if (!sprintsIncomplete.length) return null;
      // Use the most recent incomplete Sprints for the day
      sprintsIncomplete.sort((a, b) => new Date(b.datetime_started) - new Date(a.datetime_started));
      return Number(sprintsIncomplete[0].goal);
    } catch (_) {
      return null;
    }
  }, [cardioLogsApi.data, data?.datetime_started]);
  const extraMarks = useMemo(() => {
    const x = Number(sprintGoalX);
    if (!Number.isFinite(x) || x <= 1) return [];
    const marks = [];
    for (let k = 1; k < x; k++) {
      marks.push({ fraction: k / x, color: "#f59e0b" });
    }
    return marks;
  }, [sprintGoalX]);

  // Remaining to next Sprint marker (1/x of goal)
  let remainingSprint = null;
  if (repGoal != null && repGoal > 0 && sprintGoalX && Number(sprintGoalX) > 0) {
    const tr = totalReps != null ? Number(totalReps) : null;
    const marker = repGoal / Number(sprintGoalX);
    if (tr == null || tr <= 0) {
      remainingSprint = Math.ceil(marker);
    } else {
      const nextSprint = Math.ceil(tr / marker) * marker;
      remainingSprint = Math.max(0, Math.ceil(nextSprint - tr));
    }
  }
  const remainingSprintForExercise = perRepStd ? (remainingSprint != null ? Math.ceil(remainingSprint / perRepStd) : null) : remainingSprint;

  return (
    <Card title={`Strength Log ${id}`} action={<button onClick={refetch} style={btnStyle}>Refresh</button>}>
      {loading && <div>Loading…</div>}
      {error && <div style={{ color: "#b91c1c" }}>Error: {String(error.message || error)}</div>}
      {deleteErr && <div style={{ color: "#b91c1c" }}>Delete error: {String(deleteErr.message || deleteErr)}</div>}
      {!loading && !error && data && (
        <>
          <div style={{ marginBottom: 12 }}>
            <div><strong>Started:</strong> {new Date(data.datetime_started).toLocaleString()}</div>
            <div><strong>Routine:</strong> {data.routine?.name || "—"}</div>
            <div><strong>Rep goal:</strong> {data.rep_goal ?? "—"}</div>
            <div><strong>Level:</strong> {levelApi.data?.progression_order ?? "—"}</div>
            <div><strong>Points:</strong> {levelPoints ?? "—"}</div>
            <div><strong>Total reps:</strong> {data.total_reps_completed ?? "—"}{pctComplete != null ? ` (${pctComplete.toFixed(0)}%)` : ""}</div>
            <div style={{ marginTop: 4 }}>
              <ProgressBar value={totalReps ?? 0} max={repGoal ?? 0} extraMarks={extraMarks} />
              <div style={{ display: "flex", gap: 16, fontSize: 12, marginTop: 4 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <span style={{ width: 2, height: 12, background: "#1d4ed8", display: "inline-block" }}></span>
                  25%
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <span style={{ width: 2, height: 6, background: "#16a34a", display: "inline-block" }}></span>
                  1/7
                </div>
                {sprintGoalX ? (
                  <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <span style={{ width: 2, height: 6, background: "#f59e0b", display: "inline-block" }}></span>
                    {`1/${sprintGoalX} (Sprints)`}
                  </div>
                ) : null}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
                <label style={{ fontSize: 12 }}>
                  <span style={{ marginRight: 6 }}>Exercise</span>
                  <select
                    value={selectedExerciseId}
                    onChange={(e) => setSelectedExerciseId(e.target.value)}
                    disabled={exApi.loading}
                  >
                    <option value="">All</option>
                    {(exApi.data || []).map(e => (
                      <option key={e.id} value={String(e.id)}>{e.name}</option>
                    ))}
                  </select>
                </label>
                {perRepStd ? (
                  <span style={{ fontSize: 12, color: "#6b7280" }}>
                    Using weight {exerciseWeight} (≈{perRepStd.toFixed(3)} std-reps/rep)
                  </span>
                ) : null}
              </div>
              <div style={{ fontSize: 12, marginTop: 4 }}>
                <div>
                  Remaining to next 25% marker: {selectedExerciseId ? remaining25ForExercise : remaining25}
                  {pctRemaining25 != null ? ` (${pctRemaining25.toFixed(0)}%)` : ""}
                </div>
                <div>
                  Remaining to next 1/7 marker: {selectedExerciseId ? remaining7ForExercise : remaining7}
                  {pctRemaining7 != null ? ` (${pctRemaining7.toFixed(0)}%)` : ""}
                </div>
                {sprintGoalX && (
                  <div>
                    Remaining to next Sprint marker: {selectedExerciseId ? remainingSprintForExercise : remainingSprint}
                  </div>
                )}
              </div>
            </div>
            <div><strong>Max reps:</strong> {data.max_reps ?? "—"}</div>
            <div><strong>Max weight:</strong> {data.max_weight ?? "—"}</div>
            <div><strong>Minutes:</strong> {data.minutes_elapsed ?? "—"}</div>
            <div><strong>Rest Timer:</strong> {restTimerDisplay}</div>
          </div>
          <table style={{ borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid #e5e7eb" }}>
                <th style={{ padding: 6 }}>Time</th>
                <th style={{ padding: 6 }}>Exercise</th>
                <th style={{ padding: 6 }}>Reps</th>
                <th style={{ padding: 6 }}>Weight</th>
                <th style={{ padding: 6 }}>Standard Reps</th>
                <th style={{ padding: 6 }}>Progress</th>
                <th style={{ padding: 6 }}></th>
              </tr>
            </thead>
            <tbody>
              {(data.details || []).map(d => {
                const stdReps =
                  data.routine?.hundred_points_weight && d.reps != null && d.weight != null
                    ? (d.reps * d.weight) / data.routine.hundred_points_weight
                    : null;
                const pct =
                  repGoal && repGoal > 0 && stdReps != null
                    ? `${((stdReps / repGoal) * 100).toFixed(1)}%`
                    : "—";
                return (
                  <tr key={d.id} style={{ borderTop: "1px solid #f3f4f6" }}>
                    <td style={{ padding: 8 }}>{new Date(d.datetime).toLocaleString()}</td>
                    <td style={{ padding: 8 }}>{d.exercise || "—"}</td>
                    <td style={{ padding: 8 }}>{d.reps ?? "—"}</td>
                    <td style={{ padding: 8 }}>{d.weight ?? "—"}</td>
                    <td style={{ padding: 8 }}>{stdReps != null ? stdReps.toFixed(2) : "—"}</td>
                    <td style={{ padding: 8 }}>{pct}</td>
                    <td style={{ padding: 8 }}>
                      <button type="button" style={editBtnInline} onClick={() => openEdit(d)} title="Edit set" aria-label={`Edit set ${d.id}`}>✎</button>
                      <button type="button" style={xBtnInline} onClick={() => deleteDetail(d.id)} disabled={deletingId === d.id} title="Delete set" aria-label={`Delete set ${d.id}`}>{deletingId === d.id ? "…" : "✕"}</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <div style={{ marginTop: 12 }}>
            <button type="button" style={btnStyle} onClick={openModal} disabled={exApi.loading}>Add set</button>
          </div>

          <Modal open={addModalOpen}>
            <form onSubmit={submit}>
              <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
                <label>
                  <div>Time (local)</div>
                  <input type="datetime-local" value={row.datetime} onChange={(e) => setField({ datetime: e.target.value })} />
                </label>
                <label>
                  <div>Exercise</div>
                  <select
                    value={row.exercise_id}
                    onChange={(e) => {
                      const val = e.target.value;
                      const ex = (exApi.data || []).find(x => String(x.id) === val);
                      // Fetch last set for this exercise (in this log, else previous log)
                      (async () => {
                        try {
                          const res = await fetch(`${API_BASE}/api/strength/log/${id}/last-set/?exercise_id=${val}`);
                          let std = ex ? (ex.standard_weight ?? 0) : 0;
                          let extra = "";
                          if (res.ok) {
                            const d = await res.json();
                            if (d && d.weight != null) {
                              extra = std !== "" ? String(Number(d.weight) - Number(std)) : String(d.weight);
                            }
                          }
                          setField({
                            exercise_id: val,
                            standard_weight: ex ? String(std) : "",
                            extra_weight: extra,
                          });
                        } catch (_) {
                          setField({
                            exercise_id: val,
                            standard_weight: ex ? String(ex.standard_weight ?? 0) : "",
                            extra_weight: "",
                          });
                        }
                      })();
                    }}
                    disabled={exApi.loading}
                  >
                    {exApi.loading && <option value="">Loading…</option>}
                    {!exApi.loading && exApi.data && exApi.data.map(e => (
                      <option key={e.id} value={e.id}>{e.name}</option>
                    ))}
                  </select>
                </label>
                <label>
                  <div>Reps</div>
                  <input
                    type="number"
                    step="1"
                    value={row.reps}
                    onChange={(e) => setField({ reps: e.target.value })}
                  />
                  {(repGoal && repGoal > 0) || data?.routine?.hundred_points_weight ? (
                    <div style={{ fontSize: 12 }}>
                      {repGoal && repGoal > 0 &&
                        `Contributes ${(
                          ((Number(row.reps || 0) * (Number(row.standard_weight || 0) + Number(row.extra_weight || 0))) /
                            (data.routine?.hundred_points_weight || 1) /
                            repGoal) *
                          100
                        ).toFixed(1)}%`}
                      {data?.routine?.hundred_points_weight && (
                        <>
                          {repGoal && repGoal > 0 ? " • " : ""}
                          {`Standard Reps: ${(
                            (Number(row.reps || 0) *
                              (Number(row.standard_weight || 0) + Number(row.extra_weight || 0))) /
                            (data.routine?.hundred_points_weight || 1)
                          ).toFixed(2)}`}
                        </>
                      )}
                    </div>
                  ) : null}
                </label>
                <label><div>Standard Weight</div><input type="number" step="any" value={row.standard_weight} onChange={(e) => setField({ standard_weight: e.target.value })} /></label>
                <label><div>Extra Weight</div><input type="number" step="any" value={row.extra_weight} onChange={(e) => setField({ extra_weight: e.target.value })} /></label>
              </div>
              <div style={{ marginTop: 8 }}>
                <button type="submit" style={btnStyle} disabled={saving || exApi.loading}>{saving ? "Saving…" : (editingId ? "Save set" : "Add set")}</button>
                <button type="button" style={{ ...btnStyle, marginLeft: 8 }} onClick={closeModal} disabled={saving}>Cancel</button>
                {saveErr && <span style={{ marginLeft: 8, color: "#b91c1c" }}>Error: {String(saveErr.message || saveErr)}</span>}
              </div>
            </form>
          </Modal>
        </>
      )}
    </Card>
  );
}
