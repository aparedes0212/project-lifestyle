export function formatProgression(p) {
  if (!p) return "—";
  const val = typeof p.progression === "number" ? p.progression : Number(p.progression);
  if (Number.isFinite(val)) return val.toFixed(3).replace(/\.0+$/, "").replace(/\.(\d*[1-9])0+$/, ".$1");
  return String(p.progression);
}
