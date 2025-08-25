import { useParams } from "react-router-dom";
import { useState } from "react";
import useApi from "../hooks/useApi";
import { API_BASE } from "../lib/config";
import Card from "../components/ui/Card";
import Modal from "../components/ui/Modal";

const btnStyle = { border: "1px solid #e5e7eb", background: "#f9fafb", borderRadius: 8, padding: "6px 10px", cursor: "pointer" };
const xBtnInline = { border: "none", background: "transparent", color: "#b91c1c", cursor: "pointer", fontSize: 14, lineHeight: 1, padding: 2, marginLeft: 8 };
const editBtnInline = { border: "none", background: "transparent", color: "#1d4ed8", cursor: "pointer", fontSize: 14, lineHeight: 1, padding: 2 };

function toIsoLocal(date) {
  const d = date instanceof Date ? date : new Date(date);
  const tzOffset = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - tzOffset).toISOString().slice(0, 19);
}
function toIsoLocalNow() { return toIsoLocal(new Date()); }
const emptyRow = { datetime: "", exercise_id: "", reps: "", weight: "" };

export default function StrengthLogDetailsPage() {
  const { id } = useParams();
  const { data, loading, error, refetch } = useApi(`${API_BASE}/api/strength/log/${id}/`, { deps: [id] });
  const exApi = useApi(`${API_BASE}/api/strength/exercises/`, { deps: [] });

  const [addModalOpen, setAddModalOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [row, setRow] = useState(emptyRow);
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const [deleteErr, setDeleteErr] = useState(null);

  const setField = (patch) => setRow(r => ({ ...r, ...patch }));

  const openModal = async () => {
    setEditingId(null);
    let base = { ...emptyRow, datetime: toIsoLocalNow() };
    try {
      const res = await fetch(`${API_BASE}/api/strength/log/${id}/last-set/`);
      if (res.ok) {
        const d = await res.json();
        const ex = (exApi.data || []).find(e => e.name === d.exercise);
        base = {
          ...base,
          exercise_id: ex ? String(ex.id) : "",
          reps: d.reps ?? "",
          weight: d.weight ?? "",
        };
      }
    } catch (err) {
      console.error(err);
    }
    setRow(base);
    setAddModalOpen(true);
  };
  const openEdit = (detail) => {
    setEditingId(detail.id);
    const ex = (exApi.data || []).find(e => e.name === detail.exercise);
    setRow({
      datetime: toIsoLocal(detail.datetime),
      exercise_id: ex ? String(ex.id) : "",
      reps: detail.reps ?? "",
      weight: detail.weight ?? "",
    });
    setAddModalOpen(true);
  };
  const closeModal = () => {
    setAddModalOpen(false);
    setEditingId(null);
    setRow(emptyRow);
  };

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setSaveErr(null);
    try {
      const payload = {
        datetime: new Date(row.datetime).toISOString(),
        exercise_id: row.exercise_id ? Number(row.exercise_id) : null,
        reps: row.reps === "" ? null : Number(row.reps),
        weight: row.weight === "" ? null : Number(row.weight),
      };
      const url = editingId
        ? `${API_BASE}/api/strength/log/${id}/details/${editingId}/`
        : `${API_BASE}/api/strength/log/${id}/details/`;
      const method = editingId ? "PATCH" : "POST";
      const body = editingId ? JSON.stringify(payload) : JSON.stringify({ details: [payload] });
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body,
      });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      await res.json();
      await refetch();
      closeModal();
    } catch (err) {
      setSaveErr(err);
    } finally {
      setSaving(false);
    }
  };

  const deleteDetail = async (detailId) => {
    if (!confirm("Delete this set?")) return;
    setDeletingId(detailId);
    setDeleteErr(null);
    try {
      const res = await fetch(`${API_BASE}/api/strength/log/${id}/details/${detailId}/delete/`, { method: "DELETE" });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      await refetch();
    } catch (err) {
      setDeleteErr(err);
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <Card title={`Strength Log ${id}`} action={<button onClick={refetch} style={btnStyle}>Refresh</button>}>
      {loading && <div>Loading…</div>}
      {error && <div style={{ color: "#b91c1c" }}>Error: {String(error.message || error)}</div>}
      {deleteErr && <div style={{ color: "#b91c1c" }}>Delete error: {String(deleteErr.message || deleteErr)}</div>}
      {!loading && !error && data && (
        <>
          <div style={{ marginBottom: 12 }}>
            <div><strong>Started:</strong> {new Date(data.datetime_started).toLocaleString()}</div>
            <div><strong>Routine:</strong> {data.routine?.name || "—"}</div>
            <div><strong>Rep goal:</strong> {data.rep_goal ?? "—"}</div>
            <div><strong>Total reps:</strong> {data.total_reps_completed ?? "—"}</div>
            <div><strong>Max reps:</strong> {data.max_reps ?? "—"}</div>
            <div><strong>Max weight:</strong> {data.max_weight ?? "—"}</div>
            <div><strong>Minutes:</strong> {data.minutes_elapsed ?? "—"}</div>
          </div>
          <table style={{ borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid #e5e7eb" }}>
                <th style={{ padding: 6 }}>Time</th>
                <th style={{ padding: 6 }}>Exercise</th>
                <th style={{ padding: 6 }}>Reps</th>
                <th style={{ padding: 6 }}>Weight</th>
                <th style={{ padding: 6 }}></th>
              </tr>
            </thead>
            <tbody>
              {(data.details || []).map(d => (
                <tr key={d.id} style={{ borderTop: "1px solid #f3f4f6" }}>
                  <td style={{ padding: 8 }}>{new Date(d.datetime).toLocaleString()}</td>
                  <td style={{ padding: 8 }}>{d.exercise || "—"}</td>
                  <td style={{ padding: 8 }}>{d.reps ?? "—"}</td>
                  <td style={{ padding: 8 }}>{d.weight ?? "—"}</td>
                  <td style={{ padding: 8 }}>
                    <button type="button" style={editBtnInline} onClick={() => openEdit(d)} title="Edit set" aria-label={`Edit set ${d.id}`}>✎</button>
                    <button type="button" style={xBtnInline} onClick={() => deleteDetail(d.id)} disabled={deletingId === d.id} title="Delete set" aria-label={`Delete set ${d.id}`}>{deletingId === d.id ? "…" : "✕"}</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div style={{ marginTop: 12 }}>
            <button type="button" style={btnStyle} onClick={openModal} disabled={exApi.loading}>Add set</button>
          </div>

          <Modal open={addModalOpen}>
            <form onSubmit={submit}>
              <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
                <label>
                  <div>Time (local)</div>
                  <input type="datetime-local" value={row.datetime} onChange={(e) => setField({ datetime: e.target.value })} />
                </label>
                <label>
                  <div>Exercise</div>
                  <select value={row.exercise_id} onChange={(e) => setField({ exercise_id: e.target.value })} disabled={exApi.loading}>
                    {exApi.loading && <option value="">Loading…</option>}
                    {!exApi.loading && exApi.data && exApi.data.map(e => (
                      <option key={e.id} value={e.id}>{e.name}</option>
                    ))}
                  </select>
                </label>
                <label><div>Reps</div><input type="number" step="1" value={row.reps} onChange={(e) => setField({ reps: e.target.value })} /></label>
                <label><div>Weight</div><input type="number" step="any" value={row.weight} onChange={(e) => setField({ weight: e.target.value })} /></label>
              </div>
              <div style={{ marginTop: 8 }}>
                <button type="submit" style={btnStyle} disabled={saving || exApi.loading}>{saving ? "Saving…" : (editingId ? "Save set" : "Add set")}</button>
                <button type="button" style={{ ...btnStyle, marginLeft: 8 }} onClick={closeModal} disabled={saving}>Cancel</button>
                {saveErr && <span style={{ marginLeft: 8, color: "#b91c1c" }}>Error: {String(saveErr.message || saveErr)}</span>}
              </div>
            </form>
          </Modal>
        </>
      )}
    </Card>
  );
}
