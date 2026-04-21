import { formatNumber } from "./numberFormat";

export function formatSecondsClock(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) return "--";

  let minutes = Math.floor(num / 60);
  let seconds = Number((num - minutes * 60).toFixed(2));
  if (seconds >= 60) {
    minutes += 1;
    seconds = 0;
  }

  const secStr = Number.isInteger(seconds)
    ? String(seconds).padStart(2, "0")
    : seconds.toFixed(2).padStart(5, "0");

  return `${String(minutes).padStart(2, "0")}:${secStr}`;
}

export function formatSupplementalGoalText(goal, options = {}) {
  if (goal == null || goal === "") return "";

  const routineUnit = String(options.routineUnit || "").trim().toLowerCase();
  const isTime = options.isTime === true || routineUnit === "time";
  const numeric = Number(goal);

  if (Number.isFinite(numeric)) {
    if (isTime) return formatSecondsClock(numeric);
    const precision = routineUnit === "reps" ? 0 : 2;
    const formatted = formatNumber(numeric, precision);
    return formatted !== "" ? formatted : String(goal);
  }

  const rawGoal = String(goal);
  if (!isTime) return rawGoal;

  return rawGoal.replace(/(Set\s+\d+:\s*)(-?\d+(?:\.\d+)?)/gi, (match, prefix, value) => {
    const formatted = formatSecondsClock(value);
    return formatted === "--" ? match : `${prefix}${formatted}`;
  });
}
