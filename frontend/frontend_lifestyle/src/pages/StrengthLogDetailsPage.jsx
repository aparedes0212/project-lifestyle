import { useParams } from "react-router-dom";
import { useCallback, useEffect, useMemo, useState } from "react";
import useApi from "../hooks/useApi";
import { API_BASE } from "../lib/config";
import Card from "../components/ui/Card";
import Modal from "../components/ui/Modal";
import ProgressBar from "../components/ui/ProgressBar";
import { formatNumber } from "../lib/numberFormat";
import { deriveRestColor } from "../lib/restColors";

const btnStyle = { border: "1px solid #e5e7eb", background: "#f9fafb", borderRadius: 8, padding: "6px 10px", cursor: "pointer" };
const editBtnInline = { border: "1px solid #bfdbfe", background: "#eff6ff", color: "#1d4ed8", cursor: "pointer", fontSize: 12, lineHeight: 1.2, padding: "2px 10px", borderRadius: 999, fontWeight: 600 };
const xBtnInline = { border: "1px solid #fecaca", background: "#fee2e2", color: "#b91c1c", cursor: "pointer", fontSize: 12, lineHeight: 1.2, padding: "2px 10px", borderRadius: 999, fontWeight: 600 };

const dashboardWrap = { display: "grid", gap: 20 };
const summaryGridStyle = { display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" };
const statCardStyle = { border: "1px solid #e5e7eb", borderRadius: 10, padding: "12px 16px", background: "#f9fafb", display: "flex", flexDirection: "column", gap: 4, minHeight: 72 };
const statLabelStyle = { fontSize: 12, fontWeight: 600, color: "#6b7280", letterSpacing: "0.02em", textTransform: "uppercase" };
const statValueStyle = { fontSize: 18, fontWeight: 600, color: "#111827" };
const statSubtleStyle = { fontSize: 12, color: "#6b7280" };
const panelsGridStyle = { display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))" };
const panelCardStyle = { border: "1px solid #e5e7eb", borderRadius: 12, padding: "16px 18px", background: "#fff", display: "flex", flexDirection: "column", gap: 12 };
const panelTitleStyle = { fontSize: 16, fontWeight: 600, color: "#111827", margin: 0 };
const miniStatGridStyle = { display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))" };
const miniStatLabelStyle = { fontSize: 12, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.04em" };
const miniStatValueStyle = { fontSize: 16, fontWeight: 600, color: "#111827" };
const progressBadgeStyle = { fontSize: 12, fontWeight: 600, padding: "4px 8px", borderRadius: 999, background: "#ecfdf5", color: "#047857", border: "1px solid #04785720" };
const legendRowStyle = { display: "flex", gap: 16, fontSize: 12, flexWrap: "wrap", alignItems: "center" };
const controlsRowStyle = { display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" };
const controlLabelStyle = { display: "flex", flexDirection: "column", fontSize: 12, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.04em", gap: 4 };
const controlSelectStyle = { minWidth: 160, padding: "6px 8px", borderRadius: 6, border: "1px solid #d1d5db" };
const perRepNoteStyle = { fontSize: 12, color: "#6b7280" };
const tablePanelStyle = { border: "1px solid #e5e7eb", borderRadius: 12, overflow: "hidden", background: "#fff" };
const tableHeaderStyle = { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "16px 20px", borderBottom: "1px solid #e5e7eb", gap: 12, flexWrap: "wrap" };
const headerLeftStyle = { display: "flex", flexDirection: "column", gap: 4 };
const headerTitleStyle = { fontSize: 16, fontWeight: 600, color: "#111827", margin: 0 };
const tableScrollStyle = { overflowX: "auto" };
const tableHeadCellStyle = { padding: 10, textAlign: "left", fontSize: 12, textTransform: "uppercase", letterSpacing: "0.04em", color: "#6b7280", borderBottom: "1px solid #e5e7eb", background: "#f9fafb" };
const tableCellStyle = { padding: 12, borderTop: "1px solid #f3f4f6", fontSize: 13, verticalAlign: "top" };


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
  const strengthThresholdsApi = useApi(`${API_BASE}/api/strength/rest-thresholds/`, { deps: [] });
  const cardioThresholdsApi = useApi(`${API_BASE}/api/cardio/rest-thresholds/`, { deps: [] });

  const strengthThresholdsByExercise = useMemo(() => {
    const map = {};
    (strengthThresholdsApi.data || []).forEach(item => {
      map[String(item.exercise)] = item;
    });
    return map;
  }, [strengthThresholdsApi.data]);

  const cardioThresholdsByWorkout = useMemo(() => {
    const map = {};
    (cardioThresholdsApi.data || []).forEach(item => {
      map[String(item.workout)] = item;
    });
    return map;
  }, [cardioThresholdsApi.data]);

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

  const sprintWorkoutId = sprintCardioLog?.workout?.id != null ? String(sprintCardioLog.workout.id) : "";

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
    const update = () => {
      const diff = Date.now() - sprintLastDetailTime;
      setSprintRestSeconds(diff > 0 ? Math.floor(diff / 1000) : 0);
    };
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
    if (!Array.isArray(data?.details)) return [];
    const arr = Array.from(data.details);
    arr.sort((a, b) => {
      const aTs = new Date(a?.datetime ?? 0).getTime();
      const bTs = new Date(b?.datetime ?? 0).getTime();
      if (Number.isFinite(bTs) && Number.isFinite(aTs) && bTs !== aTs) {
        return bTs - aTs;
      }
      const aId = Number(a?.id) || 0;
      const bId = Number(b?.id) || 0;
      return bId - aId;
    });
    return arr;
  }, [data?.details]);

  const [restSeconds, setRestSeconds] = useState(0);
  useEffect(() => {
    const computeAndSet = () => {
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

      if (baseTs == null && data?.datetime_started) {
        const startTs = new Date(data.datetime_started).getTime();
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

    computeAndSet();
    const interval = setInterval(computeAndSet, 1000);
    return () => clearInterval(interval);
  }, [sortedDetails, data?.datetime_started]);

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

  const strengthProgressionsApiUrl = useMemo(() => {
    const rid = data?.routine?.id;
    return rid ? `${API_BASE}/api/strength/progressions/?routine_id=${rid}` : null;
  }, [data?.routine?.id]);
  const strengthProgressionsApi = useApi(strengthProgressionsApiUrl || "", { deps: [strengthProgressionsApiUrl], skip: !strengthProgressionsApiUrl });

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

  const primaryStrengthExerciseId = useMemo(() => {
    if (sortedDetails.length && sortedDetails[0]?.exercise_id != null) {
      return String(sortedDetails[0].exercise_id);
    }
    return selectedExerciseId ? String(selectedExerciseId) : "";
  }, [sortedDetails, selectedExerciseId]);

  const restColor = useMemo(() => {
    const thresholds = primaryStrengthExerciseId
      ? strengthThresholdsByExercise[primaryStrengthExerciseId]
      : null;
    return deriveRestColor(restSeconds, thresholds);
  }, [restSeconds, primaryStrengthExerciseId, strengthThresholdsByExercise]);

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

  // Default the per-exercise dropdown to the most recent exercise in this log
  useEffect(() => {
    const last = (sortedDetails || [])[0]; // newest first
    if (last?.exercise_id != null) setSelectedExerciseId(String(last.exercise_id));
  }, [sortedDetails.length]);

  const openModal = async () => {
    setEditingId(null);
    const baseRow = { ...emptyRow, datetime: toIsoLocalNow() };

    const findExercise = (val) => {
      if (val == null || val === "") return null;
      return (exApi.data || []).find(e => String(e.id) === String(val)) || null;
    };

    const toRow = ({ exerciseId, detail }) => {
      const resolvedId = detail?.exercise_id != null ? detail.exercise_id : exerciseId;
      const exercise = findExercise(resolvedId);
      const stdRaw = exercise ? exercise.standard_weight ?? 0 : "";
      const resolvedReps = detail?.reps == null ? "" : String(detail.reps);
      let diff = "";
      if (detail && detail.weight != null && stdRaw !== "") {
        const total = Number(detail.weight);
        const stdNum = Number(stdRaw);
        diff = Number.isFinite(total) && Number.isFinite(stdNum) ? total - stdNum : "";
      }
      return {
        ...baseRow,
        exercise_id: resolvedId ? String(resolvedId) : "",
        reps: resolvedReps,
        standard_weight: stdRaw === "" ? "" : String(stdRaw),
        extra_weight: diff === "" ? "" : String(diff),
      };
    };

    const fetchLastSet = async (exerciseId) => {
      try {
        const qs = exerciseId ? `?exercise_id=${exerciseId}` : "";
        const res = await fetch(`${API_BASE}/api/strength/log/${id}/last-set/${qs}`);
        if (!res.ok) return null;
        const detail = await res.json();
        return detail || null;
      } catch (err) {
        console.error(err);
        return null;
      }
    };

    let nextRow = { ...baseRow };
    const selectedId = selectedExerciseId ? String(selectedExerciseId) : "";

    if (selectedId) {
      const localDetail = (sortedDetails || []).find(d => String(d.exercise_id) === selectedId) || null;
      if (localDetail) {
        nextRow = toRow({ exerciseId: selectedId, detail: localDetail });
      } else {
        const remoteDetail = await fetchLastSet(selectedId);
        if (remoteDetail) {
          const withId = remoteDetail.exercise_id != null ? remoteDetail : { ...remoteDetail, exercise_id: selectedId };
          nextRow = toRow({ exerciseId: selectedId, detail: withId });
        } else {
          nextRow = toRow({ exerciseId: selectedId });
        }
      }
    } else {
      const remoteDetail = await fetchLastSet("");
      if (remoteDetail) {
        nextRow = toRow({ exerciseId: remoteDetail.exercise_id ?? "", detail: remoteDetail });
      }
    }

    if (!nextRow.exercise_id) {
      const fallbackExercise = selectedId || (exApi.data || [])[0]?.id;
      if (fallbackExercise != null && fallbackExercise !== "") {
        nextRow = toRow({ exerciseId: fallbackExercise });
      }
    }

    setRow(nextRow);
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

  const formatPercent = useCallback((value, precision = 1) => {
    if (value === null || value === undefined) return null;
    const num = Number(value);
    if (!Number.isFinite(num)) return null;
    const formatted = formatNumber(num, precision);
    const result = formatted !== "" ? formatted : num.toFixed(precision);
    return `${result}%`;
  }, []);

  const formatCount = useCallback((value) => {
    if (value === null || value === undefined) return "\u2014";
    const num = Number(value);
    if (!Number.isFinite(num)) return "\u2014";
    const abs = Math.abs(num);
    const precision = abs >= 10 ? 0 : 1;
    const formatted = formatNumber(num, precision);
    if (formatted !== "") return formatted;
    return precision === 0 ? String(Math.round(num)) : num.toFixed(precision);
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
  let remainingSprint = null;
  let pctComplete = null;
  let pctRemaining25 = null;
  let pctRemaining7 = null;
  if (repGoal != null && repGoal > 0) {
    const quarter = repGoal * 0.25;
    const seventh = repGoal / 7;
    const tr = totalReps != null ? Number(totalReps) : null;
    const sprintDivisor = Number(sprintGoalX);
    const sprintSegment = Number.isFinite(sprintDivisor) && sprintDivisor > 0 ? repGoal / sprintDivisor : null;
    if (tr == null || tr <= 0) {
      // No sets yet: next markers are the first thresholds
      remaining25 = Math.round(quarter);
      remaining7 = Math.round(seventh);
      if (sprintSegment != null) {
        remainingSprint = Math.round(sprintSegment);
      }
      pctComplete = tr == null ? null : (tr / repGoal) * 100;
      pctRemaining25 = (remaining25 / repGoal) * 100;
      pctRemaining7 = (remaining7 / repGoal) * 100;
    } else {
      const nextQuarter = Math.ceil(tr / quarter) * quarter;
      const nextSeventh = Math.ceil(tr / seventh) * seventh;
      const diff25 = Math.max(0, nextQuarter - tr);
      const diff7 = Math.max(0, nextSeventh - tr);
      // If next marker is effectively 100%, round up; otherwise normal rounding
      const adjustRemaining = (diff, nextTarget, segmentSize) => {
        const rounded = nextTarget >= repGoal ? Math.ceil(diff) : Math.round(diff);
        if (rounded <= 0 && diff > 0) {
          const bumpTarget = Math.min(nextTarget + segmentSize, repGoal);
          if (bumpTarget > nextTarget) {
            const bumpDiff = Math.max(0, bumpTarget - tr);
            return bumpTarget >= repGoal ? Math.ceil(bumpDiff) : Math.round(bumpDiff);
          }
        }
        return rounded;
      };
      remaining25 = adjustRemaining(diff25, nextQuarter, quarter);
      remaining7 = adjustRemaining(diff7, nextSeventh, seventh);
      if (sprintSegment != null) {
        const nextSprint = Math.ceil(tr / sprintSegment) * sprintSegment;
        const diffSprint = Math.max(0, nextSprint - tr);
        remainingSprint = adjustRemaining(diffSprint, nextSprint, sprintSegment);
      }
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
      if (lastLocal && Number.isFinite(Number(lastLocal.weight))) {
        if (!cancelled) setExerciseWeight(Number(lastLocal.weight));
        return;
      }

      let fallbackWeight = null;
      try {
        const res = await fetch(`${API_BASE}/api/strength/log/${id}/last-set/?exercise_id=${selectedExerciseId}`);
        if (!cancelled && res.ok) {
          const d = await res.json();
          if (d && Number.isFinite(Number(d.weight))) {
            fallbackWeight = Number(d.weight);
          }
        }
      } catch (_) {
        // ignore and fall through
      }

      if (fallbackWeight != null) {
        if (!cancelled) setExerciseWeight(fallbackWeight);
        return;
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
  const toExerciseReps = useCallback((val) => {
    const num = Number(val);
    if (!Number.isFinite(num)) return null;
    if (perRepStd && perRepStd > 0) return num / perRepStd;
    return num;
  }, [perRepStd]);
  const formatExerciseReps = useCallback((val) => {
    const converted = toExerciseReps(val);
    if (converted == null) return "\u2014";
    return formatNumber(converted, 2) || String(converted);
  }, [toExerciseReps]);

  const rphGoalMaxExercise = useMemo(() => {
    const val = rphGoalMaxEff;
    if (val == null) return null;
    return toExerciseReps(val);
  }, [rphGoalMaxEff, toExerciseReps]);
  const rphGoalAvgExercise = useMemo(() => {
    const val = rphGoalAvgEff;
    if (val == null) return null;
    return toExerciseReps(val);
  }, [rphGoalAvgEff, toExerciseReps]);

  const minutesAtGoals = useMemo(() => {
    const vol = Number(data?.rep_goal);
    const max = Number(rphGoalMaxExercise);
    const avg = Number(rphGoalAvgExercise);
    if (!Number.isFinite(vol) || vol <= 0) return null;
    return {
      minutes_max: Number.isFinite(max) && max > 0 ? Math.round(((vol / max) * 60) * 100) / 100 : null,
      minutes_avg: Number.isFinite(avg) && avg > 0 ? Math.round(((vol / avg) * 60) * 100) / 100 : null,
    };
  }, [data?.rep_goal, rphGoalMaxExercise, rphGoalAvgExercise]);

  const currentRph = useMemo(() => {
    const total = Number(data?.total_reps_completed);
    const minsRaw = Number(data?.minutes_elapsed);
    const mins = Math.abs(minsRaw);
    if (!Number.isFinite(total) || !Number.isFinite(mins) || mins <= 0) return null;
    return (total / (mins / 60));
  }, [data?.total_reps_completed, data?.minutes_elapsed]);
  const currentRphExercise = useMemo(() => {
    if (currentRph == null) return null;
    const converted = toExerciseReps(currentRph);
    return converted != null ? converted : null;
  }, [currentRph, toExerciseReps]);

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

  const remainingSprintForExercise = perRepStd ? (remainingSprint != null ? Math.ceil(remainingSprint / perRepStd) : null) : remainingSprint;

  const startedDisplay = data?.datetime_started ? new Date(data.datetime_started).toLocaleString() : "\u2014";
  const routineName = data?.routine?.name || "\u2014";
  const repGoalDisplay = formatExerciseReps(repGoal);
  const totalRepsDisplay = formatExerciseReps(totalReps);
  const totalSetsCount = sortedDetails.length;
  const setsSubtitle = totalSetsCount ? `${totalSetsCount} ${totalSetsCount === 1 ? "set logged" : "sets logged"}` : "No sets yet";
  const repGoalNumber = repGoal != null ? Number(repGoal) : null;
  const totalRepsNumber = totalReps != null ? Number(totalReps) : null;
  const overallRemaining = repGoalNumber != null && totalRepsNumber != null ? Math.max(0, repGoalNumber - totalRepsNumber) : null;
  const overallRemainingDisplay = formatCount(overallRemaining);
  const overallRemainingPercent = repGoalNumber != null && totalRepsNumber != null && repGoalNumber > 0
    ? formatPercent((overallRemaining / repGoalNumber) * 100)
    : null;
  const progressPercentValue = pctComplete != null ? Number(pctComplete) : null;
  const progressPercentDisplay = progressPercentValue != null && Number.isFinite(progressPercentValue)
    ? formatPercent(progressPercentValue)
    : null;
  const progressPercentBadge = (() => {
    if (progressPercentDisplay) {
      if (progressPercentValue != null && progressPercentValue >= 100) {
        return { label: `${progressPercentDisplay} done`, background: "#ecfdf5", color: "#047857", border: "1px solid #04785720" };
      }
      return { label: `${progressPercentDisplay} complete`, background: "#e0f2fe", color: "#0369a1", border: "1px solid #0369a120" };
    }
    if (totalRepsNumber && totalRepsNumber > 0) {
      return { label: "In progress", background: "#fef3c7", color: "#b45309", border: "1px solid #b4530920" };
    }
    return null;
  })();
  const peakSetDisplay = formatExerciseReps(data?.max_reps);
  const peakGoalDisplay = data?.max_reps_goal != null ? formatExerciseReps(data.max_reps_goal) : null;
  const maxWeightDisplay = data?.max_weight != null ? formatRepsValue(data.max_weight) : "\u2014";
  const maxWeightGoalDisplay = data?.max_weight_goal != null ? formatRepsValue(data.max_weight_goal) : null;
  const minutesDisplay = data?.minutes_elapsed != null ? (formatNumber(Math.abs(Number(data.minutes_elapsed)), 2) || String(Math.abs(Number(data.minutes_elapsed)))) : "\u2014";
  const levelDisplay = levelApi.data?.progression_order ?? "\u2014";
  const levelPointsDisplay = levelPoints != null ? `${levelPoints} pts` : null;
  const trainingSetDisplay = useMemo(() => {
    const level = levelApi.data?.progression_order;
    const list = strengthProgressionsApi.data;
    if (level == null) return "\u2014";
    if (!Array.isArray(list)) return strengthProgressionsApi.loading ? "Loading\u2026" : "\u2014";
    const match = list.find(p => Number(p.progression_order) === Number(level));
    if (!match) return "\u2014";
    const val = Number(match.training_set);
    if (!Number.isFinite(val)) return "\u2014";
    return formatExerciseReps(val);
  }, [formatExerciseReps, levelApi.data?.progression_order, strengthProgressionsApi.data, strengthProgressionsApi.loading]);
  const [predictingNextReps, setPredictingNextReps] = useState(false);
  const [nextRepsPrediction, setNextRepsPrediction] = useState(null);
  const [nextRepsError, setNextRepsError] = useState(null);
  const exerciseSetsChrono = useMemo(() => {
    const list = selectedExerciseId
      ? sortedDetails.filter(d => String(d.exercise_id) === String(selectedExerciseId))
      : sortedDetails;
    const arr = Array.from(list);
    arr.sort((a, b) => new Date(a.datetime) - new Date(b.datetime));
    return arr;
  }, [selectedExerciseId, sortedDetails]);
  const nextSetIndex = exerciseSetsChrono.length + 1;
  const lastSet = exerciseSetsChrono.length ? exerciseSetsChrono[exerciseSetsChrono.length - 1] : null;
  const prevSet = exerciseSetsChrono.length > 1 ? exerciseSetsChrono[exerciseSetsChrono.length - 2] : null;
  const restPrevSeconds = useMemo(() => {
    if (!lastSet || !prevSet) return null;
    try {
      const cur = new Date(lastSet.datetime).getTime();
      const prev = new Date(prevSet.datetime).getTime();
      if (Number.isFinite(cur) && Number.isFinite(prev)) {
        return Math.max(0, Math.round((cur - prev) / 1000));
      }
    } catch (_) {
      return null;
    }
    return null;
  }, [lastSet, prevSet]);
  const predictNextReps = useCallback(async () => {
    setPredictingNextReps(true);
    setNextRepsError(null);
    try {
      await new Promise(res => setTimeout(res, 250)); // async feel

      // Simple linear regression of reps ~ set_index
      const points = exerciseSetsChrono
        .map((s, idx) => ({ x: idx + 1, y: Number(s.reps) }))
        .filter(p => Number.isFinite(p.y));

      if (!points.length) {
        throw new Error("No reps available to predict from.");
      }

      const n = points.length;
      const meanX = points.reduce((a, b) => a + b.x, 0) / n;
      const meanY = points.reduce((a, b) => a + b.y, 0) / n;
      const num = points.reduce((acc, p) => acc + (p.x - meanX) * (p.y - meanY), 0);
      const den = points.reduce((acc, p) => acc + (p.x - meanX) ** 2, 0);
      const slope = den !== 0 ? num / den : 0;
      const intercept = meanY - slope * meanX;
      const rawPred = intercept + slope * (n + 1);
      const cleaned = Math.max(0, Math.round(rawPred));

      setNextRepsPrediction({
        reps: cleaned,
        meta: {
          setIndex: n + 1,
          slope: Number.isFinite(slope) ? slope : null,
          intercept: Number.isFinite(intercept) ? intercept : null,
          restPrevSeconds,
          repsPrev1: points[n - 1]?.y ?? null,
          repsPrev2: points[n - 2]?.y ?? null,
        },
      });
    } catch (err) {
      setNextRepsError(err);
    } finally {
      setPredictingNextReps(false);
    }
  }, [exerciseSetsChrono, restPrevSeconds]);

  useEffect(() => {
    if (!exerciseSetsChrono.length) {
      setNextRepsPrediction(null);
      return;
    }
    let cancelled = false;
    (async () => {
      await predictNextReps();
      if (cancelled) return;
    })();
    return () => {
      cancelled = true;
    };
  }, [exerciseSetsChrono, predictNextReps]);
  const summaryCards = [
    { id: "started", label: "Started", value: startedDisplay },
    { id: "routine", label: "Routine", value: routineName },
    { id: "sets", label: "Sets", value: String(totalSetsCount), sub: totalSetsCount === 1 ? "set logged" : "sets logged" },
    { id: "rep-goal", label: "Rep Goal", value: repGoalDisplay },
    { id: "total-reps", label: "Total Reps", value: totalRepsDisplay, sub: progressPercentDisplay ? `${progressPercentDisplay} complete` : null },
    { id: "peak", label: "Peak Set", value: peakSetDisplay, sub: peakGoalDisplay ? `Goal ${peakGoalDisplay}` : null },
    { id: "max-weight", label: "Max Weight", value: maxWeightDisplay, sub: maxWeightGoalDisplay ? `Goal ${maxWeightGoalDisplay}` : null },
    { id: "minutes", label: "Minutes", value: minutesDisplay },
    { id: "level", label: "Level", value: levelDisplay, sub: levelPointsDisplay },
  ];
  const highlightCards = (() => {
    const cards = [
      {
        id: "rest",
        label: "Rest Timer",
        value: restTimerDisplay,
        sub: restColor.label,
        style: {
          background: restColor.bg,
          color: restColor.fg,
          border: `1px solid ${restColor.fg}20`,
        },
      },
    ];
    if (sprintGoalX && sprintCardioLog?.id) {
      cards.push({
        id: "sprint-rest",
        label: "Sprint Rest",
        value: sprintRestDisplay,
        sub: sprintGoalX ? `Target 1/${sprintGoalX}` : null,
        style: {
          background: sprintRestColor.bg,
          color: sprintRestColor.fg,
          border: `1px solid ${sprintRestColor.fg}20`,
        },
      });
    }
    return cards;
  })();
  const summaryCardData = [...summaryCards, ...highlightCards];
  const rawRemainingMarkers = [
    {
      id: "25",
      label: "Next 25%",
      raw: selectedExerciseId ? remaining25ForExercise : remaining25,
      sub: formatPercent(pctRemaining25),
    },
    {
      id: "seventh",
      label: "Next 1/7",
      raw: selectedExerciseId ? remaining7ForExercise : remaining7,
      sub: formatPercent(pctRemaining7),
    },
  ];
  if (sprintGoalX) {
    rawRemainingMarkers.push({
      id: "sprint",
      label: "Next Sprint",
      raw: selectedExerciseId ? remainingSprintForExercise : remainingSprint,
      sub: sprintGoalX ? `1/${sprintGoalX}` : null,
    });
  }
  const highlightedMarker = rawRemainingMarkers.reduce((best, marker) => {
    if (marker.raw == null) return best;
    const num = Number(marker.raw);
    if (!Number.isFinite(num)) return best;
    if (!best || num < best.value) {
      return { id: marker.id, value: num };
    }
    return best;
  }, null);
  const highlightedMarkerId = highlightedMarker?.id ?? null;
  const remainingMarkers = rawRemainingMarkers.map(marker => ({
    id: marker.id,
    label: marker.label,
    value: formatCount(marker.raw),
    sub: marker.sub,
  }));
  const markerContextText = selectedExerciseId
    ? "Markers adjusted for the selected exercise and weight."
    : "Markers based on total log output.";
  const currentRphDisplay = currentRphExercise != null ? `${formatNumber(currentRphExercise, 1)} reps/hr` : "\u2014";
  const rphGoalMaxDisplay = rphGoalMaxExercise != null ? `${formatNumber(rphGoalMaxExercise, 1)} reps/hr` : "\u2014";
  const rphGoalAvgDisplay = rphGoalAvgExercise != null ? `${formatNumber(rphGoalAvgExercise, 1)} reps/hr` : "\u2014";
  const rphMaxRepsGoalPredictionDisplay = rphApi.data?.max_reps_goal != null ? formatExerciseReps(rphApi.data.max_reps_goal) : "\u2014";
  const rphMaxWeightGoalPredictionDisplay = rphApi.data?.max_weight_goal != null ? formatNumber(rphApi.data.max_weight_goal, 2) : "\u2014";
  const minutesAtMaxDisplay = minutesAtGoals?.minutes_max != null
    ? `${minutesAtGoals.minutes_max} min`
    : (rphApi.data?.minutes_max != null ? `${rphApi.data.minutes_max} min` : "\u2014");
  const minutesAtAvgDisplay = minutesAtGoals?.minutes_avg != null
    ? `${minutesAtGoals.minutes_avg} min`
    : (rphApi.data?.minutes_avg != null ? `${rphApi.data.minutes_avg} min` : "\u2014");


  return (
    <Card title={`Strength Log ${id}`} action={<button onClick={refetch} style={btnStyle}>Refresh</button>}>
      {loading && <div>Loading…</div>}
      {error && <div style={{ color: "#b91c1c" }}>Error: {String(error.message || error)}</div>}
      {deleteErr && <div style={{ color: "#b91c1c" }}>Delete error: {String(deleteErr.message || deleteErr)}</div>}
      {!loading && !error && data && (
        <>
          <div style={dashboardWrap}>
            <div style={summaryGridStyle}>
              {summaryCardData.map(card => {
                const cardStyle = card.style ? { ...statCardStyle, ...card.style } : statCardStyle;
                const labelStyle = card.style?.color ? { ...statLabelStyle, color: card.style.color } : statLabelStyle;
                const valueStyle = card.style?.color ? { ...statValueStyle, color: card.style.color } : statValueStyle;
                const subStyle = card.style?.color ? { ...statSubtleStyle, color: card.style.color } : statSubtleStyle;
                return (
                  <div key={card.id} style={cardStyle}>
                    <span style={labelStyle}>{card.label}</span>
                    <span style={valueStyle}>{card.value}</span>
                    {card.sub ? <span style={subStyle}>{card.sub}</span> : null}
                  </div>
                );
              })}
            </div>

            <div style={panelsGridStyle}>
              <div style={panelCardStyle}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
                  <div>
                    <h3 style={panelTitleStyle}>Volume Progress</h3>
                    <div style={statSubtleStyle}>Goal coverage for this session</div>
                  </div>
                  {progressPercentBadge ? (
                    <span
                      style={{
                        ...progressBadgeStyle,
                        background: progressPercentBadge.background,
                        color: progressPercentBadge.color,
                        border: progressPercentBadge.border,
                      }}
                    >
                      {progressPercentBadge.label}
                    </span>
                  ) : null}
                </div>
                <div style={miniStatGridStyle}>
                  <div>
                    <div style={miniStatLabelStyle}>Rep Goal</div>
                    <div style={miniStatValueStyle}>{repGoalDisplay}</div>
                  </div>
                  <div>
                    <div style={miniStatLabelStyle}>Total Reps</div>
                    <div style={miniStatValueStyle}>{totalRepsDisplay}</div>
                  </div>
                  <div>
                    <div style={miniStatLabelStyle}>Remaining</div>
                    <div style={miniStatValueStyle}>{overallRemainingDisplay}</div>
                    {overallRemainingPercent ? <div style={statSubtleStyle}>{overallRemainingPercent} of goal</div> : null}
                  </div>
                </div>
                <ProgressBar value={totalRepsNumber ?? 0} max={repGoalNumber ?? 0} extraMarks={extraMarks} />
                <div style={legendRowStyle}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ width: 10, height: 10, borderRadius: 999, background: "#1d4ed8" }}></span>
                    25% markers
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ width: 10, height: 10, borderRadius: 999, background: "#16a34a" }}></span>
                    1/7 markers
                  </div>
                  {sprintGoalX ? (
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ width: 10, height: 10, borderRadius: 999, background: "#f59e0b" }}></span>
                      Sprint markers
                    </div>
                  ) : null}
                </div>
                <div style={miniStatGridStyle}>
                  {remainingMarkers.map(marker => {
                    const isHighlighted = highlightedMarkerId === marker.id;
                    const markerStyle = isHighlighted
                      ? { border: "1px solid #111827", borderRadius: 8, padding: "10px 12px" }
                      : undefined;
                    return (
                      <div key={marker.id} style={markerStyle}>
                        <div style={miniStatLabelStyle}>{marker.label}</div>
                        <div style={miniStatValueStyle}>{marker.value}</div>
                        {marker.sub ? <div style={statSubtleStyle}>{marker.sub}</div> : null}
                      </div>
                    );
                  })}
                </div>
                <div style={controlsRowStyle}>
                  <label style={controlLabelStyle}>
                    <span>Exercise</span>
                    <select
                      value={selectedExerciseId}
                      onChange={(e) => setSelectedExerciseId(e.target.value)}
                      disabled={exApi.loading}
                      style={controlSelectStyle}
                    >
                      <option value="">All</option>
                      {(exApi.data || []).map(e => (
                        <option key={e.id} value={String(e.id)}>{e.name}</option>
                      ))}
                    </select>
                  </label>
                  {perRepStd ? (
                    <span style={perRepNoteStyle}>
                      Using weight {exerciseWeight} (~{perRepStd.toFixed(3)} std-reps/rep)
                    </span>
                  ) : null}
                </div>
                <div style={statSubtleStyle}>{markerContextText}</div>
                <div style={{ marginTop: 12, padding: 12, border: "1px dashed #e5e7eb", borderRadius: 10, background: "#f9fafb" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                      <div>
                        <div style={{ fontWeight: 600, color: "#111827" }}>Next-set reps (linear trend)</div>
                        <div style={{ fontSize: 12, color: "#6b7280" }}>
                        Fits reps vs set index (linear regression), extrapolates to the next set, then rounds to an integer.
                        </div>
                      </div>
                  </div>
                  {predictingNextReps && (
                    <div style={{ marginTop: 8, fontSize: 12, color: "#6b7280" }}>Predicting…</div>
                  )}
                  {nextRepsPrediction ? (
                    <div style={{ marginTop: 8, display: "flex", gap: 12, flexWrap: "wrap", alignItems: "baseline" }}>
                      <div style={{ fontSize: 24, fontWeight: 700, color: "#111827" }}>
                        {formatExerciseReps(nextRepsPrediction.reps)} reps
                      </div>
                      <div style={{ fontSize: 12, color: "#6b7280" }}>
                        Set #{nextRepsPrediction.meta.setIndex}
                        {nextRepsPrediction.meta.repsPrev1 != null ? ` • Prev: ${formatExerciseReps(nextRepsPrediction.meta.repsPrev1)}` : ""}
                        {nextRepsPrediction.meta.repsPrev2 != null ? ` • Prev-2: ${formatExerciseReps(nextRepsPrediction.meta.repsPrev2)}` : ""}
                        {nextRepsPrediction.meta.restPrevSeconds != null ? ` • Rest: ${nextRepsPrediction.meta.restPrevSeconds}s` : ""}
                        {nextRepsPrediction.meta.weightPrev1 != null ? ` • Wt: ${nextRepsPrediction.meta.weightPrev1}` : ""}
                      </div>
                    </div>
                  ) : (
                    <div style={{ marginTop: 8, fontSize: 12, color: "#6b7280" }}>
                      {exerciseSetsChrono.length === 0
                        ? "Log at least one set to enable prediction."
                        : "Awaiting data…"}
                    </div>
                  )}
                  {nextRepsError && (
                    <div style={{ marginTop: 6, color: "#b91c1c", fontSize: 12 }}>
                      {String(nextRepsError.message || nextRepsError)}
                    </div>
                  )}
                </div>
              </div>

              <div style={panelCardStyle}>
                <h3 style={panelTitleStyle}>RPH Prediction</h3>
                <div style={miniStatGridStyle}>
                  <div>
                    <div style={miniStatLabelStyle}>Current</div>
                    <div style={miniStatValueStyle}>{currentRphDisplay}</div>
                  </div>
                  <div>
                    <div style={miniStatLabelStyle}>Goal (Max)</div>
                    <div style={miniStatValueStyle}>{rphGoalMaxDisplay}</div>
                  </div>
                  <div>
                    <div style={miniStatLabelStyle}>Goal (Avg)</div>
                    <div style={miniStatValueStyle}>{rphGoalAvgDisplay}</div>
                  </div>
                  <div>
                    <div style={miniStatLabelStyle}>Training Set</div>
                    <div style={miniStatValueStyle}>{trainingSetDisplay}</div>
                  </div>
                  <div>
                    <div style={miniStatLabelStyle}>Max Reps Goal</div>
                    <div style={miniStatValueStyle}>{rphMaxRepsGoalPredictionDisplay}</div>
                  </div>
                  <div>
                    <div style={miniStatLabelStyle}>Max Weight Goal</div>
                    <div style={miniStatValueStyle}>{rphMaxWeightGoalPredictionDisplay}</div>
                  </div>
                  <div>
                    <div style={miniStatLabelStyle}>Est. Time @ Max</div>
                    <div style={miniStatValueStyle}>{minutesAtMaxDisplay}</div>
                  </div>
                  <div>
                    <div style={miniStatLabelStyle}>Est. Time @ Avg</div>
                    <div style={miniStatValueStyle}>{minutesAtAvgDisplay}</div>
                  </div>
                </div>
              </div>
            </div>

            <div style={tablePanelStyle}>
              <div style={tableHeaderStyle}>
                <div style={headerLeftStyle}>
                  <h3 style={headerTitleStyle}>Sets</h3>
                  <span style={statSubtleStyle}>{setsSubtitle}</span>
                </div>
                <button type="button" style={btnStyle} onClick={openModal} disabled={exApi.loading}>Add set</button>
              </div>
              <div style={tableScrollStyle}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      <th style={tableHeadCellStyle}>Time</th>
                      <th style={tableHeadCellStyle}>Exercise</th>
                      <th style={tableHeadCellStyle}>Reps</th>
                      <th style={tableHeadCellStyle}>Weight</th>
                      <th style={tableHeadCellStyle}>Standard Reps</th>
                      <th style={tableHeadCellStyle}>Progress</th>
                      <th style={tableHeadCellStyle}>Rest</th>
                      <th style={tableHeadCellStyle}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedDetails.length ? (
                      sortedDetails.map((d, idx) => {
                        const stdReps =
                          data.routine?.hundred_points_weight && d.reps != null && d.weight != null
                            ? (d.reps * d.weight) / data.routine.hundred_points_weight
                            : null;
                        const pct =
                          repGoal && repGoal > 0 && stdReps != null
                            ? `${formatNumber((stdReps / repGoal) * 100, 1)}%`
                            : "\u2014";
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
                        const isSelected = selectedExerciseId && String(selectedExerciseId) === String(d.exercise_id);
                        return (
                          <tr key={d.id} style={isSelected ? { background: "#f9fafb" } : undefined}>
                            <td style={tableCellStyle}>{new Date(d.datetime).toLocaleString()}</td>
                            <td style={tableCellStyle}>{d.exercise || "\u2014"}</td>
                            <td style={tableCellStyle}>{formatRepsValue(d.reps)}</td>
                            <td style={tableCellStyle}>{d.weight ?? "\u2014"}</td>
                            <td style={tableCellStyle}>{stdReps != null ? formatRepsValue(stdReps) : "\u2014"}</td>
                            <td style={tableCellStyle}>{pct}</td>
                            <td style={tableCellStyle}>{restDisplay}</td>
                            <td style={{ ...tableCellStyle, whiteSpace: "nowrap" }}>
                              <div style={{ display: "flex", gap: 8 }}>
                                <button
                                  type="button"
                                  style={editBtnInline}
                                  onClick={() => openEdit(d)}
                                  title="Edit set"
                                  aria-label={`Edit set ${d.id}`}
                                >
                                  Edit
                                </button>
                                <button
                                  type="button"
                                  style={xBtnInline}
                                  onClick={() => deleteDetail(d.id)}
                                  disabled={deletingId === d.id}
                                  title="Delete set"
                                  aria-label={`Delete set ${d.id}`}
                                >
                                  {deletingId === d.id ? "Deleting..." : "Delete"}
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    ) : (
                      <tr>
                        <td style={{ ...tableCellStyle, fontStyle: "italic" }} colSpan={8}>No sets logged yet.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
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









