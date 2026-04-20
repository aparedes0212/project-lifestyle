import { API_BASE } from "./config";

const EPSILON = 1e-9;

const WORKOUT_DESCRIPTION_BY_NAME = {
  "Fast": "Preview from the saved metrics-period selection for Fast.",
  "Tempo": "Preview from the saved metrics-period selection for Tempo.",
  "Min Run": "Preview from the saved metrics-period selection for Min Run.",
  "x800": "Preview from the saved metrics-period selection for x800.",
  "x400": "Preview from the saved metrics-period selection for x400.",
  "x200": "Preview from the saved metrics-period selection for x200.",
};

export function emptyCardioDistributionState() {
  return {
    title: "",
    description: "",
    meta: [],
    progression: null,
    targets: null,
    summary: null,
    alreadyComplete: null,
    recommendations: [],
    error: null,
  };
}

function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}

export function normalizeCardioDistributionResponse(json, fallbackTitle = "Distribution") {
  const recommendations = ensureArray(json?.recommendations);

  return {
    title: json?.title || fallbackTitle,
    description: typeof json?.description === "string" ? json.description : "",
    meta: ensureArray(json?.meta),
    progression: json?.progression && typeof json.progression === "object" ? json.progression : null,
    targets: json?.targets && typeof json.targets === "object" ? json.targets : null,
    summary: json?.summary && typeof json.summary === "object" ? json.summary : null,
    alreadyComplete: json?.already_complete && typeof json.already_complete === "object"
      ? json.already_complete
      : null,
    recommendations,
    error: json?.error ?? null,
  };
}

function n(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function normalizeProgressionUnit(value, workoutName = "") {
  const text = String(value || "").trim().toLowerCase();
  if (text.startsWith("min")) return "minutes";
  if (text === "intervals") return "intervals";
  if (text === "miles") return "miles";
  if (workoutName === "Tempo" || workoutName === "Min Run") return "minutes";
  return "miles";
}

function ceilingToNextTenth(value) {
  const num = n(value);
  if (num == null || num <= 0) return null;
  return (Math.floor((num * 10) + 1e-9) + 1) / 10;
}

function roundToNearestTenth(value) {
  const num = n(value);
  return num == null ? null : Number(num.toFixed(1));
}

function roundToDisplayTenth(value) {
  const num = n(value);
  if (num == null || num <= 0) return null;
  return Number(num.toFixed(1));
}

function roundToNearestHundredth(value) {
  const num = n(value);
  return num == null ? null : Number(num.toFixed(2));
}

function roundToNearestSecondMinute(value) {
  const num = n(value);
  if (num == null || num <= 0) return null;
  return Math.round(num * 60) / 60;
}

function getInheritedMinRunEasyMph(minRunPeriod, fastPeriod) {
  const easyFloor = ceilingToNextTenth(fastPeriod?.riegel?.easy_low_mph);
  const easyCeiling = ceilingToNextTenth(fastPeriod?.riegel?.easy_high_mph);
  const currentAvg = n(minRunPeriod?.avg_mph);
  if (!Number.isFinite(easyFloor) || !Number.isFinite(easyCeiling)) {
    return null;
  }

  const lowerBound = Math.min(easyFloor, easyCeiling);
  const upperBound = Math.max(easyFloor, easyCeiling);
  let adjusted = lowerBound;
  const minimumRequired = Number.isFinite(currentAvg) && currentAvg > 0 ? currentAvg + 0.1 : null;

  while (Number.isFinite(minimumRequired) && adjusted < minimumRequired && adjusted < upperBound) {
    adjusted = Number((adjusted + 0.1).toFixed(1));
  }

  return Math.min(adjusted, upperBound);
}

function buildTimeChunks(totalMinutes, chunkMinutes) {
  const total = Number(totalMinutes);
  const chunk = Number(chunkMinutes);
  if (!Number.isFinite(total) || total <= 0 || !Number.isFinite(chunk) || chunk <= 0) {
    return [];
  }

  const chunks = [];
  let remaining = total;
  while (remaining > 1e-9) {
    const nextChunk = Math.min(chunk, remaining);
    chunks.push(Number(nextChunk.toFixed(4)));
    remaining -= nextChunk;
  }
  return chunks;
}

function buildTempoAdjustmentOrder(count, peakIndex, direction) {
  const order = [];
  if (direction === "increase") {
    for (let offset = 1; offset < count; offset += 1) {
      const left = peakIndex - offset;
      const right = peakIndex + offset;
      if (left >= 0) order.push(left);
      if (right < count) order.push(right);
    }
    return order;
  }

  for (let offset = 0; offset < count; offset += 1) {
    const left = offset;
    const right = count - 1 - offset;
    if (left !== peakIndex) {
      order.push(left);
    }
    if (right !== left && right !== peakIndex) {
      order.push(right);
    }
  }
  return order;
}

function isTempoValueValid(values, index, nextValue, peakValue) {
  if (!Number.isFinite(nextValue) || nextValue <= 0 || nextValue > peakValue) {
    return false;
  }
  const peakIndex = Math.floor(values.length / 2);
  if (index === peakIndex && nextValue !== peakValue) {
    return false;
  }
  if (index > 0 && index <= peakIndex && nextValue < values[index - 1]) {
    return false;
  }
  if (index < peakIndex && nextValue > values[index + 1]) {
    return false;
  }
  if (index > peakIndex && nextValue > values[index - 1]) {
    return false;
  }
  if (index < values.length - 1 && index >= peakIndex && nextValue < values[index + 1]) {
    return false;
  }
  return true;
}

function buildTempoDisplayedMphs({ intervalCount, targetAvgMph, nextMaxMph }) {
  const count = Number(intervalCount);
  const target = Number(targetAvgMph);
  const peak = Number(nextMaxMph);
  if (!Number.isInteger(count) || count <= 0 || !Number.isFinite(peak) || peak <= 0) {
    return [];
  }

  if (count === 1) {
    return [peak];
  }

  const safeTarget = Number.isFinite(target) && target > 0 ? target : peak;
  const peakIndex = Math.floor(count / 2);
  const maxDistanceFromPeak = Math.max(peakIndex, count - 1 - peakIndex, 1);
  const norms = Array.from({ length: count }, (_, index) => 1 - (Math.abs(index - peakIndex) / maxDistanceFromPeak));
  const normAverage = norms.reduce((sum, value) => sum + value, 0) / count;

  let easy = safeTarget;
  if (normAverage < 1 - 1e-9) {
    easy = (safeTarget - (peak * normAverage)) / (1 - normAverage);
  }
  easy = Math.max(0.1, Math.min(easy, peak));

  const values = norms.map((norm) => roundToNearestTenth(easy + ((peak - easy) * norm)));
  values[peakIndex] = peak;

  const targetTenths = Math.round(safeTarget * 10 * count);
  let currentTenths = values.reduce((sum, value) => sum + Math.round(value * 10), 0);
  let diff = targetTenths - currentTenths;

  const increaseOrder = buildTempoAdjustmentOrder(count, peakIndex, "increase");
  const decreaseOrder = buildTempoAdjustmentOrder(count, peakIndex, "decrease");
  let guard = 0;

  while (diff !== 0 && guard < 500) {
    guard += 1;
    const order = diff > 0 ? increaseOrder : decreaseOrder;
    let changed = false;

    for (const index of order) {
      if (diff === 0) break;
      const delta = diff > 0 ? 0.1 : -0.1;
      const nextValue = Number((values[index] + delta).toFixed(1));
      if (!isTempoValueValid(values, index, nextValue, peak)) {
        continue;
      }
      values[index] = nextValue;
      diff += diff > 0 ? -1 : 1;
      changed = true;
      if (diff === 0) {
        break;
      }
    }

    if (!changed) {
      break;
    }
  }

  return values;
}

function buildSprintAdjustmentOrder(count, peakIndex, secondaryIndex) {
  const order = [];
  for (let offset = 1; offset < count; offset += 1) {
    const left = peakIndex - offset;
    const right = peakIndex + offset;
    if (left >= 0 && left !== secondaryIndex) {
      order.push(left);
    }
    if (right < count && right !== secondaryIndex) {
      order.push(right);
    }
  }
  return order;
}

function pickPredictedSprintBaseMph({ count, targetAvgMph, peakMph, secondaryMph }) {
  const target = Number(targetAvgMph);
  const peak = Number(peakMph);
  const secondary = Number(secondaryMph);
  if (!Number.isFinite(target) || target <= 0 || !Number.isFinite(peak) || peak <= 0) {
    return target;
  }

  const anchorTenths = Math.round(peak * 10) + Math.round(secondary * 10);
  const targetTenths = Math.round(target * 10 * count);
  const freeSlots = Math.max(1, count - 2);
  const solvedBaseTenths = Math.floor((targetTenths - anchorTenths) / freeSlots);
  const minimumBaseTenths = 1;
  const maximumBaseTenths = Math.round(peak * 10);
  const baseTenths = Math.max(minimumBaseTenths, Math.min(solvedBaseTenths, maximumBaseTenths));
  const currentTenths = anchorTenths + (freeSlots * baseTenths);
  const maxTenths = anchorTenths + (freeSlots * maximumBaseTenths);

  if (currentTenths <= targetTenths && maxTenths >= targetTenths) {
    return Number((baseTenths / 10).toFixed(1));
  }

  return roundToNearestTenth(Math.min(target, peak));
}

function buildPredictedSprintDisplayedMphs({ intervalCount, targetAvgMph, currentMaxMph, predictedMph }) {
  const count = Number(intervalCount);
  const target = Number(targetAvgMph);
  const currentMax = Number(currentMaxMph);
  const predicted = Number(predictedMph);
  if (!Number.isInteger(count) || count <= 0) {
    return [];
  }
  if (!Number.isFinite(target) || target <= 0 || !Number.isFinite(currentMax) || currentMax <= 0 || !Number.isFinite(predicted) || predicted <= 0) {
    return [];
  }

  if (count === 1) {
    return [Math.max(currentMax, predicted)];
  }

  const peak = Math.max(currentMax, predicted);
  const secondary = peak === predicted ? currentMax : predicted;
  const peakIndex = Math.floor(count / 2);
  const secondaryIndex = peakIndex === 0 ? 1 : peakIndex - 1;
  const preferredBase = pickPredictedSprintBaseMph({
    count,
    targetAvgMph: target,
    peakMph: peak,
    secondaryMph: secondary,
  });
  const values = Array.from({ length: count }, () => preferredBase);
  values[peakIndex] = peak;
  values[secondaryIndex] = secondary;

  const targetTenths = Math.round(target * 10 * count);
  let currentTenths = values.reduce((sum, value) => sum + Math.round(value * 10), 0);
  let diff = targetTenths - currentTenths;
  if (diff <= 0) {
    return values.map((value) => roundToNearestTenth(value));
  }

  const increaseOrder = buildSprintAdjustmentOrder(count, peakIndex, secondaryIndex);
  let guard = 0;
  while (diff > 0 && guard < 500) {
    guard += 1;
    let changed = false;
    for (const index of increaseOrder) {
      if (diff <= 0) break;
      const nextValue = Number((values[index] + 0.1).toFixed(1));
      if (nextValue > peak) {
        continue;
      }
      values[index] = nextValue;
      diff -= 1;
      changed = true;
      if (diff <= 0) {
        break;
      }
    }
    if (!changed) {
      break;
    }
  }

  return values.map((value) => roundToNearestTenth(value));
}

function buildNextFastPreview(period, { sourceDistanceMiles, totalDistanceMiles }) {
  if (!period) return null;
  const nextMaxMph = ceilingToNextTenth(period?.max_mph);
  const nextAvgMph = ceilingToNextTenth(period?.avg_mph);
  const sourceMiles = Number(sourceDistanceMiles);
  const totalMiles = Number(totalDistanceMiles);
  const safeSourceMiles = Number.isFinite(sourceMiles) && sourceMiles > 0 ? sourceMiles : null;
  const safeTotalMiles = Number.isFinite(totalMiles) && totalMiles > 0 ? totalMiles : safeSourceMiles;
  if (nextMaxMph == null || nextAvgMph == null || safeSourceMiles == null || safeTotalMiles == null) {
    return null;
  }

  const totalMinutes = (safeTotalMiles / nextAvgMph) * 60;
  if (!Number.isFinite(totalMinutes) || totalMinutes <= 0) {
    return null;
  }

  if (safeTotalMiles <= safeSourceMiles) {
    return {
      nextMaxMph,
      nextAvgMph,
      totalMinutes,
      totalDistanceMiles: safeTotalMiles,
      segments: [
        {
          label: "Full Run",
          minutes: totalMinutes,
          distanceMiles: safeTotalMiles,
          mph: nextAvgMph,
        },
      ],
    };
  }

  const firstDistanceMiles = Math.min(safeSourceMiles, safeTotalMiles);
  const secondDistanceMiles = Math.max(0, safeTotalMiles - firstDistanceMiles);
  const firstMinutes = (firstDistanceMiles / nextMaxMph) * 60;
  let secondMinutes = totalMinutes - firstMinutes;
  if (!Number.isFinite(secondMinutes) || secondMinutes <= 0) {
    secondMinutes = secondDistanceMiles > 0 ? (secondDistanceMiles / nextAvgMph) * 60 : 0;
  }
  let secondSegmentMph = secondDistanceMiles > 0 ? (secondDistanceMiles / (secondMinutes / 60)) : nextAvgMph;
  if (!Number.isFinite(secondSegmentMph) || secondSegmentMph <= 0) {
    secondSegmentMph = nextAvgMph;
  }

  const segments = [
    {
      label: "First Block",
      minutes: firstMinutes,
      distanceMiles: firstDistanceMiles,
      mph: nextMaxMph,
    },
  ];
  if (secondDistanceMiles > 0) {
    segments.push({
      label: "Second Block",
      minutes: secondMinutes,
      distanceMiles: secondDistanceMiles,
      mph: secondSegmentMph,
    });
  }

  return {
    nextMaxMph,
    nextAvgMph,
    totalMinutes,
    totalDistanceMiles: safeTotalMiles,
    segments,
  };
}

function buildNextTempoPreview(period, { intervalMinutes, totalMinutes }) {
  if (!period) return null;
  const nextMaxMph = ceilingToNextTenth(period?.riegel?.predicted_mph);
  const currentAvgMph = ceilingToNextTenth(period?.avg_mph);
  const chunks = buildTimeChunks(totalMinutes, intervalMinutes);
  if (!Number.isFinite(nextMaxMph) || nextMaxMph <= 0 || chunks.length === 0) {
    return null;
  }

  const displayedMphs = buildTempoDisplayedMphs({
    intervalCount: chunks.length,
    targetAvgMph: currentAvgMph,
    nextMaxMph,
  });
  if (displayedMphs.length !== chunks.length) {
    return null;
  }

  const intervals = chunks.map((minutes, index) => {
    const mph = displayedMphs[index];
    return {
      label: `Interval ${index + 1}`,
      minutes,
      distanceMiles: (mph * minutes) / 60.0,
      mph,
    };
  });
  const totalMinutesValue = chunks.reduce((sum, value) => sum + value, 0);
  const totalDistanceMiles = intervals.reduce((sum, interval) => sum + interval.distanceMiles, 0);

  return {
    currentAvgMph,
    nextMaxMph,
    totalMinutes: totalMinutesValue,
    totalDistanceMiles,
    intervals,
  };
}

function buildNextMinRunPreview(period, { closingBlockMinutes, totalMinutes }) {
  if (!period) return null;
  const nextMaxMph = Number(period?.riegel?.predicted_mph);
  const currentAvgMph = roundToDisplayTenth(period?.avg_mph);
  const total = Number(totalMinutes);
  const closing = Number(closingBlockMinutes);
  if (!Number.isFinite(nextMaxMph) || nextMaxMph <= 0 || !Number.isFinite(total) || total <= 0) {
    return null;
  }

  const safeClosing = Number.isFinite(closing) && closing > 0 ? Math.min(closing, total) : 0;
  const firstMinutes = Math.max(0, total - safeClosing);
  const safeCurrentAvgMph = Number.isFinite(currentAvgMph) && currentAvgMph > 0 ? currentAvgMph : nextMaxMph;
  let firstMph = safeCurrentAvgMph;
  if (firstMinutes > 0 && safeClosing > 0 && Number.isFinite(safeCurrentAvgMph) && safeCurrentAvgMph > 0) {
    firstMph = ((safeCurrentAvgMph * total) - (nextMaxMph * safeClosing)) / firstMinutes;
  }
  if (!Number.isFinite(firstMph) || firstMph <= 0) {
    firstMph = safeCurrentAvgMph;
  }

  const segments = [];
  if (firstMinutes > 0) {
    segments.push({
      label: "First Block",
      minutes: firstMinutes,
      distanceMiles: (firstMph * firstMinutes) / 60.0,
      mph: firstMph,
    });
  }
  if (safeClosing > 0) {
    segments.push({
      label: "Closing Block",
      minutes: safeClosing,
      distanceMiles: (nextMaxMph * safeClosing) / 60.0,
      mph: nextMaxMph,
    });
  }
  if (segments.length === 0) {
    segments.push({
      label: "Full Run",
      minutes: total,
      distanceMiles: (nextMaxMph * total) / 60.0,
      mph: nextMaxMph,
    });
  }

  const totalDistanceMiles = Number.isFinite(safeCurrentAvgMph) && safeCurrentAvgMph > 0
    ? (safeCurrentAvgMph * total) / 60.0
    : segments.reduce((sum, segment) => sum + segment.distanceMiles, 0);

  return {
    currentAvgMph: safeCurrentAvgMph,
    nextMaxMph,
    totalMinutes: total,
    totalDistanceMiles,
    segments,
  };
}

function buildNextX800Preview(period, { intervalCount, intervalDistanceMiles }) {
  if (!period) return null;
  const nextMaxMph = ceilingToNextTenth(period?.max_mph);
  const currentAvgMph = ceilingToNextTenth(period?.avg_mph);
  const count = Math.max(0, Math.round(Number(intervalCount)));
  const distanceMiles = Number(intervalDistanceMiles);
  if (!Number.isFinite(nextMaxMph) || nextMaxMph <= 0 || !Number.isFinite(currentAvgMph) || currentAvgMph <= 0) {
    return null;
  }
  if (!Number.isFinite(distanceMiles) || distanceMiles <= 0 || count <= 0) {
    return null;
  }

  const displayedMphs = buildTempoDisplayedMphs({
    intervalCount: count,
    targetAvgMph: currentAvgMph,
    nextMaxMph,
  });
  if (displayedMphs.length !== count) {
    return null;
  }

  const intervals = displayedMphs.map((mph, index) => ({
    label: `Interval ${index + 1}`,
    minutes: (distanceMiles / mph) * 60,
    distanceMiles,
    mph,
  }));
  const totalMinutes = intervals.reduce((sum, interval) => sum + interval.minutes, 0);

  return {
    currentAvgMph,
    nextMaxMph,
    totalMinutes,
    totalDistanceMiles: count * distanceMiles,
    intervals,
  };
}

function buildNextPredictedSprintPreview(period, { intervalCount, intervalDistanceMiles, predictedMph }) {
  if (!period) return null;
  const currentMaxMph = ceilingToNextTenth(period?.max_mph);
  const currentAvgMph = ceilingToNextTenth(period?.avg_mph);
  const predictedAnchorMph = ceilingToNextTenth(predictedMph);
  const count = Math.max(0, Math.round(Number(intervalCount)));
  const distanceMiles = Number(intervalDistanceMiles);
  if (!Number.isFinite(currentMaxMph) || currentMaxMph <= 0) return null;
  if (!Number.isFinite(currentAvgMph) || currentAvgMph <= 0) return null;
  if (!Number.isFinite(predictedAnchorMph) || predictedAnchorMph <= 0) return null;
  if (!Number.isFinite(distanceMiles) || distanceMiles <= 0 || count <= 0) return null;

  const displayedMphs = buildPredictedSprintDisplayedMphs({
    intervalCount: count,
    targetAvgMph: currentAvgMph,
    currentMaxMph,
    predictedMph: predictedAnchorMph,
  });
  if (displayedMphs.length !== count) {
    return null;
  }

  const intervals = displayedMphs.map((mph, index) => ({
    label: `Interval ${index + 1}`,
    minutes: (distanceMiles / mph) * 60,
    distanceMiles,
    mph,
  }));
  const totalMinutes = intervals.reduce((sum, interval) => sum + interval.minutes, 0);

  return {
    currentAvgMph,
    nextMaxMph: Math.max(currentMaxMph, predictedAnchorMph),
    totalMinutes,
    totalDistanceMiles: count * distanceMiles,
    intervals,
  };
}

function resolveWorkoutSection(snapshot, workoutName) {
  if (!snapshot || !workoutName) return null;
  if (workoutName === "Fast") return snapshot.fast ?? null;
  if (workoutName === "Tempo") return snapshot.tempo ?? null;
  if (workoutName === "Min Run") return snapshot.min_run ?? null;
  const workouts = ensureArray(snapshot?.sprints?.workouts);
  return workouts.find((item) => item?.workout_name === workoutName) ?? null;
}

function getSelectedPeriod(section) {
  const periods = ensureArray(section?.periods);
  const selectedKey = String(section?.selected_period_key || "");
  return periods.find((period) => period?.key === selectedKey) ?? periods[0] ?? null;
}

function buildPreviewForWorkout(snapshot, payload) {
  const workoutName = String(payload?.workout_name || "").trim();
  const section = resolveWorkoutSection(snapshot, workoutName);
  const period = getSelectedPeriod(section);
  if (!section || !period) {
    return { section, period, preview: null, progressionUnit: null, progression: null, goalDistance: null };
  }

  const progressionUnit = normalizeProgressionUnit(payload?.progression_unit, workoutName);
  const payloadProgression = n(payload?.progression);
  const payloadGoalDistance = n(payload?.goal_distance);

  if (workoutName === "Fast") {
    const totalDistanceMiles = payloadProgression ?? n(section?.next_progression_miles);
    const sourceDistanceMiles = payloadGoalDistance ?? n(section?.source_distance_miles);
    return {
      section,
      period,
      progressionUnit: "miles",
      progression: totalDistanceMiles,
      goalDistance: sourceDistanceMiles,
      preview: buildNextFastPreview(period, { sourceDistanceMiles, totalDistanceMiles }),
    };
  }

  if (workoutName === "Tempo") {
    const fastSection = snapshot?.fast ?? null;
    const fastPeriod = ensureArray(fastSection?.periods).find((item) => item?.key === period?.key) ?? getSelectedPeriod(fastSection);
    const enrichedPeriod = {
      ...period,
      riegel: {
        ...(period?.riegel ?? {}),
        predicted_mph: fastPeriod?.riegel?.predicted_mph ?? null,
      },
    };
    const totalMinutes = payloadProgression ?? n(section?.next_progression);
    const intervalMinutes = payloadGoalDistance ?? n(section?.goal_distance);
    return {
      section,
      period,
      progressionUnit: "minutes",
      progression: totalMinutes,
      goalDistance: intervalMinutes,
      preview: buildNextTempoPreview(enrichedPeriod, { intervalMinutes, totalMinutes }),
    };
  }

  if (workoutName === "Min Run") {
    const fastSection = snapshot?.fast ?? null;
    const fastPeriod = ensureArray(fastSection?.periods).find((item) => item?.key === period?.key) ?? getSelectedPeriod(fastSection);
    const enrichedPeriod = {
      ...period,
      riegel: {
        ...(period?.riegel ?? {}),
        predicted_mph: getInheritedMinRunEasyMph(period, fastPeriod),
      },
    };
    const totalMinutes = payloadProgression ?? n(section?.next_progression);
    const closingBlockMinutes = payloadGoalDistance ?? n(section?.goal_distance);
    return {
      section,
      period,
      progressionUnit: "minutes",
      progression: totalMinutes,
      goalDistance: closingBlockMinutes,
      preview: buildNextMinRunPreview(enrichedPeriod, { closingBlockMinutes, totalMinutes }),
    };
  }

  const intervalDistanceMiles = payloadGoalDistance ?? n(section?.distance_miles);
  const totalMiles = payloadProgression;
  const intervalCount = totalMiles != null && intervalDistanceMiles != null && intervalDistanceMiles > 0
    ? Math.round(totalMiles / intervalDistanceMiles)
    : Math.round(Number(section?.next_progression) || 0);

  if (workoutName === "x800") {
    return {
      section,
      period,
      progressionUnit: "miles",
      progression: intervalCount * intervalDistanceMiles,
      goalDistance: intervalDistanceMiles,
      preview: buildNextX800Preview(period, { intervalCount, intervalDistanceMiles }),
    };
  }

  if (workoutName === "x400" || workoutName === "x200") {
    return {
      section,
      period,
      progressionUnit: "miles",
      progression: intervalCount * intervalDistanceMiles,
      goalDistance: intervalDistanceMiles,
      preview: buildNextPredictedSprintPreview(period, {
        intervalCount,
        intervalDistanceMiles,
        predictedMph: period?.riegel?.predicted_mph,
      }),
    };
  }

  return { section, period, preview: null, progressionUnit, progression: payloadProgression, goalDistance: payloadGoalDistance };
}

function getPreviewSegments(preview) {
  if (!preview || typeof preview !== "object") return [];
  if (Array.isArray(preview.intervals)) return preview.intervals;
  if (Array.isArray(preview.segments)) return preview.segments;
  return [];
}

function normalizeAlreadyComplete(payloadAlreadyComplete, progressionUnit) {
  const source = payloadAlreadyComplete && typeof payloadAlreadyComplete === "object" ? payloadAlreadyComplete : {};
  const segments = ensureArray(source.segments).map((segment, index) => ({
    label: segment?.label ?? `Completed ${index + 1}`,
    target_distance: roundToNearestHundredth(segment?.target_distance ?? segment?.distanceMiles ?? segment?.running_miles),
    target_minutes: roundToNearestSecondMinute(segment?.target_minutes ?? segment?.minutes),
    target_mph: roundToNearestTenth(segment?.target_mph ?? segment?.mph ?? segment?.running_mph),
    notes: segment?.notes || "",
  }));
  const completedProgression = n(source.completed_progression)
    ?? (progressionUnit === "minutes" ? n(source.completed_minutes) : n(source.completed_miles))
    ?? 0;

  return {
    completed_progression: completedProgression,
    completed_miles: n(source.completed_miles) ?? 0,
    completed_minutes: n(source.completed_minutes) ?? 0,
    max_goal_done: Boolean(source.max_goal_done),
    segments,
  };
}

function buildRemainingSegments(segments, completedProgression, progressionUnit) {
  let remainingToTrim = Math.max(0, Number(completedProgression) || 0);
  const output = [];

  segments.forEach((segment) => {
    const mph = Number(segment?.mph);
    const minutes = Number(segment?.minutes);
    const distanceMiles = Number(segment?.distanceMiles);
    const segmentProgression = progressionUnit === "minutes" ? minutes : distanceMiles;
    if (!Number.isFinite(segmentProgression) || segmentProgression <= 0 || !Number.isFinite(mph) || mph <= 0) {
      return;
    }

    if (remainingToTrim >= segmentProgression - EPSILON) {
      remainingToTrim -= segmentProgression;
      return;
    }

    if (remainingToTrim > EPSILON) {
      const remainingProgression = segmentProgression - remainingToTrim;
      remainingToTrim = 0;
      if (progressionUnit === "minutes") {
        output.push({
          label: segment.label,
          minutes: remainingProgression,
          distanceMiles: (mph * remainingProgression) / 60.0,
          mph,
        });
      } else {
        output.push({
          label: segment.label,
          minutes: (remainingProgression / mph) * 60.0,
          distanceMiles: remainingProgression,
          mph,
        });
      }
      return;
    }

    output.push(segment);
  });

  return output;
}

function buildRecommendationRows(segments) {
  return segments.map((segment) => ({
    label: segment.label,
    target_distance: roundToNearestHundredth(segment.distanceMiles),
    target_minutes: roundToNearestSecondMinute(segment.minutes),
    target_mph: roundToNearestTenth(segment.mph),
    notes: "",
  }));
}

function buildTargets(workoutName, preview, goalDistance, progressionUnit) {
  if (!preview) return null;
  const avgMphGoal = workoutName === "Fast"
    ? preview.nextAvgMph
    : (preview.currentAvgMph ?? preview.nextAvgMph ?? preview.nextMaxMph);
  return {
    avg_mph_goal: roundToNearestTenth(avgMphGoal),
    max_mph_goal: roundToNearestTenth(preview.nextMaxMph),
    goal_distance: progressionUnit === "minutes"
      ? roundToNearestSecondMinute(goalDistance)
      : roundToNearestHundredth(goalDistance),
  };
}

function buildCardioDistributionResponse(snapshot, payload, fallbackTitle) {
  const workoutName = String(payload?.workout_name || "").trim();
  const { period, preview, progressionUnit, progression, goalDistance } = buildPreviewForWorkout(snapshot, payload);
  if (!workoutName || !period || !preview) {
    return {
      title: fallbackTitle || "Distribution",
      meta: [],
      already_complete: {},
      recommendations: [],
      error: "No metrics preview is available for this workout.",
    };
  }

  const previewSegments = getPreviewSegments(preview);
  const alreadyComplete = normalizeAlreadyComplete(payload?.already_complete, progressionUnit);
  const remainingSegments = buildRemainingSegments(previewSegments, alreadyComplete.completed_progression, progressionUnit);
  const totalProgression = n(progression)
    ?? previewSegments.reduce((sum, segment) => (
      sum + (progressionUnit === "minutes" ? Number(segment?.minutes || 0) : Number(segment?.distanceMiles || 0))
    ), 0);
  const remainingProgression = Math.max(0, (Number(totalProgression) || 0) - (Number(alreadyComplete.completed_progression) || 0));

  return {
    title: fallbackTitle || `${workoutName} Recommendation`,
    description: WORKOUT_DESCRIPTION_BY_NAME[workoutName] || "",
    meta: [`Period: ${period.label}`],
    progression: {
      total: progressionUnit === "minutes" ? roundToNearestSecondMinute(totalProgression) : roundToNearestHundredth(totalProgression),
      remaining: progressionUnit === "minutes" ? roundToNearestSecondMinute(remainingProgression) : roundToNearestHundredth(remainingProgression),
      unit: progressionUnit,
    },
    targets: buildTargets(workoutName, preview, goalDistance, progressionUnit),
    already_complete: alreadyComplete,
    recommendations: buildRecommendationRows(remainingSegments),
    error: null,
  };
}

export async function fetchCardioDistribution(payload, fallbackTitle = "Distribution") {
  const res = await fetch(`${API_BASE}/api/metrics/cardio/`);
  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText}`);
  }

  const snapshot = await res.json();
  const json = buildCardioDistributionResponse(snapshot, payload || {}, fallbackTitle);
  return normalizeCardioDistributionResponse(json, fallbackTitle);
}
