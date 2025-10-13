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

const roundToTenth = (value) => {
  if (!Number.isFinite(value)) return null;
  return Math.round(value * 10) / 10;
};

const clamp = (value, min, max) => {
  if (!Number.isFinite(value)) return null;
  if (Number.isFinite(min) && value < min) return min;
  if (Number.isFinite(max) && value > max) return max;
  return value;
};

const sumBy = (values, iteratee) => {
  return values.reduce((acc, item, index) => acc + (iteratee ? iteratee(item, index) : item), 0);
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
  isTempo = false,
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

  const distances = [];
  if (perSet > 0) {
    let remaining = totalMilesVal;
    while (remaining > perSet + EPS) {
      distances.push(perSet);
      remaining -= perSet;
    }
    const finalSegment = remaining > EPS ? remaining : perSet;
    distances.push(finalSegment);
  } else {
    distances.push(totalMilesVal);
  }

  const totalDistanceCheck = sumBy(distances);
  if (Math.abs(totalDistanceCheck - totalMilesVal) > EPS) {
    const adjust = totalMilesVal - totalDistanceCheck;
    distances[distances.length - 1] += adjust;
  }

  const setCount = distances.length;
  const lastDistance = distances[setCount - 1];
  meta.push(`Total distance: ${formatMiles(totalDistanceCheck)}`);
  meta.push(`Sets: ${setCount}`);
  if (setCount === 1) {
    meta.push(`Set distance: ${formatMiles(distances[0])}`);
  } else if (Math.abs(lastDistance - perSet) > EPS) {
    meta.push(`Set distance: ${formatMiles(perSet)} (final ${formatMiles(lastDistance)})`);
  } else {
    meta.push(`Set distance: ${formatMiles(perSet)}`);
  }

  const restSpeed = 4.5;
  const restMargin = 1.1;
  const minNonRestSpeed = restSpeed + restMargin;
  const maxIterations = 200;
  const tolerance = 1e-4;

  if (isTempo) {
    if (setCount < 2) {
      return {
        ...basePayload(title, meta),
        error: "Tempo distribution requires at least two sets to schedule rest intervals.",
      };
    }

    const speeds = new Array(setCount).fill(null);
    const firstSpeed = roundToTenth(maxVal) ?? maxVal;
    speeds[0] = firstSpeed;

    const restIndices = [];
    for (let i = 1; i < setCount; i += 2) {
      restIndices.push(i);
      speeds[i] = restSpeed;
    }

    const nonRestIndices = [];
    for (let i = 0; i < setCount; i += 1) {
      if (speeds[i] === null) {
        nonRestIndices.push(i);
      }
    }

    const totalDistance = sumBy(distances);
    const targetTime = totalDistance / effectiveAvg;
    const restTime = restIndices.reduce((acc, idx) => acc + distances[idx] / restSpeed, 0);
    const firstTime = distances[0] / firstSpeed;

    if (nonRestIndices.length === 0) {
      const totalTime = restTime + firstTime;
      if (Math.abs(totalTime - targetTime) <= tolerance) {
        meta.push(`Max MPH: ${maxVal.toFixed(1)}`);
        meta.push(`Avg MPH: ${effectiveAvg.toFixed(1)}`);
        meta.push(`Rest MPH: ${restSpeed.toFixed(1)}`);
        const rowsSolo = speeds.map((mph, index) => {
          const minutesPerSet = (distances[index] / mph) * 60;
          const distanceNote = `${formatMiles(distances[index])} | `;
          return {
            label: `Set ${index + 1}`,
            primary: formatMph(mph),
            secondary: `${distanceNote}${formatDuration(minutesPerSet)}`,
          };
        });
        return { title, meta, rows: rowsSolo, error: null };
      }
      return {
        ...basePayload(title, meta),
        error: "Tempo distribution lacks enough work intervals to meet the goal average.",
      };
    }

    const maxNonRestSpeed = firstSpeed - 0.1;
    if (minNonRestSpeed >= maxNonRestSpeed) {
      return {
        ...basePayload(title, meta),
        error: "Tempo constraints leave no room for work interval speeds.",
      };
    }

    const workIndices = [...nonRestIndices];
    workIndices.forEach((idx) => {
      speeds[idx] = minNonRestSpeed;
    });

    const computeTotalTime = () => {
      return speeds.reduce((acc, mph, idx) => acc + distances[idx] / mph, 0);
    };

    let totalTime = computeTotalTime();
    let diff = totalTime - targetTime;

    if (diff > tolerance) {
      for (const idx of workIndices) {
        while (diff > tolerance && speeds[idx] < maxNonRestSpeed - 1e-6) {
          const next = roundToTenth(speeds[idx] + 0.1);
          if (next == null || next >= maxVal) {
            break;
          }
          speeds[idx] = Math.min(next, maxNonRestSpeed);
          totalTime = computeTotalTime();
          diff = totalTime - targetTime;
        }
      }
    } else if (diff < -tolerance) {
      for (let i = workIndices.length - 1; i >= 0 && diff < -tolerance; i -= 1) {
        const idx = workIndices[i];
        while (diff < -tolerance && speeds[idx] > minNonRestSpeed + 1e-6) {
          const next = roundToTenth(speeds[idx] - 0.1);
          if (next == null || next < minNonRestSpeed) {
            break;
          }
          speeds[idx] = next;
          totalTime = computeTotalTime();
          diff = totalTime - targetTime;
        }
      }
    }

    const lastWorkIdx = workIndices.length > 0 ? workIndices[workIndices.length - 1] : null;
    if (lastWorkIdx !== null) {
      const timeWithout = totalTime - distances[lastWorkIdx] / speeds[lastWorkIdx];
      const neededTime = targetTime - timeWithout;
      if (neededTime > tolerance) {
        let desiredSpeed = distances[lastWorkIdx] / neededTime;
        desiredSpeed = clamp(desiredSpeed, minNonRestSpeed, maxNonRestSpeed);
        desiredSpeed = clamp(roundToTenth(desiredSpeed) ?? desiredSpeed, minNonRestSpeed, maxNonRestSpeed);
        speeds[lastWorkIdx] = desiredSpeed;
        totalTime = computeTotalTime();
        diff = totalTime - targetTime;
      }
    }

    if (lastWorkIdx !== null && Math.abs(diff) > tolerance) {
      for (let iteration = 0; iteration < maxIterations; iteration += 1) {
        if (Math.abs(diff) <= tolerance) break;
        if (diff > tolerance) {
          const next = roundToTenth(speeds[lastWorkIdx] + 0.1);
          if (next == null || next > maxNonRestSpeed || next >= maxVal) break;
          speeds[lastWorkIdx] = Math.min(next, maxNonRestSpeed);
        } else if (diff < -tolerance) {
          const next = roundToTenth(speeds[lastWorkIdx] - 0.1);
          if (next == null || next < minNonRestSpeed) break;
          speeds[lastWorkIdx] = next;
        } else {
          break;
        }
        totalTime = computeTotalTime();
        diff = totalTime - targetTime;
      }
    }

    if (Math.abs(diff) > 5e-3) {
      return {
        ...basePayload(title, meta),
        error: "Tempo distribution could not converge within constraints.",
      };
    }

    const restIndexSet = new Set(restIndices);
    const rows = speeds.map((mph, index) => {
      const minutesPerSet = (distances[index] / mph) * 60;
      const distanceNote = `${formatMiles(distances[index])} | `;
      return {
        label: restIndexSet.has(index) ? `Set ${index + 1} (Rest)` : `Set ${index + 1}`,
        primary: formatMph(mph),
        secondary: `${distanceNote}${formatDuration(minutesPerSet)}`,
      };
    });

    meta.push(`Max MPH: ${maxVal.toFixed(1)}`);
    meta.push(`Avg MPH: ${effectiveAvg.toFixed(1)}`);
    meta.push(`Rest MPH: ${restSpeed.toFixed(1)}`);
    return { title, meta, rows, error: null };
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
