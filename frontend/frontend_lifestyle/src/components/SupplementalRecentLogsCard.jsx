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

export default function SupplementalRecentLogsCard() {
  const { data, loading, error, refetch, setData } = useApi(`${API_BASE}/api/supplemental/logs/?weeks=8`, { deps: [] });
  const rows = Array.isArray(data) ? data : [];

  const prepend = (row) => setData((prev) => [row, ...(prev || [])]);

  return (
    <>
      <SupplementalQuickLogCard
        ready={!loading}
        onLogged={(created) => {
          prepend(created);
          refetch();
        }}
      />

      <Card title="Recent Supplemental (8 weeks)" action={<button onClick={refetch} style={btnStyle}>Refresh</button>}>
        {loading && <div>Loading...</div>}
        {error && <div style={{ color: "#b91c1c" }}>Error: {String(error.message || error)}</div>}

        {!loading && !error && rows.length === 0 && (
          <div>No supplemental sessions logged in the last 8 weeks.</div>
        )}

        {!loading && !error && rows.length > 0 && (
          <div style={{ marginInline: "calc(50% - 50vw)", background: "white" }}>
            <table style={{ width: "100vw", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ textAlign: "left", borderBottom: "1px solid #e5e7eb" }}>
                  <th style={{ padding: 6 }}>Date</th>
                  <th style={{ padding: 6 }}>Routine</th>
                  <th style={{ padding: 6 }}>Unit</th>
                  <th style={{ padding: 6 }}>Goal</th>
                  <th style={{ padding: 6 }}>Total Completed</th>
                  <th style={{ padding: 6 }}>Details</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const dateDisplay = row.datetime_started ? new Date(row.datetime_started).toLocaleString() : "--";
                  const routineName = row.routine?.name ?? "--";
                  const routineUnit = row.routine?.unit ?? "--";
                  const goalDisplay = row.goal ?? "--";
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
                      <td style={{ padding: 8 }}>{routineName}</td>
                      <td style={{ padding: 8 }}>{routineUnit}</td>
                      <td style={{ padding: 8 }}>{goalDisplay}</td>
                      <td style={{ padding: 8 }}>{totalDisplay}</td>
                      <td style={{ padding: 8 }}>{detailSummary}</td>
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
