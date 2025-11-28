import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import useApi from "../hooks/useApi";
import { API_BASE } from "../lib/config";
import Card from "./ui/Card";
import QuickLogCard from "./QuickLogCard";
import { formatNumber, formatWithStep } from "../lib/numberFormat";

const btnStyle = { border: "1px solid #e5e7eb", background: "#f9fafb", borderRadius: 8, padding: "6px 10px", cursor: "pointer" };
const xBtn = {
  border: "none",
  background: "transparent",
  color: "#b91c1c",
  cursor: "pointer",
  fontSize: 16,
  lineHeight: 1,
  padding: 4,
};

export default function RecentLogsCard() {
  const { data, loading, error, refetch, setData } = useApi(`${API_BASE}/api/cardio/logs/?weeks=8`, { deps: [] });
  const rows = useMemo(() => {
    const normalize = (value) => {
      const ts = value ? new Date(value).getTime() : NaN;
      return Number.isFinite(ts) ? ts : -Infinity;
    };
    return (data || [])
      .slice()
      .sort((a, b) => normalize(b?.datetime_started) - normalize(a?.datetime_started));
  }, [data]);
  const [deletingId, setDeletingId] = useState(null);
  const [deleteErr, setDeleteErr] = useState(null);
  const [bfLoading, setBfLoading] = useState(false);
  const [bfErr, setBfErr] = useState(null);
  const [bfMsg, setBfMsg] = useState("");
  const [ignoreUpdatingId, setIgnoreUpdatingId] = useState(null);
  const [ignoreErr, setIgnoreErr] = useState(null);

  const getUnitRoundStep = (unit) => {
    if (!unit) return 0;
    const num = Number(unit.mround_numerator);
    const den = Number(unit.mround_denominator || 1);
    if (!Number.isFinite(num) || !Number.isFinite(den) || den === 0) return 0;
    return num / den;
  };

  const formatNumberValue = (value, precision = 6) => {
    if (value === null || value === undefined) return "—";
    const formatted = formatNumber(value, precision);
    return formatted !== "" ? formatted : "0";
  };

  const formatValueWithStep = (value, step, precision = 6) => {
    if (value === null || value === undefined) return "—";
    const formatted = formatWithStep(value, step, precision);
    return formatted !== "" ? formatted : "0";
  };

  const prepend = (row) => setData(prev => [row, ...(prev || [])]);

  const handleDelete = async (id) => {
    if (!confirm("Delete this daily log and all its intervals?")) return;
    setDeletingId(id);
    setDeleteErr(null);
    try {
      const res = await fetch(`${API_BASE}/api/cardio/log/${id}/delete/`, { method: "DELETE" });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      // Optimistic remove
      setData(prev => (prev || []).filter(r => r.id !== id));
    } catch (e) {
      setDeleteErr(e);
    } finally {
      setDeletingId(null);
    }
  };

  const handleBackfillAll = async () => {
    if (!confirm("Backfill all missing Rest days across history?")) return;
    setBfLoading(true);
    setBfErr(null);
    setBfMsg("");
    try {
      const res = await fetch(`${API_BASE}/api/cardio/backfill/all/`, { method: "POST" });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const json = await res.json();
      setBfMsg(`Created ${json.created_count} Rest day log(s).`);
      await refetch();
    } catch (e) {
      setBfErr(e);
    } finally {
      setBfLoading(false);
    }
  };

  const handleToggleIgnore = async (id, nextValue) => {
    setIgnoreUpdatingId(id);
    setIgnoreErr(null);
    try {
      const res = await fetch(`${API_BASE}/api/cardio/log/${id}/`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ignore: nextValue }),
      });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const updated = await res.json();
      setData(prev => (prev || []).map(row => (row.id === id ? updated : row)));
    } catch (e) {
      setIgnoreErr(e);
    } finally {
      setIgnoreUpdatingId(null);
    }
  };

  return (
    <>
      <QuickLogCard ready={!loading} onLogged={(created) => { prepend(created); refetch(); }} />

      <Card
        title="Recent Cardio (8 weeks)"
        action={
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={refetch} style={btnStyle}>Refresh</button>
            <button onClick={handleBackfillAll} style={btnStyle} disabled={bfLoading}>{bfLoading ? "Backfilling…" : "Backfill Rest (All Gaps)"}</button>
          </div>
        }
      >
        {loading && <div>Loading…</div>}
        {error && <div style={{ color: "#b91c1c" }}>Error: {String(error.message || error)}</div>}
        {bfErr && <div style={{ color: "#b91c1c", marginBottom: 8 }}>Backfill error: {String(bfErr.message || bfErr)}</div>}
        {bfMsg && <div style={{ color: "#065f46", marginBottom: 8 }}>{bfMsg}</div>}
        {deleteErr && <div style={{ color: "#b91c1c", marginBottom: 8 }}>Delete error: {String(deleteErr.message || deleteErr)}</div>}
        {ignoreErr && <div style={{ color: "#b91c1c", marginBottom: 8 }}>Ignore toggle error: {String(ignoreErr.message || ignoreErr)}</div>}

        {!loading && !error && (
          // full-bleed wrapper: stretch to the viewport edges inside a centered layout
          <div style={{ marginInline: "calc(50% - 50vw)" ,background:"white"}}>
            <table style={{ width: "100vw", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ textAlign: "left", borderBottom: "1px solid #e5e7eb" }}>
                  <th style={{ padding: 6, width: 36 }} aria-label="Delete column"></th>
                  <th style={{ padding: 6 }}>Ignore</th>
                  <th style={{ padding: 6 }}>Date</th>
                 <th style={{ padding: 6 }}>Routine</th>
                 <th style={{ padding: 6 }}>Workout</th>
                  <th style={{ padding: 6 }}>Goal</th>
                 <th style={{ padding: 6 }}>Total Completed</th>
                  <th style={{ padding: 6 }}>Max MPH</th>
                  <th style={{ padding: 6 }}>Avg MPH</th>
                  <th style={{ padding: 6 }}>MPH Goal (Max)</th>
                  <th style={{ padding: 6 }}>MPH Goal (Avg)</th>
                  <th style={{ padding: 6 }}>Minutes Elapsed</th>
                  <th style={{ padding: 6 }}>Details</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const unitStep = getUnitRoundStep(r.workout?.unit);
                  const goalDisplay = typeof r.goal === "number"
                    ? formatValueWithStep(r.goal, unitStep)
                    : (r.goal ?? "—");
                  const totalDisplay = formatValueWithStep(r.total_completed, unitStep);
                  const maxMphDisplay = formatNumberValue(r.max_mph, 3);
                  const avgMphDisplay = formatNumberValue(r.avg_mph, 3);
                  const mphGoalDisplay = formatNumberValue(r.mph_goal, 3);
                  const mphGoalAvgDisplay = formatNumberValue(r.mph_goal_avg, 3);
                  const minutesDisplay = formatNumberValue(r.minutes_elapsed, 4);
                  return (
                    <tr key={r.id} style={{ borderTop: "1px solid #f3f4f6" }}>
                      <td style={{ padding: 6, verticalAlign: "top" }}>
                        <button
                          type="button"
                          style={xBtn}
                          aria-label={`Delete log ${r.id}`}
                          title="Delete log"
                          onClick={() => handleDelete(r.id)}
                          disabled={deletingId === r.id}
                        >
                          {deletingId === r.id ? "…" : "✕"}
                        </button>
                      </td>
                      <td style={{ padding: 8 }}>
                        <input
                          type="checkbox"
                          checked={!!r.ignore}
                          onChange={(e) => handleToggleIgnore(r.id, e.target.checked)}
                          disabled={ignoreUpdatingId === r.id}
                          aria-label={`Ignore log ${r.id}`}
                        />
                      </td>
                      <td style={{ padding: 8 }}>{new Date(r.datetime_started).toLocaleString()}</td>
                      <td style={{ padding: 8 }}>{r.workout?.routine?.name || "—"}</td>
                      <td style={{ padding: 8 }}>{r.workout?.name || "—"}</td>
                      <td style={{ padding: 8 }}>{goalDisplay}</td>
                      <td style={{ padding: 8 }}>{totalDisplay}</td>
                      <td style={{ padding: 8 }}>{maxMphDisplay}</td>
                      <td style={{ padding: 8 }}>{avgMphDisplay}</td>
                      <td style={{ padding: 8 }}>{mphGoalDisplay}</td>
                      <td style={{ padding: 8 }}>{mphGoalAvgDisplay}</td>
                      <td style={{ padding: 8 }}>{minutesDisplay}</td>
                      <td style={{ padding: 8 }}>
                        <Link to={`/logs/${r.id}`}>details</Link>
                      </td>
                    </tr>
                  );
                })}

              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
