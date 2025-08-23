export default function Pill({ children }) {
  return (
    <span style={{
      display: "inline-block", padding: "4px 8px", borderRadius: 999,
      background: "#f3f4f6", border: "1px solid #e5e7eb", fontSize: 12
    }}>
      {children}
    </span>
  );
}
