import { useMemo, useState } from "react";
import Card from "../components/ui/Card";
import useApi from "../hooks/useApi";
import { API_BASE } from "../lib/config";

const DAY_MS = 24 * 60 * 60 * 1000;
const toNumber = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};
const toDate = (value) => {
  const d = value instanceof Date ? value : new Date(value);
  return Number.isFinite(d.getTime()) ? d : null;
};

const minutesFromParts = (mins, secs) => {
  const m = toNumber(mins) || 0;
  const s = toNumber(secs) || 0;
  const total = m + s / 60;
  return total > 0 ? total : null;
};

const formatDateLabel = (date) => {
  if (!date) return "-";
  const d = new Date(date);
  const day = String(d.getDate()).padStart(2, "0");
  const month = d.toLocaleDateString(undefined, { month: "short" });
  const year = String(d.getFullYear()).slice(-2);
  return `${day} ${month} ${year}`;
};

const formatMph = (value) => {
  const n = toNumber(value);
  return n === null ? "-" : `${n.toFixed(1)} mph`;
};
const formatPaceFromMph = (value) => {
  const n = toNumber(value);
  if (!n || n <= 0) return null;
  const minutesPerMile = 60 / n;
  const totalSeconds = Math.round(minutesPerMile * 60);
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds - mins * 60;
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}/mi`;
};

const formatTotalTimeForDistance = (mph, distanceMiles) => {
  const speed = toNumber(mph);
  const dist = toNumber(distanceMiles);
  if (!speed || speed <= 0 || !dist || dist <= 0) return null;
  const hours = dist / speed;
  const totalSeconds = Math.round(hours * 3600);
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds - mins * 60;
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
};
const formatReps = (value) => {
  const n = toNumber(value);
  return n === null ? "-" : `${n.toFixed(0)} reps`;
};
const formatPlank = (minutes) => {
  const n = toNumber(minutes);
  if (n === null) return "-";
  const totalSeconds = Math.round(n * 60);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds - m * 60;
  return `${m}:${String(s).padStart(2, "0")}`;
};

const clamp = (val, min, max) => {
  if (!Number.isFinite(val)) return val;
  if (Number.isFinite(min) && val < min) return min;
  if (Number.isFinite(max) && val > max) return max;
  return val;
};
const MAX_REASONABLE_MPH = 40; // guardrail to avoid runaway values from bad data
const FATIGUE_EXPONENT_K = 1.06; // Riegel exponent

function normalizeSeries(points) {
  if (!Array.isArray(points) || points.length === 0) {
    return { startTs: null, normalized: [] };
  }
  const sorted = [...points].sort((a, b) => a.ts - b.ts);
  const startTs = sorted[0].ts;
  const normalized = sorted.map((p) => ({
    x: ((p.ts - startTs) / DAY_MS) + 1, // ensure strictly positive for log/power fits
    y: p.value,
    ts: p.ts,
  }));
  return { startTs, normalized };
}

function fitLinear(points) {
  if (points.length === 0) return null;
  const n = points.length;
  let sumX = 0; let sumY = 0; let sumXY = 0; let sumX2 = 0;
  for (const { x, y } of points) {
    sumX += x; sumY += y; sumXY += x * y; sumX2 += x * x;
  }
  const slopeDen = n * sumX2 - sumX * sumX;
  const slope = slopeDen !== 0 ? (n * sumXY - sumX * sumY) / slopeDen : 0;
  const intercept = (sumY - slope * sumX) / n;
  const predict = (x) => intercept + slope * x;
  const meanY = sumY / n;
  let ssTot = 0; let ssRes = 0;
  for (const { x, y } of points) {
    const diff = y - meanY;
    const err = y - predict(x);
    ssTot += diff * diff;
    ssRes += err * err;
  }
  const r2 = ssTot === 0 ? 1 : 1 - (ssRes / ssTot);
  return { type: "linear", label: "Linear", r2, predict, params: { slope, intercept } };
}

function fitExponential(points) {
  if (points.length === 0) return null;
  const transformed = points.map(({ x, y }) => (y > 0 ? { x, ly: Math.log(y) } : null)).filter(Boolean);
  if (transformed.length < points.length) return null;
  const n = transformed.length;
  let sumX = 0; let sumY = 0; let sumXY = 0; let sumX2 = 0;
  for (const { x, ly } of transformed) {
    sumX += x; sumY += ly; sumXY += x * ly; sumX2 += x * x;
  }
  const slopeDen = n * sumX2 - sumX * sumX;
  if (slopeDen === 0) return null;
  const b = (n * sumXY - sumX * sumY) / slopeDen;
  const lnA = (sumY - b * sumX) / n;
  const a = Math.exp(lnA);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  const predict = (x) => a * Math.exp(b * x);
  const meanY = sumY / n;
  let ssTot = 0; let ssRes = 0;
  for (const { x, ly } of transformed) {
    const diff = ly - meanY;
    const err = ly - (lnA + b * x);
    ssTot += diff * diff;
    ssRes += err * err;
  }
  const r2 = ssTot === 0 ? 1 : 1 - (ssRes / ssTot);
  return { type: "exponential", label: "Exponential", r2, predict, params: { a, b } };
}

function fitLogarithmic(points) {
  if (points.length === 0) return null;
  const transformed = points.map(({ x, y }) => (x > 0 ? { lx: Math.log(x), y } : null)).filter(Boolean);
  if (transformed.length < points.length) return null;
  const n = transformed.length;
  let sumX = 0; let sumY = 0; let sumXY = 0; let sumX2 = 0;
  for (const { lx, y } of transformed) {
    sumX += lx; sumY += y; sumXY += lx * y; sumX2 += lx * lx;
  }
  const slopeDen = n * sumX2 - sumX * sumX;
  if (slopeDen === 0) return null;
  const b = (n * sumXY - sumX * sumY) / slopeDen;
  const a = (sumY - b * sumX) / n;
  const predict = (x) => {
    if (x <= 0) return null;
    return a + b * Math.log(x);
  };
  const meanY = sumY / n;
  let ssTot = 0; let ssRes = 0;
  for (const { lx, y } of transformed) {
    const diff = y - meanY;
    const err = y - (a + b * lx);
    ssTot += diff * diff;
    ssRes += err * err;
  }
  const r2 = ssTot === 0 ? 1 : 1 - (ssRes / ssTot);
  return { type: "logarithmic", label: "Logarithmic", r2, predict, params: { a, b } };
}

function fitPower(points) {
  if (points.length === 0) return null;
  const transformed = points.map(({ x, y }) => ((x > 0 && y > 0) ? { lx: Math.log(x), ly: Math.log(y) } : null)).filter(Boolean);
  if (transformed.length < points.length) return null;
  const n = transformed.length;
  let sumX = 0; let sumY = 0; let sumXY = 0; let sumX2 = 0;
  for (const { lx, ly } of transformed) {
    sumX += lx; sumY += ly; sumXY += lx * ly; sumX2 += lx * lx;
  }
  const slopeDen = n * sumX2 - sumX * sumX;
  if (slopeDen === 0) return null;
  const b = (n * sumXY - sumX * sumY) / slopeDen;
  const lnA = (sumY - b * sumX) / n;
  const a = Math.exp(lnA);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  const predict = (x) => {
    if (x <= 0) return null;
    return a * (x ** b);
  };
  const meanY = sumY / n;
  let ssTot = 0; let ssRes = 0;
  for (const { lx, ly } of transformed) {
    const diff = ly - meanY;
    const err = ly - (lnA + b * lx);
    ssTot += diff * diff;
    ssRes += err * err;
  }
  const r2 = ssTot === 0 ? 1 : 1 - (ssRes / ssTot);
  return { type: "power", label: "Power", r2, predict, params: { a, b } };
}

function solveForGoal(model, goal) {
  if (!model) return null;
  const { type, params } = model;
  if (!Number.isFinite(goal)) return null;
  switch (type) {
    case "linear": {
      const { slope, intercept } = params;
      if (!Number.isFinite(slope) || slope === 0) return null;
      const x = (goal - intercept) / slope;
      return Number.isFinite(x) ? x : null;
    }
    case "exponential": {
      const { a, b } = params;
      if (!(a > 0) || !Number.isFinite(b) || b === 0 || !(goal > 0)) return null;
      const x = Math.log(goal / a) / b;
      return Number.isFinite(x) ? x : null;
    }
    case "logarithmic": {
      const { a, b } = params;
      if (!Number.isFinite(b) || b === 0) return null;
      const exponent = (goal - a) / b;
      const x = Math.exp(exponent);
      return Number.isFinite(x) ? x : null;
    }
    case "power": {
      const { a, b } = params;
      if (!(a > 0) || !Number.isFinite(b) || b === 0 || !(goal > 0)) return null;
      const x = (goal / a) ** (1 / b);
      return Number.isFinite(x) ? x : null;
    }
    default:
      return null;
  }
}

function buildTrend(points, goal) {
  const clean = (points || []).filter((p) => Number.isFinite(p?.ts) && Number.isFinite(p?.value));
  const { startTs, normalized } = normalizeSeries(clean);
  if (!startTs || normalized.length === 0) {
    return {
      sortedPoints: [],
      trendPoints: [],
      goalPoint: null,
      goalDate: null,
      modelLabel: "Linear",
      r2: null,
      status: "none",
    };
  }

  const models = [fitLinear(normalized), fitExponential(normalized), fitLogarithmic(normalized), fitPower(normalized)].filter(Boolean);
  const best = models.reduce((acc, cur) => {
    if (!acc) return cur;
    if (cur.r2 > acc.r2) return cur;
    return acc;
  }, null);

  const sortedPoints = [...clean].sort((a, b) => a.ts - b.ts);
  const lastX = normalized[normalized.length - 1].x;
  const lastPred = best ? best.predict(lastX) : null;
  const firstGoalHit = sortedPoints.find((p) => p.value >= goal);

  let goalX = null;
  if (firstGoalHit) {
    const gx = ((firstGoalHit.ts - startTs) / DAY_MS) + 1;
    goalX = gx > 0 ? gx : null;
  } else if (best) {
    const candidate = solveForGoal(best, goal);
    if (candidate !== null && candidate !== undefined && candidate > 0) {
      const isUpward = lastPred === null ? true : goal >= lastPred ? true : best.params?.slope > 0;
      if (!isUpward && goal > (lastPred ?? goal)) {
        goalX = null;
      } else {
        goalX = candidate;
      }
    }
  }

  let goalDate = null;
  if (goalX && Number.isFinite(goalX) && goalX > 0) {
    goalDate = new Date(startTs + (goalX - 1) * DAY_MS);
  }

  const endX = goalX && goalX > lastX ? goalX : lastX;
  const steps = Math.max(40, normalized.length * 8);
  const trendPoints = best
    ? Array.from({ length: steps }, (_v, idx) => {
      const x = normalized[0].x + ((endX - normalized[0].x) * idx) / (steps - 1);
      const y = best.predict(x);
      return { ts: startTs + (x - 1) * DAY_MS, value: y };
    }).filter((p) => Number.isFinite(p.value))
    : [];

  const goalPoint = goalX && Number.isFinite(goalX)
    ? { ts: startTs + (goalX - 1) * DAY_MS, value: goal }
    : null;

  let status = "projection";
  if (firstGoalHit) status = "reached";
  if (!goalPoint) status = "none";

  return {
    sortedPoints,
    trendPoints,
    goalPoint,
    goalDate,
    modelLabel: best ? `${best.label}` : "Linear",
    r2: best?.r2 ?? null,
    status,
    startTs,
    predictAt: (ts) => {
      if (!best || !startTs || !Number.isFinite(ts)) return null;
      const x = ((ts - startTs) / DAY_MS) + 1;
      if (x <= 0) return null;
      const y = best.predict(x);
      return Number.isFinite(y) ? y : null;
    },
  };
}

function toMilesFromUnit(totalCompleted, unit) {
  if (!unit) return null;
  const unitType = String(unit.unit_type?.name || unit.unit_type || "").toLowerCase();
  if (unitType !== "distance") return null;
  const num = toNumber(unit.mile_equiv_numerator);
  const den = toNumber(unit.mile_equiv_denominator);
  const val = toNumber(totalCompleted);
  if (!Number.isFinite(val) || !Number.isFinite(num) || !Number.isFinite(den) || den === 0) return null;
  const miles = val * (num / den);
  return miles > 0 ? miles : null;
}

function toMilesPerUnit(unit) {
  if (!unit) return null;
  const num = toNumber(unit.mile_equiv_numerator);
  const den = toNumber(unit.mile_equiv_denominator);
  if (!Number.isFinite(num) || !Number.isFinite(den) || den === 0) return null;
  const miles = num / den;
  return miles > 0 ? miles : null;
}

function normalizeSpeedRiegel(actualSpeed, actualDistanceMiles, targetDistanceMiles, k = FATIGUE_EXPONENT_K) {
  if (!Number.isFinite(actualSpeed) || actualSpeed <= 0) return null;
  if (!Number.isFinite(actualDistanceMiles) || actualDistanceMiles <= 0) return actualSpeed;
  if (!Number.isFinite(targetDistanceMiles) || targetDistanceMiles <= 0) return actualSpeed;
  const ratio = actualDistanceMiles / targetDistanceMiles;
  return actualSpeed * (ratio ** (k - 1));
}

function bestCardioMph(log, fallbackMiles = null) {
  const primary = toNumber(log?.max_mph);
  if (primary && primary > 0) return primary;

  const mphCandidates = [];
  const pushVal = (v) => {
    const num = toNumber(v);
    if (Number.isFinite(num) && num > 0 && num <= MAX_REASONABLE_MPH) mphCandidates.push(num);
  };

  pushVal(log?.avg_mph);

  const minutesElapsed = toNumber(log?.minutes_elapsed);
  if (minutesElapsed && minutesElapsed > 0) {
    const miles = toMilesFromUnit(log?.total_completed, log?.workout?.unit);
    if (Number.isFinite(miles) && miles > 0) {
      pushVal(miles / (minutesElapsed / 60));
    }
    if (fallbackMiles && fallbackMiles > 0) {
      pushVal(fallbackMiles / (minutesElapsed / 60));
    }
  }

  if (Array.isArray(log?.details)) {
    for (const d of log.details) {
      const mph = toNumber(d?.running_mph);
      if (mph && mph > 0) {
        pushVal(mph);
      } else {
        const miles = toNumber(d?.running_miles);
        const mins = minutesFromParts(d?.running_minutes, d?.running_seconds);
        if (miles && miles > 0 && mins && mins > 0) {
          pushVal(miles / (mins / 60));
        }
      }
    }
  }

  if (mphCandidates.length === 0) return null;
  return Math.max(...mphCandidates);
}

function buildCardioSeries(logs, routineName, fallbackMiles, cutoff, keepNewMaxOnly = false, alwaysIncludeRecentWeeks = false) {
  const pts = [];
  const targetRoutine = (routineName || "").toLowerCase();
  const targetMiles = toNumber(fallbackMiles) || null; // target distance for normalization
  const recentCutoffTs = alwaysIncludeRecentWeeks ? 1 : null; // flag to keep the single most recent point even if not a new max

  const deriveDistanceMiles = (log) => {
    const unit = log?.workout?.unit;
    const routine = (log?.workout?.routine?.name || "").toLowerCase();
    const perUnitMiles = toMilesPerUnit(unit);
    const totalMiles = toMilesFromUnit(log?.total_completed, unit);

    if (routine === "sprints") {
      // Normalize per-interval distance to avoid inflating when many intervals are logged.
      return perUnitMiles ?? totalMiles ?? targetMiles;
    }
    if (routine === "5k prep") {
      // Use total session distance for 5K prep.
      return totalMiles ?? targetMiles;
    }
    return totalMiles ?? perUnitMiles ?? targetMiles;
  };

  for (const log of logs || []) {
    if (log?.ignore) continue;
    const routine = (log?.workout?.routine?.name || "").toLowerCase();
    if (routine !== targetRoutine) continue;
    const dt = toDate(log?.datetime_started);
    if (!dt || (cutoff && dt < cutoff)) continue;
    const distanceMiles = deriveDistanceMiles(log);
    const mph = bestCardioMph(log, distanceMiles);
    if (!mph) continue;
    const normalized = normalizeSpeedRiegel(mph, distanceMiles, targetMiles);
    const finalVal = Number.isFinite(normalized) ? Math.min(normalized, MAX_REASONABLE_MPH) : mph;
    pts.push({ ts: dt.getTime(), value: finalVal });
  }
  const sorted = pts.sort((a, b) => a.ts - b.ts);
  if (!keepNewMaxOnly) return sorted;
  const filtered = [];
  let best = -Infinity;
  for (const p of sorted) {
    const isRecent = recentCutoffTs != null && p === sorted[sorted.length - 1];
    if (Number.isFinite(p.value) && p.value > best) {
      filtered.push(p);
      best = p.value;
    } else if (isRecent) {
      filtered.push(p);
    }
  }
  return filtered;
}

function buildStrengthSeries(logs, routineName, cutoff, keepNewMaxOnly = true, alwaysIncludeRecentWeeks = false) {
  const pts = [];
  const targetRoutine = (routineName || "").toLowerCase();
  const recentCutoffTs = alwaysIncludeRecentWeeks ? 1 : null; // flag to keep the single most recent point even if not a new max
  for (const log of logs || []) {
    if (log?.ignore) continue;
    const routine = (log?.routine?.name || "").toLowerCase();
    if (routine !== targetRoutine) continue;
    const dt = toDate(log?.datetime_started);
    if (!dt || (cutoff && dt < cutoff)) continue;
    const value = toNumber(log?.max_reps);
    if (!value || value <= 0) continue;
    pts.push({ ts: dt.getTime(), value });
  }
  pts.sort((a, b) => a.ts - b.ts);
  if (!keepNewMaxOnly) return pts;
  const filtered = [];
  let best = -Infinity;
  for (const p of pts) {
    const isRecent = recentCutoffTs != null && p === pts[pts.length - 1];
    if (p.value > best) {
      filtered.push(p);
      best = p.value;
    } else if (isRecent) {
      filtered.push(p);
    }
  }
  return filtered;
}

function buildPlankSeries(logs, cutoff, keepNewMaxOnly = true) {
  const pts = [];
  for (const log of logs || []) {
    if (log?.ignore) continue;
    const routine = (log?.routine?.name || "").toLowerCase();
    if (!routine.includes("plank")) continue;
    const dt = toDate(log?.datetime_started);
    if (!dt || (cutoff && dt < cutoff)) continue;
    let bestSeconds = toNumber(log?.total_completed) || 0;
    if (Array.isArray(log?.details)) {
      for (const d of log.details) {
        const val = toNumber(d?.unit_count);
        if (val && val > bestSeconds) bestSeconds = val;
      }
    }
    if (bestSeconds <= 0) continue;
    pts.push({ ts: dt.getTime(), value: bestSeconds / 60 }); // minutes for consistency
  }
  pts.sort((a, b) => a.ts - b.ts);
  if (!keepNewMaxOnly) return pts;
  const filtered = [];
  let best = -Infinity;
  for (const p of pts) {
    if (Number.isFinite(p.value) && p.value > best) {
      filtered.push(p);
      best = p.value;
    }
  }
  return filtered;
}

function pathFromPoints(points, scaleX, scaleY) {
  if (!points || points.length === 0) return "";
  return points.reduce((acc, point, idx) => {
    const x = scaleX(point.ts);
    const y = scaleY(point.value);
    return acc + `${idx === 0 ? "M" : "L"}${x},${y}`;
  }, "");
}

function TrendChart({
  title,
  subtitle,
  goal,
  goalLabel,
  points,
  formatter,
  goalFormatter,
  projectionTs,
  targetDistanceMiles,
}) {
  const [hover, setHover] = useState(null);
  const analysis = useMemo(() => buildTrend(points, goal), [points, goal]);
  const allPoints = [...(analysis.sortedPoints || []), ...(analysis.trendPoints || [])];
  const goalLineValue = goal;
  if (Number.isFinite(goalLineValue)) {
    allPoints.push({ ts: analysis.goalPoint?.ts ?? analysis.sortedPoints?.[analysis.sortedPoints.length - 1]?.ts ?? Date.now(), value: goalLineValue });
  }

  const hasPoints = Array.isArray(analysis.sortedPoints) && analysis.sortedPoints.length > 0;

  const minTs = Math.min(...allPoints.map((p) => p.ts));
  const maxTs = Math.max(...allPoints.map((p) => p.ts));
  let minVal = Math.min(...allPoints.map((p) => p.value));
  let maxVal = Math.max(...allPoints.map((p) => p.value));
  const paddingY = (maxVal - minVal) * 0.12 || 1;
  minVal -= paddingY;
  maxVal += paddingY;
  minVal = clamp(minVal, 0, undefined);

  const width = 860;
  const height = 260;
  const padLeft = 48;
  const padRight = 42;
  const padTop = 18;
  const padBottom = 36;
  const plotWidth = width - padLeft - padRight;
  const plotHeight = height - padTop - padBottom;

  const scaleX = (ts) => {
    if (maxTs === minTs) return padLeft + plotWidth / 2;
    return padLeft + ((ts - minTs) / (maxTs - minTs)) * plotWidth;
  };
  const scaleY = (val) => {
    if (maxVal === minVal) return padTop + plotHeight / 2;
    return padTop + ((maxVal - val) / (maxVal - minVal)) * plotHeight;
  };

  const dataPath = pathFromPoints(analysis.sortedPoints, scaleX, scaleY);
  const trendPath = pathFromPoints(analysis.trendPoints, scaleX, scaleY);
  const goalY = scaleY(goalLineValue);
  const goalXCoord = analysis.goalPoint ? scaleX(analysis.goalPoint.ts) : null;
  const goalDateLabel = analysis.goalDate ? formatDateLabel(analysis.goalDate) : "No projection";
  const goalStatusLabel = analysis.status === "reached" ? "Goal reached" : (analysis.status === "projection" ? "Projected" : "No projection");
  const modelLabel = analysis.r2 != null ? `${analysis.modelLabel} (R² ${analysis.r2.toFixed(3)})` : analysis.modelLabel;
  const startLabel = formatDateLabel(new Date(minTs));
  const endLabel = formatDateLabel(new Date(maxTs));

  const goalText = goalFormatter ? goalFormatter(goalLineValue) : (formatter ? formatter(goalLineValue) : goalLineValue);
  const rawProjectedValue = projectionTs ? analysis.predictAt?.(projectionTs) : null;
  const adjustedProjectedValue = useMemo(() => {
    if (rawProjectedValue == null || !analysis.sortedPoints?.length) return rawProjectedValue;
    const maxPoint = Math.max(...analysis.sortedPoints.map((p) => p.value));
    if (!Number.isFinite(maxPoint)) return rawProjectedValue;
    if (rawProjectedValue < maxPoint) {
      return (rawProjectedValue + maxPoint) / 2;
    }
    return rawProjectedValue;
  }, [rawProjectedValue, analysis.sortedPoints]);
  const projectedTotal = (adjustedProjectedValue != null && formatter === formatMph)
    ? formatTotalTimeForDistance(adjustedProjectedValue, targetDistanceMiles)
    : null;

  const xTicks = useMemo(() => {
    const ticks = [];
    const segments = 6;
    for (let i = 0; i <= segments; i += 1) {
      const ratio = i / segments;
      const ts = minTs + (maxTs - minTs) * ratio;
      ticks.push(ts);
    }
    return ticks;
  }, [minTs, maxTs]);

  const yTicks = useMemo(() => {
    const ticks = [];
    const segments = 5;
    for (let i = 0; i <= segments; i += 1) {
      const ratio = i / segments;
      const val = maxVal - (maxVal - minVal) * ratio;
      ticks.push(val);
    }
    return ticks;
  }, [minVal, maxVal]);

  return (
    <div style={{ position: "relative" }}>
      <div style={{ marginBottom: 6, color: "#4b5563" }}>{subtitle}</div>
      <svg width="100%" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={title}>
        <rect x={padLeft} y={padTop} width={plotWidth} height={plotHeight} fill="#f8fafc" stroke="#e5e7eb" />
        {/* horizontal gridlines */}
        {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
          const y = padTop + plotHeight * ratio;
          return <line key={ratio} x1={padLeft} y1={y} x2={padLeft + plotWidth} y2={y} stroke="#e5e7eb" strokeDasharray="4 4" />;
        })}
        {/* vertical gridlines */}
        {xTicks.map((ts, idx) => {
          const x = scaleX(ts);
          return <line key={`v-${idx}`} x1={x} y1={padTop} x2={x} y2={padTop + plotHeight} stroke="#e5e7eb" strokeDasharray="4 4" />;
        })}
        {/* goal line */}
        <line x1={padLeft} x2={padLeft + plotWidth} y1={goalY} y2={goalY} stroke="#f97316" strokeDasharray="6 6" strokeWidth={1.5} />
        <text x={padLeft + 6} y={goalY - 6} fill="#c2410c" fontSize="11" fontWeight="600">{goalLabel || `Goal: ${goalText}`}</text>

        {/* data line */}
        {hasPoints && (
          <path d={dataPath} fill="none" stroke="#2563eb" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        )}
        {/* trend line */}
        {hasPoints && trendPath && trendPath.length > 0 && (
          <path d={trendPath} fill="none" stroke="#0ea5e9" strokeWidth="2" strokeDasharray="4 4" strokeLinecap="round" strokeLinejoin="round" />
        )}

        {/* points */}
        {hasPoints && analysis.sortedPoints.map((p, idx) => (
          <circle
            key={idx}
            cx={scaleX(p.ts)}
            cy={scaleY(p.value)}
            r={4}
            fill="#1d4ed8"
            stroke="#fff"
            strokeWidth="1.2"
            onMouseEnter={() => setHover({ x: scaleX(p.ts), y: scaleY(p.value), ts: p.ts, value: p.value })}
            onMouseLeave={() => setHover(null)}
          />
        ))}
        {analysis.goalPoint && (
          <>
            <circle cx={goalXCoord} cy={goalY} r={4.5} fill="#fff" stroke="#f97316" strokeWidth="2" />
            {analysis.status === "reached" && (
              <text x={goalXCoord + 8} y={goalY - 8} fill="#f97316" fontSize="11" fontWeight="700">
                Goal reached
              </text>
            )}
          </>
        )}

        {/* y-axis labels */}
        {yTicks.map((val, idx) => (
          <g key={`y-${idx}`}>
            <text x={padLeft - 6} y={scaleY(val) + 4} fill="#6b7280" fontSize="10" textAnchor="end">
              {formatter ? formatter(val) : val.toFixed(1)}
            </text>
          </g>
        ))}

        {/* x-axis labels */}
        {xTicks.map((ts, idx) => {
          const isFirst = idx === 0;
          const isLast = idx === xTicks.length - 1;
          const anchor = isFirst ? "start" : isLast ? "end" : "middle";
          const dx = isFirst ? 4 : isLast ? -4 : 0;
          return (
            <text key={`x-${idx}`} x={scaleX(ts) + dx} y={height - 12} fill="#6b7280" fontSize="10" textAnchor={anchor}>
              {formatDateLabel(new Date(ts))}
            </text>
          );
        })}

      </svg>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 8, alignItems: "center", color: "#374151" }}>
        <div style={{ fontWeight: 600 }}>{goalStatusLabel}: {goalDateLabel}</div>
        <div style={{ color: "#6b7280" }}>Trend: {modelLabel}</div>
        <div style={{ color: "#6b7280" }}>Points: {analysis.sortedPoints.length}</div>
        {projectionTs && adjustedProjectedValue != null && (
          <div style={{ color: "#0f172a" }}>
            Value on {formatDateLabel(new Date(projectionTs))}: {formatter ? formatter(adjustedProjectedValue) : adjustedProjectedValue.toFixed(2)}
            {projectedTotal ? ` (${projectedTotal})` : ""}
          </div>
        )}
      </div>

      {hover && (
        <div
          style={{
            position: "absolute",
            left: hover.x + 10,
            top: hover.y - 10,
            background: "#0f172a",
            color: "#fff",
            padding: "6px 8px",
            borderRadius: 6,
            fontSize: 12,
            pointerEvents: "none",
            boxShadow: "0 4px 10px rgba(0,0,0,0.15)",
          }}
        >
          <div style={{ fontWeight: 700 }}>{formatDateLabel(new Date(hover.ts))}</div>
          <div>{formatter ? formatter(hover.value) : hover.value}</div>
        </div>
      )}
      {!hasPoints && (
        <div style={{ marginTop: 8, color: "#6b7280" }}>
          No data in the last six months yet.
        </div>
      )}
    </div>
  );
}

export default function MetricsPage() {
  const cardio = useApi(`${API_BASE}/api/cardio/logs/?weeks=28`, { deps: [] });
  const strength = useApi(`${API_BASE}/api/strength/logs/?weeks=28`, { deps: [] });
  const supplemental = useApi(`${API_BASE}/api/supplemental/logs/?weeks=28`, { deps: [] });
  const [projectionDate, setProjectionDate] = useState("");
  const [projectionTs, setProjectionTs] = useState(null);
  const [includeAllPoints, setIncludeAllPoints] = useState(false);
  const parseDateInput = (value) => {
    if (!value || typeof value !== "string") return null;
    const parts = value.split("-");
    if (parts.length !== 3) return null;
    const [y, m, d] = parts.map((p) => Number(p));
    if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;
    const dt = new Date(y, m - 1, d, 12, 0, 0); // noon local to avoid TZ rollover
    return Number.isFinite(dt.getTime()) ? dt : null;
  };

  const sixMonthsAgo = useMemo(() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 6);
    return d;
  }, []);

  const charts = useMemo(() => {
    const cardioLogs = Array.isArray(cardio.data) ? cardio.data : [];
    const strengthLogs = Array.isArray(strength.data) ? strength.data : [];
    const supplementalLogs = Array.isArray(supplemental.data) ? supplemental.data : [];

    const prOnly = !includeAllPoints;

    const mufPoints = prOnly
      ? buildCardioSeries(cardioLogs, "sprints", 0.5, sixMonthsAgo, true, true)
      : buildCardioSeries(cardioLogs, "sprints", 0.5, sixMonthsAgo, false, false);

    const fiveKPoints = prOnly
      ? buildCardioSeries(cardioLogs, "5k prep", 3.0, sixMonthsAgo, true, true)
      : buildCardioSeries(cardioLogs, "5k prep", 3.0, sixMonthsAgo, false, false);

    const pullPoints = prOnly
      ? buildStrengthSeries(strengthLogs, "pull", sixMonthsAgo, true, false)
      : buildStrengthSeries(strengthLogs, "pull", sixMonthsAgo, false, false);

    const pushPoints = prOnly
      ? buildStrengthSeries(strengthLogs, "push", sixMonthsAgo, true, false)
      : buildStrengthSeries(strengthLogs, "push", sixMonthsAgo, false, false);

    const plankPoints = prOnly
      ? buildPlankSeries(supplementalLogs, sixMonthsAgo, true)
      : buildPlankSeries(supplementalLogs, sixMonthsAgo, false);

    return [
      {
        key: "muf",
        title: "MUF",
        subtitle: "Sprints normalized to 880 yards (Riegel) | PRs only + latest session",
        goal: 11.4,
        goalLabel: "Goal: 11.4 mph",
        points: mufPoints,
        formatter: formatMph,
        targetDistanceMiles: 0.5,
      },
      {
        key: "5k",
        title: "3 Mile",
        subtitle: "5K Prep normalized to 3 miles (Riegel) | PRs only + latest session",
        goal: 10,
        goalLabel: "Goal: 10 mph",
        points: fiveKPoints,
        formatter: formatMph,
        targetDistanceMiles: 3,
      },
      {
        key: "pull",
        title: "Pull Ups",
        subtitle: "PRs only (max reps per workout)",
        goal: 23,
        goalLabel: "Goal: 23 reps",
        points: pullPoints,
        formatter: formatReps,
      },
      {
        key: "ammo",
        title: "Ammo Can Lifts",
        subtitle: "PRs only (max reps per workout)",
        goal: 120,
        goalLabel: "Goal: 120 reps",
        points: pushPoints,
        formatter: formatReps,
      },
      {
        key: "planks",
        title: "Planks",
        subtitle: "PRs only (best plank per workout)",
        goal: 3.75, // minutes (3:45)
        goalLabel: "Goal: 3:45",
        points: plankPoints,
        formatter: formatPlank,
        goalFormatter: formatPlank,
      },
    ];
  }, [cardio.data, strength.data, supplemental.data, sixMonthsAgo, includeAllPoints]);

  const loading = cardio.loading || strength.loading || supplemental.loading;
  const error = cardio.error || strength.error || supplemental.error;

  const refreshAll = () => {
    cardio.refetch();
    strength.refetch();
    supplemental.refetch();
  };

  const handleCalculateProjection = () => {
    const parsed = parseDateInput(projectionDate);
    setProjectionTs(parsed ? parsed.getTime() : null);
  };

  return (
    <div>
      <Card
        title="Metrics (Last 6 Months)"
        action={(
          <button onClick={refreshAll} style={{ border: "1px solid #e5e7eb", background: "#f9fafb", borderRadius: 8, padding: "6px 10px", cursor: "pointer" }}>
            Refresh
          </button>
        )}
      >
        <div style={{ color: "#374151", marginBottom: 8 }}>
          Auto-selects the best fit (linear / exponential / logarithmic / power) per chart, extends the trend line to the goal, and labels the projected goal date.
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 10 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 14, color: "#374151" }}>
            <input
              type="checkbox"
              checked={includeAllPoints}
              onChange={(e) => setIncludeAllPoints(e.target.checked)}
            />
            Include all points (last 6 months)
          </label>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}>
          <label style={{ fontSize: 14, color: "#374151" }}>
            Projection date:
            <input
              type="date"
              value={projectionDate}
              onChange={(e) => setProjectionDate(e.target.value)}
              style={{ marginLeft: 6, border: "1px solid #e5e7eb", borderRadius: 6, padding: "4px 8px" }}
            />
          </label>
          <button
            type="button"
            onClick={handleCalculateProjection}
            style={{ border: "1px solid #e5e7eb", background: "#f9fafb", borderRadius: 8, padding: "6px 10px", cursor: "pointer" }}
          >
            Calculate
          </button>
        </div>
        {loading && <div>Loading...</div>}
        {error && <div style={{ color: "#b91c1c" }}>Error: {String(error.message || error)}</div>}
        {!loading && !error && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 8, color: "#4b5563" }}>
            <div>Cardio source: app_workout_cardiodailylog (last 6 months)</div>
            <div>Strength source: app_workout_strengthdailylog (last 6 months)</div>
            <div>Supplemental source: app_workout_supplementaldailylog (last 6 months)</div>
          </div>
        )}
      </Card>

      {charts.map((chart) => {
        const { key, ...chartProps } = chart;
        return (
          <Card key={key} title={chart.title}>
            <TrendChart {...chartProps} projectionTs={projectionTs} />
          </Card>
        );
      })}
    </div>
  );
}
