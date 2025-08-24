import { useState } from "react";
import { Link } from "react-router-dom";
import useApi from "../hooks/useApi";
import { API_BASE } from "../lib/config";
import Card from "./ui/Card";
import StrengthQuickLogCard from "./StrengthQuickLogCard";

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
      <StrengthQuickLogCard onLogged={(created) => { prepend(created); refetch(); }} />

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
                  <th style={{ padding: 6 }}>Max Reps</th>
                  <th style={{ padding: 6 }}>Max Weight</th>
                  <th style={{ padding: 6 }}>Minutes</th>
                  <th style={{ padding: 6 }}>Details</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
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
                    <td style={{ padding: 8 }}>{new Date(r.datetime_started).toLocaleString()}</td>
                    <td style={{ padding: 8 }}>{r.routine?.name || "—"}</td>
                    <td style={{ padding: 8 }}>{r.rep_goal ?? "—"}</td>
                    <td style={{ padding: 8 }}>{r.total_reps_completed ?? "—"}</td>
                    <td style={{ padding: 8 }}>{r.max_reps ?? "—"}</td>
                    <td style={{ padding: 8 }}>{r.max_weight ?? "—"}</td>
                    <td style={{ padding: 8 }}>{r.minutes_elapsed ?? "—"}</td>
                    <td style={{ padding: 8 }}>
                      <Link to={`/strength/logs/${r.id}`}>details</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
