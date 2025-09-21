export function roundToStep(value, step) {
  const num = Number(value);
  const inc = Number(step);
  if (!Number.isFinite(num)) return Number.NaN;
  if (!Number.isFinite(inc) || inc <= 0) return num;
  return Math.round(num / inc) * inc;
}

export function formatNumber(value, precision = 6) {
  const num = Number(value);
  if (!Number.isFinite(num)) return "";
  let str = num.toFixed(precision);
  if (str.includes('.')) {
    str = str.replace(/0+$/, '');
    if (str.endsWith('.')) str = str.slice(0, -1);
  }
  return str;
}

export function formatWithStep(value, step, precision = 6) {
  if (value === null || value === undefined || value === "") return "";
  const num = Number(value);
  if (!Number.isFinite(num)) return "";
  if (!Number.isFinite(step) || step <= 0) {
    return formatNumber(num, precision);
  }
  const rounded = roundToStep(num, step);
  if (!Number.isFinite(rounded)) return formatNumber(num, precision);
  return formatNumber(rounded, precision);
}
