import { useEffect, useMemo, useState } from "react";
import useApi from "../hooks/useApi";
import { API_BASE } from "../lib/config";
import Modal from "./ui/Modal";
import { buildCardioMetricPlanOptions, findMatchingCardioMetricPlanOption, roundToDisplayTenth } from "../lib/cardioMetricPlanOptions";

const btnStyle = {
  border: "1px solid #e5e7eb",
  background: "#f9fafb",
  borderRadius: 8,
  padding: "6px 10px",
  cursor: "pointer",
};

const closeBtnStyle = {
  border: "none",
  background: "transparent",
  color: "#2563eb",
  cursor: "pointer",
  fontSize: 13,
  padding: 0,
};

const OTHER_KEY = "other";

export default function CardioGoalMphModal({
  open,
  workoutName,
  title = "Select Max/Avg Goal MPH",
  currentSelection = null,
  saveLabel = "Save Goal MPH",
  onClose,
  onSave,
}) {
  const metricsApi = useApi(`${API_BASE}/api/metrics/cardio/`, {
    deps: [open, workoutName],
    skip: !open || !workoutName,
  });
  const [selectedKey, setSelectedKey] = useState(OTHER_KEY);
  const [customMaxInput, setCustomMaxInput] = useState("");
  const [customAvgInput, setCustomAvgInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState(null);

  const options = useMemo(
    () => buildCardioMetricPlanOptions(metricsApi.data, workoutName),
    [metricsApi.data, workoutName],
  );

  useEffect(() => {
    if (!open) return;
    const matched = findMatchingCardioMetricPlanOption(options, currentSelection);
    const initialMax = normalizePositive(currentSelection?.mphGoal ?? currentSelection?.mph_goal);
    const initialAvg = normalizePositive(currentSelection?.mphGoalAvg ?? currentSelection?.mph_goal_avg);

    setSelectedKey(matched?.key ?? OTHER_KEY);
    setCustomMaxInput(initialMax != null ? String(roundToDisplayTenth(initialMax) ?? initialMax) : "");
    setCustomAvgInput(initialAvg != null ? String(roundToDisplayTenth(initialAvg) ?? initialAvg) : "");
    setSaveErr(null);
  }, [open, options, currentSelection]);

  const selectedOption = useMemo(
    () => options.find((option) => option.key === selectedKey) ?? null,
    [options, selectedKey],
  );

  const handleSave = async () => {
    setSaveErr(null);
    const customMax = normalizePositive(customMaxInput);
    const customAvg = normalizePositive(customAvgInput);
    const payload = selectedKey === OTHER_KEY
      ? {
          kind: "custom",
          periodKey: null,
          periodLabel: "Other",
          mphGoal: customMax,
          mphGoalAvg: customAvg,
        }
      : {
          kind: "period",
          periodKey: selectedOption?.key ?? null,
          periodLabel: selectedOption?.label ?? null,
          mphGoal: selectedOption?.mphGoal ?? null,
          mphGoalAvg: selectedOption?.mphGoalAvg ?? null,
        };

    if (!payload.mphGoal || !payload.mphGoalAvg) {
      setSaveErr(new Error("Both Max and Avg MPH must be valid before saving."));
      return;
    }

    setSaving(true);
    try {
      await onSave?.(payload);
    } catch (error) {
      setSaveErr(error);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} contentStyle={{ maxWidth: 760 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div style={{ fontWeight: 600, fontSize: 16 }}>{title}</div>
        <button type="button" style={closeBtnStyle} onClick={onClose} disabled={saving}>
          Close
        </button>
      </div>

      <div style={{ display: "grid", gap: 10 }}>
        <div style={{ color: "#475569", fontSize: 14 }}>
          Choose one of the available metrics periods for this workout, or switch to <strong>Other</strong> to enter a custom Max/Avg MPH pair.
        </div>

        {metricsApi.loading ? <div>Loading options...</div> : null}
        {metricsApi.error ? (
          <div style={{ color: "#b91c1c", fontSize: 13 }}>
            Error loading metrics options: {String(metricsApi.error.message || metricsApi.error)}
          </div>
        ) : null}

        {options.length > 0 ? (
          <div style={{ overflowX: "auto", border: "1px solid #e5e7eb", borderRadius: 10 }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ textAlign: "left", background: "#f8fafc" }}>
                  <th style={{ padding: 8, width: 60 }}>Use</th>
                  <th style={{ padding: 8 }}>Period</th>
                  <th style={{ padding: 8 }}>Max MPH</th>
                  <th style={{ padding: 8 }}>Avg MPH</th>
                </tr>
              </thead>
              <tbody>
                {options.map((option) => (
                  <tr key={option.key} style={{ borderTop: "1px solid #e5e7eb" }}>
                    <td style={{ padding: 8 }}>
                      <input
                        type="radio"
                        name="cardio-goal-option"
                        checked={selectedKey === option.key}
                        onChange={() => setSelectedKey(option.key)}
                      />
                    </td>
                    <td style={{ padding: 8 }}>{option.label}</td>
                    <td style={{ padding: 8 }}>{formatMph(option.mphGoal)}</td>
                    <td style={{ padding: 8 }}>{formatMph(option.mphGoalAvg)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}

        <div style={{ border: "1px solid #e5e7eb", borderRadius: 10, padding: 12 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
            <input
              type="radio"
              name="cardio-goal-option"
              checked={selectedKey === OTHER_KEY}
              onChange={() => setSelectedKey(OTHER_KEY)}
            />
            <span style={{ fontWeight: 600 }}>Other</span>
          </label>

          <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
            <label>
              <div>Custom Max MPH</div>
              <input
                type="number"
                step="0.1"
                value={customMaxInput}
                onChange={(event) => {
                  setSelectedKey(OTHER_KEY);
                  setCustomMaxInput(event.target.value);
                }}
                style={{ width: "100%" }}
              />
            </label>
            <label>
              <div>Custom Avg MPH</div>
              <input
                type="number"
                step="0.1"
                value={customAvgInput}
                onChange={(event) => {
                  setSelectedKey(OTHER_KEY);
                  setCustomAvgInput(event.target.value);
                }}
                style={{ width: "100%" }}
              />
            </label>
          </div>
        </div>
      </div>

      <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 8 }}>
        <button type="button" style={btnStyle} onClick={handleSave} disabled={saving}>
          {saving ? "Saving..." : saveLabel}
        </button>
        {saveErr ? (
          <span style={{ color: "#b91c1c", fontSize: 13 }}>
            Error: {String(saveErr.message || saveErr)}
          </span>
        ) : null}
      </div>
    </Modal>
  );
}

function normalizePositive(value) {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? num : null;
}

function formatMph(value) {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? `${num.toFixed(1)} mph` : "--";
}
