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
  const workoutList = Array.isArray(nextApi.data?.workout_list) ? nextApi.data.workout_list : [];
  const defaultRoutineId = recommendedWorkout?.routine?.id ?? recommendedRoutine?.id ?? null;
  const defaultWorkoutId = recommendedWorkout?.workout?.id ?? null;

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
                  Workout: <strong>{recommendedWorkout.workout?.name ?? "Unspecified"}</strong> • Goal metric: {recommendedWorkout.goal_metric ?? "--"}
                </div>
                <div style={{ border: "1px solid #e5e7eb", borderRadius: 8, padding: 12, background: "#f9fafb", fontSize: 14, lineHeight: 1.5 }}>
                  {recommendedWorkout.description}
                </div>
              </>
            ) : (
              <div style={{ color: "#475569" }}>
                No supplemental workout found. Add supplemental routines and workout descriptions to see the daily pick.
              </div>
            )}

            {workoutList.length > 0 && (
              <div style={{ borderTop: "1px solid #e5e7eb", paddingTop: 8 }}>
                <div style={{ fontWeight: 600, marginBottom: 6 }}>Rotation</div>
                <ul style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 6 }}>
                  {workoutList.map((item) => (
                    <li key={item.id} style={{ fontSize: 13, color: "#111827" }}>
                      <strong>{item.workout?.name ?? "Workout"}</strong> — {item.description} ({item.goal_metric})
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </Card>

      <SupplementalRecentLogsCard defaultRoutineId={defaultRoutineId} defaultWorkoutId={defaultWorkoutId} />
    </div>
  );
}
