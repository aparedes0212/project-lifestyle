import useApi from "../hooks/useApi";
import { API_BASE } from "../lib/config";
import SupplementalRecentLogsCard from "../components/SupplementalRecentLogsCard";
import { RoutinePageShell } from "../components/RoutinePageShell";

const nextSummaryStyle = {
  border: "1px solid #e5e7eb",
  borderRadius: 10,
  padding: 12,
  background: "#fff",
  fontSize: 14,
  lineHeight: 1.6,
  color: "#475569",
};

export default function SupplementalPage() {
  const nextApi = useApi(`${API_BASE}/api/supplemental/next/`, { deps: [] });
  const recommendedWorkout = nextApi.data?.workout ?? null;
  const recommendedRoutine = nextApi.data?.routine || recommendedWorkout?.routine;
  const defaultRoutineId = recommendedRoutine?.id ?? null;

  return (
    <RoutinePageShell
      title="Supplemental"
      description="Log the merged supplemental block here. This page standardizes the accessory session flow and keeps the planner-facing set guidance in one place."
    >
      <SupplementalRecentLogsCard
        defaultRoutineId={defaultRoutineId}
        quickLogHeaderContent={recommendedWorkout?.description ? (
          <div style={nextSummaryStyle}>{recommendedWorkout.description}</div>
        ) : null}
      />
    </RoutinePageShell>
  );
}
