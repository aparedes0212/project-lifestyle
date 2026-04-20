import useApi from "../hooks/useApi";
import { API_BASE } from "../lib/config";
import SupplementalRecentLogsCard from "../components/SupplementalRecentLogsCard";
import { RoutinePageShell, RoutineSummaryCard } from "../components/RoutinePageShell";
import { routineButtonStyle } from "../lib/routinePageStyles";

export default function SupplementalPage() {
  const nextApi = useApi(`${API_BASE}/api/supplemental/next/`, { deps: [] });
  const recommendedWorkout = nextApi.data?.workout;
  const recommendedRoutine = nextApi.data?.routine || recommendedWorkout?.routine;
  const defaultRoutineId = recommendedRoutine?.id ?? null;

  const stats = [
    { label: "Routine", value: recommendedRoutine?.name ?? "Supplemental" },
    { label: "Workout", value: recommendedWorkout?.workout?.name ?? "3 Goal Sets + Repeat Set 3" },
    {
      label: "Rest Window",
      value: recommendedRoutine ? `${recommendedRoutine.rest_yellow_start_seconds ?? 60}-${recommendedRoutine.rest_red_start_seconds ?? 90}s` : "--",
    },
    { label: "Format", value: "3 goal sets" },
  ];

  return (
    <RoutinePageShell
      title="Supplemental"
      description="Log the merged supplemental block here. This page standardizes the accessory session flow and keeps the planner-facing set guidance in one place."
    >
      <RoutineSummaryCard
        title="Next Up"
        action={<button style={routineButtonStyle} onClick={nextApi.refetch}>Refresh</button>}
        loading={nextApi.loading}
        error={nextApi.error}
        emptyMessage="No supplemental routine is available right now."
        stats={stats}
      >
        {recommendedWorkout ? (
          <div style={{ border: "1px solid #e5e7eb", borderRadius: 10, padding: 12, background: "#fff", fontSize: 14, lineHeight: 1.6, color: "#475569" }}>
            {recommendedWorkout.description}
          </div>
        ) : null}
      </RoutineSummaryCard>

      <SupplementalRecentLogsCard defaultRoutineId={defaultRoutineId} />
    </RoutinePageShell>
  );
}
