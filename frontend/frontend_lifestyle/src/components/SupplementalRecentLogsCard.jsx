import { useState } from "react";
import { Link } from "react-router-dom";
import useApi from "../hooks/useApi";
import Card from "./ui/Card";
import SupplementalQuickLogCard from "./SupplementalQuickLogCard";
import { API_BASE } from "../lib/config";
import { formatNumber } from "../lib/numberFormat";

const btnStyle = { border: "1px solid #e5e7eb", background: "#f9fafb", borderRadius: 8, padding: "6px 10px", cursor: "pointer" };

const formatValue = (value, precision = 2) => {
  if (value === null || value === undefined) return "--";
  const formatted = formatNumber(value, precision);
  return formatted !== "" ? formatted : "0";
};

const formatSecondsClock = (value) => {
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) return "--";
  const minutes = Math.floor(num / 60);
  const seconds = num - minutes * 60;
  const secStr = Number.isInteger(seconds)
    ? String(seconds).padStart(2, "0")
    : seconds.toFixed(2).padStart(5, "0");
  return `${String(minutes).padStart(2, "0")}:${secStr}`;
};

export default function SupplementalRecentLogsCard({ defaultRoutineId = null }) {
  const { data, loading, error, refetch, setData } = useApi(`${API_BASE}/api/supplemental/logs/?weeks=8`, { deps: [] });
  const rows = Array.isArray(data) ? data : [];
  const [ignoreUpdatingId, setIgnoreUpdatingId] = useState(null);
  const [ignoreErr, setIgnoreErr] = useState(null);

  const prepend = (row) => setData((prev) => [row, ...(prev || [])]);

  const handleToggleIgnore = async (id, nextValue) => {
    setIgnoreUpdatingId(id);
    setIgnoreErr(null);
    try {
      const res = await fetch(`${API_BASE}/api/supplemental/log/${id}/`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ignore: nextValue }),
      });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const updated = await res.json();
      setData((prev) => (prev || []).map((row) => (row.id === id ? updated : row)));
    } catch (e) {
      setIgnoreErr(e);
    } finally {
      setIgnoreUpdatingId(null);
    }
  };

  return (
    <>
      <SupplementalQuickLogCard
        ready={!loading}
        defaultRoutineId={defaultRoutineId}
        onLogged={(created) => {
          prepend(created);
          refetch();
        }}
      />

      <Card title="Recent Supplemental (8 weeks)" action={<button onClick={refetch} style={btnStyle}>Refresh</button>}>
        {loading && <div>Loading...</div>}
        {error && <div style={{ color: "#b91c1c" }}>Error: {String(error.message || error)}</div>}
        {ignoreErr && <div style={{ color: "#b91c1c", marginTop: 8 }}>Ignore toggle error: {String(ignoreErr.message || ignoreErr)}</div>}

        {!loading && !error && rows.length === 0 && (
          <div>No supplemental sessions logged in the last 8 weeks.</div>
        )}

        {!loading && !error && rows.length > 0 && (
          <div style={{ marginInline: "calc(50% - 50vw)", background: "white" }}>
            <table style={{ width: "100vw", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ textAlign: "left", borderBottom: "1px solid #e5e7eb" }}>
                  <th style={{ padding: 6 }}>Date</th>
                  <th style={{ padding: 6 }}>Ignore</th>
                  <th style={{ padding: 6 }}>Routine</th>
                  <th style={{ padding: 6 }}>Rest</th>
                  <th style={{ padding: 6 }}>Set Goals</th>
                  <th style={{ padding: 6 }}>Bests (6mo)</th>
                  <th style={{ padding: 6 }}>Total Completed</th>
                  <th style={{ padding: 6 }}>Details</th>
                  <th style={{ padding: 6 }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const dateDisplay = row.datetime_started ? new Date(row.datetime_started).toLocaleString() : "--";
                  const routineName = row.routine?.name ?? "--";
                  const routineUnit = row.routine?.unit ?? "--";
                  const restYellow = row.rest_config?.yellow_start_seconds ?? row.rest_yellow_start_seconds ?? 60;
                  const restRed = row.rest_config?.red_start_seconds ?? row.rest_red_start_seconds ?? 90;
                  const setTargets = Array.isArray(row.set_targets) ? row.set_targets : [];
                  const goalsDisplay = setTargets.length
                    ? setTargets.map((item) => {
                        const unitPart = (row.routine?.unit || "").toLowerCase() === "time"
                          ? formatSecondsClock(item.goal_unit)
                          : formatValue(item.goal_unit, routineUnit === "Reps" ? 0 : 2);
                        const weightPart = item.goal_weight != null ? formatValue(item.goal_weight, 2) : null;
                        const parts = [unitPart, weightPart ? `${weightPart} wt` : null].filter(Boolean);
                        return `S${item.set_number}: ${parts.join(" ")}`;
                      }).join(" | ")
                    : (row.goal ?? "--");
                  const bestsDisplay = setTargets.length
                    ? setTargets.map((item) => {
                        const unitPart = (row.routine?.unit || "").toLowerCase() === "time"
                          ? formatSecondsClock(item.best_unit)
                          : formatValue(item.best_unit, routineUnit === "Reps" ? 0 : 2);
                        const weightPart = item.best_weight != null ? formatValue(item.best_weight, 2) : null;
                        const parts = [unitPart, weightPart ? `${weightPart} wt` : null].filter(Boolean);
                        return `S${item.set_number}: ${parts.join(" ")}`;
                      }).join(" | ")
                    : "--";
                  const totalDisplay = formatValue(row.total_completed, routineUnit === "Reps" ? 0 : 2);
                  const detailSummary = (() => {
                    const items = Array.isArray(row.details) ? row.details : [];
                    if (items.length > 0) {
                      const totalUnits = items.reduce((acc, item) => {
                        const value = Number(item.unit_count);
                        if (Number.isFinite(value)) {
                          return acc + value;
                        }
                        return acc;
                      }, 0);
                      return `${items.length} interval${items.length === 1 ? "" : "s"} (${formatValue(totalUnits, routineUnit === "Reps" ? 0 : 2)} total)`;
                    }
                    if (row.total_completed != null) {
                      return `${formatValue(row.total_completed, routineUnit === "Reps" ? 0 : 2)} total`;
                    }
                    return "--";
                  })();

                    return (
                      <tr key={row.id} style={{ borderTop: "1px solid #f3f4f6" }}>
                        <td style={{ padding: 8 }}>{dateDisplay}</td>
                        <td style={{ padding: 8 }}>
                          <input
                          type="checkbox"
                          checked={!!row.ignore}
                          onChange={(e) => handleToggleIgnore(row.id, e.target.checked)}
                          disabled={ignoreUpdatingId === row.id}
                          aria-label={`Ignore log ${row.id}`}
                        />
                        </td>
                        <td style={{ padding: 8 }}>{routineName}</td>
                        <td style={{ padding: 8 }}>{restYellow}-{restRed}s</td>
                        <td style={{ padding: 8 }}>{goalsDisplay}</td>
                        <td style={{ padding: 8 }}>{bestsDisplay}</td>
                        <td style={{ padding: 8 }}>{totalDisplay}</td>
                        <td style={{ padding: 8 }}>{detailSummary}</td>
                        <td style={{ padding: 8, display: "flex", gap: 8, alignItems: "center" }}>
                          <Link to={`/supplemental/logs/${row.id}`} style={{ textDecoration: "none", color: "#1d4ed8" }}>
                            View
                        </Link>
                        <button
                          type="button"
                          style={{ border: "1px solid #fecaca", background: "#fef2f2", color: "#b91c1c", borderRadius: 6, padding: "4px 8px", cursor: "pointer" }}
                          onClick={async () => {
                            try {
                              const res = await fetch(`${API_BASE}/api/supplemental/log/${row.id}/delete/`, { method: "DELETE" });
                              if (!res.ok) throw new Error(`Delete ${res.status}`);
                              setData((prev) => (prev || []).filter((r) => r.id !== row.id));
                            } catch (e) {
                              alert(`Failed to delete: ${String(e.message || e)}`);
                            }
                          }}
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
