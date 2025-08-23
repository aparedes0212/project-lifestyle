import useApi from "../hooks/useApi";
import { API_BASE } from "../lib/config";
import Card from "./ui/Card";
import Row from "./ui/Row";
import Pill from "./ui/Pill";
import { formatProgression } from "../lib/format";

const btnStyle = { border: "1px solid #e5e7eb", background: "#f9fafb", borderRadius: 8, padding: "6px 10px", cursor: "pointer" };

export default function NextCard() {
  const { data, loading, error, refetch } = useApi(`${API_BASE}/api/cardio/next/`, { deps: [] });
  const nextWorkout = data?.next_workout ?? null;
  const nextProg = data?.next_progression ?? null;
  const workoutList = data?.workout_list ?? [];

  return (
    <Card title="Next Cardio" action={<button onClick={refetch} style={btnStyle}>Refresh</button>}>
      {loading && <div>Loading…</div>}
      {error && <div style={{ color: "#b91c1c" }}>Error: {String(error.message || error)}</div>}
      {!loading && !error && (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
            <Pill>Predicted</Pill>
            <div style={{ fontSize: 16, fontWeight: 600 }}>{nextWorkout ? nextWorkout.name : "—"}</div>
            <div style={{ opacity: 0.7 }}>{nextWorkout?.routine?.name ? `(${nextWorkout.routine.name})` : ""}</div>
          </div>
          <Row left={<strong>Next progression</strong>} right={formatProgression(nextProg)} />
          <div style={{ height: 8 }} />
          <div style={{ fontWeight: 600, marginBottom: 6 }}>Queue (flattened)</div>
          <ol style={{ margin: 0, paddingInlineStart: 18 }}>
            {workoutList.map((w, i) => (
              <li key={`${w.id}-${i}`} style={{ padding: "4px 0" }}>
                {w.name} {w.routine?.name ? <span style={{ opacity: 0.6 }}>– {w.routine.name}</span> : null}
                {nextWorkout && w.id === nextWorkout.id ? <span style={{ marginLeft: 8 }}><Pill>next</Pill></span> : null}
              </li>
            ))}
          </ol>
        </>
      )}
    </Card>
  );
}
