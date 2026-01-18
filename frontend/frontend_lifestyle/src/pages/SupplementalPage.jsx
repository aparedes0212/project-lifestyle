import { Link } from "react-router-dom";
import Card from "../components/ui/Card";
import SupplementalRecentLogsCard from "../components/SupplementalRecentLogsCard";
import useApi from "../hooks/useApi";
import { API_BASE } from "../lib/config";

const btnStyle = {
  border: "1px solid #e5e7eb",
  background: "#f9fafb",
  borderRadius: 8,
  padding: "8px 14px",
  cursor: "pointer",
  textDecoration: "none",
  color: "inherit",
  display: "inline-block",
};

export default function SupplementalPage() {
  const nextApi = useApi(`${API_BASE}/api/supplemental/next/`, { deps: [] });
  const recommendedWorkout = nextApi.data?.workout;
  const recommendedRoutine = nextApi.data?.routine || recommendedWorkout?.routine;
  const defaultRoutineId = recommendedRoutine?.id ?? null;

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <Card title="Supplemental Overview" action={null}>
        <p style={{ marginBottom: 8 }}>
          Supplemental work covers accessory or mobility sessions that support the primary cardio and strength plans.
          Track the extra volume here so weekly recommendations can balance across all three training modes.
        </p>
        <div>
          Need to focus on something else today?
          <Link to="/cardio" style={{ ...btnStyle, marginLeft: 8 }}>Go to Cardio</Link>
          <Link to="/strength" style={{ ...btnStyle, marginLeft: 8 }}>Go to Strength</Link>
        </div>
      </Card>

      <Card
        title="Today's Supplemental"
        action={<button style={btnStyle} onClick={nextApi.refetch}>Refresh</button>}
      >
        {nextApi.loading && <div>Loading...</div>}
        {nextApi.error && (
          <div style={{ color: "#b91c1c" }}>Error: {String(nextApi.error.message || nextApi.error)}</div>
        )}

        {!nextApi.loading && !nextApi.error && (
          <div style={{ display: "grid", gap: 8 }}>
            <div style={{ fontSize: 14, color: "#475569" }}>
              Routine: <strong>{recommendedRoutine?.name ?? "Not set"}</strong>
            </div>
            {recommendedWorkout ? (
              <>
                <div style={{ fontSize: 13, color: "#475569" }}>
                  Workout: <strong>{recommendedWorkout.workout?.name ?? "3 Max Sets"}</strong> | Rest: {recommendedRoutine?.rest_yellow_start_seconds ?? 60}-{recommendedRoutine?.rest_red_start_seconds ?? 90}s
                </div>
                <div style={{ border: "1px solid #e5e7eb", borderRadius: 8, padding: 12, background: "#f9fafb", fontSize: 14, lineHeight: 1.5 }}>
                  {recommendedWorkout.description}
                </div>
              </>
            ) : (
              <div style={{ color: "#475569" }}>
                No supplemental workout found. Add a supplemental routine to see the daily pick.
              </div>
            )}
          </div>
        )}
      </Card>

      <SupplementalRecentLogsCard defaultRoutineId={defaultRoutineId} />
    </div>
  );
}
