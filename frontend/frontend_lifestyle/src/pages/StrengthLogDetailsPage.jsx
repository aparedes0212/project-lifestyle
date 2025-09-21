import { useParams } from "react-router-dom";
import { useCallback, useEffect, useMemo, useState } from "react";
import useApi from "../hooks/useApi";
import { API_BASE } from "../lib/config";
import Card from "../components/ui/Card";
import Modal from "../components/ui/Modal";
import ProgressBar from "../components/ui/ProgressBar";
import { formatNumber } from "../lib/numberFormat";

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

  // --- Sprint Rest Timer (Cardio) ---
  // Identify same-day Sprints cardio log (incomplete), then mirror its Rest Timer
  const cardioLogsApi = useApi(`${API_BASE}/api/cardio/logs/?weeks=1`, { deps: [] });
  const sprintCardioLog = useMemo(() => {
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
      const sprintsIncomplete = sameDay.filter(l => {
        const isSprints = (l?.workout?.routine?.name || "").toLowerCase() === "sprints";
        const g = Number(l.goal);
        const tc = Number(l.total_completed);
        return isSprints && Number.isFinite(g) && Number.isFinite(tc) && tc < g && g > 0;
      });
      if (!sprintsIncomplete.length) return null;
      sprintsIncomplete.sort((a, b) => new Date(b.datetime_started) - new Date(a.datetime_started));
      return sprintsIncomplete[0] || null;
    } catch (_) {
      return null;
    }
  }, [cardioLogsApi.data, data?.datetime_started]);

  const sprintGoalX = useMemo(() => {
    const g = Number(sprintCardioLog?.goal);
    return Number.isFinite(g) && g > 0 ? g : null;
  }, [sprintCardioLog?.goal]);

  // Fetch the sprint cardio log once to initialize timer baseline
  const [sprintLastDetailTime, setSprintLastDetailTime] = useState(null);
  const [sprintRestSeconds, setSprintRestSeconds] = useState(0);
  useEffect(() => {
    let cancelled = false;
    const fetchInitial = async () => {
      if (!sprintCardioLog?.id) {
        setSprintLastDetailTime(null);
        setSprintRestSeconds(0);
        return;
      }
      try {
        const res = await fetch(`${API_BASE}/api/cardio/log/${sprintCardioLog.id}/`);
        if (!res.ok) return;
        const log = await res.json();
        if (cancelled) return;
        const details = Array.isArray(log.details) ? log.details : [];
        let ts = null;
        if (details.length) ts = new Date(details[details.length - 1].datetime).getTime();
        if (!ts && log?.datetime_started) ts = new Date(log.datetime_started).getTime();
        if (ts && Number.isFinite(ts)) {
          setSprintLastDetailTime(ts);
        } else {
          setSprintLastDetailTime(null);
          setSprintRestSeconds(0);
        }
      } catch (_) {
        // ignore
      }
    };
    fetchInitial();
    return () => { cancelled = true; };
  }, [sprintCardioLog?.id]);

  // Drive the stopwatch from sprintLastDetailTime; updates every second
  useEffect(() => {
    if (!sprintLastDetailTime) {
      setSprintRestSeconds(0);
      return;
    }
    const update = () => setSprintRestSeconds(Math.floor((Date.now() - sprintLastDetailTime) / 1000));
    update();
    const t = setInterval(update, 1000);
    return () => clearInterval(t);
  }, [sprintLastDetailTime]);

  // Poll the cardio last-interval to refresh baseline if a new interval is added on cardio page
  useEffect(() => {
    if (!sprintCardioLog?.id) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/cardio/log/${sprintCardioLog.id}/last-interval/`);
        if (!res.ok) return;
        const d = await res.json();
        if (cancelled) return;
        if (d && d.datetime) {
          const ts = new Date(d.datetime).getTime();
          if (Number.isFinite(ts) && (!sprintLastDetailTime || ts > sprintLastDetailTime)) {
            setSprintLastDetailTime(ts);
          }
        }
      } catch (_) {
        // ignore
      }
    };
    const h = setInterval(poll, 10000);
    // also run once after 3s to catch quick changes
    const t = setTimeout(poll, 3000);
    return () => { cancelled = true; clearInterval(h); clearTimeout(t); };
  }, [sprintCardioLog?.id, sprintLastDetailTime]);

  const sprintRestDisplay = useMemo(() => {
    const m = Math.floor(sprintRestSeconds / 60);
    const s = String(sprintRestSeconds % 60).padStart(2, "0");
    return `${m}:${s}`;
  }, [sprintRestSeconds]);

  const sprintRestColor = useMemo(() => {
    // Green < 2:00, Yellow 2:00–2:59, Red 3:00–4:59, Critical >= 5:00
    if (sprintRestSeconds >= 300) return { bg: "#fee2e2", fg: "#991b1b", label: "Critical" };
    if (sprintRestSeconds >= 180) return { bg: "#fee2e2", fg: "#ef4444", label: "Red" };
    if (sprintRestSeconds >= 120) return { bg: "#fef3c7", fg: "#b45309", label: "Yellow" };
    return { bg: "#ecfdf5", fg: "#047857", label: "Green" };
  }, [sprintRestSeconds]);

  // Sort details by datetime DESC for display and calculations
  const sortedDetails = useMemo(() => {
    const arr = Array.isArray(data?.details) ? [...data.details] : [];
    arr.sort((a, b) => new Date(b.datetime) - new Date(a.datetime));
    return arr;
  }, [data?.details]);

  const lastDetailTime = useMemo(() => {
    if (sortedDetails.length) return new Date(sortedDetails[0].datetime).getTime();
    return data?.datetime_started ? new Date(data.datetime_started).getTime() : null;
  }, [sortedDetails, data?.datetime_started]);

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

  // Color state for the main Strength Rest Timer (same thresholds as Sprint)
  const restColor = useMemo(() => {
    // Green < 2:00, Yellow 2:00–2:59, Red 3:00–4:59, Critical >= 5:00
    if (restSeconds >= 300) return { bg: "#fee2e2", fg: "#991b1b", label: "Critical" };
    if (restSeconds >= 180) return { bg: "#fee2e2", fg: "#ef4444", label: "Red" };
    if (restSeconds >= 120) return { bg: "#fef3c7", fg: "#b45309", label: "Yellow" };
    return { bg: "#ecfdf5", fg: "#047857", label: "Green" };
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
  const [exerciseWeight, setExerciseWeight] = useState(null);

  const setField = (patch) => setRow(r => ({ ...r, ...patch }));

  // --- Reps per Hour (RPH) ---
  const rphApiUrl = useMemo(() => {
    const rid = data?.routine?.id;
    const vol = data?.rep_goal;
    if (!rid || vol == null) return null;
    const qs = new URLSearchParams({ routine_id: String(rid), volume: String(vol) }).toString();
    return `${API_BASE}/api/strength/rph-goal/?${qs}`;
  }, [data?.routine?.id, data?.rep_goal]);
  const rphApi = useApi(rphApiUrl || "", { deps: [rphApiUrl], skip: !rphApiUrl });

  const rphGoalPersisted = data?.rph_goal;
  const rphGoalAvgPersisted = data?.rph_goal_avg;

  const rphGoalMaxEff = useMemo(() => {
    const persisted = Number(rphGoalPersisted);
    if (Number.isFinite(persisted) && persisted > 0) return persisted;
    const apiVal = Number(rphApi.data?.rph_goal);
    return Number.isFinite(apiVal) && apiVal > 0 ? apiVal : null;
  }, [rphGoalPersisted, rphApi.data?.rph_goal]);

  const rphGoalAvgEff = useMemo(() => {
    const persisted = Number(rphGoalAvgPersisted);
    if (Number.isFinite(persisted) && persisted > 0) return persisted;
    const apiVal = Number(rphApi.data?.rph_goal_avg);
    if (Number.isFinite(apiVal) && apiVal > 0) return apiVal;
    return rphGoalMaxEff;
  }, [rphGoalAvgPersisted, rphApi.data?.rph_goal_avg, rphGoalMaxEff]);

  const minutesAtGoals = useMemo(() => {
    const vol = Number(data?.rep_goal);
    const max = Number(rphGoalMaxEff);
    const avg = Number(rphGoalAvgEff);
    if (!Number.isFinite(vol) || vol <= 0) return null;
    return {
      minutes_max: Number.isFinite(max) && max > 0 ? Math.round(((vol / max) * 60) * 100) / 100 : null,
      minutes_avg: Number.isFinite(avg) && avg > 0 ? Math.round(((vol / avg) * 60) * 100) / 100 : null,
    };
  }, [data?.rep_goal, rphGoalMaxEff, rphGoalAvgEff]);

  const currentRph = useMemo(() => {
    const total = Number(data?.total_reps_completed);
    const mins = Number(data?.minutes_elapsed);
    if (!Number.isFinite(total) || !Number.isFinite(mins) || mins <= 0) return null;
    return (total / (mins / 60));
  }, [data?.total_reps_completed, data?.minutes_elapsed]);

  // Default the per-exercise dropdown to the most recent exercise in this log
  useEffect(() => {
    const last = (sortedDetails || [])[0]; // newest first
    if (last?.exercise_id != null) setSelectedExerciseId(String(last.exercise_id));
  }, [sortedDetails.length]);

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

  const formatRepsValue = useCallback((value, precision = 2) => {
    if (value === null || value === undefined) return "\u2014";
    const formatted = formatNumber(value, precision);
    return formatted !== "" ? formatted : "0";
  }, []);

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
      remaining25 = Math.round(quarter);
      remaining7 = Math.round(seventh);
      pctComplete = tr == null ? null : (tr / repGoal) * 100;
      pctRemaining25 = (remaining25 / repGoal) * 100;
      pctRemaining7 = (remaining7 / repGoal) * 100;
    } else {
      const nextQuarter = Math.ceil(tr / quarter) * quarter;
      const nextSeventh = Math.ceil(tr / seventh) * seventh;
      const diff25 = Math.max(0, nextQuarter - tr);
      const diff7 = Math.max(0, nextSeventh - tr);
      // If next marker is effectively 100%, round up; otherwise normal rounding
      remaining25 = nextQuarter >= repGoal ? Math.ceil(diff25) : Math.round(diff25);
      remaining7 = nextSeventh >= repGoal ? Math.ceil(diff7) : Math.round(diff7);
      pctComplete = (tr / repGoal) * 100;
      pctRemaining25 = (remaining25 / repGoal) * 100;
      pctRemaining7 = (remaining7 / repGoal) * 100;
    }
  }

  // Convert the remaining standard-reps into reps for a selected exercise
  const routineHPW = data?.routine?.hundred_points_weight || null;
  const selectedExercise = (exApi.data || []).find(e => String(e.id) === String(selectedExerciseId)) || null;

  // Keep exerciseWeight in sync with selected exercise using the same logic
  // as the Add Set modal: prefer last set in this log; else query last-set API
  // (which falls back to previous daily logs); else use the exercise standard weight.
  useEffect(() => {
    let cancelled = false;
    const update = async () => {
      if (!selectedExerciseId) {
        setExerciseWeight(null);
        return;
      }
      const lastLocal = (sortedDetails || []).find(d => String(d.exercise_id) === String(selectedExerciseId)) || null;
      if (lastLocal && lastLocal.weight != null) {
        if (!cancelled) setExerciseWeight(Number(lastLocal.weight));
        return;
      }
      try {
        const res = await fetch(`${API_BASE}/api/strength/log/${id}/last-set/?exercise_id=${selectedExerciseId}`);
        if (cancelled) return;
        if (res.ok) {
          const d = await res.json();
          if (d && d.weight != null) {
            setExerciseWeight(Number(d.weight));
            return;
          }
        }
      } catch (_) {
        // ignore and fall through to standard weight
      }
      const std = selectedExercise && selectedExercise.standard_weight != null ? Number(selectedExercise.standard_weight) : null;
      setExerciseWeight(std);
    };
    update();
    return () => { cancelled = true; };
  }, [selectedExerciseId, data?.details?.length, exApi.data, id]);

  const perRepStd = routineHPW && exerciseWeight != null ? exerciseWeight / routineHPW : null;
  const remaining25ForExercise = perRepStd ? Math.ceil(remaining25 / perRepStd) : remaining25;
  const remaining7ForExercise = perRepStd ? Math.ceil(remaining7 / perRepStd) : remaining7;

  // If a cardio "Sprints" workout happens the same day, add a 1/x marker where x is its goal
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
            <div><strong>Routine:</strong> {data.routine?.name || "\u2014"}</div>
            <div><strong>Rep goal:</strong> {formatRepsValue(repGoal)}</div>
            <div><strong>Level:</strong> {levelApi.data?.progression_order ?? "\u2014"}</div>
            <div><strong>Points:</strong> {levelPoints ?? "\u2014"}</div>
            <div><strong>Total reps:</strong> {formatRepsValue(totalReps)}{pctComplete != null ? ` (${pctComplete.toFixed(0)}%)` : ""}</div>
            <div style={{ marginTop: 6, padding: 8, border: "1px solid #e5e7eb", borderRadius: 8, background: "#fff" }}>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>RPH Prediction</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 8, fontSize: 13 }}>
                <div>
                  <div style={{ color: "#6b7280" }}>Current</div>
                  <div>{currentRph != null ? `${formatNumber(currentRph, 1)} reps/hr` : "\u2014"}</div>
                </div>
                <div>
                  <div style={{ color: "#6b7280" }}>Goal (Max)</div>
                  <div>{rphGoalMaxEff != null ? `${formatNumber(rphGoalMaxEff, 1)} reps/hr` : "\u2014"}</div>
                </div>
                <div>
                  <div style={{ color: "#6b7280" }}>Goal (Avg)</div>
                  <div>{rphGoalAvgEff != null ? `${formatNumber(rphGoalAvgEff, 1)} reps/hr` : "\u2014"}</div>
                </div>
                <div>
                  <div style={{ color: "#6b7280" }}>Est. Time @ Max</div>
                  <div>{minutesAtGoals?.minutes_max != null ? `${minutesAtGoals.minutes_max} min` : (rphApi.data?.minutes_max != null ? `${rphApi.data.minutes_max} min` : "\u2014")}</div>
                </div>
                <div>
                  <div style={{ color: "#6b7280" }}>Est. Time @ Avg</div>
                  <div>{minutesAtGoals?.minutes_avg != null ? `${minutesAtGoals.minutes_avg} min` : (rphApi.data?.minutes_avg != null ? `${rphApi.data.minutes_avg} min` : "\u2014")}</div>
                </div>
              </div>
            </div>
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
              {sprintGoalX && sprintCardioLog?.id ? (
                <div style={{ marginTop: 6 }}>
                  <span
                    title={`Sprint Rest Timer (${sprintRestColor.label})`}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 8,
                      fontSize: 12,
                      padding: "4px 8px",
                      borderRadius: 6,
                      background: sprintRestColor.bg,
                      color: sprintRestColor.fg,
                      border: `1px solid ${sprintRestColor.fg}20`,
                    }}
                  >
                    <strong style={{ fontWeight: 600 }}>Sprint Rest Timer:</strong> {sprintRestDisplay}
                  </span>
                </div>
              ) : null}
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
            <div><strong>Max reps:</strong> {formatRepsValue(data?.max_reps)}</div>
            <div><strong>Max weight:</strong> {data.max_weight ?? "\u2014"}</div>
            <div><strong>Minutes:</strong> {data.minutes_elapsed ?? "\u2014"}</div>
            <div>
              <span
                title={`Rest Timer (${restColor.label})`}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                  fontSize: 12,
                  padding: "4px 8px",
                  borderRadius: 6,
                  background: restColor.bg,
                  color: restColor.fg,
                  border: `1px solid ${restColor.fg}20`,
                }}
              >
                <strong style={{ fontWeight: 600 }}>Rest Timer:</strong> {restTimerDisplay}
              </span>
            </div>
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
                  <th style={{ padding: 6 }}>Rest Time</th>
                  <th style={{ padding: 6 }}></th>
                </tr>
              </thead>
              <tbody>
              {sortedDetails.map((d, idx) => {
                const stdReps =
                  data.routine?.hundred_points_weight && d.reps != null && d.weight != null
                    ? (d.reps * d.weight) / data.routine.hundred_points_weight
                    : null;
                const pct =
                  repGoal && repGoal > 0 && stdReps != null
                    ? `${formatNumber((stdReps / repGoal) * 100, 1)}%`
                    : "\u2014";

                // Compute rest time: current row time minus previous chronological (older) row
                let restDisplay = "\u2014";
                try {
                  const cur = new Date(d.datetime).getTime();
                  const prevTs = (idx < sortedDetails.length - 1)
                    ? (new Date(sortedDetails[idx + 1].datetime).getTime())
                    : (data?.datetime_started ? new Date(data.datetime_started).getTime() : null);
                  if (prevTs != null && Number.isFinite(prevTs)) {
                    const diffSec = Math.max(0, Math.floor((cur - prevTs) / 1000));
                    const m = Math.floor(diffSec / 60);
                    const s = String(diffSec % 60).padStart(2, "0");
                    restDisplay = `${m}:${s}`;
                  }
                } catch (_) {
                  // keep em dash
                }
                return (
                  <tr key={d.id} style={{ borderTop: "1px solid #f3f4f6" }}>
                    <td style={{ padding: 8 }}>{new Date(d.datetime).toLocaleString()}</td>
                    <td style={{ padding: 8 }}>{d.exercise || "\u2014"}</td>
                    <td style={{ padding: 8 }}>{formatRepsValue(d.reps)}</td>
                    <td style={{ padding: 8 }}>{d.weight ?? "\u2014"}</td>
                    <td style={{ padding: 8 }}>{stdReps != null ? formatRepsValue(stdReps) : "\u2014"}</td>
                    <td style={{ padding: 8 }}>{pct}</td>
                    <td style={{ padding: 8 }}>{restDisplay}</td>
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
                          let reps = "";
                          if (res.ok) {
                            const d = await res.json();
                            if (d && d.weight != null) {
                              extra = std !== "" ? String(Number(d.weight) - Number(std)) : String(d.weight);
                            }
                            if (d && d.reps != null) {
                              reps = String(d.reps);
                            }
                          }
                          setField({
                            exercise_id: val,
                            standard_weight: ex ? String(std) : "",
                            extra_weight: extra,
                            reps,
                          });
                        } catch (_) {
                          setField({
                            exercise_id: val,
                            standard_weight: ex ? String(ex.standard_weight ?? 0) : "",
                            extra_weight: "",
                            reps: "",
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
