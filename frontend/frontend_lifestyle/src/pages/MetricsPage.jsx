import { useEffect, useMemo, useState } from "react";
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
  const [selectedFastKey, setSelectedFastKey] = useState("");

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
  const fastSourceDistanceMiles = Number(data?.fast?.source_distance_miles);
  const fastNextProgressionMiles = Number(data?.fast?.next_progression_miles);
  const rawTempoPeriods = Array.isArray(data?.tempo?.periods) ? data.tempo.periods : [];
  const rawMinRunPeriods = Array.isArray(data?.min_run?.periods) ? data.min_run.periods : [];
  const sprintWorkouts = Array.isArray(data?.sprints?.workouts) ? data.sprints.workouts : [];
  const x800Workout = sprintWorkouts.find((item) => item?.workout_name === "x800") ?? null;
  const fastPeriodsByKey = useMemo(
    () => Object.fromEntries(fastPeriods.map((period) => [period.key, period])),
    [fastPeriods],
  );
  const tempoPeriods = useMemo(
    () => rawTempoPeriods.map((period) => ({
      ...period,
      riegel: {
        ...(period?.riegel ?? {}),
        predicted_mph: fastPeriodsByKey[period.key]?.riegel?.predicted_mph ?? null,
      },
    })),
    [rawTempoPeriods, fastPeriodsByKey],
  );
  const minRunPeriods = useMemo(
    () => rawMinRunPeriods.map((period) => ({
      ...period,
      riegel: {
        ...(period?.riegel ?? {}),
        predicted_mph: getInheritedMinRunEasyMph(period, fastPeriodsByKey[period.key]),
      },
    })),
    [rawMinRunPeriods, fastPeriodsByKey],
  );
  const selectedFastPeriod = useMemo(
    () => fastPeriods.find((period) => period.key === selectedFastKey) ?? fastPeriods[0] ?? null,
    [fastPeriods, selectedFastKey],
  );
  const nextFastPreview = useMemo(
    () => buildNextFastPreview(selectedFastPeriod, {
      sourceDistanceMiles: fastSourceDistanceMiles,
      totalDistanceMiles: fastNextProgressionMiles,
    }),
    [selectedFastPeriod, fastSourceDistanceMiles, fastNextProgressionMiles],
  );

  useEffect(() => {
    if (fastPeriods.length === 0) {
      setSelectedFastKey("");
      return;
    }
    if (!fastPeriods.some((period) => period.key === selectedFastKey)) {
      setSelectedFastKey(fastPeriods[0].key);
    }
  }, [fastPeriods, selectedFastKey]);

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
        subtitle={`Riegel target: 10K (${formatNumber(conversions.ten_k_miles, 8)} miles) from ${formatNumber(fastSourceDistanceMiles, 1)} miles`}
        loading={loading}
        error={error}
        periods={fastPeriods}
        showMaxMph
        showAvgMph
        predictedColumnLabel="Predicted 10K MPH"
        easyColumnLabel="Predicted Easy MPH"
        note="When Current Max MPH is below 10.000 mph, Current Avg MPH and Date use the same log where that Max MPH was reached."
        selectableName="fast-period"
        selectedKey={selectedFastPeriod?.key ?? ""}
        onSelectKey={setSelectedFastKey}
      />

      <Card title="Next Fast" action={null}>
        {selectedFastPeriod && nextFastPreview ? (
          <div style={{ display: "grid", gap: 12 }}>
            <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
              <MetricStat label="Selected Period" value={selectedFastPeriod.label} />
              <MetricStat label="Next Max MPH" value={formatNextFastMph(nextFastPreview.nextMaxMph)} />
              <MetricStat label="Next Avg MPH" value={formatNextFastMph(nextFastPreview.nextAvgMph)} />
              <MetricStat label="Total Distance" value={formatMilesWord(nextFastPreview.totalDistanceMiles)} />
            </div>
            <div style={{ display: "grid", gap: 8 }}>
              <div style={{ border: "1px solid #e5e7eb", borderRadius: 10, padding: 12, background: "#f8fafc" }}>
                <div style={{ fontWeight: 700 }}>
                  First {formatMilesWord(nextFastPreview.firstDistanceMiles)}
                </div>
                <div style={{ color: "#475569", marginTop: 4 }}>
                  {formatNextFastMph(nextFastPreview.nextMaxMph)}
                  {nextFastPreview.firstDurationMinutes != null ? ` | ${formatDurationMinutes(nextFastPreview.firstDurationMinutes)}` : ""}
                </div>
              </div>
              <div style={{ border: "1px solid #e5e7eb", borderRadius: 10, padding: 12, background: "#f8fafc" }}>
                <div style={{ fontWeight: 700 }}>
                  Second {formatMilesWord(nextFastPreview.secondDistanceMiles)}
                </div>
                <div style={{ color: "#475569", marginTop: 4 }}>
                  {formatNextFastMph(nextFastPreview.secondSegmentMph)}
                  {nextFastPreview.secondDurationMinutes != null ? ` | ${formatDurationMinutes(nextFastPreview.secondDurationMinutes)}` : ""}
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div style={{ color: "#475569" }}>Select a Fast row to preview the next Fast workout.</div>
        )}
      </Card>

      <MetricsTableCard
        title="Tempo"
        subtitle="Current Avg MPH snapshots across the same history windows."
        loading={loading}
        error={error}
        periods={tempoPeriods}
        showAvgMph
        predictedColumnLabel="Predicted 10K MPH"
      />

      <MetricsTableCard
        title="Min Run"
        subtitle="Current Avg MPH snapshots across the same history windows."
        loading={loading}
        error={error}
        periods={minRunPeriods}
        showAvgMph
        predictedColumnLabel="Predicted Easy MPH"
        formatPredictedValue={formatNextFastMph}
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
          note={workout.workout_name === "x800"
            ? "When Current Max MPH is below 11.400 mph, Current Avg MPH and Date use the same log where that Max MPH was reached."
            : null}
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
  formatPredictedValue = formatMph,
  easyColumnLabel = null,
  strongerColumnLabel = null,
  note = null,
  selectableName = null,
  selectedKey = "",
  onSelectKey = null,
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
                  {selectableName ? <th style={{ padding: 8, width: 60 }}>Use</th> : null}
                  <th style={{ padding: 8 }}>Period</th>
                  {showMaxMph ? <th style={{ padding: 8 }}>Current Max MPH</th> : null}
                  {showAvgMph ? <th style={{ padding: 8 }}>Current Avg MPH</th> : null}
                  {predictedColumnLabel ? <th style={{ padding: 8 }}>{predictedColumnLabel}</th> : null}
                  {easyColumnLabel ? <th style={{ padding: 8 }}>{easyColumnLabel}</th> : null}
                  {strongerColumnLabel ? <th style={{ padding: 8 }}>{strongerColumnLabel}</th> : null}
                  <th style={{ padding: 8 }}>Date</th>
                </tr>
              </thead>
              <tbody>
                {periods.map((period) => (
                  <tr key={period.key} style={{ borderTop: "1px solid #e5e7eb" }}>
                    {selectableName ? (
                      <td style={{ padding: 8 }}>
                        <input
                          type="radio"
                          name={selectableName}
                          checked={selectedKey === period.key}
                          onChange={() => onSelectKey?.(period.key)}
                        />
                      </td>
                    ) : null}
                    <td style={{ padding: 8 }}>{period.label}</td>
                    {showMaxMph ? <td style={{ padding: 8 }}>{formatMph(period.max_mph)}</td> : null}
                    {showAvgMph ? <td style={{ padding: 8 }}>{formatMph(period.avg_mph)}</td> : null}
                    {predictedColumnLabel ? (
                      <td style={{ padding: 8 }}>{formatPredictedValue(period?.riegel?.predicted_mph)}</td>
                    ) : null}
                    {easyColumnLabel ? (
                      <td style={{ padding: 8 }}>{formatCeilingTenthMphRange(period?.riegel?.easy_low_mph, period?.riegel?.easy_high_mph)}</td>
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
      {note ? <div style={{ color: "#475569", marginTop: 10, fontSize: 13 }}>{note}</div> : null}
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

function formatCeilingTenthMphRange(lowValue, highValue) {
  const low = ceilingToNextTenth(lowValue);
  const high = ceilingToNextTenth(highValue);
  if (!Number.isFinite(low) || !Number.isFinite(high)) return "--";
  return `${low.toFixed(1)} to ${high.toFixed(1)} mph`;
}

function formatNextFastMph(value) {
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

function formatMilesWord(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return "--";
  return `${num.toFixed(1)} miles`;
}

function formatDurationMinutes(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return "--";
  const totalSeconds = Math.round(num * 60);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds - (minutes * 60);
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
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

function ceilingToNextTenth(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return null;
  return (Math.floor((num * 10) + 1e-9) + 1) / 10;
}

function getInheritedMinRunEasyMph(minRunPeriod, fastPeriod) {
  const easyFloor = ceilingToNextTenth(fastPeriod?.riegel?.easy_low_mph);
  const easyCeiling = ceilingToNextTenth(fastPeriod?.riegel?.easy_high_mph);
  const currentAvg = Number(minRunPeriod?.avg_mph);
  if (!Number.isFinite(easyFloor) || !Number.isFinite(easyCeiling)) {
    return null;
  }

  const lowerBound = Math.min(easyFloor, easyCeiling);
  const upperBound = Math.max(easyFloor, easyCeiling);
  let adjusted = lowerBound;

  while (Number.isFinite(currentAvg) && adjusted <= currentAvg && adjusted < upperBound) {
    adjusted = Number((adjusted + 0.1).toFixed(1));
  }

  return Math.min(adjusted, upperBound);
}

function buildNextFastPreview(period, { sourceDistanceMiles, totalDistanceMiles }) {
  if (!period) return null;
  const nextMaxMph = ceilingToNextTenth(period.max_mph);
  const nextAvgMph = ceilingToNextTenth(period.avg_mph);
  const sourceMiles = Number(sourceDistanceMiles);
  const totalMiles = Number(totalDistanceMiles);
  const safeSourceMiles = Number.isFinite(sourceMiles) && sourceMiles > 0 ? sourceMiles : null;
  const safeTotalMiles = Number.isFinite(totalMiles) && totalMiles > 0
    ? totalMiles
    : safeSourceMiles;
  if (nextMaxMph == null || nextAvgMph == null || safeSourceMiles == null || safeTotalMiles == null) {
    return null;
  }

  const firstDistanceMiles = Math.min(safeSourceMiles, safeTotalMiles);
  const secondDistanceMiles = Math.max(0, safeTotalMiles - firstDistanceMiles);
  const firstDurationHours = firstDistanceMiles / nextMaxMph;
  const totalDurationHours = safeTotalMiles / nextAvgMph;
  let secondDurationHours = secondDistanceMiles > 0 ? totalDurationHours - firstDurationHours : 0;
  if (!Number.isFinite(secondDurationHours) || secondDurationHours <= 0) {
    secondDurationHours = secondDistanceMiles > 0 ? (secondDistanceMiles / nextAvgMph) : 0;
  }
  let secondSegmentMph = secondDistanceMiles > 0 ? (secondDistanceMiles / secondDurationHours) : nextAvgMph;
  if (!Number.isFinite(secondSegmentMph) || secondSegmentMph <= 0) {
    secondSegmentMph = nextAvgMph;
  }
  if (secondSegmentMph > nextMaxMph) {
    secondSegmentMph = nextMaxMph;
  }

  return {
    nextMaxMph,
    nextAvgMph,
    totalDistanceMiles: safeTotalMiles,
    firstDistanceMiles,
    secondDistanceMiles,
    firstDurationMinutes: firstDistanceMiles > 0 ? firstDurationHours * 60 : null,
    secondDurationMinutes: secondDistanceMiles > 0 ? (secondDistanceMiles / secondSegmentMph) * 60 : null,
    secondSegmentMph,
  };
}
