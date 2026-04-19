import { useEffect, useMemo, useState } from "react";
import Modal from "./ui/Modal";
import { API_BASE } from "../lib/config";
import TMSyncDefaultsModal from "./TMSyncDefaultsModal";
import CardioProgressionsModal from "./CardioProgressionsModal";
import RestThresholdsModal from "./RestThresholdsModal";
import CardioGoalDistanceModal from "./CardioGoalDistanceModal";
import DistanceConversionsModal from "./DistanceConversionsModal";

const btnStyle = {
  border: "1px solid #e5e7eb",
  background: "#f9fafb",
  borderRadius: 8,
  padding: "6px 10px",
  cursor: "pointer",
};

const weeklyGridStyle = {
  display: "grid",
  gap: 10,
  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
};

const weeklyDayCardStyle = {
  border: "1px solid #dbe4f0",
  borderRadius: 10,
  padding: 12,
  background: "#f8fafc",
  display: "grid",
  gap: 8,
};

const DEFAULT_WEEKLY_MODEL_OPTIONS = [
  { code: "5k_prep", label: "5K Prep" },
  { code: "sprints", label: "Sprints" },
  { code: "strength", label: "Strength" },
  { code: "supplemental", label: "Supplemental" },
];

const WEEKLY_MODEL_UPDATED_EVENT = "weekly-model-updated";

export default function SettingsModal({ open, onClose }) {
  const [bodyweight, setBodyweight] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);
  const [tmDefaultsOpen, setTmDefaultsOpen] = useState(false);
  const [progressionsOpen, setProgressionsOpen] = useState(false);
  const [restThresholdsOpen, setRestThresholdsOpen] = useState(false);
  const [goalDistanceOpen, setGoalDistanceOpen] = useState(false);
  const [distanceConversionsOpen, setDistanceConversionsOpen] = useState(false);
  const [routineOptions, setRoutineOptions] = useState(DEFAULT_WEEKLY_MODEL_OPTIONS);
  const [weeklyModelDays, setWeeklyModelDays] = useState([]);

  useEffect(() => {
    if (!open) return;
    let ignore = false;

    const fetchAll = async () => {
      setLoading(true);
      setErr(null);
      try {
        const [bwRes, weeklyModelRes] = await Promise.all([
          fetch(`${API_BASE}/api/cardio/bodyweight/`),
          fetch(`${API_BASE}/api/settings/weekly-model/`),
        ]);
        if (!bwRes.ok) throw new Error(`Bodyweight ${bwRes.status}`);
        if (!weeklyModelRes.ok) throw new Error(`Weekly model ${weeklyModelRes.status}`);

        const [bodyweightData, weeklyModelData] = await Promise.all([bwRes.json(), weeklyModelRes.json()]);
        if (ignore) return;

        const nextRoutineOptions = normalizeRoutineOptions(weeklyModelData?.routine_options);
        setBodyweight(toNumStr(bodyweightData?.bodyweight));
        setRoutineOptions(nextRoutineOptions);
        setWeeklyModelDays(normalizeWeeklyModelDays(weeklyModelData?.days, nextRoutineOptions));
      } catch (e) {
        if (!ignore) setErr(e);
      } finally {
        if (!ignore) setLoading(false);
      }
    };

    fetchAll();
    return () => {
      ignore = true;
    };
  }, [open]);

  const routineOptionsByCode = useMemo(
    () => Object.fromEntries(routineOptions.map((option) => [option.code, option.label])),
    [routineOptions],
  );

  const toggleWeeklyModelCode = (dayNumber, routineCode) => {
    setWeeklyModelDays((prev) => prev.map((day) => {
      if (day.day_number !== dayNumber) return day;
      const currentCodes = normalizeRoutineCodes(day.routine_codes);
      const hasCode = currentCodes.includes(routineCode);

      let nextCodes;
      if (hasCode) {
        if (currentCodes.length <= 1) return day;
        nextCodes = currentCodes.filter((code) => code !== routineCode);
      } else {
        if (currentCodes.length >= 2) return day;
        nextCodes = normalizeRoutineCodes([...currentCodes, routineCode]);
      }

      return buildWeeklyModelDay(
        {
          day_number: day.day_number,
          routine_codes: nextCodes,
        },
        routineOptionsByCode,
      );
    }));
  };

  const save = async () => {
    setSaving(true);
    setErr(null);

    try {
      const normalizedDays = normalizeWeeklyModelDays(weeklyModelDays, routineOptions);
      if (normalizedDays.length !== 7) {
        throw new Error("Weekly model must include all 7 days.");
      }

      const bodyweightPayload = { bodyweight: toNumOrNull(bodyweight) };
      const weeklyModelPayload = {
        days: normalizedDays.map((day) => ({
          day_number: day.day_number,
          routine_codes: normalizeRoutineCodes(day.routine_codes),
        })),
      };

      const [bwRes, weeklyModelRes] = await Promise.all([
        fetch(`${API_BASE}/api/cardio/bodyweight/`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(bodyweightPayload),
        }),
        fetch(`${API_BASE}/api/settings/weekly-model/`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(weeklyModelPayload),
        }),
      ]);

      if (!bwRes.ok) throw new Error(`Bodyweight save ${bwRes.status}`);
      if (!weeklyModelRes.ok) {
        const payload = await weeklyModelRes.json().catch(() => null);
        throw new Error(formatApiError(payload) || `Weekly model save ${weeklyModelRes.status}`);
      }

      const weeklyModelData = await weeklyModelRes.json();
      const nextRoutineOptions = normalizeRoutineOptions(weeklyModelData?.routine_options);
      setRoutineOptions(nextRoutineOptions);
      setWeeklyModelDays(normalizeWeeklyModelDays(weeklyModelData?.days, nextRoutineOptions));

      if (typeof window !== "undefined") {
        window.dispatchEvent(new Event(WEEKLY_MODEL_UPDATED_EVENT));
      }
      onClose?.();
    } catch (e) {
      setErr(e);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <div style={{ fontWeight: 600, fontSize: 16 }}>Settings</div>
        <button type="button" style={btnStyle} onClick={onClose}>Close</button>
      </div>
      {err && <div style={{ color: "#b91c1c", marginBottom: 8 }}>Error: {String(err.message || err)}</div>}

      <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))" }}>
        <fieldset style={{ border: "1px solid #e5e7eb", borderRadius: 8, padding: 12, gridColumn: "1 / -1" }}>
          <legend style={{ padding: "0 6px" }}>Weekly Model</legend>
          <p style={{ marginTop: 0, marginBottom: 10, opacity: 0.8, fontSize: 13 }}>
            This now drives the daily recommendation flow. Pick one or two routines for each day.
          </p>
          {loading ? (
            <div style={{ fontSize: 13, color: "#475569" }}>Loading weekly model...</div>
          ) : weeklyModelDays.length === 0 ? (
            <div style={{ fontSize: 13, color: "#b91c1c" }}>Weekly model is unavailable.</div>
          ) : (
            <div style={weeklyGridStyle}>
              {weeklyModelDays.map((day) => (
                <div key={day.day_number} style={weeklyDayCardStyle}>
                  <div>
                    <div style={{ fontSize: 12, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                      Day {day.day_number}
                    </div>
                    <div style={{ fontWeight: 700, marginTop: 4 }}>{day.label}</div>
                  </div>
                  <div style={{ display: "grid", gap: 6 }}>
                    {routineOptions.map((option) => {
                      const checked = day.routine_codes.includes(option.code);
                      const selectedCount = day.routine_codes.length;
                      return (
                        <label key={`${day.day_number}-${option.code}`} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={
                              saving
                              || (!checked && selectedCount >= 2)
                              || (checked && selectedCount <= 1)
                            }
                            onChange={() => toggleWeeklyModelCode(day.day_number, option.code)}
                          />
                          <span>{option.label}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </fieldset>

        <fieldset style={{ border: "1px solid #e5e7eb", borderRadius: 8, padding: 12 }}>
          <legend style={{ padding: "0 6px" }}>Cardio Progressions</legend>
          <p style={{ marginTop: 0, marginBottom: 8, opacity: 0.8, fontSize: 13 }}>
            Manage the goal ladder for each cardio workout.
          </p>
          <button type="button" style={btnStyle} onClick={() => setProgressionsOpen(true)}>Configure.</button>
        </fieldset>

        <fieldset style={{ border: "1px solid #e5e7eb", borderRadius: 8, padding: 12 }}>
          <legend style={{ padding: "0 6px" }}>Goal Distances</legend>
          <p style={{ marginTop: 0, marginBottom: 8, opacity: 0.8, fontSize: 13 }}>
            Set how long or far the workout's Max MPH effort is measured for, in that workout's native unit.
          </p>
          <button type="button" style={btnStyle} onClick={() => setGoalDistanceOpen(true)}>Configure.</button>
        </fieldset>

        <fieldset style={{ border: "1px solid #e5e7eb", borderRadius: 8, padding: 12 }}>
          <legend style={{ padding: "0 6px" }}>Distance Conversions</legend>
          <p style={{ marginTop: 0, marginBottom: 8, opacity: 0.8, fontSize: 13 }}>
            Manage the shared 10K and sprint distance assumptions used by metrics and sprint conversions.
          </p>
          <button type="button" style={btnStyle} onClick={() => setDistanceConversionsOpen(true)}>Configure.</button>
        </fieldset>

        <fieldset style={{ border: "1px solid #e5e7eb", borderRadius: 8, padding: 12 }}>
          <legend style={{ padding: "0 6px" }}>Rest Color Thresholds</legend>
          <p style={{ marginTop: 0, marginBottom: 8, opacity: 0.8, fontSize: 13 }}>
            Edit the rest timer color thresholds for each strength exercise and cardio workout.
          </p>
          <button type="button" style={btnStyle} onClick={() => setRestThresholdsOpen(true)}>Configure.</button>
        </fieldset>

        <fieldset style={{ border: "1px solid #e5e7eb", borderRadius: 8, padding: 12 }}>
          <legend style={{ padding: "0 6px" }}>Bodyweight</legend>
          <label>
            <div>Bodyweight</div>
            <input
              type="number"
              step="any"
              value={bodyweight}
              onChange={(e) => setBodyweight(e.target.value)}
            />
          </label>
        </fieldset>

        <fieldset style={{ border: "1px solid #e5e7eb", borderRadius: 8, padding: 12 }}>
          <legend style={{ padding: "0 6px" }}>TM Sync Defaults</legend>
          <p style={{ marginTop: 0, marginBottom: 8, opacity: 0.8, fontSize: 13 }}>
            Configure the default TM sync behavior per cardio workout.
          </p>
          <button type="button" style={btnStyle} onClick={() => setTmDefaultsOpen(true)}>Configure...</button>
        </fieldset>
      </div>

      <div style={{ marginTop: 12 }}>
        <button type="button" style={btnStyle} onClick={save} disabled={saving || loading}>
          {saving ? "Saving..." : "Save settings"}
        </button>
      </div>

      <TMSyncDefaultsModal open={tmDefaultsOpen} onClose={() => setTmDefaultsOpen(false)} />
      <CardioProgressionsModal open={progressionsOpen} onClose={() => setProgressionsOpen(false)} />
      <RestThresholdsModal open={restThresholdsOpen} onClose={() => setRestThresholdsOpen(false)} />
      <CardioGoalDistanceModal open={goalDistanceOpen} onClose={() => setGoalDistanceOpen(false)} />
      <DistanceConversionsModal open={distanceConversionsOpen} onClose={() => setDistanceConversionsOpen(false)} />
    </Modal>
  );
}

function normalizeRoutineOptions(value) {
  const source = Array.isArray(value) && value.length > 0 ? value : DEFAULT_WEEKLY_MODEL_OPTIONS;
  const seen = new Set();
  const normalized = [];

  for (const defaultOption of DEFAULT_WEEKLY_MODEL_OPTIONS) {
    const match = source.find((item) => String(item?.code || "").toLowerCase() === defaultOption.code);
    const code = defaultOption.code;
    if (seen.has(code)) continue;
    seen.add(code);
    normalized.push({
      code,
      label: String(match?.label || defaultOption.label),
    });
  }

  return normalized;
}

function normalizeRoutineCodes(value) {
  const source = Array.isArray(value) ? value : [];
  const seen = new Set();
  const selected = new Set();

  for (const rawCode of source) {
    const code = String(rawCode || "").trim().toLowerCase();
    if (!code || seen.has(code)) continue;
    seen.add(code);
    if (DEFAULT_WEEKLY_MODEL_OPTIONS.some((option) => option.code === code)) {
      selected.add(code);
    }
  }

  return DEFAULT_WEEKLY_MODEL_OPTIONS
    .map((option) => option.code)
    .filter((code) => selected.has(code));
}

function buildWeeklyModelDay(day, routineOptionsByCode) {
  const dayNumber = Number(day?.day_number);
  const routineCodes = normalizeRoutineCodes(day?.routine_codes);
  const routineLabels = routineCodes.map((code) => routineOptionsByCode[code] || code);
  return {
    day_number: dayNumber,
    day_label: `Day ${dayNumber}`,
    routine_codes: routineCodes,
    routine_labels: routineLabels,
    label: routineLabels.join(" & "),
  };
}

function normalizeWeeklyModelDays(days, routineOptions) {
  const routineOptionsByCode = Object.fromEntries(normalizeRoutineOptions(routineOptions).map((option) => [option.code, option.label]));
  return (Array.isArray(days) ? days : [])
    .map((day) => buildWeeklyModelDay(day, routineOptionsByCode))
    .filter((day) => Number.isFinite(day.day_number))
    .sort((a, b) => a.day_number - b.day_number);
}

function formatApiError(value) {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map((item) => formatApiError(item)).filter(Boolean).join(", ");
  if (typeof value === "object") {
    return Object.values(value).map((item) => formatApiError(item)).filter(Boolean).join(", ");
  }
  return String(value);
}

function toNumStr(v) {
  if (v === null || v === undefined) return "";
  const n = Number(v);
  return Number.isFinite(n) ? String(n) : "";
}

function toNumOrNull(v) {
  if (v === "" || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
