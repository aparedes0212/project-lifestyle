import Modal from "./ui/Modal";

const closeBtnStyle = { border: "none", background: "transparent", color: "#2563eb", cursor: "pointer", fontSize: 16, padding: 0, fontWeight: 600 };
const cardStyle = { display: "flex", justifyContent: "space-between", gap: 22, padding: "14px 18px", border: "1px solid #e5e7eb", borderRadius: 10 };
const labelStyle = { color: "#6b7280" };

function n(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function fmtMph(value) {
  const num = n(value);
  if (num == null || num <= 0) return "-";
  return `${num.toFixed(1)} mph`;
}

function fmtMiles(value) {
  const num = n(value);
  if (num == null || num < 0) return "-";
  return `${num.toFixed(2)} mi`;
}

function fmtMinutes(value) {
  const num = n(value);
  if (num == null || num < 0) return "-";
  const totalSeconds = Math.round(num * 60);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

function goalMetricLabel(unit) {
  return String(unit || "").toLowerCase() === "minutes" ? "Goal Time" : "Goal Distance";
}

function renderMetricLine(item) {
  const mph = fmtMph(item?.target_mph);
  const distance = fmtMiles(item?.target_distance);
  const minutes = fmtMinutes(item?.target_minutes);
  return `${mph} | ${distance} | ${minutes}`;
}

function normalizeCompletedSegments(state) {
  const segments = Array.isArray(state?.alreadyComplete?.segments) ? state.alreadyComplete.segments : [];
  return segments.map((segment, index) => ({
    key: `done-seg-${index}`,
    label: segment?.label ?? `Completed ${index + 1}`,
    metrics: renderMetricLine(segment),
    notes: segment?.notes || "",
  }));
}

function normalizeRecommendationRows(state) {
  const recommendations = Array.isArray(state?.recommendations) ? state.recommendations : [];
  return recommendations.map((item, index) => ({
    key: `rec-${index}`,
    label: item?.label ?? `Step ${index + 1}`,
    metrics: renderMetricLine(item),
    notes: item?.notes || "",
    intensity: item?.intensity || "",
  }));
}

export default function CardioDistributionModal({ open, state, onClose }) {
  const completedRows = normalizeCompletedSegments(state);
  const recommendationRows = normalizeRecommendationRows(state);

  const progression = state?.progression || null;
  const targets = state?.targets || null;
  const alreadyComplete = state?.alreadyComplete || null;
  const targetLabel = goalMetricLabel(progression?.unit);

  return (
    <Modal open={open} contentStyle={{ maxWidth: 1200, width: "92vw", maxHeight: "94vh" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
        <div style={{ fontWeight: 700, fontSize: 28 }}>{state?.title || "Distribution"}</div>
        <button type="button" style={closeBtnStyle} onClick={onClose}>Close</button>
      </div>

      {state?.description && (
        <div style={{ marginBottom: 14, fontSize: 17, color: "#374151" }}>{state.description}</div>
      )}

      {Array.isArray(state?.meta) && state.meta.length > 0 && (
        <div style={{ fontSize: 16, marginBottom: 14, color: "#4b5563" }}>
          {state.meta.join(" | ")}
        </div>
      )}

      {(progression || targets || alreadyComplete) && (
        <div style={{ marginBottom: 16, padding: "12px 14px", border: "1px solid #e5e7eb", borderRadius: 10, fontSize: 16, color: "#374151", display: "grid", gap: 8 }}>
          {progression && (
            <div>
              Progression: {n(progression.total) != null ? Number(progression.total).toFixed(2) : "-"} {progression.unit || ""} | Remaining: {n(progression.remaining) != null ? Number(progression.remaining).toFixed(2) : "-"} {progression.unit || ""}
            </div>
          )}
          {targets && (
            <div>
              Avg: {fmtMph(targets.avg_mph_goal)} | Max: {fmtMph(targets.max_mph_goal)} | {targetLabel}: {n(targets.goal_distance) != null ? Number(targets.goal_distance).toFixed(2) : "-"} {progression?.unit || ""}
            </div>
          )}
          {alreadyComplete && (
            <div>
              Completed: {n(alreadyComplete.completed_progression) != null ? Number(alreadyComplete.completed_progression).toFixed(2) : "-"} {progression?.unit || ""} | Max Done: {alreadyComplete.max_goal_done ? "Yes" : "No"}
            </div>
          )}
        </div>
      )}

      {state?.error ? (
        <div style={{ color: "#b91c1c", fontSize: 16 }}>{state.error}</div>
      ) : (
        <>
          {completedRows.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontWeight: 600, marginBottom: 10, fontSize: 18 }}>Completed</div>
              <div style={{ display: "grid", rowGap: 8, fontSize: 16 }}>
                {completedRows.map((row) => (
                  <div key={row.key} style={cardStyle}>
                    <span style={labelStyle}>{row.label}</span>
                    <div style={{ textAlign: "right" }}>
                      <div>{row.metrics}</div>
                      {row.notes && <div style={{ fontSize: 14, color: "#6b7280" }}>{row.notes}</div>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {recommendationRows.length > 0 ? (
            <div style={{ marginBottom: 8 }}>
              <div style={{ fontWeight: 600, marginBottom: 10, fontSize: 18 }}>Recommended Next</div>
              <div style={{ display: "grid", rowGap: 8, fontSize: 16 }}>
                {recommendationRows.map((row) => (
                  <div key={row.key} style={cardStyle}>
                    <span style={labelStyle}>
                      {row.label}
                      {row.intensity ? ` (${row.intensity})` : ""}
                    </span>
                    <div style={{ textAlign: "right" }}>
                      <div>{row.metrics}</div>
                      {row.notes && <div style={{ fontSize: 14, color: "#6b7280" }}>{row.notes}</div>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div style={{ fontSize: 16, color: "#6b7280" }}>No recommendations to display.</div>
          )}
        </>
      )}
    </Modal>
  );
}
