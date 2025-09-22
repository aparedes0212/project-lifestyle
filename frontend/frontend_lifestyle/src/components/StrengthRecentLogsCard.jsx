import { useState } from "react";
import { Link } from "react-router-dom";
import useApi from "../hooks/useApi";
import { API_BASE } from "../lib/config";
import Card from "./ui/Card";
import StrengthQuickLogCard from "./StrengthQuickLogCard";
import { formatNumber } from "../lib/numberFormat";

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

export default function StrengthRecentLogsCard() {
  const { data, loading, error, refetch, setData } = useApi(`${API_BASE}/api/strength/logs/?weeks=8`, { deps: [] });
  const rows = data || [];
  const [deletingId, setDeletingId] = useState(null);
  const [deleteErr, setDeleteErr] = useState(null);

  const formatRepsValue = (value) => {
    if (value === null || value === undefined) return "\u2014";
    const formatted = formatNumber(value, 2);
    return formatted !== "" ? formatted : "0";
  };

  const formatNumericValue = (value, precision = 2) => {
    if (value === null || value === undefined) return "\u2014";
    const formatted = formatNumber(value, precision);
    return formatted !== "" ? formatted : "0";
  };

  const prepend = (row) => setData(prev => [row, ...(prev || [])]);

  const handleDelete = async (id) => {
    if (!confirm("Delete this daily log and all its sets?")) return;
    setDeletingId(id);
    setDeleteErr(null);
    try {
      const res = await fetch(`${API_BASE}/api/strength/log/${id}/delete/`, { method: "DELETE" });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      setData(prev => (prev || []).filter(r => r.id !== id));
    } catch (e) {
      setDeleteErr(e);
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <>
      <StrengthQuickLogCard ready={!loading} onLogged={(created) => { prepend(created); refetch(); }} />

      <Card title="Recent Strength (8 weeks)" action={<button onClick={refetch} style={btnStyle}>Refresh</button>}>
        {loading && <div>Loading…</div>}
        {error && <div style={{ color: "#b91c1c" }}>Error: {String(error.message || error)}</div>}
        {deleteErr && <div style={{ color: "#b91c1c", marginBottom: 8 }}>Delete error: {String(deleteErr.message || deleteErr)}</div>}

        {!loading && !error && (
          <div style={{ marginInline: "calc(50% - 50vw)", background: "white" }}>
            <table style={{ width: "100vw", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ textAlign: "left", borderBottom: "1px solid #e5e7eb" }}>
                  <th style={{ padding: 6, width: 36 }} aria-label="Delete column"></th>
                  <th style={{ padding: 6 }}>Date</th>
                  <th style={{ padding: 6 }}>Routine</th>
                  <th style={{ padding: 6 }}>Rep Goal</th>
                  <th style={{ padding: 6 }}>Total Reps</th>
                  <th style={{ padding: 6 }}>Max Reps Goal</th>
                  <th style={{ padding: 6 }}>Max Reps</th>
                  <th style={{ padding: 6 }}>Max Weight</th>
                  <th style={{ padding: 6 }}>Minutes</th>
                  <th style={{ padding: 6 }}>RPH</th>
                  <th style={{ padding: 6 }}>RPH Goal</th>
                  <th style={{ padding: 6 }}>RPH Avg</th>
                  <th style={{ padding: 6 }}>Details</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const repGoalDisplay = formatRepsValue(r.rep_goal);
                  const totalRepsDisplay = formatRepsValue(r.total_reps_completed);
                  const maxRepsGoalDisplay = formatRepsValue(r.max_reps_goal);
                  const maxRepsDisplay = formatRepsValue(r.max_reps);
                  const maxWeightDisplay = formatNumericValue(r.max_weight, 2);
                  const minutesDisplay = formatNumericValue(r.minutes_elapsed, 2);
                  const dateDisplay = r.datetime_started ? new Date(r.datetime_started).toLocaleString() : "\u2014";
                  const routineName = r.routine?.name || "\u2014";
                  const rph = (() => {
                    const total = Number(r.total_reps_completed);
                    const mins = Number(r.minutes_elapsed);
                    if (!Number.isFinite(total) || !Number.isFinite(mins) || mins <= 0) return null;
                    return (total / (mins / 60));
                  })();

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
                      <td style={{ padding: 8 }}>{dateDisplay}</td>
                      <td style={{ padding: 8 }}>{routineName}</td>
                      <td style={{ padding: 8 }}>{repGoalDisplay}</td>
                      <td style={{ padding: 8 }}>{totalRepsDisplay}</td>
                      <td style={{ padding: 8 }}>{maxRepsGoalDisplay}</td>
                      <td style={{ padding: 8 }}>{maxRepsDisplay}</td>
                      <td style={{ padding: 8 }}>{maxWeightDisplay}</td>
                      <td style={{ padding: 8 }}>{minutesDisplay}</td>
                      <td style={{ padding: 8 }}>{rph != null ? formatNumericValue(rph, 1) : "\u2014"}</td>
                      <td style={{ padding: 8 }}>{r.rph_goal != null ? formatNumericValue(r.rph_goal, 1) : "\u2014"}</td>
                      <td style={{ padding: 8 }}>{r.rph_goal_avg != null ? formatNumericValue(r.rph_goal_avg, 1) : "\u2014"}</td>
                      <td style={{ padding: 8 }}>
                        <Link to={`/strength/logs/${r.id}`}>details</Link>
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
