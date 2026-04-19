import { useEffect, useState } from "react";
import Modal from "./ui/Modal";
import { API_BASE } from "../lib/config";

const btnStyle = {
  border: "1px solid #e5e7eb",
  background: "#f9fafb",
  borderRadius: 8,
  padding: "6px 10px",
  cursor: "pointer",
};

const DISTANCE_CONVERSIONS_UPDATED_EVENT = "distance-conversions-updated";

const sprintRows = [
  { key: "x800", label: "x800" },
  { key: "x400", label: "x400" },
  { key: "x200", label: "x200" },
];

const emptyForm = {
  ten_k_miles: "",
  x800_miles: "",
  x800_meters: "",
  x800_yards: "",
  x400_miles: "",
  x400_meters: "",
  x400_yards: "",
  x200_miles: "",
  x200_meters: "",
  x200_yards: "",
};

export default function DistanceConversionsModal({ open, onClose }) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);
  const [form, setForm] = useState(emptyForm);

  useEffect(() => {
    if (!open) return;
    let ignore = false;

    const fetchSettings = async () => {
      setLoading(true);
      setErr(null);
      try {
        const res = await fetch(`${API_BASE}/api/settings/distance-conversions/`);
        if (!res.ok) throw new Error(`Distance conversions ${res.status}`);
        const data = await res.json();
        if (ignore) return;
        setForm({
          ten_k_miles: toNumStr(data?.ten_k_miles),
          x800_miles: toNumStr(data?.x800_miles),
          x800_meters: toNumStr(data?.x800_meters),
          x800_yards: toNumStr(data?.x800_yards),
          x400_miles: toNumStr(data?.x400_miles),
          x400_meters: toNumStr(data?.x400_meters),
          x400_yards: toNumStr(data?.x400_yards),
          x200_miles: toNumStr(data?.x200_miles),
          x200_meters: toNumStr(data?.x200_meters),
          x200_yards: toNumStr(data?.x200_yards),
        });
      } catch (e) {
        if (!ignore) setErr(e);
      } finally {
        if (!ignore) setLoading(false);
      }
    };

    fetchSettings();
    return () => {
      ignore = true;
    };
  }, [open]);

  const onChangeField = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const save = async () => {
    setSaving(true);
    setErr(null);
    try {
      const payload = Object.fromEntries(
        Object.entries(form).map(([key, value]) => [key, toNumOrNull(value)]),
      );
      const res = await fetch(`${API_BASE}/api/settings/distance-conversions/`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(formatApiError(data) || `Distance conversions save ${res.status}`);
      }
      if (typeof window !== "undefined") {
        window.dispatchEvent(new Event(DISTANCE_CONVERSIONS_UPDATED_EVENT));
      }
      onClose?.();
    } catch (e) {
      setErr(e);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} contentStyle={{ maxWidth: 880 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <div style={{ fontWeight: 600, fontSize: 16 }}>Distance Conversions</div>
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" style={btnStyle} onClick={onClose}>Close</button>
          <button type="button" style={btnStyle} onClick={save} disabled={saving || loading}>
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>

      {err && <div style={{ color: "#b91c1c", marginBottom: 8 }}>Error: {String(err.message || err)}</div>}
      {loading ? (
        <div>Loading...</div>
      ) : (
        <div style={{ display: "grid", gap: 16 }}>
          <div style={{ color: "#475569", fontSize: 13 }}>
            These settings control the shared race and sprint distance assumptions used by metrics and sprint distance conversions across the app.
          </div>

          <fieldset style={{ border: "1px solid #e5e7eb", borderRadius: 8, padding: 12 }}>
            <legend style={{ padding: "0 6px" }}>10K</legend>
            <label style={{ display: "grid", gap: 6, maxWidth: 220 }}>
              <span>10K Miles</span>
              <input
                type="number"
                step="any"
                value={form.ten_k_miles}
                onChange={(e) => onChangeField("ten_k_miles", e.target.value)}
              />
            </label>
          </fieldset>

          <fieldset style={{ border: "1px solid #e5e7eb", borderRadius: 8, padding: 12 }}>
            <legend style={{ padding: "0 6px" }}>Sprints</legend>
            <div style={{ overflowX: "auto", border: "1px solid #e5e7eb", borderRadius: 8 }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ background: "#f8fafc", textAlign: "left" }}>
                    <th style={{ padding: 8 }}>Workout</th>
                    <th style={{ padding: 8 }}>Miles</th>
                    <th style={{ padding: 8 }}>Meters</th>
                    <th style={{ padding: 8 }}>Yards</th>
                  </tr>
                </thead>
                <tbody>
                  {sprintRows.map((row) => (
                    <tr key={row.key} style={{ borderTop: "1px solid #e5e7eb" }}>
                      <td style={{ padding: 8, fontWeight: 700 }}>{row.label}</td>
                      <td style={{ padding: 8 }}>
                        <input
                          type="number"
                          step="any"
                          value={form[`${row.key}_miles`]}
                          onChange={(e) => onChangeField(`${row.key}_miles`, e.target.value)}
                        />
                      </td>
                      <td style={{ padding: 8 }}>
                        <input
                          type="number"
                          step="any"
                          value={form[`${row.key}_meters`]}
                          onChange={(e) => onChangeField(`${row.key}_meters`, e.target.value)}
                        />
                      </td>
                      <td style={{ padding: 8 }}>
                        <input
                          type="number"
                          step="any"
                          value={form[`${row.key}_yards`]}
                          onChange={(e) => onChangeField(`${row.key}_yards`, e.target.value)}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </fieldset>
        </div>
      )}
    </Modal>
  );
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

function toNumStr(value) {
  if (value === null || value === undefined) return "";
  const num = Number(value);
  return Number.isFinite(num) ? String(num) : "";
}

function toNumOrNull(value) {
  if (value === "" || value === null || value === undefined) return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}
