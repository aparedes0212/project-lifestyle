import { useEffect, useMemo, useRef, useState } from "react";
import useApi from "../hooks/useApi";
import { API_BASE } from "../lib/config";
import Card from "./ui/Card";
import Modal from "./ui/Modal";
import { formatNumber } from "../lib/numberFormat";

const btnStyle = { border: "1px solid #e5e7eb", background: "#f9fafb", borderRadius: 8, padding: "6px 10px", cursor: "pointer" };

export default function StrengthQuickLogCard({ onLogged, ready = true }) {
  const { data: nextData, loading } = useApi(`${API_BASE}/api/strength/next/`, { deps: [ready], skip: !ready });
  const predictedRoutine = nextData?.next_routine ?? null;
  const routineList = nextData?.routine_list ?? [];
  const predictedGoal = nextData?.next_goal?.daily_volume ?? "";
  const predictedLevel = nextData?.next_goal?.progression_order ?? null;

  const [routineId, setRoutineId] = useState(null);
  const [repGoal, setRepGoal] = useState("");
  const [levels, setLevels] = useState([]); // list of progressions for routine
  const [level, setLevel] = useState(null); // selected progression_order (aka Level)
  const [goalData, setGoalData] = useState(null); // latest /strength/goal response
  const [levelInfo, setLevelInfo] = useState(null); // latest /strength/level response
  const [debugOpen, setDebugOpen] = useState(false);
  const [debugLogs, setDebugLogs] = useState([]);
  const [debugLoading, setDebugLoading] = useState(false);
  const [debugError, setDebugError] = useState(null);
  const debugCacheRef = useRef(new Map());
  const [submitting, setSubmitting] = useState(false);
  const [submitErr, setSubmitErr] = useState(null);

  // RPH prediction for selected routine + rep goal
  const [rphInfo, setRphInfo] = useState(null);
  useEffect(() => {
    let cancelled = false;
    const fetchRph = async () => {
      setRphInfo(null);
      if (!routineId) return;
      if (repGoal === "" || repGoal == null) return;
      try {
        const qs = new URLSearchParams({ routine_id: String(routineId), volume: String(repGoal) }).toString();
        const res = await fetch(`${API_BASE}/api/strength/rph-goal/?${qs}`);
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        const data = await res.json();
        if (!cancelled) setRphInfo(data);
      } catch (_) {
        if (!cancelled) setRphInfo(null);
      }
    };
    fetchRph();
    return () => { cancelled = true; };
  }, [routineId, repGoal]);

  useEffect(() => {
    if (predictedRoutine?.id) setRoutineId(predictedRoutine.id);
    if (predictedGoal !== "") setRepGoal(String(predictedGoal));
    if (predictedLevel != null) setLevel(Number(predictedLevel));
  }, [predictedRoutine?.id, predictedGoal, predictedLevel]);

  // When routine changes, fetch its next goal and update rep goal
  useEffect(() => {
    let ignore = false;
    const fetchGoal = async () => {
      if (!routineId) return;
      try {
        const res = await fetch(`${API_BASE}/api/strength/goal/?routine_id=${routineId}`);
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        const data = await res.json();
        if (!ignore) {
          setGoalData(data ?? null);
          const vol = data?.daily_volume;
          setRepGoal(vol !== undefined && vol !== null && vol !== "" ? String(vol) : "");
          const lev = data?.progression_order;
          setLevel(lev != null ? Number(lev) : null);
        }
      } catch (_) {
        if (!ignore) {
          setGoalData(null);
          setRepGoal("");
        }
      }
    };
    const fetchLevels = async () => {
      if (!routineId) return;
      try {
        const res = await fetch(`${API_BASE}/api/strength/progressions/?routine_id=${routineId}`);
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        const data = await res.json();
        if (!ignore) setLevels(Array.isArray(data) ? data : []);
      } catch (err) {
        if (!ignore) setLevels([]);
      }
    };
    if (!routineId && !ignore) {
      setGoalData(null);
      setLevels([]);
      setLevel(null);
      setLevelInfo(null);
    }
    fetchGoal();
    fetchLevels();
    return () => { ignore = true; };
  }, [routineId]);

  useEffect(() => {
    if (!routineId) {
      setDebugLogs([]);
      return;
    }
    const cached = debugCacheRef.current.get(Number(routineId));
    if (cached) {
      setDebugLogs(cached);
    }
  }, [routineId]);

  useEffect(() => {
    if (!debugOpen || !routineId) {
      return;
    }
    const routineKey = Number(routineId);
    if (debugCacheRef.current.has(routineKey)) {
      setDebugLogs(debugCacheRef.current.get(routineKey));
      setDebugLoading(false);
      setDebugError(null);
      return;
    }
    let ignore = false;
    setDebugLoading(true);
    setDebugError(null);
    const fetchLogs = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/strength/logs/?weeks=26`);
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        const data = await res.json();
        if (ignore) return;
        const list = Array.isArray(data) ? data : [];
        const filtered = list.filter((log) => {
          const rid = Number(log?.routine?.id);
          return Number.isFinite(rid) && rid === routineKey;
        });
        debugCacheRef.current.set(routineKey, filtered);
        setDebugLogs(filtered);
        setDebugLoading(false);
      } catch (err) {
        if (ignore) return;
        setDebugError(err);
        setDebugLogs([]);
        setDebugLoading(false);
      }
    };
    fetchLogs();
    return () => {
      ignore = true;
    };
  }, [debugOpen, routineId]);

  // When repGoal changes (manual), sync Level via API
  useEffect(() => {
    let ignore = false;
    const syncLevel = async () => {
      if (!routineId) {
        if (!ignore) setLevelInfo(null);
        return;
      }
      if (repGoal === "" || repGoal == null) {
        if (!ignore) {
          setLevel(null);
          setLevelInfo(null);
        }
        return;
      }
      try {
        const qs = new URLSearchParams({ routine_id: String(routineId), volume: String(repGoal) }).toString();
        const res = await fetch(`${API_BASE}/api/strength/level/?${qs}`);
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        const data = await res.json();
        if (!ignore) {
          setLevelInfo(data ?? null);
          setLevel(data?.progression_order != null ? Number(data.progression_order) : null);
        }
      } catch (_) {
        if (!ignore) {
          setLevel(null);
          setLevelInfo(null);
        }
      }
    };
    syncLevel();
    return () => { ignore = true; };
  }, [repGoal, routineId]);

  // When Level changes (from dropdown), update Rep Goal using loaded levels mapping
  useEffect(() => {
    if (level == null) return;
    if (!Array.isArray(levels) || levels.length === 0) return;
    const match = levels.find(p => Number(p.progression_order) === Number(level));
    if (!match || match.daily_volume == null) return;
    const volString = String(match.daily_volume);
    if (repGoal === volString) return;
    setRepGoal(volString);
  }, [level, levels]);

  const points = useMemo(() => {
    if (level == null) return null;
    return Math.round((Number(level) / 23) * 100);
  }, [level]);

  const debugSteps = useMemo(() => {
    const steps = [];
    const toNumber = (value) => {
      const num = Number(value);
      return Number.isFinite(num) ? num : null;
    };
    const approxEqual = (a, b) => {
      const na = toNumber(a);
      const nb = toNumber(b);
      if (na == null || nb == null) return false;
      return Math.abs(na - nb) < 0.0001;
    };
    const formatReps = (value) => {
      const num = toNumber(value);
      if (num == null) return "not available";
      const decimals = Number.isInteger(num) ? 0 : 2;
      return `${formatNumber(num, decimals)} reps`;
    };
    const formatCount = (value) => {
      const num = toNumber(value);
      if (num == null) return "n/a";
      const decimals = Number.isInteger(num) ? 0 : 2;
      return formatNumber(num, decimals);
    };
    const formatDate = (value) => {
      if (!value) return null;
      const date = value instanceof Date ? value : new Date(value);
      if (Number.isNaN(date.valueOf())) return null;
      return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
    };
    const rotationLabelText = (key, short = false) => {
      switch (key) {
        case "max_week":
          return short ? "max_week" : "max_week (week you hit the max)";
        case "max_week_minus_one":
          return short ? "max_week_minus_one" : "max_week_minus_one (middle week)";
        case "max_week_minus_two":
          return short ? "max_week_minus_two" : "max_week_minus_two (ramp-up week)";
        default:
          return short ? "rotation" : "rotation week";
      }
    };

    const safeRoutineId = routineId != null ? Number(routineId) : null;
    const selectedRoutine = safeRoutineId != null
      ? routineList.find((r) => Number(r.id) === safeRoutineId)
      : null;

    const predictedGoalNumber = toNumber(predictedGoal);
    const repGoalNumber = toNumber(repGoal);
    const goalVolumeNumber = toNumber(goalData?.daily_volume);

    const levelsList = Array.isArray(levels)
      ? [...levels].sort((a, b) => Number(a.progression_order) - Number(b.progression_order))
      : [];

    const levelMatch = level != null
      ? levelsList.find((p) => Number(p.progression_order) === Number(level))
      : null;

    const nearestIndex = (target, field = "current_max") => {
      if (target == null || levelsList.length === 0) return null;
      let bestIdx = null;
      let bestDistance = Number.POSITIVE_INFINITY;
      levelsList.forEach((prog, idx) => {
        const value = toNumber(prog?.[field]);
        if (value == null) return;
        const distance = Math.abs(value - target);
        if (
          bestIdx == null ||
          distance < bestDistance ||
          (Math.abs(distance - bestDistance) <= 1e-9 && idx < bestIdx)
        ) {
          bestIdx = idx;
          bestDistance = distance;
        }
      });
      return bestIdx;
    };

    const logs = Array.isArray(debugLogs) ? debugLogs : [];
    let maxLogRecord = null;
    logs.forEach((log) => {
      const maxVal = toNumber(log?.max_reps);
      if (maxVal == null) return;
      const existing = maxLogRecord;
      const logDate = new Date(log?.datetime_started ?? 0);
      if (
        !existing ||
        maxVal > existing.value ||
        (maxVal === existing.value && logDate > new Date(existing.log?.datetime_started ?? 0))
      ) {
        maxLogRecord = { log, value: maxVal };
      }
    });
    const maxLog = maxLogRecord?.log ?? null;
    const maxRepsSixMonth = maxLogRecord?.value ?? null;
    const maxLogDate = maxLog ? new Date(maxLog.datetime_started) : null;
    const maxLogDateStr = maxLogDate && !Number.isNaN(maxLogDate.valueOf())
      ? formatDate(maxLogDate)
      : null;

    const anchorIdx = nearestIndex(maxRepsSixMonth, "current_max");
    const fallbackIdx = anchorIdx != null ? anchorIdx : (levelsList.length > 0 ? 0 : null);
    const anchor = fallbackIdx != null ? levelsList[fallbackIdx] ?? null : null;
    const minusOne = fallbackIdx != null ? levelsList[Math.max(0, fallbackIdx - 1)] ?? anchor : anchor;
    const minusTwo = fallbackIdx != null ? levelsList[Math.max(0, fallbackIdx - 2)] ?? (levelsList[0] ?? anchor) : anchor;
    const rotationCycle = anchor ? [minusTwo ?? anchor, minusOne ?? anchor, anchor] : [];
    const rotationLabels = ["max_week_minus_two", "max_week_minus_one", "max_week"];
    const startOfDay = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());
    let dayDiff = null;
    let rotationSelection = anchor;
    let rotationLabel = anchor ? "max_week" : null;

    if (anchor && maxLogDate && !Number.isNaN(maxLogDate.valueOf())) {
      const todayStart = startOfDay(new Date());
      const anchorStart = startOfDay(maxLogDate);
      dayDiff = Math.floor((todayStart.getTime() - anchorStart.getTime()) / 86400000);
      if (dayDiff <= 0) {
        rotationSelection = anchor;
        rotationLabel = "max_week";
      } else {
        const cycleIndex = Math.max(0, Math.floor((dayDiff - 1) / 7));
        const idx = rotationCycle.length ? cycleIndex % rotationCycle.length : 0;
        rotationSelection = rotationCycle[idx] ?? anchor;
        rotationLabel = rotationLabels[idx] ?? "max_week";
      }
    } else if (!anchor) {
      rotationSelection = null;
      rotationLabel = null;
    }

    const rotationDailyVolume = toNumber(rotationSelection?.daily_volume);

    if (predictedRoutine || predictedGoalNumber != null || predictedLevel != null) {
      const parts = [];
      if (predictedRoutine) {
        parts.push(`Predicted routine: ${predictedRoutine.name ?? "(unnamed)"} (ID ${predictedRoutine.id ?? "?"}).`);
      }
      if (predictedGoalNumber != null) {
        parts.push(`Suggested daily volume: ${formatReps(predictedGoalNumber)}.`);
      }
      if (predictedLevel != null) {
        parts.push(`Suggested progression level: ${predictedLevel}.`);
      }
      if (parts.length > 0) {
        steps.push({
          title: "Prediction Defaults",
          detail: parts.join(" "),
        });
      }
    }

    if (selectedRoutine || goalData) {
      const parts = [];
      if (selectedRoutine) {
        parts.push(`Selected routine: ${selectedRoutine.name} (ID ${selectedRoutine.id}).`);
        if (predictedRoutine?.id && predictedRoutine.id !== selectedRoutine.id) {
          parts.push("This differs from the predicted routine.");
        }
      }
      if (goalData) {
        parts.push(`Fetched /api/strength/goal/?routine_id=${routineId}.`);
        if (goalVolumeNumber != null) {
          parts.push(`Returned daily volume: ${formatReps(goalVolumeNumber)}.`);
        }
        if (goalData?.progression_order != null) {
          parts.push(`Returned progression level: ${goalData.progression_order}.`);
        }
        if (goalData?.training_set != null) {
          parts.push(`Training set guidance: ${formatReps(goalData.training_set)}.`);
        }
        if (goalData?.current_max != null) {
          parts.push(`Current max noted: ${formatCount(goalData.current_max)}.`);
        }
      } else if (selectedRoutine) {
        parts.push("Waiting on routine goal lookup from the API.");
      }
      if (parts.length > 0) {
        steps.push({
          title: "Routine Goal Lookup",
          detail: parts.join(" "),
        });
      }
    }

    const historyParts = [];
    if (!routineId) {
      historyParts.push("Select a routine to inspect recent strength history.");
    } else if (debugLoading) {
      historyParts.push("Fetching up to 26 weeks of strength logs for this routine.");
    } else if (debugError) {
      historyParts.push(`Unable to load recent logs: ${debugError?.message ?? debugError}.`);
    } else if (maxLog && maxRepsSixMonth != null) {
      historyParts.push(`Highest max reps in the last six months: ${formatReps(maxRepsSixMonth)} on ${maxLogDateStr ?? "an unknown date"}.`);
      if (maxLog?.rep_goal != null) {
        historyParts.push(`Rep goal that day: ${formatReps(maxLog.rep_goal)}.`);
      }
      if (maxLog?.id != null) {
        historyParts.push(`Log ID ${maxLog.id}.`);
      }
    } else {
      historyParts.push("No logged max reps within the last six months; rotation falls back to the earliest progression.");
    }
    steps.push({
      title: "Six-Month Max Reps",
      detail: historyParts.join(" "),
    });

    const rotationParts = [];
    if (!levelsList.length) {
      rotationParts.push("Progression table not yet loaded for this routine.");
    } else if (!anchor) {
      rotationParts.push("Waiting on historical data to anchor the rotation schedule.");
    } else {
      rotationParts.push(`Anchor progression (closest to the recorded max) is Level ${anchor.progression_order}, current max ${formatCount(anchor.current_max)}, daily volume ${formatReps(anchor.daily_volume)}.`);
      if (minusTwo) {
        rotationParts.push(`${rotationLabelText("max_week_minus_two")} => Level ${minusTwo.progression_order} (${formatReps(minusTwo.daily_volume)} daily).`);
      }
      if (minusOne) {
        rotationParts.push(`${rotationLabelText("max_week_minus_one")} => Level ${minusOne.progression_order} (${formatReps(minusOne.daily_volume)} daily).`);
      }
      rotationParts.push(`${rotationLabelText("max_week")} => Level ${anchor.progression_order} (${formatReps(anchor.daily_volume)} daily).`);
      if (rotationSelection && rotationLabel) {
        const daysPhrase = dayDiff != null ? `${dayDiff} day${dayDiff === 1 ? "" : "s"} since that max` : "Rotation lookup complete";
        rotationParts.push(`${daysPhrase} puts today in ${rotationLabelText(rotationLabel)}, selecting Level ${rotationSelection.progression_order} (${formatReps(rotationSelection.daily_volume)}).`);
      }
      if (levelInfo) {
        rotationParts.push(`Latest /api/strength/level/ response: Level ${levelInfo?.progression_order ?? "n/a"} of ${levelInfo?.total_levels ?? "?"}.`);
      }
      if (levelMatch) {
        rotationParts.push(`Selected level ${levelMatch.progression_order} maps to ${formatReps(levelMatch.daily_volume)} daily and current max ${formatCount(levelMatch.current_max)}.`);
      } else if (level != null) {
        rotationParts.push(`Selected level ${level} was not found in the progression list.`);
      }
    }
    steps.push({
      title: "Rotation Alignment",
      detail: rotationParts.join(" "),
    });

    const finalParts = [];
    if (repGoalNumber == null) {
      finalParts.push("Rep goal is not set.");
    } else {
      finalParts.push(`Current rep goal value: ${formatReps(repGoalNumber)}.`);
      if (rotationDailyVolume != null && approxEqual(repGoalNumber, rotationDailyVolume)) {
        finalParts.push(`Matches the rotation pick (${rotationLabelText(rotationLabel, true)}).`);
      } else if (goalVolumeNumber != null && approxEqual(repGoalNumber, goalVolumeNumber)) {
        finalParts.push("Matches the routine's next progression daily volume.");
      } else if (levelMatch?.daily_volume != null && approxEqual(repGoalNumber, levelMatch.daily_volume)) {
        finalParts.push(`Matches the selected progression level ${levelMatch.progression_order}.`);
      } else if (predictedGoalNumber != null && approxEqual(repGoalNumber, predictedGoalNumber)) {
        finalParts.push("Matches the predicted default volume.");
      } else {
        finalParts.push("Differs from defaults; assumed to be manually entered.");
      }
    }
    steps.push({
      title: "Current Rep Goal",
      detail: finalParts.join(" "),
    });

    return steps;
  }, [
    debugError,
    debugLoading,
    debugLogs,
    goalData,
    level,
    levelInfo,
    levels,
    predictedGoal,
    predictedLevel,
    predictedRoutine,
    repGoal,
    routineId,
    routineList,
  ]);

  const submit = async (e) => {
    e.preventDefault();
    if (!routineId) return;
    setSubmitting(true);
    setSubmitErr(null);
    try {
      const payload = {
        datetime_started: new Date().toISOString(),
        routine_id: Number(routineId),
        rep_goal: repGoal === "" ? null : Number(repGoal),
      };
      const res = await fetch(`${API_BASE}/api/strength/log/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const created = await res.json();
      onLogged?.(created);
      if (predictedGoal !== "") setRepGoal(String(predictedGoal));
      if (predictedLevel != null) setLevel(Number(predictedLevel));
    } catch (err) {
      setSubmitErr(err);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <Card title="Quick Log (Strength)" action={null}>
      {loading && <div>Loading defaults…</div>}
      {!loading && (
        <form onSubmit={submit}>
          <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))" }}>
            <label>
              <div>Routine</div>
              <select
                value={routineId || ""}
                onChange={(e) => setRoutineId(e.target.value ? Number(e.target.value) : null)}
              >
                <option value="">{predictedRoutine ? `Default: ${predictedRoutine.name}` : "— pick —"}</option>
                {routineList.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <div>Level</div>
              <select
                value={level == null ? "" : String(level)}
                onChange={(e) => setLevel(e.target.value ? Number(e.target.value) : null)}
                disabled={!routineId || levels.length === 0}
              >
                <option value="">— pick —</option>
                {levels.map((p) => (
                  <option key={p.id ?? p.progression_order}
                          value={String(p.progression_order)}>
                    {`Level ${p.progression_order}`}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <div>Rep Goal</div>
              <input
                type="number"
                value={repGoal}
                onChange={(e) => setRepGoal(e.target.value)}
                placeholder={predictedGoal !== "" ? String(predictedGoal) : ""}
              />
            </label>
          </div>
          {rphInfo && (
            <div style={{ marginTop: 8, padding: 8, border: "1px solid #e5e7eb", borderRadius: 8, background: "#fff" }}>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>RPH Prediction</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 8, fontSize: 13 }}>
                <div>
                  <div style={{ color: "#6b7280" }}>Max Reps Goal Prediction</div>
                  <div>{rphInfo.max_reps_goal != null ? formatNumber(rphInfo.max_reps_goal, 2) : "\u2014"}</div>
                </div>
                <div>
                  <div style={{ color: "#6b7280" }}>Max Weight Goal Prediction</div>
                  <div>{rphInfo.max_weight_goal != null ? formatNumber(rphInfo.max_weight_goal, 2) : "\u2014"}</div>
                </div>
                <div>
                  <div style={{ color: "#6b7280" }}>Goal (Max)</div>
                  <div>{formatNumber(rphInfo.rph_goal, 1)} reps/hr</div>
                </div>
                <div>
                  <div style={{ color: "#6b7280" }}>Goal (Avg)</div>
                  <div>{formatNumber(rphInfo.rph_goal_avg ?? rphInfo.rph_goal, 1)} reps/hr</div>
                </div>
                <div>
                  <div style={{ color: "#6b7280" }}>Est. Time @ Max</div>
                  <div>{rphInfo.minutes_max != null ? `${rphInfo.minutes_max} min` : "\u2014"}</div>
                </div>
                <div>
                  <div style={{ color: "#6b7280" }}>Est. Time @ Avg</div>
                  <div>{rphInfo.minutes_avg != null ? `${rphInfo.minutes_avg} min` : "\u2014"}</div>
                </div>
              </div>
            </div>
          )}
          <div style={{ marginTop: 6, fontSize: 12, color: "#6b7280" }}>
            <span><strong>Points:</strong> {points == null ? "—" : points}</span>
          </div>
          <div style={{ marginTop: 8 }}>
            <button type="button" style={btnStyle} onClick={() => setDebugOpen(true)}>
              Debug Rep Goal
            </button>
          </div>
          <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 8 }}>
            <button type="submit" style={btnStyle} disabled={submitting || !routineId}>
              {submitting ? "Saving…" : "Save log"}
            </button>
            {submitErr && <span style={{ color: "#b91c1c" }}>Error: {String(submitErr.message || submitErr)}</span>}
          </div>
        </form>
      )}
    </Card>
    <Modal open={debugOpen}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div style={{ fontSize: 18, fontWeight: 600 }}>Rep Goal Debug</div>
        <button type="button" style={btnStyle} onClick={() => setDebugOpen(false)}>
          Close
        </button>
      </div>
      <div style={{ fontSize: 13, color: "#4b5563" }}>
        These steps trace how the current rep goal value is determined.
      </div>
      {debugLoading && (
        <div style={{ marginTop: 12, fontSize: 13, color: "#6b7280" }}>
          Loading recent strength history...
        </div>
      )}
      {debugError && (
        <div style={{ marginTop: 12, fontSize: 13, color: "#b91c1c" }}>
          Unable to load history: {String(debugError.message || debugError)}.
        </div>
      )}
      {debugSteps.length > 0 ? (
        <ol style={{ marginTop: 12, paddingLeft: 18, display: "grid", gap: 8 }}>
          {debugSteps.map((step, index) => (
            <li key={`${step.title}-${index}`} style={{ marginLeft: 4 }}>
              <div style={{ fontWeight: 600 }}>{step.title}</div>
              <div style={{ fontSize: 13, color: "#4b5563", marginTop: 2 }}>{step.detail}</div>
            </li>
          ))}
        </ol>
      ) : (
        <div style={{ marginTop: 12, fontSize: 13, color: "#6b7280" }}>
          Select a routine to see the breakdown for its rep goal.
        </div>
      )}
    </Modal>
  </>
);
}


