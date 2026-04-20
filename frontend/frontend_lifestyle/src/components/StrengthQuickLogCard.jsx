import { useEffect, useMemo, useState } from "react";
import useApi from "../hooks/useApi";
import { API_BASE } from "../lib/config";
import Card from "./ui/Card";
import Modal from "./ui/Modal";
import { formatNumber } from "../lib/numberFormat";

const btnStyle = {
  border: "1px solid #e5e7eb",
  background: "#f9fafb",
  borderRadius: 8,
  padding: "6px 10px",
  cursor: "pointer",
};

const statCardStyle = {
  border: "1px solid #e5e7eb",
  borderRadius: 8,
  padding: 10,
  background: "#fff",
  minHeight: 74,
};

function formatValue(value, precision = 2) {
  if (value === null || value === undefined) return "\u2014";
  const formatted = formatNumber(value, precision);
  return formatted !== "" ? formatted : "0";
}

export default function StrengthQuickLogCard({ onLogged, ready = true, title = "Quick Log (Strength)", headerContent = null }) {
  const { data: nextData, loading, refetch } = useApi(`${API_BASE}/api/strength/next/`, { deps: [ready], skip: !ready });
  const predictedRoutine = nextData?.next_routine ?? null;
  const routineList = nextData?.routine_list ?? [];
  const predictedGoal = nextData?.next_goal?.daily_volume ?? "";

  const [routineId, setRoutineId] = useState(null);
  const [repGoal, setRepGoal] = useState("");
  const [goalData, setGoalData] = useState(null);
  const [debugOpen, setDebugOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitErr, setSubmitErr] = useState(null);

  const [rphInfo, setRphInfo] = useState(null);

  useEffect(() => {
    if (predictedRoutine?.id) setRoutineId(predictedRoutine.id);
    if (predictedGoal !== "") setRepGoal(String(predictedGoal));
    if (nextData?.next_goal) setGoalData(nextData.next_goal);
  }, [predictedRoutine?.id, predictedGoal, nextData?.next_goal]);

  useEffect(() => {
    let ignore = false;

    const fetchGoal = async () => {
      if (!routineId) {
        if (!ignore) {
          setGoalData(null);
          setRepGoal("");
        }
        return;
      }
      try {
        const res = await fetch(`${API_BASE}/api/strength/goal/?routine_id=${routineId}`);
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        const data = await res.json();
        if (!ignore) {
          setGoalData(data ?? null);
          const volume = data?.daily_volume;
          setRepGoal(volume !== undefined && volume !== null && volume !== "" ? String(volume) : "");
        }
      } catch {
        if (!ignore) {
          setGoalData(null);
          setRepGoal("");
        }
      }
    };

    fetchGoal();
    return () => {
      ignore = true;
    };
  }, [routineId]);

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
      } catch {
        if (!cancelled) setRphInfo(null);
      }
    };

    fetchRph();
    return () => {
      cancelled = true;
    };
  }, [routineId, repGoal]);

  const summaryCards = useMemo(() => ([
    {
      id: "bucket",
      label: "Current Max Range",
      value: goalData?.bucket_label ? `${goalData.bucket_label} pull-ups` : "\u2014",
      sub: goalData?.standardized_max_reps != null ? `Best recent set ${formatValue(goalData.standardized_max_reps)} strict-pull-up equiv.` : null,
    },
    {
      id: "target-max",
      label: "Max Set Goal",
      value: goalData?.next_max_reps_goal != null ? formatValue(goalData.next_max_reps_goal) : "\u2014",
      sub: goalData?.bucket_entry_date ? `Bucket entered ${goalData.bucket_entry_date}` : null,
    },
    {
      id: "training-set",
      label: "Training Set",
      value: goalData?.training_set_reps != null ? formatValue(goalData.training_set_reps) : "\u2014",
      sub: goalData?.increment != null ? `Volume step +${formatValue(goalData.increment)}` : null,
    },
    {
      id: "bucket-progress",
      label: "At This Volume",
      value: goalData ? `${goalData.successful_sessions_at_current_volume ?? 0}/3` : "\u2014",
      sub: goalData?.completed_sessions_in_bucket != null ? `${goalData.completed_sessions_in_bucket} completed sessions in this bucket` : null,
    },
  ]), [goalData]);

  const debugLines = useMemo(() => {
    const lines = [];
    if (predictedRoutine?.name) {
      lines.push(`Predicted routine: ${predictedRoutine.name}.`);
    }
    if (goalData?.bucket_label) {
      lines.push(`Current bucket: ${goalData.bucket_label} strict pull-ups.`);
    }
    if (goalData?.standardized_max_reps != null) {
      lines.push(`Best standardized max in the last 6 months: ${formatValue(goalData.standardized_max_reps)}.`);
    } else {
      lines.push("No standardized pull-up max found in the last 6 months; using the first seeded bucket.");
    }
    if (goalData?.daily_volume != null) {
      lines.push(`Current daily volume target: ${formatValue(goalData.daily_volume)} reps.`);
    }
    if (goalData?.increment != null) {
      lines.push(`Each bucket step adds ${formatValue(goalData.increment)} reps after 3 successful sessions.`);
    }
    if (goalData?.successful_sessions_at_current_volume != null) {
      lines.push(`Current step progress: ${goalData.successful_sessions_at_current_volume}/3 successful sessions.`);
    }
    if (goalData?.next_max_reps_goal != null) {
      lines.push(`Current max-set goal: ${formatValue(goalData.next_max_reps_goal)} pull-ups.`);
    }
    return lines;
  }, [goalData, predictedRoutine?.name]);

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
      if (predictedRoutine?.id) setRoutineId(predictedRoutine.id);
      if (predictedGoal !== "") setRepGoal(String(predictedGoal));
      if (nextData?.next_goal) setGoalData(nextData.next_goal);
    } catch (err) {
      setSubmitErr(err);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <Card
        title={title}
        action={(
          <button type="button" style={btnStyle} onClick={refetch}>
            Refresh
          </button>
        )}
      >
        {loading && <div>Loading defaults...</div>}
        {!loading && (
          <form onSubmit={submit}>
            {headerContent ? <div style={{ marginBottom: 12 }}>{headerContent}</div> : null}
            <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))" }}>
              <label>
                <div>Routine</div>
                <select
                  value={routineId || ""}
                  onChange={(e) => setRoutineId(e.target.value ? Number(e.target.value) : null)}
                >
                  <option value="">{predictedRoutine ? `Default: ${predictedRoutine.name}` : "\u2014 pick \u2014"}</option>
                  {routineList.map((routine) => (
                    <option key={routine.id} value={routine.id}>
                      {routine.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <div>Rep Goal</div>
                <input
                  type="number"
                  step="0.01"
                  value={repGoal}
                  onChange={(e) => setRepGoal(e.target.value)}
                  placeholder={predictedGoal !== "" ? String(predictedGoal) : ""}
                />
              </label>
            </div>

            <div style={{ marginTop: 12, display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
              {summaryCards.map((card) => (
                <div key={card.id} style={statCardStyle}>
                  <div style={{ fontSize: 12, color: "#6b7280" }}>{card.label}</div>
                  <div style={{ fontSize: 18, fontWeight: 700, marginTop: 4 }}>{card.value}</div>
                  {card.sub ? <div style={{ fontSize: 12, color: "#6b7280", marginTop: 4 }}>{card.sub}</div> : null}
                </div>
              ))}
            </div>

            {rphInfo && (
              <div style={{ marginTop: 12, padding: 10, border: "1px solid #e5e7eb", borderRadius: 8, background: "#fff" }}>
                <div style={{ fontWeight: 600, marginBottom: 6 }}>RPH Prediction</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 8, fontSize: 13 }}>
                  <div>
                    <div style={{ color: "#6b7280" }}>Max Reps Goal Prediction</div>
                    <div>{rphInfo.max_reps_goal != null ? formatValue(rphInfo.max_reps_goal) : "\u2014"}</div>
                  </div>
                  <div>
                    <div style={{ color: "#6b7280" }}>Max Weight Goal Prediction</div>
                    <div>{rphInfo.max_weight_goal != null ? formatValue(rphInfo.max_weight_goal) : "\u2014"}</div>
                  </div>
                  <div>
                    <div style={{ color: "#6b7280" }}>Goal (Max)</div>
                    <div>{formatValue(rphInfo.rph_goal, 1)} reps/hr</div>
                  </div>
                  <div>
                    <div style={{ color: "#6b7280" }}>Goal (Avg)</div>
                    <div>{formatValue(rphInfo.rph_goal_avg ?? rphInfo.rph_goal, 1)} reps/hr</div>
                  </div>
                  <div>
                    <div style={{ color: "#6b7280" }}>Est. Time @ Max</div>
                    <div>{rphInfo.minutes_max != null ? `${formatValue(rphInfo.minutes_max)} min` : "\u2014"}</div>
                  </div>
                  <div>
                    <div style={{ color: "#6b7280" }}>Est. Time @ Avg</div>
                    <div>{rphInfo.minutes_avg != null ? `${formatValue(rphInfo.minutes_avg)} min` : "\u2014"}</div>
                  </div>
                </div>
              </div>
            )}

            <div style={{ marginTop: 8 }}>
              <button type="button" style={btnStyle} onClick={() => setDebugOpen(true)}>
                Debug Rep Goal
              </button>
            </div>

            <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 8 }}>
              <button type="submit" style={btnStyle} disabled={submitting || !routineId}>
                {submitting ? "Saving..." : "Save log"}
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
        <div style={{ display: "grid", gap: 8, fontSize: 13, color: "#374151" }}>
          {debugLines.map((line) => (
            <div key={line}>{line}</div>
          ))}
        </div>
      </Modal>
    </>
  );
}
