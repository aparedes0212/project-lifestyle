import useApi from "../hooks/useApi";
import { API_BASE } from "../lib/config";
import StrengthRecentLogsCard from "../components/StrengthRecentLogsCard";
import { RoutinePageShell, RoutineSummaryCard, routineButtonStyle } from "../components/RoutinePageShell";

function formatStrengthGoal(nextGoal) {
  if (!nextGoal) return "--";
  if (nextGoal.daily_volume == null) return "--";
  return `${nextGoal.daily_volume} reps`;
}

export default function StrengthPage() {
  const nextApi = useApi(`${API_BASE}/api/strength/next/`, { deps: [] });
  const nextRoutine = nextApi.data?.next_routine ?? null;
  const nextGoal = nextApi.data?.next_goal ?? null;
  const routineList = Array.isArray(nextApi.data?.routine_list) ? nextApi.data.routine_list : [];

  const stats = [
    { label: "Routine", value: nextRoutine?.name ?? "Strength" },
    { label: "Daily Volume", value: formatStrengthGoal(nextGoal) },
    { label: "Training Set", value: nextGoal?.training_set_reps != null ? `${nextGoal.training_set_reps}` : "--" },
    { label: "Max Range", value: nextGoal?.bucket_label ? `${nextGoal.bucket_label} pull-ups` : "--" },
  ];

  return (
    <RoutinePageShell
      title="Strength"
      description="Track the merged strength block here. This page uses the unified Strength routine and surfaces the next predicted daily volume, then keeps the recent log workflow below."
    >
      <RoutineSummaryCard
        title="Next Up"
        action={<button style={routineButtonStyle} onClick={nextApi.refetch}>Refresh</button>}
        loading={nextApi.loading}
        error={nextApi.error}
        emptyMessage="No strength routine is available right now."
        stats={stats}
      >
        {routineList.length > 0 ? (
          <div style={{ border: "1px solid #e5e7eb", borderRadius: 10, padding: 12, background: "#fff" }}>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>Queue</div>
            <div style={{ color: "#475569", fontSize: 14 }}>
              {routineList.map((routine) => routine.name).join(" -> ")}
            </div>
          </div>
        ) : null}
      </RoutineSummaryCard>

      <StrengthRecentLogsCard />
    </RoutinePageShell>
  );
}
