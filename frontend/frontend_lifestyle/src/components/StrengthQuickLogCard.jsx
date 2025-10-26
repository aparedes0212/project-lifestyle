import { useEffect, useMemo, useState } from "react";
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

    const predictedGoalNumber = toNumber(predictedGoal);
    const repGoalNumber = toNumber(repGoal);
    const goalVolumeNumber = toNumber(goalData?.daily_volume);
    const selectedRoutine = routineId != null
      ? routineList.find((r) => Number(r.id) === Number(routineId))
      : null;
    const levelMatch = level != null && Array.isArray(levels)
      ? levels.find((p) => Number(p.progression_order) === Number(level))
      : null;

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
        if (goalData?.training_set) {
          parts.push(`Training set guidance: ${goalData.training_set}.`);
        }
        if (goalData?.current_max) {
          parts.push(`Current max noted: ${goalData.current_max}.`);
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

    if (levelInfo || levelMatch) {
      const parts = [];
      if (levelInfo) {
        parts.push(`Matched /api/strength/level/ response: progression order ${levelInfo?.progression_order ?? "n/a"} of ${levelInfo?.total_levels ?? "?"}.`);
      }
      if (levelMatch) {
        parts.push(`Level ${levelMatch.progression_order} sets daily volume to ${formatReps(levelMatch.daily_volume)}.`);
        if (levelMatch.training_set) {
          parts.push(`Training set: ${levelMatch.training_set}.`);
        }
        if (levelMatch.current_max) {
          parts.push(`Current max: ${levelMatch.current_max}.`);
        }
      } else if (level != null) {
        parts.push(`Selected level ${level}, but no progression data was returned for it.`);
      }
      if (parts.length > 0) {
        steps.push({
          title: "Level Mapping",
          detail: parts.join(" "),
        });
      }
    }

    const finalParts = [];
    if (repGoalNumber == null) {
      finalParts.push("Rep goal is not set.");
    } else {
      finalParts.push(`Current rep goal value: ${formatReps(repGoalNumber)}.`);
      if (goalVolumeNumber != null && approxEqual(repGoalNumber, goalVolumeNumber)) {
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
          Rep goal data is still loading. Select a routine or enter a value to see the breakdown.
        </div>
      )}
    </Modal>
  </>
);
}


