import useApi from "../hooks/useApi";
import { API_BASE } from "../lib/config";
import RecentLogsCard from "../components/RecentLogsCard";
import { RoutinePageShell, RoutineSummaryCard, routineButtonStyle } from "../components/RoutinePageShell";

function formatGoal(nextWorkout, nextProgression) {
  const progression = nextProgression?.progression;
  if (progression == null || progression === "") return "--";
  const unitName = nextWorkout?.unit?.name;
  return unitName ? `${progression} ${unitName}` : String(progression);
}

export default function CardioRoutinePage({ routineName, description }) {
  const params = new URLSearchParams({ include_skipped: "true", routine_name: routineName });
  const nextApi = useApi(`${API_BASE}/api/cardio/next/?${params.toString()}`, { deps: [routineName] });

  const nextWorkout = nextApi.data?.next_workout ?? null;
  const nextProgression = nextApi.data?.next_progression ?? null;
  const selectedMetricPlan = nextApi.data?.selected_metric_plan ?? null;
  const workoutList = Array.isArray(nextApi.data?.workout_list) ? nextApi.data.workout_list : [];

  const stats = [
    { label: "Routine", value: routineName },
    { label: "Workout", value: nextWorkout?.name ?? "--" },
    { label: "Goal", value: formatGoal(nextWorkout, nextProgression) },
    { label: "Queue Size", value: workoutList.length > 0 ? String(workoutList.length) : "--" },
  ];
  if (selectedMetricPlan) {
    stats.push(
      { label: "Metrics Period", value: selectedMetricPlan.period_label ?? "--" },
      {
        label: "MPH Goal",
        value: selectedMetricPlan?.mph_goal != null ? `${Number(selectedMetricPlan.mph_goal).toFixed(1)} mph` : "--",
        detail: selectedMetricPlan?.mph_goal_avg != null ? `Avg ${Number(selectedMetricPlan.mph_goal_avg).toFixed(1)} mph` : null,
      },
    );
  }

  return (
    <RoutinePageShell title={routineName} description={description}>
      <RoutineSummaryCard
        title="Next Up"
        action={<button style={routineButtonStyle} onClick={nextApi.refetch}>Refresh</button>}
        loading={nextApi.loading}
        error={nextApi.error}
        emptyMessage={`No ${routineName} workout is available right now.`}
        stats={stats}
      >
        {nextWorkout ? (
          <div style={{ border: "1px solid #e5e7eb", borderRadius: 10, padding: 12, background: "#fff" }}>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>{nextWorkout.name}</div>
            <div style={{ color: "#475569", fontSize: 14 }}>
              {selectedMetricPlan
                ? `This is the next ${routineName} workout currently predicted by the planner, using the saved metrics selection for ${selectedMetricPlan.period_label}.`
                : `This is the next ${routineName} workout currently predicted by the planner.`}
            </div>
          </div>
        ) : null}
      </RoutineSummaryCard>

      <RecentLogsCard
        routineName={routineName}
        title={`Recent ${routineName} (8 weeks)`}
      />
    </RoutinePageShell>
  );
}
