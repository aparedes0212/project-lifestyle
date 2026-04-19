import { useEffect } from "react";
import Card from "../components/ui/Card";
import useApi from "../hooks/useApi";
import { API_BASE } from "../lib/config";

const btnStyle = {
  border: "1px solid #e5e7eb",
  background: "#f9fafb",
  borderRadius: 8,
  padding: "8px 14px",
  cursor: "pointer",
};

const DISTANCE_CONVERSIONS_UPDATED_EVENT = "distance-conversions-updated";

export default function MetricsPage() {
  const { data, loading, error, refetch } = useApi(`${API_BASE}/api/metrics/cardio/`, { deps: [] });

  useEffect(() => {
    const handleUpdated = () => {
      refetch();
    };
    window.addEventListener(DISTANCE_CONVERSIONS_UPDATED_EVENT, handleUpdated);
    return () => {
      window.removeEventListener(DISTANCE_CONVERSIONS_UPDATED_EVENT, handleUpdated);
    };
  }, [refetch]);

  const conversions = data?.conversions ?? {};
  const fastPeriods = Array.isArray(data?.fast?.periods) ? data.fast.periods : [];
  const sprintWorkouts = Array.isArray(data?.sprints?.workouts) ? data.sprints.workouts : [];

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <Card
        title="Metrics"
        action={(
          <button type="button" style={btnStyle} onClick={refetch}>
            Refresh
          </button>
        )}
      >
        <div style={{ color: "#475569", lineHeight: 1.6 }}>
          Current cardio snapshots based on rolling history windows, plus the Riegel projections driven by the shared distance conversion settings.
        </div>
      </Card>

      <Card title="Distance Assumptions" action={null}>
        {loading && <div>Loading...</div>}
        {error && <div style={{ color: "#b91c1c" }}>Error: {String(error.message || error)}</div>}
        {!loading && !error && (
          <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
            <MetricStat label="10K" value={`${formatNumber(conversions.ten_k_miles, 8)} mi`} />
            <MetricStat label="x800" value={formatSprintDistance(conversions, "x800")} />
            <MetricStat label="x400" value={formatSprintDistance(conversions, "x400")} />
            <MetricStat label="x200" value={formatSprintDistance(conversions, "x200")} />
          </div>
        )}
      </Card>

      <MetricsTableCard
        title="Fast"
        subtitle={`Riegel target: 10K (${formatNumber(conversions.ten_k_miles, 8)} miles) from 3.0 miles`}
        loading={loading}
        error={error}
        predictedColumnLabel="Predicted 10K MPH"
        periods={fastPeriods}
      />

      {sprintWorkouts.map((workout) => (
        <MetricsTableCard
          key={workout.workout_name}
          title={workout.workout_name}
          subtitle={
            workout.workout_name === "x800"
              ? `${formatNumber(workout.distance_miles, 3)} mi | ${formatNumber(workout.distance_meters, 0)} m | ${formatNumber(workout.distance_yards, 0)} yd`
              : `Riegel from x800 (${formatNumber(sprintWorkouts.find((item) => item.workout_name === "x800")?.distance_miles, 3)} miles) to ${workout.workout_name} (${formatNumber(workout.distance_miles, 3)} miles)`
          }
          loading={loading}
          error={error}
          predictedColumnLabel={workout.workout_name === "x800" ? null : `Predicted ${workout.workout_name} MPH`}
          periods={Array.isArray(workout.periods) ? workout.periods : []}
        />
      ))}
    </div>
  );
}

function MetricsTableCard({ title, subtitle, loading, error, periods, predictedColumnLabel }) {
  return (
    <Card title={title} action={null}>
      {subtitle ? <div style={{ color: "#475569", marginBottom: 10 }}>{subtitle}</div> : null}
      {loading && <div>Loading...</div>}
      {error && <div style={{ color: "#b91c1c" }}>Error: {String(error.message || error)}</div>}
      {!loading && !error && (
        periods.length > 0 ? (
          <div style={{ overflowX: "auto", border: "1px solid #e5e7eb", borderRadius: 10 }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ textAlign: "left", background: "#f8fafc" }}>
                  <th style={{ padding: 8 }}>Period</th>
                  <th style={{ padding: 8 }}>Current Max MPH</th>
                  {predictedColumnLabel ? <th style={{ padding: 8 }}>{predictedColumnLabel}</th> : null}
                  <th style={{ padding: 8 }}>Date</th>
                </tr>
              </thead>
              <tbody>
                {periods.map((period) => (
                  <tr key={period.key} style={{ borderTop: "1px solid #e5e7eb" }}>
                    <td style={{ padding: 8 }}>{period.label}</td>
                    <td style={{ padding: 8 }}>{formatMph(period.max_mph)}</td>
                    {predictedColumnLabel ? (
                      <td style={{ padding: 8 }}>{formatMph(period?.riegel?.predicted_mph)}</td>
                    ) : null}
                    <td style={{ padding: 8 }}>{formatDateLabel(period.activity_date)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div style={{ color: "#475569" }}>No data available.</div>
        )
      )}
    </Card>
  );
}

function MetricStat({ label, value }) {
  return (
    <div style={{ border: "1px solid #e5e7eb", borderRadius: 10, padding: 12, background: "#f8fafc" }}>
      <div style={{ fontSize: 12, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.04em" }}>
        {label}
      </div>
      <div style={{ fontSize: 18, fontWeight: 700, marginTop: 4, color: "#0f172a" }}>
        {value || "--"}
      </div>
    </div>
  );
}

function formatMph(value) {
  const num = Number(value);
  return Number.isFinite(num) ? `${num.toFixed(1)} mph` : "--";
}

function formatNumber(value, digits = 3) {
  const num = Number(value);
  return Number.isFinite(num) ? num.toFixed(digits) : "--";
}

function formatDateLabel(value) {
  if (!value) return "--";
  const date = new Date(`${value}T12:00:00`);
  if (!Number.isFinite(date.getTime())) return String(value);
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function formatSprintDistance(conversions, key) {
  const miles = formatNumber(conversions?.[`${key}_miles`], 3);
  const meters = formatNumber(conversions?.[`${key}_meters`], 0);
  const yards = formatNumber(conversions?.[`${key}_yards`], 0);
  if (miles === "--" && meters === "--" && yards === "--") return "--";
  return `${miles} mi | ${meters} m | ${yards} yd`;
}
