import { useEffect, useState } from "react";
import Modal from "./ui/Modal";
import { API_BASE } from "../lib/config";
import TMSyncDefaultsModal from "./TMSyncDefaultsModal";
import WarmupDefaultsModal from "./WarmupDefaultsModal";
import CardioProgressionsModal from "./CardioProgressionsModal";
import RestThresholdsModal from "./RestThresholdsModal";

const btnStyle = { border: "1px solid #e5e7eb", background: "#f9fafb", borderRadius: 8, padding: "6px 10px", cursor: "pointer" };

export default function SettingsModal({ open, onClose }) {
  const [bodyweight, setBodyweight] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);
  const [tmDefaultsOpen, setTmDefaultsOpen] = useState(false);
  const [warmupDefaultsOpen, setWarmupDefaultsOpen] = useState(false);
  const [progressionsOpen, setProgressionsOpen] = useState(false);
  const [restThresholdsOpen, setRestThresholdsOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    let ignore = false;
    const fetchAll = async () => {
      setLoading(true);
      setErr(null);
      try {
        const res = await fetch(`${API_BASE}/api/cardio/bodyweight/`);
        if (!res.ok) throw new Error(`Bodyweight ${res.status}`);
        const data = await res.json();
        if (!ignore) {
          setBodyweight(toNumStr(data.bodyweight));
        }
      } catch (e) {
        if (!ignore) setErr(e);
      } finally {
        if (!ignore) setLoading(false);
      }
    };
    fetchAll();
    return () => { ignore = true; };
  }, [open]);

  const save = async () => {
    setSaving(true);
    setErr(null);
    try {
      const payload = { bodyweight: toNumOrNull(bodyweight) };
      const res = await fetch(`${API_BASE}/api/cardio/bodyweight/`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`Bodyweight save ${res.status}`);
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
      <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
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



