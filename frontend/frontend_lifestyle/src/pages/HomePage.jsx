import { Link } from "react-router-dom";
import Card from "../components/ui/Card";
import useApi from "../hooks/useApi";
import { API_BASE } from "../lib/config";

const btnStyle = { border: "1px solid #e5e7eb", background: "#f9fafb", borderRadius: 8, padding: "8px 14px", cursor: "pointer" };

export default function HomePage() {
  const { data, loading, error, refetch } = useApi(`${API_BASE}/api/home/recommendation/`, { deps: [] });
  const rec = data?.recommendation;
  const title = rec === "cardio" ? "Today’s Pick: Cardio"
    : rec === "strength" ? "Today’s Pick: Strength"
    : rec === "both" ? "Today’s Pick: Both"
    : "Today’s Pick: Tie";
  const desc = rec === "cardio"
    ? "Cardio has the larger gap this week (or lower % complete on tie)."
    : rec === "strength"
      ? "Strength has the larger gap this week (or lower % complete on tie)."
      : rec === "both"
        ? "You still owe double-days and both are behind — stack Cardio and Strength today."
        : "You’re even — pick either.";
  return (
    <>
      <Card title={title} action={<button onClick={refetch} style={{ border: "1px solid #e5e7eb", background: "#f9fafb", borderRadius: 8, padding: "6px 10px", cursor: "pointer" }}>Refresh</button>}>
        {loading && <div>Loading…</div>}
        {error && <div style={{ color: "#b91c1c" }}>Error: {String(error.message || error)}</div>}
        {!loading && !error && (
          <div>
            <div style={{ marginBottom: 8 }}>{desc}</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 8 }}>
              <div style={{ border: "1px solid #e5e7eb", borderRadius: 8, padding: 8 }}>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>Cardio</div>
                <div>Plan non-rest: {data?.cardio_plan_non_rest ?? "—"}</div>
                <div>Done (7d): {data?.cardio_done_last7 ?? "—"}</div>
                <div>Delta: {data?.delta_cardio ?? "—"}</div>
                <div>Pct done: {data?.pct_cardio != null ? Math.round(data.pct_cardio * 100) + "%" : "—"}</div>
              </div>
              <div style={{ border: "1px solid #e5e7eb", borderRadius: 8, padding: 8 }}>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>Strength</div>
                <div>Plan non-rest: {data?.strength_plan_non_rest ?? "—"}</div>
                <div>Done (7d): {data?.strength_done_last7 ?? "—"}</div>
                <div>Delta: {data?.delta_strength ?? "—"}</div>
                <div>Pct done: {data?.pct_strength != null ? Math.round(data.pct_strength * 100) + "%" : "—"}</div>
              </div>
              <div style={{ border: "1px solid #e5e7eb", borderRadius: 8, padding: 8 }}>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>Double-days</div>
                <div>Required/week: {data?.double_required_per_week ?? "—"}</div>
                <div>Completed (7d): {data?.double_completed_last7 ?? "—"}</div>
                <div>Remaining: {data?.double_remaining ?? "—"}</div>
              </div>
            </div>
            <div style={{ marginTop: 12, display: "flex", gap: 12 }}>
              <Link to="/cardio" style={{ border: "1px solid #e5e7eb", background: "#f9fafb", borderRadius: 8, padding: "8px 14px", cursor: "pointer", textDecoration: "none", color: "inherit" }}>Go to Cardio</Link>
              <Link to="/strength" style={{ border: "1px solid #e5e7eb", background: "#f9fafb", borderRadius: 8, padding: "8px 14px", cursor: "pointer", textDecoration: "none", color: "inherit" }}>Go to Strength</Link>
            </div>
          </div>
        )}
      </Card>
      <Card title="Welcome" action={null}>
        <div style={{ marginBottom: 12 }}>Choose a section to get started.</div>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <Link to="/cardio" style={btnStyle}>Go to Cardio</Link>
          <Link to="/strength" style={btnStyle}>Go to Strength</Link>
        </div>
      </Card>
    </>
  );
}
