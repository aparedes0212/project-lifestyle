import StrengthRecentLogsCard from "../components/StrengthRecentLogsCard";
import { RoutinePageShell } from "../components/RoutinePageShell";

export default function StrengthPage() {
  return (
    <RoutinePageShell
      title="Strength"
      description="Track the merged strength block here. This page uses the unified Strength routine and keeps the next predicted daily volume inside the same quick-log flow."
    >
      <StrengthRecentLogsCard />
    </RoutinePageShell>
  );
}
