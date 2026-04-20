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
  const [selectedTempoKey, setSelectedTempoKey] = useState("");
  const [selectedMinRunKey, setSelectedMinRunKey] = useState("");
  const [selectedX800Key, setSelectedX800Key] = useState("");
  const [selectedX400Key, setSelectedX400Key] = useState("");
  const [selectedX200Key, setSelectedX200Key] = useState("");

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
  const tempoGoalMinutes = Number(data?.tempo?.goal_distance);
  const tempoNextProgressionMinutes = Number(data?.tempo?.next_progression);
  const rawTempoPeriods = Array.isArray(data?.tempo?.periods) ? data.tempo.periods : [];
  const minRunGoalMinutes = Number(data?.min_run?.goal_distance);
  const minRunNextProgressionMinutes = Number(data?.min_run?.next_progression);
  const rawMinRunPeriods = Array.isArray(data?.min_run?.periods) ? data.min_run.periods : [];
  const sprintWorkouts = Array.isArray(data?.sprints?.workouts) ? data.sprints.workouts : [];
  const x800Workout = sprintWorkouts.find((item) => item?.workout_name === "x800") ?? null;
  const x400Workout = sprintWorkouts.find((item) => item?.workout_name === "x400") ?? null;
  const x200Workout = sprintWorkouts.find((item) => item?.workout_name === "x200") ?? null;
  const x800Periods = Array.isArray(x800Workout?.periods) ? x800Workout.periods : [];
  const x400Periods = Array.isArray(x400Workout?.periods) ? x400Workout.periods : [];
  const x200Periods = Array.isArray(x200Workout?.periods) ? x200Workout.periods : [];
  const x800DistanceMiles = Number(x800Workout?.distance_miles);
  const x400DistanceMiles = Number(x400Workout?.distance_miles);
  const x200DistanceMiles = Number(x200Workout?.distance_miles);
  const x800NextProgression = Number(x800Workout?.next_progression);
  const x400NextProgression = Number(x400Workout?.next_progression);
  const x200NextProgression = Number(x200Workout?.next_progression);
  const savedFastKey = String(data?.fast?.selected_period_key || "");
  const savedTempoKey = String(data?.tempo?.selected_period_key || "");
  const savedMinRunKey = String(data?.min_run?.selected_period_key || "");
  const savedX800Key = String(x800Workout?.selected_period_key || "");
  const savedX400Key = String(x400Workout?.selected_period_key || "");
  const savedX200Key = String(x200Workout?.selected_period_key || "");
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
  const selectedTempoPeriod = useMemo(
    () => tempoPeriods.find((period) => period.key === selectedTempoKey) ?? tempoPeriods[0] ?? null,
    [tempoPeriods, selectedTempoKey],
  );
  const selectedMinRunPeriod = useMemo(
    () => minRunPeriods.find((period) => period.key === selectedMinRunKey) ?? minRunPeriods[0] ?? null,
    [minRunPeriods, selectedMinRunKey],
  );
  const selectedX800Period = useMemo(
    () => x800Periods.find((period) => period.key === selectedX800Key) ?? x800Periods[0] ?? null,
    [x800Periods, selectedX800Key],
  );
  const selectedX400Period = useMemo(
    () => x400Periods.find((period) => period.key === selectedX400Key) ?? x400Periods[0] ?? null,
    [x400Periods, selectedX400Key],
  );
  const selectedX200Period = useMemo(
    () => x200Periods.find((period) => period.key === selectedX200Key) ?? x200Periods[0] ?? null,
    [x200Periods, selectedX200Key],
  );
  const nextFastPreview = useMemo(
    () => buildNextFastPreview(selectedFastPeriod, {
      sourceDistanceMiles: fastSourceDistanceMiles,
      totalDistanceMiles: fastNextProgressionMiles,
    }),
    [selectedFastPeriod, fastSourceDistanceMiles, fastNextProgressionMiles],
  );
  const nextTempoPreview = useMemo(
    () => buildNextTempoPreview(selectedTempoPeriod, {
      intervalMinutes: tempoGoalMinutes,
      totalMinutes: tempoNextProgressionMinutes,
    }),
    [selectedTempoPeriod, tempoGoalMinutes, tempoNextProgressionMinutes],
  );
  const nextMinRunPreview = useMemo(
    () => buildNextMinRunPreview(selectedMinRunPeriod, {
      closingBlockMinutes: minRunGoalMinutes,
      totalMinutes: minRunNextProgressionMinutes,
    }),
    [selectedMinRunPeriod, minRunGoalMinutes, minRunNextProgressionMinutes],
  );
  const nextX800Preview = useMemo(
    () => buildNextX800Preview(selectedX800Period, {
      intervalCount: x800NextProgression,
      intervalDistanceMiles: x800DistanceMiles,
    }),
    [selectedX800Period, x800NextProgression, x800DistanceMiles],
  );
  const nextX400Preview = useMemo(
    () => buildNextPredictedSprintPreview(selectedX400Period, {
      intervalCount: x400NextProgression,
      intervalDistanceMiles: x400DistanceMiles,
      predictedMph: selectedX400Period?.riegel?.predicted_mph,
    }),
    [selectedX400Period, x400NextProgression, x400DistanceMiles],
  );
  const nextX200Preview = useMemo(
    () => buildNextPredictedSprintPreview(selectedX200Period, {
      intervalCount: x200NextProgression,
      intervalDistanceMiles: x200DistanceMiles,
      predictedMph: selectedX200Period?.riegel?.predicted_mph,
    }),
    [selectedX200Period, x200NextProgression, x200DistanceMiles],
  );

  const persistSelectedPeriod = async (workoutName, periodKey) => {
    if (!workoutName || !periodKey) return;
    try {
      await fetch(`${API_BASE}/api/metrics/cardio/`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workout_name: workoutName, period_key: periodKey }),
      });
    } catch {
      // Keep the local selection even if persistence fails.
    }
  };

  const handleSelectPeriod = (workoutName, setter) => (periodKey) => {
    setter(periodKey);
    void persistSelectedPeriod(workoutName, periodKey);
  };

  useEffect(() => {
    if (fastPeriods.length === 0) {
      setSelectedFastKey("");
      return;
    }
    if (!fastPeriods.some((period) => period.key === selectedFastKey)) {
      setSelectedFastKey(savedFastKey && fastPeriods.some((period) => period.key === savedFastKey) ? savedFastKey : fastPeriods[0].key);
    }
  }, [fastPeriods, savedFastKey, selectedFastKey]);

  useEffect(() => {
    if (tempoPeriods.length === 0) {
      setSelectedTempoKey("");
      return;
    }
    if (!tempoPeriods.some((period) => period.key === selectedTempoKey)) {
      setSelectedTempoKey(savedTempoKey && tempoPeriods.some((period) => period.key === savedTempoKey) ? savedTempoKey : tempoPeriods[0].key);
    }
  }, [tempoPeriods, savedTempoKey, selectedTempoKey]);

  useEffect(() => {
    if (minRunPeriods.length === 0) {
      setSelectedMinRunKey("");
      return;
    }
    if (!minRunPeriods.some((period) => period.key === selectedMinRunKey)) {
      setSelectedMinRunKey(savedMinRunKey && minRunPeriods.some((period) => period.key === savedMinRunKey) ? savedMinRunKey : minRunPeriods[0].key);
    }
  }, [minRunPeriods, savedMinRunKey, selectedMinRunKey]);

  useEffect(() => {
    if (x800Periods.length === 0) {
      setSelectedX800Key("");
      return;
    }
    if (!x800Periods.some((period) => period.key === selectedX800Key)) {
      setSelectedX800Key(savedX800Key && x800Periods.some((period) => period.key === savedX800Key) ? savedX800Key : x800Periods[0].key);
    }
  }, [x800Periods, savedX800Key, selectedX800Key]);

  useEffect(() => {
    if (x400Periods.length === 0) {
      setSelectedX400Key("");
      return;
    }
    if (!x400Periods.some((period) => period.key === selectedX400Key)) {
      setSelectedX400Key(savedX400Key && x400Periods.some((period) => period.key === savedX400Key) ? savedX400Key : x400Periods[0].key);
    }
  }, [x400Periods, savedX400Key, selectedX400Key]);

  useEffect(() => {
    if (x200Periods.length === 0) {
      setSelectedX200Key("");
      return;
    }
    if (!x200Periods.some((period) => period.key === selectedX200Key)) {
      setSelectedX200Key(savedX200Key && x200Periods.some((period) => period.key === savedX200Key) ? savedX200Key : x200Periods[0].key);
    }
  }, [x200Periods, savedX200Key, selectedX200Key]);

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
        onSelectKey={handleSelectPeriod("Fast", setSelectedFastKey)}
      />

      <Card title="Next Fast" action={null}>
        {selectedFastPeriod && nextFastPreview ? (
          <div style={{ display: "grid", gap: 12 }}>
            <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
              <MetricStat label="Selected Period" value={selectedFastPeriod.label} />
              <MetricStat label="Next Avg MPH" value={formatNextFastMph(nextFastPreview.nextAvgMph)} />
              <MetricStat label="Next Max MPH" value={formatNextFastMph(nextFastPreview.nextMaxMph)} />
              <MetricStat label="Total Time" value={formatDurationMinutes(nextFastPreview.totalMinutes, "floor")} />
              <MetricStat label="Total Distance" value={formatMilesPreviewTotal(nextFastPreview.totalDistanceMiles)} />
              <MetricStat label="Blocks" value={String(nextFastPreview.segments.length)} />
            </div>
            <SegmentPreviewTable
              title="Fast Blocks"
              rowLabel="Block"
              segments={nextFastPreview.segments}
              mphFormatter={formatNextFastMph}
              totalDistanceMiles={nextFastPreview.totalDistanceMiles}
              totalMinutes={nextFastPreview.totalMinutes}
              timeRounding="floor"
            />
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
        selectableName="tempo-period"
        selectedKey={selectedTempoPeriod?.key ?? ""}
        onSelectKey={handleSelectPeriod("Tempo", setSelectedTempoKey)}
      />

      <Card title="Next Tempo" action={null}>
        {selectedTempoPeriod && nextTempoPreview ? (
          <div style={{ display: "grid", gap: 12 }}>
            <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
              <MetricStat label="Selected Period" value={selectedTempoPeriod.label} />
              <MetricStat label="Current Avg MPH" value={formatNextFastMph(nextTempoPreview.currentAvgMph)} />
              <MetricStat label="Next Max MPH" value={formatNextFastMph(nextTempoPreview.nextMaxMph)} />
              <MetricStat label="Total Time" value={formatDurationMinutes(nextTempoPreview.totalMinutes)} />
              <MetricStat label="Total Distance" value={formatMilesPreviewTotal(nextTempoPreview.totalDistanceMiles)} />
              <MetricStat label="Intervals" value={String(nextTempoPreview.intervals.length)} />
            </div>
            <SegmentPreviewTable
              title="Tempo Intervals"
              rowLabel="Interval"
              segments={nextTempoPreview.intervals}
              mphFormatter={formatNextFastMph}
              totalDistanceMiles={nextTempoPreview.totalDistanceMiles}
              totalMinutes={nextTempoPreview.totalMinutes}
            />
          </div>
        ) : (
          <div style={{ color: "#475569" }}>Select a Tempo row to preview the next Tempo workout.</div>
        )}
      </Card>

      <MetricsTableCard
        title="Min Run"
        subtitle="Current Avg MPH snapshots across the same history windows."
        loading={loading}
        error={error}
        periods={minRunPeriods}
        showAvgMph
        formatAvgValue={formatNextFastMph}
        predictedColumnLabel="Predicted Easy MPH"
        formatPredictedValue={formatNextFastMph}
        selectableName="min-run-period"
        selectedKey={selectedMinRunPeriod?.key ?? ""}
        onSelectKey={handleSelectPeriod("Min Run", setSelectedMinRunKey)}
      />

      <Card title="Next Min Run" action={null}>
        {selectedMinRunPeriod && nextMinRunPreview ? (
          <div style={{ display: "grid", gap: 12 }}>
            <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
              <MetricStat label="Selected Period" value={selectedMinRunPeriod.label} />
              <MetricStat label="Current Avg MPH" value={formatNextFastMph(nextMinRunPreview.currentAvgMph)} />
              <MetricStat label="Next Max MPH" value={formatNextFastMph(nextMinRunPreview.nextMaxMph)} />
              <MetricStat label="Total Time" value={formatDurationMinutes(nextMinRunPreview.totalMinutes)} />
              <MetricStat label="Total Distance" value={formatMilesPreviewTotal(nextMinRunPreview.totalDistanceMiles)} />
              <MetricStat label="Blocks" value={String(nextMinRunPreview.segments.length)} />
            </div>
            <SegmentPreviewTable
              title="Min Run Blocks"
              rowLabel="Block"
              segments={nextMinRunPreview.segments}
              mphFormatter={formatNextFastMph}
              totalDistanceMiles={nextMinRunPreview.totalDistanceMiles}
              totalMinutes={nextMinRunPreview.totalMinutes}
            />
          </div>
        ) : (
          <div style={{ color: "#475569" }}>Select a Min Run row to preview the next Min Run workout.</div>
        )}
      </Card>

      <MetricsTableCard
        title="x800"
        subtitle={`${formatNumber(x800Workout?.distance_miles, 3)} mi | ${formatNumber(x800Workout?.distance_meters, 0)} m | ${formatNumber(x800Workout?.distance_yards, 0)} yd`}
        loading={loading}
        error={error}
        periods={x800Periods}
        showMaxMph
        showAvgMph
        selectableName="x800-period"
        selectedKey={selectedX800Period?.key ?? ""}
        onSelectKey={handleSelectPeriod("x800", setSelectedX800Key)}
        note="When Current Max MPH is below 11.400 mph, Current Avg MPH and Date use the same log where that Max MPH was reached."
      />

      <Card title="Next x800" action={null}>
        {selectedX800Period && nextX800Preview ? (
          <div style={{ display: "grid", gap: 12 }}>
            <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
              <MetricStat label="Selected Period" value={selectedX800Period.label} />
              <MetricStat label="Current Avg MPH" value={formatNextFastMph(nextX800Preview.currentAvgMph)} />
              <MetricStat label="Next Max MPH" value={formatNextFastMph(nextX800Preview.nextMaxMph)} />
              <MetricStat label="Total Time" value={formatDurationMinutes(nextX800Preview.totalMinutes, "floor")} />
              <MetricStat label="Total Distance" value={formatMilesPreviewTotal(nextX800Preview.totalDistanceMiles)} />
              <MetricStat label="Intervals" value={String(nextX800Preview.intervals.length)} />
            </div>
            <SegmentPreviewTable
              title="x800 Intervals"
              rowLabel="Interval"
              segments={nextX800Preview.intervals}
              mphFormatter={formatNextFastMph}
              totalDistanceMiles={nextX800Preview.totalDistanceMiles}
              totalMinutes={nextX800Preview.totalMinutes}
              timeRounding="floor"
            />
          </div>
        ) : (
          <div style={{ color: "#475569" }}>Select an x800 row to preview the next x800 workout.</div>
        )}
      </Card>

      <MetricsTableCard
        title="x400"
        subtitle={`Riegel from x800 (${formatNumber(x800Workout?.distance_miles, 3)} miles) to x400 (${formatNumber(x400Workout?.distance_miles, 3)} miles)`}
        loading={loading}
        error={error}
        periods={x400Periods}
        showMaxMph
        showAvgMph
        predictedColumnLabel="Predicted x400 MPH"
        strongerColumnLabel="Higher Of Max / Predicted"
        selectableName="x400-period"
        selectedKey={selectedX400Period?.key ?? ""}
        onSelectKey={handleSelectPeriod("x400", setSelectedX400Key)}
      />

      <Card title="Next x400" action={null}>
        {selectedX400Period && nextX400Preview ? (
          <div style={{ display: "grid", gap: 12 }}>
            <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
              <MetricStat label="Selected Period" value={selectedX400Period.label} />
              <MetricStat label="Current Avg MPH" value={formatNextFastMph(nextX400Preview.currentAvgMph)} />
              <MetricStat label="Next Max MPH" value={formatNextFastMph(nextX400Preview.nextMaxMph)} />
              <MetricStat label="Total Time" value={formatDurationMinutes(nextX400Preview.totalMinutes, "floor")} />
              <MetricStat label="Total Distance" value={formatMilesPreviewTotal(nextX400Preview.totalDistanceMiles)} />
              <MetricStat label="Intervals" value={String(nextX400Preview.intervals.length)} />
            </div>
            <SegmentPreviewTable
              title="x400 Intervals"
              rowLabel="Interval"
              segments={nextX400Preview.intervals}
              mphFormatter={formatNextFastMph}
              totalDistanceMiles={nextX400Preview.totalDistanceMiles}
              totalMinutes={nextX400Preview.totalMinutes}
              timeRounding="floor"
            />
          </div>
        ) : (
          <div style={{ color: "#475569" }}>Select an x400 row to preview the next x400 workout.</div>
        )}
      </Card>

      <MetricsTableCard
        title="x200"
        subtitle={`Riegel from x800 (${formatNumber(x800Workout?.distance_miles, 3)} miles) to x200 (${formatNumber(x200Workout?.distance_miles, 3)} miles)`}
        loading={loading}
        error={error}
        periods={x200Periods}
        showMaxMph
        showAvgMph
        predictedColumnLabel="Predicted x200 MPH"
        strongerColumnLabel="Higher Of Max / Predicted"
        selectableName="x200-period"
        selectedKey={selectedX200Period?.key ?? ""}
        onSelectKey={handleSelectPeriod("x200", setSelectedX200Key)}
      />

      <Card title="Next x200" action={null}>
        {selectedX200Period && nextX200Preview ? (
          <div style={{ display: "grid", gap: 12 }}>
            <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
              <MetricStat label="Selected Period" value={selectedX200Period.label} />
              <MetricStat label="Current Avg MPH" value={formatNextFastMph(nextX200Preview.currentAvgMph)} />
              <MetricStat label="Next Max MPH" value={formatNextFastMph(nextX200Preview.nextMaxMph)} />
              <MetricStat label="Total Time" value={formatDurationMinutes(nextX200Preview.totalMinutes, "floor")} />
              <MetricStat label="Total Distance" value={formatMilesPreviewTotal(nextX200Preview.totalDistanceMiles)} />
              <MetricStat label="Intervals" value={String(nextX200Preview.intervals.length)} />
            </div>
            <SegmentPreviewTable
              title="x200 Intervals"
              rowLabel="Interval"
              segments={nextX200Preview.intervals}
              mphFormatter={formatNextFastMph}
              totalDistanceMiles={nextX200Preview.totalDistanceMiles}
              totalMinutes={nextX200Preview.totalMinutes}
              timeRounding="floor"
            />
          </div>
        ) : (
          <div style={{ color: "#475569" }}>Select an x200 row to preview the next x200 workout.</div>
        )}
      </Card>
    </div>
  );
}

function SegmentPreviewTable({
  title,
  rowLabel,
  segments,
  mphFormatter,
  totalDistanceMiles,
  totalMinutes,
  timeRounding = "nearest",
}) {
  const displayDistances = buildDisplaySegmentDistances(segments, totalDistanceMiles);
  const displayMinutes = buildDisplaySegmentMinutes(segments, totalMinutes, timeRounding);

  return (
    <div style={{ overflowX: "auto", border: "1px solid #e5e7eb", borderRadius: 10 }}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ textAlign: "left", background: "#f8fafc" }}>
            <th style={{ padding: 8 }}>{rowLabel}</th>
            <th style={{ padding: 8 }}>Time</th>
            <th style={{ padding: 8 }}>Distance</th>
            <th style={{ padding: 8 }}>MPH</th>
          </tr>
        </thead>
        <tbody>
          {segments.map((segment, index) => (
            <tr key={segment.label} style={{ borderTop: "1px solid #e5e7eb" }}>
              <td style={{ padding: 8 }}>{segment.label}</td>
              <td style={{ padding: 8 }}>{formatDurationMinutes(displayMinutes[index], "nearest")}</td>
              <td style={{ padding: 8 }}>{formatMilesShort(displayDistances[index])}</td>
              <td style={{ padding: 8 }}>{mphFormatter(segment.mph)}</td>
            </tr>
          ))}
        </tbody>
      </table>
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
  formatMaxValue = formatMph,
  showAvgMph = false,
  formatAvgValue = formatMph,
  predictedColumnLabel = null,
  formatPredictedValue = formatMph,
  easyColumnLabel = null,
  strongerColumnLabel = null,
  formatStrongerValue = formatMph,
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
                    {showMaxMph ? <td style={{ padding: 8 }}>{formatMaxValue(period.max_mph)}</td> : null}
                    {showAvgMph ? <td style={{ padding: 8 }}>{formatAvgValue(period.avg_mph)}</td> : null}
                    {predictedColumnLabel ? (
                      <td style={{ padding: 8 }}>{formatPredictedValue(period?.riegel?.predicted_mph)}</td>
                    ) : null}
                    {easyColumnLabel ? (
                      <td style={{ padding: 8 }}>{formatCeilingTenthMphRange(period?.riegel?.easy_low_mph, period?.riegel?.easy_high_mph)}</td>
                    ) : null}
                    {strongerColumnLabel ? (
                      <td style={{ padding: 8 }}>{formatStrongerValue(period.max_or_predicted_mph)}</td>
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

function formatMilesShort(value) {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? `${num.toFixed(2)} mi` : "--";
}

function formatMilesPreviewTotal(value) {
  const num = ceilingToHundredth(value);
  return Number.isFinite(num) && num > 0 ? `${num.toFixed(2)} miles` : "--";
}

function buildDisplaySegmentDistances(segments, totalDistanceMiles) {
  if (!Array.isArray(segments) || segments.length === 0) {
    return [];
  }

  const total = ceilingToHundredth(totalDistanceMiles);
  if (!Number.isFinite(total) || total <= 0) {
    return segments.map((segment) => roundToNearestHundredth(segment?.distanceMiles));
  }

  const totalHundredths = Math.round(total * 100);
  const displayValues = [];
  let sumPriorHundredths = 0;

  for (let index = 0; index < segments.length; index += 1) {
    const isLast = index === segments.length - 1;
    if (isLast) {
      displayValues.push(Math.max(0, totalHundredths - sumPriorHundredths) / 100);
      continue;
    }

    const rounded = roundToNearestHundredth(segments[index]?.distanceMiles);
    const roundedHundredths = Number.isFinite(rounded) ? Math.round(rounded * 100) : 0;
    const cappedHundredths = Math.max(0, Math.min(roundedHundredths, totalHundredths - sumPriorHundredths));
    sumPriorHundredths += cappedHundredths;
    displayValues.push(cappedHundredths / 100);
  }

  return displayValues;
}

function buildDisplaySegmentMinutes(segments, totalMinutes, totalRounding = "nearest") {
  if (!Array.isArray(segments) || segments.length === 0) {
    return [];
  }

  const total = Number(totalMinutes);
  if (!Number.isFinite(total) || total <= 0) {
    return segments.map((segment) => roundToNearestSecondMinute(segment?.minutes));
  }

  const totalSeconds = Math.max(0, roundMinutesToSeconds(total, totalRounding));
  const displayValues = [];
  let sumPriorSeconds = 0;

  for (let index = 0; index < segments.length; index += 1) {
    const isLast = index === segments.length - 1;
    if (isLast) {
      displayValues.push(Math.max(0, totalSeconds - sumPriorSeconds) / 60);
      continue;
    }

    const roundedSeconds = Math.max(0, Math.round(Number(segments[index]?.minutes ?? 0) * 60));
    const cappedSeconds = Math.max(0, Math.min(roundedSeconds, totalSeconds - sumPriorSeconds));
    sumPriorSeconds += cappedSeconds;
    displayValues.push(cappedSeconds / 60);
  }

  return displayValues;
}

function formatDurationMinutes(value, rounding = "nearest") {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return "--";
  const totalSeconds = roundMinutesToSeconds(num, rounding);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds - (minutes * 60);
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function roundMinutesToSeconds(value, rounding = "nearest") {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return 0;
  if (rounding === "floor") {
    return Math.floor((num * 60) + 1e-9);
  }
  return Math.round(num * 60);
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

function ceilingToHundredth(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return null;
  return Math.ceil((num * 100) - 1e-9) / 100;
}

function getInheritedMinRunEasyMph(minRunPeriod, fastPeriod) {
  const easyFloor = ceilingToNextTenth(fastPeriod?.riegel?.easy_low_mph);
  const easyCeiling = ceilingToNextTenth(fastPeriod?.riegel?.easy_high_mph);
  const currentAvg = roundToDisplayTenth(minRunPeriod?.avg_mph);
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

function roundToDisplayTenth(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return null;
  return Number(num.toFixed(1));
}

function buildTimeChunks(totalMinutes, chunkMinutes) {
  const total = Number(totalMinutes);
  const chunk = Number(chunkMinutes);
  if (!Number.isFinite(total) || total <= 0 || !Number.isFinite(chunk) || chunk <= 0) {
    return [];
  }

  const chunks = [];
  let remaining = total;
  while (remaining > 1e-9) {
    const nextChunk = Math.min(chunk, remaining);
    chunks.push(Number(nextChunk.toFixed(4)));
    remaining -= nextChunk;
  }
  return chunks;
}

function buildNextTempoPreview(period, { intervalMinutes, totalMinutes }) {
  if (!period) return null;
  const nextMaxMph = ceilingToNextTenth(period?.riegel?.predicted_mph);
  const currentAvgMph = ceilingToNextTenth(period?.avg_mph);
  const chunks = buildTimeChunks(totalMinutes, intervalMinutes);
  if (!Number.isFinite(nextMaxMph) || nextMaxMph <= 0 || chunks.length === 0) {
    return null;
  }

  const displayedMphs = buildTempoDisplayedMphs({
    intervalCount: chunks.length,
    targetAvgMph: currentAvgMph,
    nextMaxMph,
  });
  if (displayedMphs.length !== chunks.length) {
    return null;
  }

  const intervals = chunks.map((minutes, index) => {
    const mph = displayedMphs[index];
    return {
      label: `Interval ${index + 1}`,
      minutes,
      distanceMiles: (mph * minutes) / 60.0,
      mph,
    };
  });
  const totalMinutesValue = chunks.reduce((sum, value) => sum + value, 0);
  const totalDistanceMiles = intervals.reduce((sum, interval) => sum + interval.distanceMiles, 0);

  return {
    currentAvgMph,
    nextMaxMph,
    totalMinutes: totalMinutesValue,
    totalDistanceMiles,
    intervals,
  };
}

function buildNextX800Preview(period, { intervalCount, intervalDistanceMiles }) {
  if (!period) return null;
  const nextMaxMph = ceilingToNextTenth(period?.max_mph);
  const currentAvgMph = ceilingToNextTenth(period?.avg_mph);
  const count = Math.max(0, Math.round(Number(intervalCount)));
  const distanceMiles = Number(intervalDistanceMiles);
  if (!Number.isFinite(nextMaxMph) || nextMaxMph <= 0 || !Number.isFinite(currentAvgMph) || currentAvgMph <= 0) {
    return null;
  }
  if (!Number.isFinite(distanceMiles) || distanceMiles <= 0 || count <= 0) {
    return null;
  }

  const displayedMphs = buildTempoDisplayedMphs({
    intervalCount: count,
    targetAvgMph: currentAvgMph,
    nextMaxMph,
  });
  if (displayedMphs.length !== count) {
    return null;
  }

  const intervals = displayedMphs.map((mph, index) => ({
    label: `Interval ${index + 1}`,
    minutes: (distanceMiles / mph) * 60,
    distanceMiles,
    mph,
  }));
  const totalMinutes = intervals.reduce((sum, interval) => sum + interval.minutes, 0);

  return {
    currentAvgMph,
    nextMaxMph,
    totalMinutes,
    totalDistanceMiles: count * distanceMiles,
    intervals,
  };
}

function buildNextPredictedSprintPreview(period, { intervalCount, intervalDistanceMiles, predictedMph }) {
  if (!period) return null;
  const currentMaxMph = ceilingToNextTenth(period?.max_mph);
  const currentAvgMph = ceilingToNextTenth(period?.avg_mph);
  const predictedAnchorMph = ceilingToNextTenth(predictedMph);
  const count = Math.max(0, Math.round(Number(intervalCount)));
  const distanceMiles = Number(intervalDistanceMiles);
  if (!Number.isFinite(currentMaxMph) || currentMaxMph <= 0) {
    return null;
  }
  if (!Number.isFinite(currentAvgMph) || currentAvgMph <= 0) {
    return null;
  }
  if (!Number.isFinite(predictedAnchorMph) || predictedAnchorMph <= 0) {
    return null;
  }
  if (!Number.isFinite(distanceMiles) || distanceMiles <= 0 || count <= 0) {
    return null;
  }

  const displayedMphs = buildPredictedSprintDisplayedMphs({
    intervalCount: count,
    targetAvgMph: currentAvgMph,
    currentMaxMph,
    predictedMph: predictedAnchorMph,
  });
  if (displayedMphs.length !== count) {
    return null;
  }

  const intervals = displayedMphs.map((mph, index) => ({
    label: `Interval ${index + 1}`,
    minutes: (distanceMiles / mph) * 60,
    distanceMiles,
    mph,
  }));
  const totalMinutes = intervals.reduce((sum, interval) => sum + interval.minutes, 0);

  return {
    currentAvgMph,
    nextMaxMph: Math.max(currentMaxMph, predictedAnchorMph),
    totalMinutes,
    totalDistanceMiles: count * distanceMiles,
    intervals,
  };
}

function buildPredictedSprintDisplayedMphs({ intervalCount, targetAvgMph, currentMaxMph, predictedMph }) {
  const count = Number(intervalCount);
  const target = Number(targetAvgMph);
  const currentMax = Number(currentMaxMph);
  const predicted = Number(predictedMph);
  if (!Number.isInteger(count) || count <= 0) {
    return [];
  }
  if (!Number.isFinite(target) || target <= 0 || !Number.isFinite(currentMax) || currentMax <= 0 || !Number.isFinite(predicted) || predicted <= 0) {
    return [];
  }

  if (count === 1) {
    return [Math.max(currentMax, predicted)];
  }

  const peak = Math.max(currentMax, predicted);
  const secondary = peak === predicted ? currentMax : predicted;
  const peakIndex = Math.floor(count / 2);
  const secondaryIndex = peakIndex === 0 ? 1 : peakIndex - 1;
  const preferredBase = pickPredictedSprintBaseMph({
    count,
    targetAvgMph: target,
    peakMph: peak,
    secondaryMph: secondary,
  });
  const values = Array.from({ length: count }, () => preferredBase);
  values[peakIndex] = peak;
  values[secondaryIndex] = secondary;

  const targetTenths = Math.round(target * 10 * count);
  let currentTenths = values.reduce((sum, value) => sum + Math.round(value * 10), 0);
  let diff = targetTenths - currentTenths;
  if (diff <= 0) {
    return values.map((value) => roundToNearestTenth(value));
  }

  const increaseOrder = buildSprintAdjustmentOrder(count, peakIndex, secondaryIndex);
  let guard = 0;
  while (diff > 0 && guard < 500) {
    guard += 1;
    let changed = false;
    for (const index of increaseOrder) {
      if (diff <= 0) break;
      const nextValue = Number((values[index] + 0.1).toFixed(1));
      if (nextValue > peak) {
        continue;
      }
      values[index] = nextValue;
      diff -= 1;
      changed = true;
      if (diff <= 0) {
        break;
      }
    }
    if (!changed) {
      break;
    }
  }

  return values.map((value) => roundToNearestTenth(value));
}

function pickPredictedSprintBaseMph({ count, targetAvgMph, peakMph, secondaryMph }) {
  const target = Number(targetAvgMph);
  const peak = Number(peakMph);
  const secondary = Number(secondaryMph);
  if (!Number.isFinite(target) || target <= 0 || !Number.isFinite(peak) || peak <= 0) {
    return target;
  }

  const anchorTenths = Math.round(peak * 10) + Math.round(secondary * 10);
  const targetTenths = Math.round(target * 10 * count);
  const freeSlots = Math.max(1, count - 2);
  const solvedBaseTenths = Math.floor((targetTenths - anchorTenths) / freeSlots);
  const minimumBaseTenths = 1;
  const maximumBaseTenths = Math.round(peak * 10);
  const baseTenths = Math.max(minimumBaseTenths, Math.min(solvedBaseTenths, maximumBaseTenths));
  const currentTenths = anchorTenths + (freeSlots * baseTenths);
  const maxTenths = anchorTenths + (freeSlots * maximumBaseTenths);

  if (currentTenths <= targetTenths && maxTenths >= targetTenths) {
    return Number((baseTenths / 10).toFixed(1));
  }

  return roundToNearestTenth(Math.min(target, peak));
}

function buildSprintAdjustmentOrder(count, peakIndex, secondaryIndex) {
  const order = [];
  for (let offset = 1; offset < count; offset += 1) {
    const left = peakIndex - offset;
    const right = peakIndex + offset;
    if (left >= 0 && left !== secondaryIndex) {
      order.push(left);
    }
    if (right < count && right !== secondaryIndex) {
      order.push(right);
    }
  }
  return order;
}

function buildTempoDisplayedMphs({ intervalCount, targetAvgMph, nextMaxMph }) {
  const count = Number(intervalCount);
  const target = Number(targetAvgMph);
  const peak = Number(nextMaxMph);
  if (!Number.isInteger(count) || count <= 0 || !Number.isFinite(peak) || peak <= 0) {
    return [];
  }

  if (count === 1) {
    return [peak];
  }

  const safeTarget = Number.isFinite(target) && target > 0 ? target : peak;
  const peakIndex = Math.floor(count / 2);
  const maxDistanceFromPeak = Math.max(peakIndex, count - 1 - peakIndex, 1);
  const norms = Array.from({ length: count }, (_, index) => 1 - (Math.abs(index - peakIndex) / maxDistanceFromPeak));
  const normAverage = norms.reduce((sum, value) => sum + value, 0) / count;

  let easy = safeTarget;
  if (normAverage < 1 - 1e-9) {
    easy = (safeTarget - (peak * normAverage)) / (1 - normAverage);
  }
  easy = Math.max(0.1, Math.min(easy, peak));

  const values = norms.map((norm) => roundToNearestTenth(easy + ((peak - easy) * norm)));
  values[peakIndex] = peak;

  const targetTenths = Math.round(safeTarget * 10 * count);
  let currentTenths = values.reduce((sum, value) => sum + Math.round(value * 10), 0);
  let diff = targetTenths - currentTenths;

  const increaseOrder = buildTempoAdjustmentOrder(count, peakIndex, "increase");
  const decreaseOrder = buildTempoAdjustmentOrder(count, peakIndex, "decrease");
  let guard = 0;

  while (diff !== 0 && guard < 500) {
    guard += 1;
    const order = diff > 0 ? increaseOrder : decreaseOrder;
    let changed = false;

    for (const index of order) {
      if (diff === 0) break;
      const delta = diff > 0 ? 0.1 : -0.1;
      const nextValue = Number((values[index] + delta).toFixed(1));
      if (!isTempoValueValid(values, index, nextValue, peak)) {
        continue;
      }
      values[index] = nextValue;
      diff += diff > 0 ? -1 : 1;
      changed = true;
      if (diff === 0) {
        break;
      }
    }

    if (!changed) {
      break;
    }
  }

  return values;
}

function buildTempoAdjustmentOrder(count, peakIndex, direction) {
  const order = [];
  if (direction === "increase") {
    for (let offset = 1; offset < count; offset += 1) {
      const left = peakIndex - offset;
      const right = peakIndex + offset;
      if (left >= 0) order.push(left);
      if (right < count) order.push(right);
    }
    return order;
  }

  for (let offset = 0; offset < count; offset += 1) {
    const left = offset;
    const right = count - 1 - offset;
    if (left !== peakIndex) {
      order.push(left);
    }
    if (right !== left && right !== peakIndex) {
      order.push(right);
    }
  }
  return order;
}

function isTempoValueValid(values, index, nextValue, peakValue) {
  if (!Number.isFinite(nextValue) || nextValue <= 0 || nextValue > peakValue) {
    return false;
  }
  const peakIndex = Math.floor(values.length / 2);
  if (index === peakIndex && nextValue !== peakValue) {
    return false;
  }
  if (index > 0 && index <= peakIndex && nextValue < values[index - 1]) {
    return false;
  }
  if (index < peakIndex && nextValue > values[index + 1]) {
    return false;
  }
  if (index > peakIndex && nextValue > values[index - 1]) {
    return false;
  }
  if (index < values.length - 1 && index >= peakIndex && nextValue < values[index + 1]) {
    return false;
  }
  return true;
}

function roundToNearestTenth(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  return Number(num.toFixed(1));
}

function roundToNearestHundredth(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  return Number(num.toFixed(2));
}

function roundToNearestSecondMinute(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return null;
  return Math.round(num * 60) / 60;
}

function buildNextMinRunPreview(period, { closingBlockMinutes, totalMinutes }) {
  if (!period) return null;
  const nextMaxMph = Number(period?.riegel?.predicted_mph);
  const currentAvgMph = roundToDisplayTenth(period?.avg_mph);
  const total = Number(totalMinutes);
  const closing = Number(closingBlockMinutes);
  if (!Number.isFinite(nextMaxMph) || nextMaxMph <= 0 || !Number.isFinite(total) || total <= 0) {
    return null;
  }

  const safeClosing = Number.isFinite(closing) && closing > 0 ? Math.min(closing, total) : 0;
  const firstMinutes = Math.max(0, total - safeClosing);
  const safeCurrentAvgMph = Number.isFinite(currentAvgMph) && currentAvgMph > 0 ? currentAvgMph : nextMaxMph;
  let firstMph = safeCurrentAvgMph;
  if (firstMinutes > 0 && safeClosing > 0 && Number.isFinite(safeCurrentAvgMph) && safeCurrentAvgMph > 0) {
    firstMph = ((safeCurrentAvgMph * total) - (nextMaxMph * safeClosing)) / firstMinutes;
  }
  if (!Number.isFinite(firstMph) || firstMph <= 0) {
    firstMph = safeCurrentAvgMph;
  }
  const segments = [];

  if (firstMinutes > 0) {
    segments.push({
      label: "First Block",
      minutes: firstMinutes,
      distanceMiles: (firstMph * firstMinutes) / 60.0,
      mph: firstMph,
    });
  }
  if (safeClosing > 0) {
    segments.push({
      label: "Closing Block",
      minutes: safeClosing,
      distanceMiles: (nextMaxMph * safeClosing) / 60.0,
      mph: nextMaxMph,
    });
  }
  if (segments.length === 0) {
    segments.push({
      label: "Full Run",
      minutes: total,
      distanceMiles: (nextMaxMph * total) / 60.0,
      mph: nextMaxMph,
    });
  }

  const totalDistanceMiles = Number.isFinite(safeCurrentAvgMph) && safeCurrentAvgMph > 0
    ? (safeCurrentAvgMph * total) / 60.0
    : segments.reduce((sum, segment) => sum + segment.distanceMiles, 0);

  return {
    currentAvgMph: safeCurrentAvgMph,
    nextMaxMph,
    totalMinutes: total,
    totalDistanceMiles,
    segments,
  };
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

  const totalMinutes = (safeTotalMiles / nextAvgMph) * 60;
  if (!Number.isFinite(totalMinutes) || totalMinutes <= 0) {
    return null;
  }

  if (safeTotalMiles <= safeSourceMiles) {
    return {
      nextMaxMph,
      nextAvgMph,
      totalMinutes,
      totalDistanceMiles: safeTotalMiles,
      segments: [
        {
          label: "Full Run",
          minutes: totalMinutes,
          distanceMiles: safeTotalMiles,
          mph: nextAvgMph,
        },
      ],
    };
  }

  const firstDistanceMiles = Math.min(safeSourceMiles, safeTotalMiles);
  const secondDistanceMiles = Math.max(0, safeTotalMiles - firstDistanceMiles);
  const firstMinutes = (firstDistanceMiles / nextMaxMph) * 60;
  let secondMinutes = totalMinutes - firstMinutes;
  if (!Number.isFinite(secondMinutes) || secondMinutes <= 0) {
    secondMinutes = secondDistanceMiles > 0 ? (secondDistanceMiles / nextAvgMph) * 60 : 0;
  }
  let secondSegmentMph = secondDistanceMiles > 0 ? (secondDistanceMiles / (secondMinutes / 60)) : nextAvgMph;
  if (!Number.isFinite(secondSegmentMph) || secondSegmentMph <= 0) {
    secondSegmentMph = nextAvgMph;
  }
  const segments = [
    {
      label: "First Block",
      minutes: firstMinutes,
      distanceMiles: firstDistanceMiles,
      mph: nextMaxMph,
    },
  ];
  if (secondDistanceMiles > 0) {
    segments.push({
      label: "Second Block",
      minutes: secondMinutes,
      distanceMiles: secondDistanceMiles,
      mph: secondSegmentMph,
    });
  }

  return {
    nextMaxMph,
    nextAvgMph,
    totalMinutes,
    totalDistanceMiles: safeTotalMiles,
    segments,
  };
}
