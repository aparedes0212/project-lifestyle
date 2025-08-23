export default function Row({ left, right, subtle }) {
  return (
    <div style={{
      display: "grid", gridTemplateColumns: "1fr auto", gap: 8, padding: "8px 0",
      borderTop: subtle ? "1px dashed #e5e7eb" : "1px solid #f3f4f6"
    }}>
      <div>{left}</div>
      <div style={{ opacity: 0.8 }}>{right}</div>
    </div>
  );
}
