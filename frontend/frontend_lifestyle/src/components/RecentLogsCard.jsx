import { useState } from "react";
import { Link } from "react-router-dom";
import useApi from "../hooks/useApi";
import { API_BASE } from "../lib/config";
import Card from "./ui/Card";
import QuickLogCard from "./QuickLogCard";

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
  const rows = data || [];
  const [deletingId, setDeletingId] = useState(null);
  const [deleteErr, setDeleteErr] = useState(null);
  const [bfLoading, setBfLoading] = useState(false);
  const [bfErr, setBfErr] = useState(null);
  const [bfMsg, setBfMsg] = useState("");

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

        {!loading && !error && (
          // full-bleed wrapper: stretch to the viewport edges inside a centered layout
          <div style={{ marginInline: "calc(50% - 50vw)" ,background:"white"}}>
            <table style={{ width: "100vw", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ textAlign: "left", borderBottom: "1px solid #e5e7eb" }}>
                  <th style={{ padding: 6, width: 36 }} aria-label="Delete column"></th>
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
                    <td style={{ padding: 8 }}>{r.workout?.routine?.name || "—"}</td>
                    <td style={{ padding: 8 }}>{r.workout?.name || "—"}</td>
                    <td style={{ padding: 8 }}>{r.goal ?? "—"}</td>
                    <td style={{ padding: 8 }}>{r.total_completed ?? "—"}</td>
                    <td style={{ padding: 8 }}>{r.max_mph ?? "—"}</td>
                    <td style={{ padding: 8 }}>{r.avg_mph ?? "—"}</td>
                    <td style={{ padding: 8 }}>{r.mph_goal ?? "—"}</td>
                    <td style={{ padding: 8 }}>{r.mph_goal_avg ?? "—"}</td>
                    <td style={{ padding: 8 }}>{r.minutes_elapsed ?? "—"}</td>
                    <td style={{ padding: 8 }}>
                      <Link to={`/logs/${r.id}`}>details</Link>
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
