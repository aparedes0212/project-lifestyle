import { useState } from "react";
import { Link } from "react-router-dom";
import useApi from "../hooks/useApi";
import { API_BASE } from "../lib/config";
import { formatNumber } from "../lib/numberFormat";
import { tableActionLinkStyle, tableDangerButtonStyle } from "../lib/tableActions";
import SupplementalQuickLogCard from "./SupplementalQuickLogCard";
import Card from "./ui/Card";

const btnStyle = {
  border: "1px solid #e5e7eb",
  background: "#f9fafb",
  borderRadius: 8,
  padding: "6px 10px",
  cursor: "pointer",
};

const tableWrapStyle = {
  width: "100%",
  maxWidth: "100%",
  overflowX: "auto",
  background: "white",
};

const tableStyle = {
  width: "100%",
  minWidth: 980,
  borderCollapse: "collapse",
};

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

const formatUnitDisplay = (value, isTime, routineUnit) => {
  const precision = routineUnit === "Reps" ? 0 : 2;
  return isTime ? formatSecondsClock(value) : formatValue(value, precision);
};

const formatSetGoalCell = (item, isTime, routineUnit) => {
  if (!item) return "--";
  const unitPart = formatUnitDisplay(item.goal_unit, isTime, routineUnit);
  const weightPart = !isTime && item.goal_weight != null ? `${formatValue(item.goal_weight, 2)} wt` : null;
  const minGoal = formatMinGoal(item, isTime, routineUnit);

  return (
    <>
      <div>
        {[unitPart, weightPart].filter(Boolean).join(" ") || "--"}
      </div>
      {minGoal ? <div style={{ color: "#6b7280", fontSize: 12 }}>Min {minGoal}</div> : null}
    </>
  );
};

const formatMinGoal = (item, isTime, routineUnit) => {
  if (item.min_goal_unit == null && (isTime || item.min_goal_weight == null)) return null;
  const unitPart = formatUnitDisplay(item.min_goal_unit, isTime, routineUnit);
  const weightPart = !isTime && item.min_goal_weight != null ? formatValue(item.min_goal_weight, 2) : null;
  const pieces = [];
  if (unitPart && unitPart !== "--") pieces.push(unitPart);
  if (weightPart) pieces.push(`${weightPart} wt`);
  return pieces.length ? pieces.join(" ") : null;
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
          <div style={tableWrapStyle}>
            <table style={tableStyle}>
              <thead>
                <tr style={{ textAlign: "left", borderBottom: "1px solid #e5e7eb" }}>
                  <th style={{ padding: 6 }}>Date</th>
                  <th style={{ padding: 6 }}>Ignore</th>
                  <th style={{ padding: 6 }}>Set 1 Goal</th>
                  <th style={{ padding: 6 }}>Set 2 Goal</th>
                  <th style={{ padding: 6 }}>Set 3 Goal</th>
                  <th style={{ padding: 6 }}>Total Goal</th>
                  <th style={{ padding: 6 }}>Total Completed</th>
                  <th style={{ padding: 6 }}>Intervals</th>
                  <th style={{ padding: 6 }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const dateDisplay = row.datetime_started ? new Date(row.datetime_started).toLocaleString() : "--";
                  const routineUnit = row.unit_snapshot ?? row.routine?.unit ?? "--";
                  const isTime = String(routineUnit).toLowerCase() === "time";
                  const setTargets = Array.isArray(row.set_targets) ? row.set_targets : [];
                  const targetsBySet = Object.fromEntries(
                    setTargets.map((item) => [Number(item?.set_number), item])
                  );
                  const totalGoalDisplay = formatUnitDisplay(row.total_goal, isTime, routineUnit);
                  const totalCompletedDisplay = isTime
                    ? formatSecondsClock(row.total_completed)
                    : formatUnitDisplay(row.total_completed, isTime, routineUnit);
                  const intervalCount = Array.isArray(row.details) ? row.details.length : Number(row.sets_logged);
                  const intervalsDisplay = Number.isFinite(intervalCount) && intervalCount >= 0 ? String(intervalCount) : "--";

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
                      <td style={{ padding: 8 }}>{formatSetGoalCell(targetsBySet[1], isTime, routineUnit)}</td>
                      <td style={{ padding: 8 }}>{formatSetGoalCell(targetsBySet[2], isTime, routineUnit)}</td>
                      <td style={{ padding: 8 }}>{formatSetGoalCell(targetsBySet[3], isTime, routineUnit)}</td>
                      <td style={{ padding: 8 }}>{totalGoalDisplay}</td>
                      <td style={{ padding: 8 }}>{totalCompletedDisplay}</td>
                      <td style={{ padding: 8 }}>{intervalsDisplay}</td>
                      <td style={{ padding: 8 }}>
                        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                          <Link to={`/supplemental/logs/${row.id}`} style={tableActionLinkStyle}>
                            View
                          </Link>
                          <button
                            type="button"
                            style={tableDangerButtonStyle}
                            onClick={async () => {
                              try {
                                const res = await fetch(`${API_BASE}/api/supplemental/log/${row.id}/delete/`, { method: "DELETE" });
                                if (!res.ok) throw new Error(`Delete ${res.status}`);
                                setData((prev) => (prev || []).filter((item) => item.id !== row.id));
                              } catch (e) {
                                alert(`Failed to delete: ${String(e.message || e)}`);
                              }
                            }}
                          >
                            Delete
                          </button>
                        </div>
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
