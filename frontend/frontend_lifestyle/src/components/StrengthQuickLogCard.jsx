import { useEffect, useMemo, useState } from "react";
import useApi from "../hooks/useApi";
import { API_BASE } from "../lib/config";
import Card from "./ui/Card";

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
  const [submitting, setSubmitting] = useState(false);
  const [submitErr, setSubmitErr] = useState(null);

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
          const vol = data?.daily_volume;
          setRepGoal(vol !== undefined && vol !== null && vol !== "" ? String(vol) : "");
          const lev = data?.progression_order;
          setLevel(lev != null ? Number(lev) : null);
        }
      } catch (_) {
        if (!ignore) setRepGoal("");
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
    fetchGoal();
    fetchLevels();
    return () => { ignore = true; };
  }, [routineId]);

  // When repGoal changes (manual), sync Level via API
  useEffect(() => {
    let ignore = false;
    const syncLevel = async () => {
      if (!routineId) return;
      if (repGoal === "" || repGoal == null) { setLevel(null); return; }
      try {
        const qs = new URLSearchParams({ routine_id: String(routineId), volume: String(repGoal) }).toString();
        const res = await fetch(`${API_BASE}/api/strength/level/?${qs}`);
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        const data = await res.json();
        if (!ignore) setLevel(data?.progression_order != null ? Number(data.progression_order) : null);
      } catch (_) {
        if (!ignore) setLevel(null);
      }
    };
    syncLevel();
    return () => { ignore = true; };
  }, [repGoal, routineId]);

  // When Level changes (from dropdown), update Rep Goal using loaded levels mapping
  useEffect(() => {
    if (level == null) return;
    const match = (levels || []).find(p => Number(p.progression_order) === Number(level));
    if (match && match.daily_volume != null) {
      setRepGoal(String(match.daily_volume));
    }
  }, [level]);

  const points = useMemo(() => {
    if (level == null) return null;
    return Math.round((Number(level) / 23) * 100);
  }, [level]);

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
          <div style={{ marginTop: 6, fontSize: 12, color: "#6b7280" }}>
            <span><strong>Points:</strong> {points == null ? "—" : points}</span>
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
  );
}

