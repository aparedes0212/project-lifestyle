import { useParams } from "react-router-dom";
import useApi from "../hooks/useApi";
import { API_BASE } from "../lib/config";
import Card from "../components/ui/Card";

const btnStyle = { border: "1px solid #e5e7eb", background: "#f9fafb", borderRadius: 8, padding: "6px 10px", cursor: "pointer" };

export default function StrengthLogDetailsPage() {
  const { id } = useParams();
  const { data, loading, error, refetch } = useApi(`${API_BASE}/api/strength/log/${id}/`, { deps: [id] });

  return (
    <Card title={`Strength Log ${id}`} action={<button onClick={refetch} style={btnStyle}>Refresh</button>}>
      {loading && <div>Loading…</div>}
      {error && <div style={{ color: "#b91c1c" }}>Error: {String(error.message || error)}</div>}
      {!loading && !error && data && (
        <>
          <div style={{ marginBottom: 12 }}>
            <div><strong>Started:</strong> {new Date(data.datetime_started).toLocaleString()}</div>
            <div><strong>Routine:</strong> {data.routine?.name || "—"}</div>
            <div><strong>Rep goal:</strong> {data.rep_goal ?? "—"}</div>
            <div><strong>Total reps:</strong> {data.total_reps_completed ?? "—"}</div>
            <div><strong>Max reps:</strong> {data.max_reps ?? "—"}</div>
            <div><strong>Max weight:</strong> {data.max_weight ?? "—"}</div>
            <div><strong>Minutes:</strong> {data.minutes_elapsed ?? "—"}</div>
          </div>
          <table style={{ borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid #e5e7eb" }}>
                <th style={{ padding: 6 }}>Time</th>
                <th style={{ padding: 6 }}>Exercise</th>
                <th style={{ padding: 6 }}>Reps</th>
                <th style={{ padding: 6 }}>Weight</th>
              </tr>
            </thead>
            <tbody>
              {(data.details || []).map(d => (
                <tr key={d.id} style={{ borderTop: "1px solid #f3f4f6" }}>
                  <td style={{ padding: 8 }}>{new Date(d.datetime).toLocaleString()}</td>
                  <td style={{ padding: 8 }}>{d.exercise || "—"}</td>
                  <td style={{ padding: 8 }}>{d.reps ?? "—"}</td>
                  <td style={{ padding: 8 }}>{d.weight ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </Card>
  );
}
