import { useEffect, useMemo, useState } from "react";
import useApi from "../hooks/useApi";
import { API_BASE } from "../lib/config";
import CardioGoalMphModal from "../components/CardioGoalMphModal";
import RecentLogsCard from "../components/RecentLogsCard";
import { RoutinePageShell, RoutineSummaryCard } from "../components/RoutinePageShell";
import { routineButtonStyle } from "../lib/routinePageStyles";

function formatGoal(nextWorkout, nextProgression) {
  const progression = nextProgression?.progression;
  if (progression == null || progression === "") return "--";
  const unitName = nextWorkout?.unit?.name;
  return unitName ? `${progression} ${unitName}` : String(progression);
}

export default function CardioRoutinePage({ routineName, description }) {
  const params = new URLSearchParams({ include_skipped: "true", routine_name: routineName });
  const nextApi = useApi(`${API_BASE}/api/cardio/next/?${params.toString()}`, { deps: [routineName] });
  const [goalModalOpen, setGoalModalOpen] = useState(false);
  const [goalPlanOverride, setGoalPlanOverride] = useState(null);

  const nextWorkout = nextApi.data?.next_workout ?? null;
  const nextProgression = nextApi.data?.next_progression ?? null;
  const selectedMetricPlan = nextApi.data?.selected_metric_plan ?? null;
  const workoutList = Array.isArray(nextApi.data?.workout_list) ? nextApi.data.workout_list : [];
  const activeGoalPlan = useMemo(() => {
    if (
      goalPlanOverride
      && nextWorkout
      && Number(goalPlanOverride.workoutId) === Number(nextWorkout.id)
    ) {
      return goalPlanOverride;
    }
    return selectedMetricPlan;
  }, [goalPlanOverride, nextWorkout, selectedMetricPlan]);

  useEffect(() => {
    if (!goalPlanOverride) return;
    if (!nextWorkout || Number(goalPlanOverride.workoutId) !== Number(nextWorkout.id)) {
      setGoalPlanOverride(null);
    }
  }, [goalPlanOverride, nextWorkout]);

  const stats = [
    { label: "Routine", value: routineName },
    { label: "Workout", value: nextWorkout?.name ?? "--" },
    { label: "Goal", value: formatGoal(nextWorkout, nextProgression) },
    { label: "Queue Size", value: workoutList.length > 0 ? String(workoutList.length) : "--" },
  ];
  if (activeGoalPlan) {
    stats.push(
      { label: "Goal Source", value: activeGoalPlan.period_label ?? "Custom" },
      {
        label: "MPH Goal",
        value: activeGoalPlan?.mph_goal != null ? `${Number(activeGoalPlan.mph_goal).toFixed(1)} mph` : "--",
        detail: activeGoalPlan?.mph_goal_avg != null ? `Avg ${Number(activeGoalPlan.mph_goal_avg).toFixed(1)} mph` : null,
      },
    );
  }

  const saveGoalPlanSelection = async (selection) => {
    if (!nextWorkout?.name || !nextWorkout?.id) return;

    const override = {
      workoutId: nextWorkout.id,
      workoutName: nextWorkout.name,
      period_key: selection.periodKey,
      period_label: selection.periodLabel ?? "Custom",
      mph_goal: selection.mphGoal,
      mph_goal_avg: selection.mphGoalAvg,
    };

    if (selection.kind === "period") {
      const response = await fetch(`${API_BASE}/api/metrics/cardio/`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workout_name: nextWorkout.name,
          period_key: selection.periodKey,
        }),
      });
      if (!response.ok) {
        throw new Error(`${response.status} ${response.statusText}`);
      }
      setGoalPlanOverride(override);
      setGoalModalOpen(false);
      nextApi.refetch();
      return;
    }

    setGoalPlanOverride(override);
    setGoalModalOpen(false);
  };

  return (
    <RoutinePageShell title={routineName} description={description}>
      <RoutineSummaryCard
        title="Next Up"
        action={(
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button style={routineButtonStyle} onClick={nextApi.refetch}>Refresh</button>
            {nextWorkout ? (
              <button type="button" style={routineButtonStyle} onClick={() => setGoalModalOpen(true)}>
                Select Max/Avg Goal MPH
              </button>
            ) : null}
          </div>
        )}
        loading={nextApi.loading}
        error={nextApi.error}
        emptyMessage={`No ${routineName} workout is available right now.`}
        stats={stats}
      >
        {nextWorkout ? (
          <div style={{ border: "1px solid #e5e7eb", borderRadius: 10, padding: 12, background: "#fff" }}>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>{nextWorkout.name}</div>
            <div style={{ color: "#475569", fontSize: 14 }}>
              {activeGoalPlan
                ? `This is the next ${routineName} workout currently predicted by the planner, using ${activeGoalPlan.period_label ?? "Custom"} for the Max/Avg MPH target.`
                : `This is the next ${routineName} workout currently predicted by the planner.`}
            </div>
          </div>
        ) : null}
      </RoutineSummaryCard>

      <CardioGoalMphModal
        open={goalModalOpen}
        workoutName={nextWorkout?.name ?? ""}
        title={`Select Max/Avg Goal MPH (${nextWorkout?.name ?? routineName})`}
        currentSelection={activeGoalPlan}
        onClose={() => setGoalModalOpen(false)}
        onSave={saveGoalPlanSelection}
      />

      <RecentLogsCard
        routineName={routineName}
        title={`Recent ${routineName} (8 weeks)`}
        goalPlanOverride={goalPlanOverride}
      />
    </RoutinePageShell>
  );
}
