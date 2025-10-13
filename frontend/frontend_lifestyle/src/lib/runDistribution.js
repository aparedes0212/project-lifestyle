import mphDistribution from "./mphDistribution";

const EPS = 1e-6;
export const FIVE_K_PER_SET_MILES = 0.75;

const toFinite = (value) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

const formatMph = (value) => {
  const num = toFinite(value);
  return num === null ? "-" : `${num.toFixed(1)} mph`;
};

const formatMiles = (value) => {
  const num = toFinite(value);
  return num === null ? "-" : `${num.toFixed(2)} mi`;
};

const formatDuration = (minutes) => {
  const num = toFinite(minutes);
  if (num === null) return "-";
  const totalSeconds = Math.max(0, Math.round(num * 60));
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds - mins * 60;
  return `${mins}m ${String(secs).padStart(2, "0")}s`;
};

const normalizeSets = (sets) => {
  const raw = toFinite(sets);
  if (raw === null || raw <= 0) return { value: null, rounded: null, diff: null };
  const rounded = Math.max(1, Math.round(raw));
  return { value: raw, rounded, diff: Math.abs(raw - rounded) };
};

const basePayload = (title, metaExtras = []) => ({
  title,
  meta: metaExtras,
  rows: [],
  error: null,
});

export function buildSprintsDistribution({ sets, maxMph, avgMph }) {
  const title = "Sprint MPH Distribution";
  const normalized = normalizeSets(sets);
  const maxVal = toFinite(maxMph);
  const avgVal = toFinite(avgMph);
  const effectiveAvg = avgVal !== null && avgVal > 0 ? avgVal : maxVal;

  const meta = [
    `Sets: ${normalized.rounded ?? "-"}`,
    `Max MPH: ${maxVal !== null ? maxVal.toFixed(1) : "-"}`,
    `Avg MPH: ${effectiveAvg !== null ? effectiveAvg.toFixed(1) : "-"}`,
  ];

  if (normalized.rounded === null) {
    return {
      ...basePayload(title, meta),
      error: "Goal must be a positive integer number of sets.",
    };
  }
  if (normalized.diff !== null && normalized.diff > EPS) {
    return {
      ...basePayload(title, meta),
      error: "Goal must be an integer number of sets.",
    };
  }
  if (maxVal === null || maxVal <= 0) {
    return {
      ...basePayload(title, meta),
      error: "MPH goal is unavailable.",
    };
  }
  if (effectiveAvg === null || effectiveAvg <= 0) {
    return {
      ...basePayload(title, meta),
      error: "Average MPH goal is unavailable.",
    };
  }

  try {
    const mphValues = mphDistribution(normalized.rounded, maxVal, effectiveAvg);
    const rows = mphValues.map((mph, index) => ({
      label: `Set ${index + 1}`,
      primary: formatMph(mph),
    }));
    return { title, meta, rows, error: null };
  } catch (err) {
    return {
      ...basePayload(title, meta),
      error: err?.message || String(err),
    };
  }
}

export function buildFiveKDistribution({
  totalMiles,
  maxMph,
  avgMph,
  perSetMiles = FIVE_K_PER_SET_MILES,
  goalMinutesLabel = null,
  goalDistanceLabel = null,
  goalUnitLabel = null,
}) {
  const title = "5K Prep Distribution";
  const totalMilesVal = toFinite(totalMiles);
  const perSet = toFinite(perSetMiles);
  const maxVal = toFinite(maxMph);
  const avgVal = toFinite(avgMph);
  const effectiveAvg = avgVal !== null && avgVal > 0 ? avgVal : maxVal;

  const meta = [];
  if (goalMinutesLabel !== null && goalMinutesLabel !== undefined && goalMinutesLabel !== "") {
    meta.push(`Goal time: ${goalMinutesLabel} min`);
  }
  if (goalDistanceLabel !== null && goalDistanceLabel !== undefined && goalDistanceLabel !== "") {
    const unitSuffix = goalUnitLabel ? ` ${goalUnitLabel}` : "";
    meta.push(`Goal: ${goalDistanceLabel}${unitSuffix}`);
  }

  if (totalMilesVal === null || totalMilesVal <= 0) {
    return {
      ...basePayload(title, meta),
      error: "Total miles could not be determined from the goal.",
    };
  }
  if (perSet === null || perSet <= 0) {
    return {
      ...basePayload(title, meta),
      error: "Invalid per-set distance.",
    };
  }
  if (maxVal === null || maxVal <= 0) {
    return {
      ...basePayload(title, meta),
      error: "MPH goal is unavailable.",
    };
  }
  if (effectiveAvg === null || effectiveAvg <= 0) {
    return {
      ...basePayload(title, meta),
      error: "Average MPH goal is unavailable.",
    };
  }

  let baseSets = Math.floor(totalMilesVal / perSet);
  if (!Number.isFinite(baseSets) || baseSets < 0) baseSets = 0;
  let remainder = totalMilesVal - baseSets * perSet;
  if (!Number.isFinite(remainder) || remainder <= EPS) {
    remainder = 0;
  }
  let provisionalCount = baseSets + (remainder > EPS ? 1 : 0);
  if (provisionalCount <= 0) {
    provisionalCount = 1;
    remainder = totalMilesVal;
    baseSets = 0;
  }

  const distances = Array(baseSets).fill(perSet);
  if (provisionalCount > baseSets) {
    distances.push(remainder);
  }
  if (distances.length === 0) {
    distances.push(totalMilesVal);
  }

  const setCount = distances.length;
  const lastDistance = distances[setCount - 1];

  const totalDistanceCheck = distances.reduce((acc, val) => acc + val, 0);

  meta.push(`Total distance: ${formatMiles(totalDistanceCheck)}`);
  meta.push(`Sets: ${setCount}`);
  if (setCount === 1) {
    meta.push(`Set distance: ${formatMiles(distances[0])}`);
  } else if (Math.abs(lastDistance - perSet) > EPS) {
    meta.push(`Set distance: ${formatMiles(perSet)} (final ${formatMiles(lastDistance)})`);
  } else {
    meta.push(`Set distance: ${formatMiles(perSet)}`);
  }
  meta.push(`Max MPH: ${maxVal.toFixed(1)}`);
  meta.push(`Avg MPH: ${effectiveAvg.toFixed(1)}`);

  let mphValues;
  try {
    mphValues = mphDistribution(setCount, maxVal, effectiveAvg);
  } catch (err) {
    return {
      ...basePayload(title, meta),
      error: err?.message || String(err),
    };
  }

  const speeds = [...mphValues];
  const targetDistance = totalDistanceCheck;
  const targetTimeHours = targetDistance / effectiveAvg;
  if (setCount > 0 && targetTimeHours > 0) {
    const otherTime = distances.slice(0, -1).reduce((acc, miles, idx) => acc + miles / speeds[idx], 0);
    const remainingHours = targetTimeHours - otherTime;
    if (setCount === 1) {
      if (remainingHours > EPS) {
        const adjusted = distances[0] / remainingHours;
        if (Number.isFinite(adjusted) && adjusted > EPS) {
          speeds[0] = adjusted;
        }
      }
    } else if (remainingHours > EPS) {
      const adjusted = distances[setCount - 1] / remainingHours;
      if (Number.isFinite(adjusted) && adjusted > EPS) {
        speeds[setCount - 1] = adjusted;
      }
    }
  }

  const rows = speeds.map((mph, index) => {
    const milesForSet = distances[index];
    const minutesPerSet = (milesForSet / mph) * 60;
    const distanceNote = `${formatMiles(milesForSet)} | `;
    return {
      label: `Set ${index + 1}`,
      primary: formatMph(mph),
      secondary: `${distanceNote}${formatDuration(minutesPerSet)}`,
    };
  });

  return { title, meta, rows, error: null };
}
