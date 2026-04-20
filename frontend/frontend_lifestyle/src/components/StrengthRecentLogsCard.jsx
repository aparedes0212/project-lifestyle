import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import useApi from "../hooks/useApi";
import { API_BASE } from "../lib/config";
import { formatNumber } from "../lib/numberFormat";
import { tableActionLinkStyle, tableDangerButtonStyle } from "../lib/tableActions";
import StrengthQuickLogCard from "./StrengthQuickLogCard";
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
  minWidth: 1220,
  borderCollapse: "collapse",
};

export default function StrengthRecentLogsCard() {
  const { data, loading, error, refetch, setData } = useApi(`${API_BASE}/api/strength/logs/?weeks=8`, { deps: [] });
  const rows = useMemo(() => {
    const normalize = (value) => {
      const ts = value ? new Date(value).getTime() : Number.NaN;
      return Number.isFinite(ts) ? ts : -Infinity;
    };
    return (data || [])
      .slice()
      .sort((a, b) => normalize(b?.datetime_started) - normalize(a?.datetime_started));
  }, [data]);

  const [deletingId, setDeletingId] = useState(null);
  const [deleteErr, setDeleteErr] = useState(null);
  const [ignoreUpdatingId, setIgnoreUpdatingId] = useState(null);
  const [ignoreErr, setIgnoreErr] = useState(null);

  const formatRepsValue = (value) => {
    if (value === null || value === undefined) return "\u2014";
    const formatted = formatNumber(value, 2);
    return formatted !== "" ? formatted : "0";
  };

  const formatNumericValue = (value, precision = 2) => {
    if (value === null || value === undefined) return "\u2014";
    const formatted = formatNumber(value, precision);
    return formatted !== "" ? formatted : "0";
  };

  const prepend = (row) => setData((prev) => [row, ...(prev || [])]);

  const handleDelete = async (id) => {
    if (!confirm("Delete this daily log and all its sets?")) return;
    setDeletingId(id);
    setDeleteErr(null);
    try {
      const res = await fetch(`${API_BASE}/api/strength/log/${id}/delete/`, { method: "DELETE" });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      setData((prev) => (prev || []).filter((row) => row.id !== id));
    } catch (e) {
      setDeleteErr(e);
    } finally {
      setDeletingId(null);
    }
  };

  const handleToggleIgnore = async (id, nextValue) => {
    setIgnoreUpdatingId(id);
    setIgnoreErr(null);
    try {
      const res = await fetch(`${API_BASE}/api/strength/log/${id}/`, {
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
      <StrengthQuickLogCard
        ready={!loading}
        onLogged={(created) => {
          prepend(created);
          refetch();
        }}
      />

      <Card title="Recent Strength (8 weeks)" action={<button onClick={refetch} style={btnStyle}>Refresh</button>}>
        {loading && <div>Loading.</div>}
        {error && <div style={{ color: "#b91c1c" }}>Error: {String(error.message || error)}</div>}
        {deleteErr && <div style={{ color: "#b91c1c", marginBottom: 8 }}>Delete error: {String(deleteErr.message || deleteErr)}</div>}
        {ignoreErr && <div style={{ color: "#b91c1c", marginBottom: 8 }}>Ignore toggle error: {String(ignoreErr.message || ignoreErr)}</div>}

        {!loading && !error && (
          <div style={tableWrapStyle}>
            <table style={tableStyle}>
              <thead>
                <tr style={{ textAlign: "left", borderBottom: "1px solid #e5e7eb" }}>
                  <th style={{ padding: 6 }}>Ignore</th>
                  <th style={{ padding: 6 }}>Date</th>
                  <th style={{ padding: 6 }}>Routine</th>
                  <th style={{ padding: 6 }}>Rep Goal</th>
                  <th style={{ padding: 6 }}>Total Reps</th>
                  <th style={{ padding: 6 }}>Max Reps Goal</th>
                  <th style={{ padding: 6 }}>Max Reps</th>
                  <th style={{ padding: 6 }}>Max Weight Goal</th>
                  <th style={{ padding: 6 }}>Max Weight</th>
                  <th style={{ padding: 6 }}>Minutes</th>
                  <th style={{ padding: 6 }}>RPH</th>
                  <th style={{ padding: 6 }}>RPH Goal</th>
                  <th style={{ padding: 6 }}>RPH Avg</th>
                  <th style={{ padding: 6 }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const repGoalDisplay = formatRepsValue(row.rep_goal);
                  const totalRepsDisplay = formatRepsValue(row.total_reps_completed);
                  const maxRepsGoalDisplay = formatRepsValue(row.max_reps_goal);
                  const maxRepsDisplay = formatRepsValue(row.max_reps);
                  const maxWeightGoalDisplay = formatNumericValue(row.max_weight_goal, 2);
                  const maxWeightDisplay = formatNumericValue(row.max_weight, 2);
                  const minutesDisplay = formatNumericValue(row.minutes_elapsed, 2);
                  const dateDisplay = row.datetime_started ? new Date(row.datetime_started).toLocaleString() : "\u2014";
                  const routineName = row.routine?.name || "\u2014";
                  const rph = (() => {
                    const total = Number(row.total_reps_completed);
                    const minsRaw = Number(row.minutes_elapsed);
                    const mins = Math.abs(minsRaw);
                    if (!Number.isFinite(total) || !Number.isFinite(mins) || mins <= 0) return null;
                    return total / (mins / 60);
                  })();

                  return (
                    <tr key={row.id} style={{ borderTop: "1px solid #f3f4f6" }}>
                      <td style={{ padding: 8 }}>
                        <input
                          type="checkbox"
                          checked={!!row.ignore}
                          onChange={(e) => handleToggleIgnore(row.id, e.target.checked)}
                          disabled={ignoreUpdatingId === row.id}
                          aria-label={`Ignore log ${row.id}`}
                        />
                      </td>
                      <td style={{ padding: 8 }}>{dateDisplay}</td>
                      <td style={{ padding: 8 }}>{routineName}</td>
                      <td style={{ padding: 8 }}>{repGoalDisplay}</td>
                      <td style={{ padding: 8 }}>{totalRepsDisplay}</td>
                      <td style={{ padding: 8 }}>{maxRepsGoalDisplay}</td>
                      <td style={{ padding: 8 }}>{maxRepsDisplay}</td>
                      <td style={{ padding: 8 }}>{maxWeightGoalDisplay}</td>
                      <td style={{ padding: 8 }}>{maxWeightDisplay}</td>
                      <td style={{ padding: 8 }}>{minutesDisplay}</td>
                      <td style={{ padding: 8 }}>{rph != null ? formatNumericValue(rph, 1) : "\u2014"}</td>
                      <td style={{ padding: 8 }}>{row.rph_goal != null ? formatNumericValue(row.rph_goal, 1) : "\u2014"}</td>
                      <td style={{ padding: 8 }}>{row.rph_goal_avg != null ? formatNumericValue(row.rph_goal_avg, 1) : "\u2014"}</td>
                      <td style={{ padding: 8 }}>
                        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                          <Link to={`/strength/logs/${row.id}`} style={tableActionLinkStyle}>
                            View
                          </Link>
                          <button
                            type="button"
                            style={tableDangerButtonStyle}
                            aria-label={`Delete log ${row.id}`}
                            title="Delete log"
                            onClick={() => handleDelete(row.id)}
                            disabled={deletingId === row.id}
                          >
                            {deletingId === row.id ? "Deleting..." : "Delete"}
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
