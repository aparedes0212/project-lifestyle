import { API_BASE } from "./config";

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
    rows: [],
    rowsCompleted: [],
    rowsRemaining: [],
    error: null,
  };
}

function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}

export function normalizeCardioDistributionResponse(json, fallbackTitle = "Distribution") {
  const rows = ensureArray(json?.rows);
  const rowsCompleted = ensureArray(json?.rows_completed);
  const rowsRemainingRaw = ensureArray(json?.rows_remaining);
  const rowsRemaining = rowsRemainingRaw.length > 0 ? rowsRemainingRaw : rows;
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
    rows,
    rowsCompleted,
    rowsRemaining,
    error: json?.error ?? null,
  };
}

export async function fetchCardioDistribution(payload, fallbackTitle = "Distribution") {
  const res = await fetch(`${API_BASE}/api/cardio/distribution/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload || {}),
  });

  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText}`);
  }

  const json = await res.json();
  return normalizeCardioDistributionResponse(json, fallbackTitle);
}
