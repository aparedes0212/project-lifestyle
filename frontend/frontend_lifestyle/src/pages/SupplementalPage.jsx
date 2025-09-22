import { Link } from "react-router-dom";
import Card from "../components/ui/Card";
import SupplementalRecentLogsCard from "../components/SupplementalRecentLogsCard";

const btnStyle = {
  border: "1px solid #e5e7eb",
  background: "#f9fafb",
  borderRadius: 8,
  padding: "8px 14px",
  cursor: "pointer",
  textDecoration: "none",
  color: "inherit",
  display: "inline-block",
};

export default function SupplementalPage() {
  return (
    <div style={{ display: "grid", gap: 16 }}>
      <Card title="Supplemental Overview" action={null}>
        <p style={{ marginBottom: 8 }}>
          Supplemental work covers accessory or mobility sessions that support the primary cardio and strength plans.
          Track the extra volume here so weekly recommendations can balance across all three training modes.
        </p>
        <div>
          Need to focus on something else today?
          <Link to="/cardio" style={{ ...btnStyle, marginLeft: 8 }}>Go to Cardio</Link>
          <Link to="/strength" style={{ ...btnStyle, marginLeft: 8 }}>Go to Strength</Link>
        </div>
      </Card>

      <SupplementalRecentLogsCard />
    </div>
  );
}
