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

function buildCardioSeries(logs, routineName, fallbackMiles, cutoff) {
  const pts = [];
  const targetRoutine = (routineName || "").toLowerCase();
  for (const log of logs || []) {
    if (log?.ignore) continue;
    const routine = (log?.workout?.routine?.name || "").toLowerCase();
    if (routine !== targetRoutine) continue;
    const dt = toDate(log?.datetime_started);
    if (!dt || (cutoff && dt < cutoff)) continue;
    const mph = bestCardioMph(log, fallbackMiles);
    if (!mph) continue;
    pts.push({ ts: dt.getTime(), value: mph });
  }
  return pts.sort((a, b) => a.ts - b.ts);
}

function buildStrengthSeries(logs, routineName, cutoff) {
  const pts = [];
  const targetRoutine = (routineName || "").toLowerCase();
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
  // keep only new personal bests
  pts.sort((a, b) => a.ts - b.ts);
  const filtered = [];
  let best = -Infinity;
  for (const p of pts) {
    if (p.value > best) {
      filtered.push(p);
      best = p.value;
    }
  }
  return filtered;
}

function buildPlankSeries(logs, cutoff) {
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
  return pts.sort((a, b) => a.ts - b.ts);
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

  const sixMonthsAgo = useMemo(() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 6);
    return d;
  }, []);

  const charts = useMemo(() => {
    const cardioLogs = Array.isArray(cardio.data) ? cardio.data : [];
    const strengthLogs = Array.isArray(strength.data) ? strength.data : [];
    const supplementalLogs = Array.isArray(supplemental.data) ? supplemental.data : [];

    const mufPoints = buildCardioSeries(cardioLogs, "sprints", 0.5, sixMonthsAgo);
    const fiveKPoints = buildCardioSeries(cardioLogs, "5k prep", 3.0, sixMonthsAgo);
    const pullPoints = buildStrengthSeries(strengthLogs, "pull", sixMonthsAgo);
    const pushPoints = buildStrengthSeries(strengthLogs, "push", sixMonthsAgo);
    const plankPoints = buildPlankSeries(supplementalLogs, sixMonthsAgo);

    return [
      {
        key: "muf",
        title: "MUF",
        subtitle: "Sprints normalized to 880 yards | max mph per workout",
        goal: 11.4,
        goalLabel: "Goal: 11.4 mph",
        points: mufPoints,
        formatter: formatMph,
      },
      {
        key: "5k",
        title: "3 Mile",
        subtitle: "5K Prep normalized to 3 miles | max mph per workout",
        goal: 10,
        goalLabel: "Goal: 10 mph",
        points: fiveKPoints,
        formatter: formatMph,
      },
      {
        key: "pull",
        title: "Pull Ups",
        subtitle: "Only new personal bests (max reps per workout)",
        goal: 23,
        goalLabel: "Goal: 23 reps",
        points: pullPoints,
        formatter: formatReps,
      },
      {
        key: "ammo",
        title: "Ammo Can Lifts",
        subtitle: "Only new personal bests (max reps per workout)",
        goal: 120,
        goalLabel: "Goal: 120 reps",
        points: pushPoints,
        formatter: formatReps,
      },
      {
        key: "planks",
        title: "Planks",
        subtitle: "Max plank duration per workout (best set)",
        goal: 3.75, // minutes (3:45)
        goalLabel: "Goal: 3:45",
        points: plankPoints,
        formatter: formatPlank,
        goalFormatter: formatPlank,
      },
    ];
  }, [cardio.data, strength.data, supplemental.data, sixMonthsAgo]);

  const loading = cardio.loading || strength.loading || supplemental.loading;
  const error = cardio.error || strength.error || supplemental.error;

  const refreshAll = () => {
    cardio.refetch();
    strength.refetch();
    supplemental.refetch();
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
            <TrendChart {...chartProps} />
          </Card>
        );
      })}
    </div>
  );
}
