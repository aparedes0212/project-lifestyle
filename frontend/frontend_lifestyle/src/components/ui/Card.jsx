export default function Card({ title, action, children }) {
  const showHeader = Boolean(title || action);
  return (
    <div style={{
      background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12,
      padding: 16, boxShadow: "0 1px 2px rgba(0,0,0,0.04)", marginBottom: 16
    }}>
      {showHeader && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
          {title ? <h2 style={{ margin: 0, fontSize: 18 }}>{title}</h2> : <div />}
          {action}
        </div>
      )}
      {children}
    </div>
  );
}
