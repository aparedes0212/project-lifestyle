import { Link } from "react-router-dom";
import Card from "../components/ui/Card";
import useApi from "../hooks/useApi";
import { API_BASE } from "../lib/config";

const btnStyle = { border: "1px solid #e5e7eb", background: "#f9fafb", borderRadius: 8, padding: "8px 14px", cursor: "pointer" };

const capitalize = (value) => value ? value.charAt(0).toUpperCase() + value.slice(1) : "";
const joinTypes = (types) => {
  if (!Array.isArray(types) || types.length === 0) return "";
  if (types.length === 1) return capitalize(types[0]);
  if (types.length === 2) return `${capitalize(types[0])} and ${capitalize(types[1])}`;
  const head = types.slice(0, -1).map(capitalize).join(", ");
  return `${head}, and ${capitalize(types[types.length - 1])}`;
};

export default function HomePage() {
  const { data, loading, error, refetch } = useApi(`${API_BASE}/api/home/recommendation/`, { deps: [] });

  const rec = data?.recommendation;
  const recTypesRaw = Array.isArray(data?.recommendation_types) ? data.recommendation_types : [];
  const resolvedTypes = rec === "both"
    ? ["cardio", "strength"]
    : recTypesRaw.length > 0
      ? recTypesRaw
      : rec && !["rest", "tie"].includes(rec)
        ? rec.split("+")
        : [];

  const title = (() => {
    if (rec === "rest") return "Today's Pick: Rest";
    if (rec === "tie" || resolvedTypes.length === 0) return "Today's Pick: Tie";
    const pretty = resolvedTypes.map(capitalize);
    return pretty.length === 1
      ? `Today's Pick: ${pretty[0]}`
      : `Today's Pick: ${pretty.join(" + ")}`;
  })();

  const desc = (() => {
    if (rec === "rest") {
      return "You're ahead of plan; take a rest day or choose whatever feels best.";
    }
    if (rec === "tie" || resolvedTypes.length === 0) {
      return "You're even - pick whichever training block feels best today.";
    }
    if (rec === "both") {
      return "You still owe double-days and both are behind - stack Cardio and Strength today.";
    }
    if (resolvedTypes.length === 1) {
      const label = capitalize(resolvedTypes[0]);
      return `${label} has the larger gap this week (or the lower % complete on tie).`;
    }
    return `Multiple tracks are behind - stack ${resolvedTypes.map(capitalize).join(" + ")} today.`;
  })();

  const extraRequired = data?.multi_required_per_week ?? data?.double_required_per_week ?? 0;
  const extraCompleted = data?.multi_completed_last7 ?? data?.double_completed_last7 ?? 0;
  const extraRemaining = data?.multi_remaining ?? data?.double_remaining ?? 0;

  return (
    <>
      <Card
        title={title}
        action={(
          <button onClick={refetch} style={{ border: "1px solid #e5e7eb", background: "#f9fafb", borderRadius: 8, padding: "6px 10px", cursor: "pointer" }}>
            Refresh
          </button>
        )}
      >
        {loading && <div>Loading...</div>}
        {error && <div style={{ color: "#b91c1c" }}>Error: {String(error.message || error)}</div>}
        {!loading && !error && (
          <div>
            <div style={{ marginBottom: 8 }}>{desc}</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 8 }}>
              <div style={{ border: "1px solid #e5e7eb", borderRadius: 8, padding: 8 }}>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>Cardio</div>
                <div>Plan non-rest: {data?.cardio_plan_non_rest ?? "--"}</div>
                <div>Done (7d): {data?.cardio_done_last7 ?? "--"}</div>
                <div>Delta: {data?.delta_cardio ?? "--"}</div>
                <div>Pct done: {data?.pct_cardio != null ? Math.round(data.pct_cardio * 100) + "%" : "--"}</div>
              </div>
              <div style={{ border: "1px solid #e5e7eb", borderRadius: 8, padding: 8 }}>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>Strength</div>
                <div>Plan non-rest: {data?.strength_plan_non_rest ?? "--"}</div>
                <div>Done (7d): {data?.strength_done_last7 ?? "--"}</div>
                <div>Delta: {data?.delta_strength ?? "--"}</div>
                <div>Pct done: {data?.pct_strength != null ? Math.round(data.pct_strength * 100) + "%" : "--"}</div>
              </div>
              <div style={{ border: "1px solid #e5e7eb", borderRadius: 8, padding: 8 }}>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>Supplemental</div>
                <div>Plan non-rest: {data?.supplemental_plan_non_rest ?? "--"}</div>
                <div>Done (7d): {data?.supplemental_done_last7 ?? "--"}</div>
                <div>Delta: {data?.delta_supplemental ?? "--"}</div>
                <div>Pct done: {data?.pct_supplemental != null ? Math.round(data.pct_supplemental * 100) + "%" : "--"}</div>
              </div>
              <div style={{ border: "1px solid #e5e7eb", borderRadius: 8, padding: 8 }}>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>Extra Sessions</div>
                <div>Required/week: {extraRequired}</div>
                <div>Completed (7d): {extraCompleted}</div>
                <div>Remaining: {extraRemaining}</div>
                <div>Focus: {resolvedTypes.length > 1 ? joinTypes(resolvedTypes) : capitalize(resolvedTypes[0] ?? "--")}</div>
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
          <Link to="/supplemental" style={btnStyle}>Go to Supplemental</Link>
        </div>
      </Card>
    </>
  );
}


