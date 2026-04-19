export function cardioRouteForRoutineName(name) {
  const value = String(name || "").trim().toLowerCase();
  if (value.includes("sprint")) return "/sprints";
  if (value.includes("5k")) return "/5k-prep";
  return "/5k-prep";
}

export function sectionForPath(pathname) {
  const path = String(pathname || "");
  if (path.startsWith("/5k-prep")) return "5K Prep";
  if (path.startsWith("/sprints")) return "Sprints";
  if (path.startsWith("/strength")) return "Strength";
  if (path.startsWith("/supplemental")) return "Supplemental";
  if (path.startsWith("/metrics")) return "Metrics";
  return "Home";
}
