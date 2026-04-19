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
  const tempoPeriods = Array.isArray(data?.tempo?.periods) ? data.tempo.periods : [];
  const minRunPeriods = Array.isArray(data?.min_run?.periods) ? data.min_run.periods : [];
  const sprintWorkouts = Array.isArray(data?.sprints?.workouts) ? data.sprints.workouts : [];
  const x800Workout = sprintWorkouts.find((item) => item?.workout_name === "x800") ?? null;

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
        periods={fastPeriods}
        showMaxMph
        showAvgMph
        predictedColumnLabel="Predicted 10K MPH"
      />

      <MetricsTableCard
        title="Tempo"
        subtitle="Current Avg MPH snapshots across the same history windows."
        loading={loading}
        error={error}
        periods={tempoPeriods}
        showAvgMph
      />

      <MetricsTableCard
        title="Min Run"
        subtitle="Current Avg MPH snapshots across the same history windows."
        loading={loading}
        error={error}
        periods={minRunPeriods}
        showAvgMph
      />

      {sprintWorkouts.map((workout) => (
        <MetricsTableCard
          key={workout.workout_name}
          title={workout.workout_name}
          subtitle={
            workout.workout_name === "x800"
              ? `${formatNumber(workout.distance_miles, 3)} mi | ${formatNumber(workout.distance_meters, 0)} m | ${formatNumber(workout.distance_yards, 0)} yd`
              : `Riegel from x800 (${formatNumber(x800Workout?.distance_miles, 3)} miles) to ${workout.workout_name} (${formatNumber(workout.distance_miles, 3)} miles)`
          }
          loading={loading}
          error={error}
          periods={Array.isArray(workout.periods) ? workout.periods : []}
          showMaxMph
          showAvgMph
          predictedColumnLabel={workout.workout_name === "x800" ? null : `Predicted ${workout.workout_name} MPH`}
          strongerColumnLabel={workout.workout_name === "x800" ? null : "Higher Of Max / Predicted"}
        />
      ))}
    </div>
  );
}

function MetricsTableCard({
  title,
  subtitle,
  loading,
  error,
  periods,
  showMaxMph = false,
  showAvgMph = false,
  predictedColumnLabel = null,
  strongerColumnLabel = null,
}) {
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
                  {showMaxMph ? <th style={{ padding: 8 }}>Current Max MPH</th> : null}
                  {showAvgMph ? <th style={{ padding: 8 }}>Current Avg MPH</th> : null}
                  {predictedColumnLabel ? <th style={{ padding: 8 }}>{predictedColumnLabel}</th> : null}
                  {strongerColumnLabel ? <th style={{ padding: 8 }}>{strongerColumnLabel}</th> : null}
                  <th style={{ padding: 8 }}>Date</th>
                </tr>
              </thead>
              <tbody>
                {periods.map((period) => (
                  <tr key={period.key} style={{ borderTop: "1px solid #e5e7eb" }}>
                    <td style={{ padding: 8 }}>{period.label}</td>
                    {showMaxMph ? <td style={{ padding: 8 }}>{formatMph(period.max_mph)}</td> : null}
                    {showAvgMph ? <td style={{ padding: 8 }}>{formatMph(period.avg_mph)}</td> : null}
                    {predictedColumnLabel ? (
                      <td style={{ padding: 8 }}>{formatMph(period?.riegel?.predicted_mph)}</td>
                    ) : null}
                    {strongerColumnLabel ? (
                      <td style={{ padding: 8 }}>{formatMph(period.max_or_predicted_mph)}</td>
                    ) : null}
                    <td style={{ padding: 8 }}>{formatPeriodDates(period, { showMaxMph, showAvgMph })}</td>
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
  return Number.isFinite(num) ? `${num.toFixed(3)} mph` : "--";
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

function formatPeriodDates(period, { showMaxMph, showAvgMph }) {
  const maxDate = formatDateLabel(period?.max_activity_date);
  const avgDate = formatDateLabel(period?.avg_activity_date);

  if (showMaxMph && showAvgMph) {
    if (maxDate === "--" && avgDate === "--") return "--";
    if (maxDate === avgDate) return maxDate;
    return `Max: ${maxDate} | Avg: ${avgDate}`;
  }
  if (showMaxMph) return maxDate;
  if (showAvgMph) return avgDate;
  return "--";
}
