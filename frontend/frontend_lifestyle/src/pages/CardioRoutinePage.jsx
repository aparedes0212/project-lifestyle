import { Link } from "react-router-dom";
import Card from "../components/ui/Card";
import RecentLogsCard from "../components/RecentLogsCard";

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

export default function CardioRoutinePage({ routineName, description }) {
  return (
    <div style={{ display: "grid", gap: 16 }}>
      <Card title={routineName} action={null}>
        <p style={{ marginBottom: 8 }}>{description}</p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {routineName !== "5K Prep" && <Link to="/5k-prep" style={btnStyle}>Go to 5K Prep</Link>}
          {routineName !== "Sprints" && <Link to="/sprints" style={btnStyle}>Go to Sprints</Link>}
          <Link to="/strength" style={btnStyle}>Go to Strength</Link>
          <Link to="/supplemental" style={btnStyle}>Go to Supplemental</Link>
        </div>
      </Card>

      <RecentLogsCard
        routineName={routineName}
        title={`Recent ${routineName} (8 weeks)`}
      />
    </div>
  );
}
