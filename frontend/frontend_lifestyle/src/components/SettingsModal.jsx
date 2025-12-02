import { useEffect, useMemo, useState } from "react";
import Modal from "./ui/Modal";
import { API_BASE } from "../lib/config";
import TMSyncDefaultsModal from "./TMSyncDefaultsModal";
import WarmupDefaultsModal from "./WarmupDefaultsModal";
import CardioProgressionsModal from "./CardioProgressionsModal";
import RestThresholdsModal from "./RestThresholdsModal";

const btnStyle = { border: "1px solid #e5e7eb", background: "#f9fafb", borderRadius: 8, padding: "6px 10px", cursor: "pointer" };

const PROGRAM_TYPE_OPTIONS = [
  { key: "cardio", label: "Cardio" },
  { key: "strength", label: "Strength" },
  { key: "supplemental", label: "Supplemental" },
];

export default function SettingsModal({ open, onClose }) {
  const [bodyweight, setBodyweight] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);
  const [tmDefaultsOpen, setTmDefaultsOpen] = useState(false);
  const [warmupDefaultsOpen, setWarmupDefaultsOpen] = useState(false);
  const [progressionsOpen, setProgressionsOpen] = useState(false);
  const [restThresholdsOpen, setRestThresholdsOpen] = useState(false);
  const [programs, setPrograms] = useState([]);
  const [programLoading, setProgramLoading] = useState(false);
  const [programSaving, setProgramSaving] = useState({
    cardio: false,
    strength: false,
    supplemental: false,
  });
  const [specialRules, setSpecialRules] = useState({ skip_marathon_prep_weekdays: false });
  const [specialRulesLoading, setSpecialRulesLoading] = useState(false);
  const [specialRulesSaving, setSpecialRulesSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    let ignore = false;
    const fetchAll = async () => {
      setLoading(true);
      setProgramLoading(true);
      setSpecialRulesLoading(true);
      setErr(null);
      try {
        const [bwRes, progRes, rulesRes] = await Promise.all([
          fetch(`${API_BASE}/api/cardio/bodyweight/`),
          fetch(`${API_BASE}/api/programs/`),
          fetch(`${API_BASE}/api/settings/special-rules/`),
        ]);
        if (!bwRes.ok) throw new Error(`Bodyweight ${bwRes.status}`);
        if (!progRes.ok) throw new Error(`Programs ${progRes.status}`);
        if (!rulesRes.ok) throw new Error(`Special rules ${rulesRes.status}`);
        const [bodyweightData, programData, rulesData] = await Promise.all([bwRes.json(), progRes.json(), rulesRes.json()]);
        if (!ignore) {
          setBodyweight(toNumStr(bodyweightData.bodyweight));
          setPrograms(Array.isArray(programData) ? programData : []);
          setSpecialRules({
            skip_marathon_prep_weekdays: !!rulesData?.skip_marathon_prep_weekdays,
          });
        }
      } catch (e) {
        if (!ignore) setErr(e);
      } finally {
        if (!ignore) {
          setLoading(false);
          setProgramLoading(false);
          setSpecialRulesLoading(false);
        }
      }
    };
    fetchAll();
    return () => { ignore = true; };
  }, [open]);

  const selectedProgramIds = useMemo(() => {
    const findId = (field) => {
      const match = programs.find((prog) => prog?.[field]);
      return match ? String(match.id) : "";
    };
    return {
      cardio: findId("selected_cardio"),
      strength: findId("selected_strength"),
      supplemental: findId("selected_supplemental"),
    };
  }, [programs]);

  const refreshProgramsFromResponse = (data) => {
    setPrograms(Array.isArray(data) ? data : []);
  };

  const updateProgramSelection = async (trainingType, programIdValue) => {
    const nextId = Number(programIdValue);
    if (!Number.isFinite(nextId)) return;
    if (String(programIdValue) === selectedProgramIds[trainingType]) return;
    setProgramSaving((prev) => ({ ...prev, [trainingType]: true }));
    setErr(null);
    try {
      const res = await fetch(`${API_BASE}/api/programs/select/`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          training_type: trainingType,
          program_id: nextId,
        }),
      });
      if (!res.ok) throw new Error(`Program select ${res.status}`);
      const data = await res.json();
      refreshProgramsFromResponse(data);
    } catch (e) {
      setErr(e);
    } finally {
      setProgramSaving((prev) => ({ ...prev, [trainingType]: false }));
    }
  };

  const save = async () => {
    setSaving(true);
    setSpecialRulesSaving(true);
    setErr(null);
    try {
      const bodyweightPayload = { bodyweight: toNumOrNull(bodyweight) };
      const rulesPayload = { skip_marathon_prep_weekdays: !!specialRules.skip_marathon_prep_weekdays };
      const [bwRes, rulesRes] = await Promise.all([
        fetch(`${API_BASE}/api/cardio/bodyweight/`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(bodyweightPayload),
        }),
        fetch(`${API_BASE}/api/settings/special-rules/`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(rulesPayload),
        }),
      ]);
      if (!bwRes.ok) throw new Error(`Bodyweight save ${bwRes.status}`);
      if (!rulesRes.ok) throw new Error(`Special rules save ${rulesRes.status}`);
      onClose?.();
    } catch (e) {
      setErr(e);
    } finally {
      setSaving(false);
      setSpecialRulesSaving(false);
    }
  };

  return (
    <Modal open={open}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <div style={{ fontWeight: 600, fontSize: 16 }}>Settings</div>
        <button type="button" style={btnStyle} onClick={onClose}>Close</button>
      </div>
      {err && <div style={{ color: "#b91c1c", marginBottom: 8 }}>Error: {String(err.message || err)}</div>}
      <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
        <fieldset style={{ border: "1px solid #e5e7eb", borderRadius: 8, padding: 12 }}>
          <legend style={{ padding: "0 6px" }}>Programs</legend>
          <p style={{ marginTop: 0, marginBottom: 8, opacity: 0.8, fontSize: 13 }}>
            Choose which program drives cardio, strength, and supplemental predictions.
          </p>
          {programLoading ? (
            <div style={{ fontSize: 13, color: "#475569" }}>Loading programs�?�</div>
          ) : programs.length === 0 ? (
            <div style={{ fontSize: 13, color: "#b91c1c" }}>No programs available.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {PROGRAM_TYPE_OPTIONS.map(({ key, label }) => (
                <label key={key} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span>{label} program</span>
                    {programSaving[key] && <span style={{ fontSize: 12, color: "#475569" }}>Saving�?�</span>}
                  </div>
                  <select
                    value={selectedProgramIds[key] || ""}
                    onChange={(e) => updateProgramSelection(key, e.target.value)}
                    disabled={programSaving[key] || programLoading}
                  >
                    <option value="" disabled>
                      Select a program
                    </option>
                    {programs.map((prog) => (
                      <option key={prog.id} value={prog.id}>
                        {prog.name}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
          )}
        </fieldset>

        <fieldset style={{ border: "1px solid #e5e7eb", borderRadius: 8, padding: 12 }}>
          <legend style={{ padding: "0 6px" }}>Cardio Warmup Defaults</legend>
          <p style={{ marginTop: 0, marginBottom: 8, opacity: 0.8, fontSize: 13 }}>
            Configure per-workout warmup minutes and MPH used for treadmill seeding.
          </p>
          <button type="button" style={btnStyle} onClick={() => setWarmupDefaultsOpen(true)}>Configure.</button>
        </fieldset>
        <fieldset style={{ border: "1px solid #e5e7eb", borderRadius: 8, padding: 12 }}>
          <legend style={{ padding: "0 6px" }}>Cardio Progressions</legend>
          <p style={{ marginTop: 0, marginBottom: 8, opacity: 0.8, fontSize: 13 }}>
            Manage the goal ladder for each cardio workout.
          </p>
          <button type="button" style={btnStyle} onClick={() => setProgressionsOpen(true)}>Configure.</button>
        </fieldset>

        <fieldset style={{ border: "1px solid #e5e7eb", borderRadius: 8, padding: 12 }}>
          <legend style={{ padding: "0 6px" }}>Rest Color Thresholds</legend>
          <p style={{ marginTop: 0, marginBottom: 8, opacity: 0.8, fontSize: 13 }}>
            Edit the rest timer color thresholds for each strength exercise and cardio workout.
          </p>
          <button type="button" style={btnStyle} onClick={() => setRestThresholdsOpen(true)}>Configure.</button>
        </fieldset>

        <fieldset style={{ border: "1px solid #e5e7eb", borderRadius: 8, padding: 12 }}>
          <legend style={{ padding: "0 6px" }}>Special Rules</legend>
          {specialRulesLoading ? (
            <div style={{ fontSize: 13, color: "#475569" }}>Loading...</div>
          ) : (
            <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input
                type="checkbox"
                checked={!!specialRules.skip_marathon_prep_weekdays}
                onChange={(e) => setSpecialRules((prev) => ({ ...prev, skip_marathon_prep_weekdays: e.target.checked }))}
                disabled={specialRulesSaving}
              />
              <span>Skip Marathon Prep on weekdays (only schedule on weekends)</span>
            </label>
          )}
        </fieldset>

        <fieldset style={{ border: "1px solid #e5e7eb", borderRadius: 8, padding: 12 }}>
          <legend style={{ padding: "0 6px" }}>Bodyweight</legend>
          <label>
            <div>Bodyweight</div>
            <input type="number" step="any" value={bodyweight}
              onChange={(e) => setBodyweight(e.target.value)} />
          </label>
        </fieldset>

        <fieldset style={{ border: "1px solid #e5e7eb", borderRadius: 8, padding: 12 }}>
          <legend style={{ padding: "0 6px" }}>TM Sync Defaults</legend>
          <p style={{ marginTop: 0, marginBottom: 8, opacity: 0.8, fontSize: 13 }}>
            Configure the default TM sync behavior per cardio workout.
          </p>
          <button type="button" style={btnStyle} onClick={() => setTmDefaultsOpen(true)}>Configure…</button>
        </fieldset>
      </div>

      <div style={{ marginTop: 12 }}>
        <button type="button" style={btnStyle} onClick={save} disabled={saving || loading}>
          {saving ? "Saving…" : "Save settings"}
        </button>
      </div>
      <TMSyncDefaultsModal open={tmDefaultsOpen} onClose={() => setTmDefaultsOpen(false)} />
      <WarmupDefaultsModal open={warmupDefaultsOpen} onClose={() => setWarmupDefaultsOpen(false)} />
      <CardioProgressionsModal open={progressionsOpen} onClose={() => setProgressionsOpen(false)} />
      <RestThresholdsModal open={restThresholdsOpen} onClose={() => setRestThresholdsOpen(false)} />
    </Modal>
  );
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



