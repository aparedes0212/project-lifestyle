const DEFAULT_REST_THRESHOLDS = Object.freeze({ yellow: 120, red: 180, critical: 300 });

const REST_COLOR_STATES = {
  green: { bg: "#ecfdf5", fg: "#047857", label: "Green" },
  yellow: { bg: "#fef3c7", fg: "#b45309", label: "Yellow" },
  red: { bg: "#fee2e2", fg: "#ef4444", label: "Red" },
  critical: { bg: "#fee2e2", fg: "#991b1b", label: "Critical" },
};

function normalizeThresholds(entry) {
  const yellow = Number(entry?.yellow_start_seconds);
  const red = Number(entry?.red_start_seconds);
  const criticalRaw = Number(entry?.critical_start_seconds);
  const hasYellowRed = Number.isFinite(yellow) && Number.isFinite(red) && yellow >= 0 && red >= 0 && yellow < red;
  if (hasYellowRed) {
    const hasCritical = Number.isFinite(criticalRaw) && criticalRaw > red;
    return { yellow, red, critical: hasCritical ? criticalRaw : null };
  }
  return DEFAULT_REST_THRESHOLDS;
}

export function deriveRestColor(seconds, config) {
  const thresholds = normalizeThresholds(config);
  const value = Number(seconds);
  if (!Number.isFinite(value) || value < 0) {
    return REST_COLOR_STATES.green;
  }
  if (thresholds.critical != null && thresholds.critical > thresholds.red && value >= thresholds.critical) {
    return REST_COLOR_STATES.critical;
  }
  if (value >= thresholds.red) return REST_COLOR_STATES.red;
  if (value >= thresholds.yellow) return REST_COLOR_STATES.yellow;
  return REST_COLOR_STATES.green;
}

export { DEFAULT_REST_THRESHOLDS };
