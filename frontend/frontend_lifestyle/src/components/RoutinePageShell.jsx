import { Link } from "react-router-dom";
import Card from "./ui/Card";

export const routineButtonStyle = {
  border: "1px solid #e5e7eb",
  background: "#f9fafb",
  borderRadius: 8,
  padding: "8px 14px",
  cursor: "pointer",
  textDecoration: "none",
  color: "inherit",
  display: "inline-block",
};

const sectionLabelStyle = {
  fontSize: 12,
  color: "#64748b",
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  fontWeight: 700,
};

const heroTitleStyle = {
  margin: 0,
  fontSize: 32,
  lineHeight: 1.1,
  color: "#0f172a",
};

const heroBodyStyle = {
  margin: 0,
  color: "#475569",
  lineHeight: 1.6,
  maxWidth: 720,
};

const activeNavStyle = {
  ...routineButtonStyle,
  background: "#0f172a",
  borderColor: "#0f172a",
  color: "#fff",
};

const inactiveNavStyle = {
  ...routineButtonStyle,
  background: "#fff",
};

const statGridStyle = {
  display: "grid",
  gap: 10,
  gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
};

const statCardStyle = {
  border: "1px solid #e5e7eb",
  borderRadius: 10,
  padding: 12,
  background: "#f8fafc",
};

const navLinks = [
  { label: "5K Prep", to: "/5k-prep" },
  { label: "Sprints", to: "/sprints" },
  { label: "Strength", to: "/strength" },
  { label: "Supplemental", to: "/supplemental" },
];

export function RoutinePageShell({ title, description, children }) {
  return (
    <div style={{ display: "grid", gap: 16 }}>
      <Card title={null} action={null}>
        <div style={{ display: "grid", gap: 14 }}>
          <div style={sectionLabelStyle}>Routine Page</div>
          <h2 style={heroTitleStyle}>{title}</h2>
          <p style={heroBodyStyle}>{description}</p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {navLinks.map((link) => (
              <Link
                key={link.to}
                to={link.to}
                style={link.label === title ? activeNavStyle : inactiveNavStyle}
              >
                {link.label}
              </Link>
            ))}
          </div>
        </div>
      </Card>
      {children}
    </div>
  );
}

export function RoutineSummaryCard({ title = "Next Up", action = null, loading, error, emptyMessage, stats = [], children }) {
  return (
    <Card title={title} action={action}>
      {loading && <div>Loading...</div>}
      {error && <div style={{ color: "#b91c1c" }}>Error: {String(error.message || error)}</div>}
      {!loading && !error && (
        <div style={{ display: "grid", gap: 12 }}>
          {stats.length > 0 && (
            <div style={statGridStyle}>
              {stats.map((item) => (
                <div key={item.label} style={statCardStyle}>
                  <div style={{ fontSize: 12, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                    {item.label}
                  </div>
                  <div style={{ fontSize: 18, fontWeight: 700, marginTop: 4, color: "#0f172a" }}>
                    {item.value ?? "--"}
                  </div>
                  {item.detail ? <div style={{ marginTop: 4, color: "#475569", fontSize: 13 }}>{item.detail}</div> : null}
                </div>
              ))}
            </div>
          )}
          {children}
          {!children && emptyMessage ? <div style={{ color: "#475569" }}>{emptyMessage}</div> : null}
        </div>
      )}
    </Card>
  );
}
