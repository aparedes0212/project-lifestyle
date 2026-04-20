import RecentLogsCard from "../components/RecentLogsCard";
import { RoutinePageShell } from "../components/RoutinePageShell";

export default function CardioRoutinePage({ routineName, description }) {
  return (
    <RoutinePageShell title={routineName} description={description}>
      <RecentLogsCard
        routineName={routineName}
        title={`Recent ${routineName} (8 weeks)`}
        quickLogTitle={`Next Up + Quick Log (${routineName})`}
      />
    </RoutinePageShell>
  );
}
