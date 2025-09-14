import { useEffect, useMemo, useState } from "react";
import Modal from "./ui/Modal";
import { API_BASE } from "../lib/config";

const btnStyle = { border: "1px solid #e5e7eb", background: "#f9fafb", borderRadius: 8, padding: "6px 10px", cursor: "pointer" };

export default function SettingsModal({ open, onClose }) {
  const [warmup, setWarmup] = useState({
    warmup_minutes_5k_prep: "",
    warmup_mph_5k_prep: "",
    warmup_minutes_sprints: "",
    warmup_mph_sprints: "",
  });
  const [bodyweight, setBodyweight] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);

  useEffect(() => {
    if (!open) return;
    let ignore = false;
    const fetchAll = async () => {
      setLoading(true);
      setErr(null);
      try {
        const [wRes, bRes] = await Promise.all([
          fetch(`${API_BASE}/api/cardio/warmup-settings/`),
          fetch(`${API_BASE}/api/cardio/bodyweight/`),
        ]);
        if (!wRes.ok) throw new Error(`Warmup ${wRes.status}`);
        if (!bRes.ok) throw new Error(`Bodyweight ${bRes.status}`);
        const [wData, bData] = await Promise.all([wRes.json(), bRes.json()]);
        if (!ignore) {
          setWarmup({
            warmup_minutes_5k_prep: toNumStr(wData.warmup_minutes_5k_prep),
            warmup_mph_5k_prep: toNumStr(wData.warmup_mph_5k_prep),
            warmup_minutes_sprints: toNumStr(wData.warmup_minutes_sprints),
            warmup_mph_sprints: toNumStr(wData.warmup_mph_sprints),
          });
          setBodyweight(toNumStr(bData.bodyweight));
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
      const wPayload = toNumsOrNull(warmup);
      const bPayload = { bodyweight: toNumOrNull(bodyweight) };

      // Do sequential PATCH to avoid SQLite DB locked errors
      const wRes = await fetch(`${API_BASE}/api/cardio/warmup-settings/`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(wPayload),
      });
      if (!wRes.ok) throw new Error(`Warmup save ${wRes.status}`);

      const bRes = await fetch(`${API_BASE}/api/cardio/bodyweight/`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(bPayload),
      });
      if (!bRes.ok) throw new Error(`Bodyweight save ${bRes.status}`);

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
          <legend style={{ padding: "0 6px" }}>Cardio Warmup</legend>
          <label>
            <div>Warm Up Minutes 5k Prep</div>
            <input type="number" step="any" value={warmup.warmup_minutes_5k_prep}
              onChange={(e) => setWarmup({ ...warmup, warmup_minutes_5k_prep: e.target.value })} />
          </label>
          <label>
            <div>Warm Up MPH 5k Prep</div>
            <input type="number" step="any" value={warmup.warmup_mph_5k_prep}
              onChange={(e) => setWarmup({ ...warmup, warmup_mph_5k_prep: e.target.value })} />
          </label>
          <label>
            <div>Warm Up Minutes Sprints</div>
            <input type="number" step="any" value={warmup.warmup_minutes_sprints}
              onChange={(e) => setWarmup({ ...warmup, warmup_minutes_sprints: e.target.value })} />
          </label>
          <label>
            <div>Warm Up MPH Sprints</div>
            <input type="number" step="any" value={warmup.warmup_mph_sprints}
              onChange={(e) => setWarmup({ ...warmup, warmup_mph_sprints: e.target.value })} />
          </label>
        </fieldset>

        <fieldset style={{ border: "1px solid #e5e7eb", borderRadius: 8, padding: 12 }}>
          <legend style={{ padding: "0 6px" }}>Bodyweight</legend>
          <label>
            <div>Bodyweight</div>
            <input type="number" step="any" value={bodyweight}
              onChange={(e) => setBodyweight(e.target.value)} />
          </label>
        </fieldset>
      </div>

      <div style={{ marginTop: 12 }}>
        <button type="button" style={btnStyle} onClick={save} disabled={saving || loading}>
          {saving ? "Saving…" : "Save settings"}
        </button>
      </div>
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
function toNumsOrNull(obj) {
  const out = {};
  for (const k of Object.keys(obj)) out[k] = toNumOrNull(obj[k]);
  return out;
}
