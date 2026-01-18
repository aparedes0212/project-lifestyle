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
const stopwatchModalStyle = {
  maxWidth: 720,
  width: "min(720px, 95vw)",
  padding: 24,
};
const stopwatchBtnStyle = {
  ...btnStyle,
  fontSize: 15,
  padding: "10px 20px",
  minWidth: 140,
};

function toIsoLocal(date) {
  const d = date instanceof Date ? date : new Date(date);
  const tzOffset = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - tzOffset).toISOString().slice(0, 19);
}
function toIsoLocalNow() { return toIsoLocal(new Date()); }

function formatSecondsClock(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) return "--";
  const minutes = Math.floor(num / 60);
  const seconds = num - minutes * 60;
  const secStr = Number.isInteger(seconds)
    ? String(seconds).padStart(2, "0")
    : seconds.toFixed(2).padStart(5, "0");
  return `${String(minutes).padStart(2, "0")}:${secStr}`;
}

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

function formatElapsed(ms) {
  const totalSec = Math.max(0, ms / 1000);
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec - mins * 60;
  return `${String(mins).padStart(2, "0")}:${secs.toFixed(2).padStart(5, "0")}`;
}

export default function SupplementalLogDetailsPage() {
  const { id } = useParams();
  const logApi = useApi(`${API_BASE}/api/supplemental/log/${id}/`, { deps: [id] });
  const log = logApi.data;

  const routineId = log?.routine?.id;
  const workoutDesc = useMemo(() => {
    if (!log?.routine) return null;
    const ry = log?.rest_yellow_start_seconds ?? log?.rest_config?.yellow_start_seconds ?? 60;
    const rr = log?.rest_red_start_seconds ?? log?.rest_config?.red_start_seconds ?? 90;
    return {
      workout: { name: "3 Max Sets" },
      description: `Do three maximum effort sets. Rest ${ry}-${rr} seconds between each set. As soon as you stop (even for one second), that set is complete.`,
    };
  }, [log?.rest_red_start_seconds, log?.rest_yellow_start_seconds, log?.rest_config, log?.routine]);

  const isTime = (log?.routine?.unit || "").toLowerCase() === "time";
  const unitLabel = isTime ? "Seconds" : "Reps";

  const [newUnit, setNewUnit] = useState("");
  const [newMinutes, setNewMinutes] = useState("");
  const [newSeconds, setNewSeconds] = useState("");
  const [newWeight, setNewWeight] = useState("");
  const [newDatetime, setNewDatetime] = useState(toIsoLocalNow());
  const [newDatetimeTouched, setNewDatetimeTouched] = useState(false);
  const [err, setErr] = useState(null);
  const [saving, setSaving] = useState(false);

  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({ unit_count: "", minutes: "", seconds: "", datetime: "", weight: "" });

  const [startedAtInput, setStartedAtInput] = useState("");
  const [updatingStart, setUpdatingStart] = useState(false);
  const [updateStartErr, setUpdateStartErr] = useState(null);

  const [showStopwatch, setShowStopwatch] = useState(false);
  const [stopwatchRunning, setStopwatchRunning] = useState(false);
  const [stopwatchStartMs, setStopwatchStartMs] = useState(null);
  const [stopwatchElapsedMs, setStopwatchElapsedMs] = useState(0);
  const [stopwatchLastMarkMs, setStopwatchLastMarkMs] = useState(null);
  const [stopwatchLastLoggedElapsedMs, setStopwatchLastLoggedElapsedMs] = useState(0);

  const [restSeconds, setRestSeconds] = useState(0);

  const sortedDetails = useMemo(() => {
    if (!Array.isArray(log?.details)) return [];
    const arr = [...log.details];
    arr.sort((a, b) => new Date(b.datetime || 0) - new Date(a.datetime || 0));
    return arr;
  }, [log?.details]);
  const setTargets = useMemo(() => (Array.isArray(log?.set_targets) ? log.set_targets : []), [log?.set_targets]);
  const setsLogged = sortedDetails?.length ?? 0;
  const nextSetNumber = useMemo(() => Math.min(3, setsLogged + 1), [setsLogged]);
  const reachedMaxSets = setsLogged >= 3;
  const currentSetTarget = useMemo(
    () => setTargets.find((item) => Number(item?.set_number) === nextSetNumber) || null,
    [setTargets, nextSetNumber]
  );
  const stopwatchIntervalMs = useMemo(() => {
    if (!stopwatchRunning || !stopwatchStartMs) return stopwatchElapsedMs;
    const baseline = stopwatchLastMarkMs && stopwatchStartMs ? stopwatchLastMarkMs - stopwatchStartMs : 0;
    return Math.max(0, stopwatchElapsedMs - baseline);
  }, [stopwatchRunning, stopwatchStartMs, stopwatchLastMarkMs, stopwatchElapsedMs]);
  const remainingToGoalLabel = useMemo(() => {
    if (!isTime) return null;
    const goalSeconds = Number(currentSetTarget?.goal_unit);
    if (!Number.isFinite(goalSeconds) || goalSeconds <= 0) return null;
    const remainingMs = Math.max(0, goalSeconds * 1000 - stopwatchIntervalMs);
    return formatElapsed(remainingMs);
  }, [currentSetTarget?.goal_unit, isTime, stopwatchIntervalMs]);
  const restThresholds = useMemo(() => {
    const cfg = log?.rest_config || {};
    const yellow = cfg.yellow_start_seconds ?? log?.rest_yellow_start_seconds ?? 60;
    const red = cfg.red_start_seconds ?? log?.rest_red_start_seconds ?? 90;
    const critical = cfg.critical_start_seconds ?? red;
    return {
      yellow_start_seconds: yellow,
      red_start_seconds: red,
      critical_start_seconds: critical,
    };
  }, [log?.rest_config, log?.rest_red_start_seconds, log?.rest_yellow_start_seconds]);

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

  useEffect(() => {
    setStartedAtInput(log?.datetime_started ? toLocalInputValue(log.datetime_started) : "");
  }, [log?.datetime_started]);

  useEffect(() => {
    if (newDatetimeTouched) return;
    const nowMs = Date.now();
    const last = (sortedDetails || [])[0];
    if (last?.datetime) {
      const lastMs = new Date(last.datetime).getTime();
      if (Number.isFinite(lastMs) && nowMs - lastMs > 24 * 60 * 60 * 1000) {
        const candidate = lastMs + 60 * 1000; // 1 minute after the last log
        const chosen = Math.min(candidate, nowMs);
        setNewDatetime(toIsoLocal(new Date(chosen)));
        return;
      }
    }
    setNewDatetime(toIsoLocalNow());
  }, [sortedDetails, newDatetimeTouched]);

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

  const restDisplay = useMemo(() => {
    const mins = Math.floor(restSeconds / 60);
    const secs = restSeconds - mins * 60;
    return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }, [restSeconds]);
  const restColor = useMemo(
    () => deriveRestColor(restSeconds, restThresholds),
    [restSeconds, restThresholds]
  );
  const formatUnitDisplay = (value) => {
    if (value == null) return "--";
    return isTime ? formatSecondsClock(value) : formatNumber(value, log?.routine?.unit === "Reps" ? 0 : 2);
  };
  const formatSetLine = (unit, weight) => {
    const parts = [];
    const unitText = formatUnitDisplay(unit);
    if (unitText && unitText !== "--") parts.push(unitText);
    if (weight != null) {
      const w = formatNumber(weight, 2);
      if (w !== "") parts.push(`+${w} wt`);
    }
    return parts.length ? parts.join(" ") : "--";
  };
  const goalDisplay = useMemo(() => {
    if (log?.goal == null || log.goal === "") return "--";
    const numeric = Number(log.goal);
    if (Number.isFinite(numeric)) {
      if (isTime) return formatSecondsClock(numeric);
      const precision = log?.routine?.unit === "Reps" ? 0 : 2;
      const formatted = formatNumber(numeric, precision);
      return formatted !== "" ? formatted : String(log.goal);
    }
    return String(log.goal);
  }, [isTime, log?.goal, log?.routine?.unit]);

  const applyStopwatch = () => {
    const totalSec = Math.max(0, stopwatchElapsedMs / 1000);
    const mins = Math.floor(totalSec / 60);
    const secs = totalSec - mins * 60;
    setNewMinutes(String(mins));
    setNewSeconds(secs.toFixed(2));
    const nowLocal = toIsoLocalNow();
    setNewDatetime(nowLocal);
    setNewDatetimeTouched(true);
    setShowStopwatch(false);
    setStopwatchRunning(false);
    setStopwatchLastMarkMs(null);
    setStopwatchLastLoggedElapsedMs(0);
    // Auto-log using the captured time
    void handleAddFromStopwatch(totalSec, nowLocal, nextSetNumber);
  };

  const resetStopwatch = () => {
    setStopwatchRunning(false);
    setStopwatchStartMs(null);
    setStopwatchElapsedMs(0);
    setStopwatchLastMarkMs(null);
    setStopwatchLastLoggedElapsedMs(0);
  };

  const logIntervalKeepRunning = async () => {
    if (!stopwatchRunning || !stopwatchStartMs || saving) return;
    const nowMs = Date.now();
    const mark = stopwatchLastMarkMs || stopwatchStartMs;
    const intervalMs = nowMs - mark;
    if (intervalMs <= 0) return;
    const loggedElapsed = stopwatchElapsedMs;
    const ok = await handleAddFromStopwatch(intervalMs / 1000, toIsoLocalNow(), nextSetNumber);
    if (!ok) return;
    setStopwatchLastMarkMs(nowMs);
    setStopwatchLastLoggedElapsedMs(loggedElapsed);
  };

  const markNowWithoutLog = () => {
    if (!stopwatchRunning || !stopwatchStartMs) return;
    const baselineElapsed = stopwatchLastLoggedElapsedMs || stopwatchElapsedMs || 0;
    const nowMs = Date.now();
    // Reset lap baseline to now, and adjust the total timer so elapsed shows the last logged total.
    setStopwatchStartMs(nowMs - baselineElapsed);
    setStopwatchLastMarkMs(nowMs);
    setStopwatchElapsedMs(baselineElapsed);
  };

  const handleAddFromStopwatch = async (totalSeconds, datetimeLocal, setNumberOverride = null) => {
    if (!isTime) return false;
    const setNumber = setNumberOverride || nextSetNumber;
    if (setNumber > 3 || reachedMaxSets) {
      setErr(new Error("All 3 sets are already logged."));
      return false;
    }
    const unitVal = Number(totalSeconds);
    if (!Number.isFinite(unitVal) || unitVal <= 0) return false;
    setSaving(true);
    setErr(null);
    try {
      const dtPayload = toUtcISOString(datetimeLocal) || new Date().toISOString();
      const payload = { details: [{ datetime: dtPayload, unit_count: unitVal, set_number: setNumber }] };
      const res = await fetch(`${API_BASE}/api/supplemental/log/${id}/details/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`Add detail ${res.status}`);
      const data = await res.json();
      logApi.setData(data);
      setNewMinutes("");
      setNewSeconds("");
      setNewDatetime(toIsoLocalNow());
      setNewDatetimeTouched(false);
      return true;
    } catch (e) {
      setErr(e);
      return false;
    } finally {
      setSaving(false);
    }
  };

  const handleAdd = async (e) => {
    e.preventDefault();
    if (reachedMaxSets) {
      setErr(new Error("All 3 sets are already logged."));
      return;
    }
    const unitVal = isTime ? computeSeconds(newMinutes, newSeconds) : Number(newUnit);
    if (unitVal === null || unitVal <= 0) {
      setErr(new Error("Enter minutes/seconds or reps greater than 0."));
      return;
    }
    const weightValRaw = newWeight === "" ? null : Number(newWeight);
    if (newWeight !== "" && (weightValRaw === null || Number.isNaN(weightValRaw))) {
      setErr(new Error("Weight must be a valid number."));
      return;
    }
    // If user didn't change the datetime, default to "now" to avoid stale values
    const baseline = toIsoLocalNow().slice(0, 16);
    const current = (newDatetime || "").slice(0, 16);
    const dtLocal = current === baseline ? toIsoLocalNow() : newDatetime;

    setSaving(true);
    setErr(null);
    try {
      const dtPayload = toUtcISOString(dtLocal) || new Date().toISOString();
      const payload = { details: [{ datetime: dtPayload, unit_count: unitVal, set_number: nextSetNumber, weight: weightValRaw }] };
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
      setNewWeight("");
      setNewDatetime(toIsoLocalNow());
      setNewDatetimeTouched(false);
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
      weight: detail.weight ?? "",
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
      const weightVal = editForm.weight === "" ? null : Number(editForm.weight);
      if (editForm.weight !== "" && (weightVal === null || Number.isNaN(weightVal))) {
        throw new Error("Weight must be a number.");
      }
      const dtPayload = toUtcISOString(editForm.datetime);
      const res = await fetch(`${API_BASE}/api/supplemental/log/${id}/details/${detailId}/`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          unit_count: unitVal,
          datetime: dtPayload,
          weight: weightVal,
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

  const saveStart = async () => {
    setUpdatingStart(true);
    setUpdateStartErr(null);
    try {
      if (!startedAtInput) {
        throw new Error("Please pick a start time.");
      }
      const newStartDate = new Date(startedAtInput);
      const newStartMs = newStartDate.getTime();
      if (!Number.isFinite(newStartMs)) {
        throw new Error("Invalid start time.");
      }

      const detailsChrono = Array.isArray(log?.details)
        ? log.details
            .filter((d) => d?.datetime && Number.isFinite(new Date(d.datetime).getTime()))
            .sort((a, b) => new Date(a.datetime) - new Date(b.datetime))
        : [];
      const firstDetail = detailsChrono[0] || null;
      const firstDetailMs = firstDetail ? new Date(firstDetail.datetime).getTime() : null;
      const deltaMs = Number.isFinite(firstDetailMs) ? newStartMs - firstDetailMs : null;

      const logRes = await fetch(`${API_BASE}/api/supplemental/log/${id}/`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ datetime_started: newStartDate.toISOString() }),
      });
      if (!logRes.ok) {
        let msg = `${logRes.status} ${logRes.statusText}`;
        try {
          const errBody = await logRes.json();
          msg += `: ${JSON.stringify(errBody)}`;
        } catch (_) {
          // ignore parse failure
        }
        throw new Error(msg);
      } else {
        await logRes.json();
      }

      if (detailsChrono.length && deltaMs !== null && deltaMs !== 0) {
        for (const detail of detailsChrono) {
          const ts = new Date(detail.datetime).getTime();
          if (!Number.isFinite(ts)) continue;
          const shiftedIso = new Date(ts + deltaMs).toISOString();
          const res = await fetch(`${API_BASE}/api/supplemental/log/${id}/details/${detail.id}/`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ datetime: shiftedIso }),
          });
          if (!res.ok) {
            let msg = `Set ${detail.id}: ${res.status} ${res.statusText}`;
            try {
              const errBody = await res.json();
              msg += `: ${JSON.stringify(errBody)}`;
            } catch (_) {
              // ignore parse failure
            }
            throw new Error(msg);
          }
        }
      }

      await refresh();
    } catch (e) {
      setUpdateStartErr(e);
    } finally {
      setUpdatingStart(false);
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
            <div style={{ display: "grid", gap: 6 }}>
              <div style={{ fontWeight: 600, color: "#111827" }}>Started</div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <input
                  type="datetime-local"
                  value={startedAtInput}
                  onChange={(e) => setStartedAtInput(e.target.value)}
                />
                <button type="button" style={btnStyle} onClick={saveStart} disabled={updatingStart}>
                  {updatingStart ? "Saving..." : "Save start"}
                </button>
                <span style={{ fontSize: 12, color: "#6b7280" }}>
                  Saving shifts interval times so the first matches the start and gaps stay the same.
                </span>
              </div>
              {updateStartErr ? (
                <div style={{ color: "#b91c1c", fontSize: 12 }}>
                  Error: {String(updateStartErr.message || updateStartErr)}
                </div>
              ) : null}
            </div>
            <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
              <div style={{ border: "1px solid #e5e7eb", borderRadius: 10, padding: 10 }}>
                <div style={{ fontSize: 12, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.04em" }}>Routine</div>
                <div style={{ fontWeight: 700 }}>{log.routine?.name ?? "--"}</div>
              </div>
              <div style={{ border: "1px solid #e5e7eb", borderRadius: 10, padding: 10 }}>
                <div style={{ fontSize: 12, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.04em" }}>Workout</div>
                <div style={{ fontWeight: 700 }}>3 Max Sets</div>
              </div>
              <div style={{ border: "1px solid #e5e7eb", borderRadius: 10, padding: 10 }}>
                <div style={{ fontSize: 12, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.04em" }}>Rest Window</div>
                <div style={{ fontWeight: 700 }}>{restThresholds.yellow_start_seconds}-{restThresholds.red_start_seconds}s</div>
              </div>
              <div style={{ border: "1px solid #e5e7eb", borderRadius: 10, padding: 10 }}>
                <div style={{ fontSize: 12, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.04em" }}>Goal (Saved)</div>
                <div style={{ fontWeight: 700 }}>{goalDisplay}</div>
              </div>
              <div style={{ border: "1px solid #e5e7eb", borderRadius: 10, padding: 10 }}>
                <div style={{ fontSize: 12, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.04em" }}>Total Completed</div>
                <div style={{ fontWeight: 700 }}>
                  {log.total_completed != null ? formatNumber(log.total_completed, log.routine?.unit === "Reps" ? 0 : 2) : "--"}
                </div>
              </div>
              <div style={{ border: "1px solid #e5e7eb", borderRadius: 10, padding: 10 }}>
                <div style={{ fontSize: 12, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.04em" }}>Next Set</div>
                <div style={{ fontWeight: 700 }}>{Math.min(nextSetNumber, 3)} of 3</div>
              </div>
            </div>

            {workoutDesc?.description && (
              <div style={{ border: "1px solid #e5e7eb", borderRadius: 10, padding: 12, background: "#f8fafc" }}>
                <div style={{ fontWeight: 700, marginBottom: 6 }}>{workoutDesc.workout?.name}</div>
                <div style={{ fontSize: 14, lineHeight: 1.5, whiteSpace: "pre-line" }}>{workoutDesc.description}</div>
              </div>
            )}

            {setTargets.length > 0 && (
              <div style={{ border: "1px solid #e5e7eb", borderRadius: 10, padding: 12, background: "#f1f5f9" }}>
                <div style={{ fontWeight: 700, marginBottom: 6 }}>Set Goals</div>
                <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}>
                  {setTargets.map((item) => (
                    <div key={item.set_number} style={{ border: "1px solid #e5e7eb", borderRadius: 8, padding: 10, background: "white" }}>
                      <div style={{ fontWeight: 700, marginBottom: 4 }}>Set {item.set_number}</div>
                      <div style={{ color: "#6b7280" }}>Best: {formatSetLine(item.best_unit, item.best_weight)}</div>
                      <div>Next: {formatSetLine(item.goal_unit, item.goal_weight)}</div>
                      {item.using_weight && <div style={{ fontSize: 12, color: "#6b7280", marginTop: 4 }}>Progress with added weight</div>}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </Card>

      <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))" }}>
        <Card title="Add Interval" action={null}>
          <form onSubmit={handleAdd} style={{ display: "grid", gap: 10 }}>
            <div style={{ fontSize: 12, color: "#6b7280" }}>
              {reachedMaxSets ? "All 3 sets logged. Edit a set to update it." : `Logging set #${Math.min(nextSetNumber, 3)} of 3`}
            </div>
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
              <div>Weight (optional)</div>
              <input
                type="number"
                step="any"
                value={newWeight}
                onChange={(e) => setNewWeight(e.target.value)}
                placeholder="Add weight once you reach the max set time/reps"
              />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "space-between" }}>
                    <span>Datetime</span>
                    <button
                      type="button"
                      style={{ ...btnStyle, padding: "4px 8px", fontSize: 12 }}
                      onClick={() => { setNewDatetime(toIsoLocalNow()); setNewDatetimeTouched(true); }}
                    >
                      Set to now
                    </button>
                  </div>
                  <input
                    type="datetime-local"
                    value={newDatetime}
                    onChange={(e) => { setNewDatetime(e.target.value); setNewDatetimeTouched(true); }}
                  />
            </label>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <button
                type="submit"
                style={btnStyle}
                disabled={
                  saving ||
                  reachedMaxSets ||
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
          action={<div style={{ fontSize: 12, color: "#475569" }}>Green 0-{restThresholds.yellow_start_seconds}s / Yellow {restThresholds.yellow_start_seconds}-{restThresholds.red_start_seconds}s / Red {restThresholds.red_start_seconds}+s</div>}
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
                <div style={{ color: "#475569" }}>Yellow at {restThresholds.yellow_start_seconds}s / Red at {restThresholds.red_start_seconds}s+</div>
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
                  <th style={{ padding: 8 }}>Set #</th>
                  <th style={{ padding: 8 }}>Units ({unitLabel || "Units"})</th>
                  <th style={{ padding: 8 }}>Weight</th>
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
                      <td style={{ padding: 8 }}>{detail.set_number ?? "--"}</td>
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
                      <td style={{ padding: 8 }}>
                        {isEditing ? (
                          <input
                            type="number"
                            step="any"
                            value={editForm.weight}
                            onChange={(e) => setEditForm((prev) => ({ ...prev, weight: e.target.value }))}
                          />
                        ) : (
                          detail.weight != null ? formatNumber(detail.weight, 2) : "--"
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
        <Modal open contentStyle={stopwatchModalStyle}>
          <div style={{ display: "grid", gap: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ fontWeight: 600 }}>Stopwatch</div>
              <button style={stopwatchBtnStyle} onClick={() => { setShowStopwatch(false); resetStopwatch(); }}>Cancel</button>
            </div>
            <div style={{ fontSize: 32, textAlign: "center", fontVariantNumeric: "tabular-nums" }}>
              {formatElapsed(stopwatchElapsedMs)}
            </div>
            {currentSetTarget && (
              <div style={{ fontSize: 14, textAlign: "center", color: "#475569" }}>
                Set {nextSetNumber} goal: {formatSetLine(currentSetTarget.goal_unit, currentSetTarget.goal_weight)}
              </div>
            )}
            {remainingToGoalLabel && (
              <div style={{ fontSize: 12, textAlign: "center", color: "#64748b" }}>
                Remaining to goal: {remainingToGoalLabel}
              </div>
            )}
            <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
              {!stopwatchRunning && (
                <button
                  style={stopwatchBtnStyle}
                  onClick={() => {
                    const now = Date.now();
                    setStopwatchStartMs(now);
                    setStopwatchLastMarkMs(now);
                    setStopwatchElapsedMs(0);
                    setStopwatchLastLoggedElapsedMs(0);
                    setStopwatchRunning(true);
                  }}
                >
                  Start
                </button>
              )}
              {stopwatchRunning && (
                <button style={stopwatchBtnStyle} onClick={() => setStopwatchRunning(false)}>
                  Stop
                </button>
              )}
              {stopwatchRunning && stopwatchElapsedMs > 0 && (
                <button style={stopwatchBtnStyle} onClick={logIntervalKeepRunning} disabled={saving}>
                  Log interval (keep running)
                </button>
              )}
              {stopwatchRunning && (
                <button style={stopwatchBtnStyle} onClick={markNowWithoutLog}>
                  Set previous mark to now
                </button>
              )}
              <button style={stopwatchBtnStyle} onClick={() => { resetStopwatch(); }}>
                Reset
              </button>
              {!stopwatchRunning && stopwatchElapsedMs > 0 && (
                <button style={stopwatchBtnStyle} onClick={applyStopwatch}>
                  Use time (auto log)
                </button>
              )}
            </div>
            {stopwatchRunning && stopwatchElapsedMs > 0 && (
              <div style={{ fontSize: 12, color: "#6b7280", textAlign: "center" }}>
                Logs the time since the last interval:{" "}
                {formatElapsed(
                  Math.max(
                    0,
                    stopwatchElapsedMs -
                      (stopwatchLastMarkMs && stopwatchStartMs ? stopwatchLastMarkMs - stopwatchStartMs : 0)
                  )
                )}{" "}
                (stopwatch keeps running)
              </div>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
