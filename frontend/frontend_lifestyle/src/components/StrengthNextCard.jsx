import useApi from "../hooks/useApi";
import { API_BASE } from "../lib/config";
import Card from "./ui/Card";
import Pill from "./ui/Pill";
import Row from "./ui/Row";
import { formatNumber } from "../lib/numberFormat";

const btnStyle = { border: "1px solid #e5e7eb", background: "#f9fafb", borderRadius: 8, padding: "6px 10px", cursor: "pointer" };

export default function StrengthNextCard() {
  const { data, loading, error, refetch } = useApi(`${API_BASE}/api/strength/next/`, { deps: [] });
  const nextRoutine = data?.next_routine ?? null;
  const nextGoal = data?.next_goal ?? null;
  const nextGoalDisplay = nextGoal?.daily_volume != null ? formatNumber(nextGoal.daily_volume, 2) : "\u2014";

  const routineList = data?.routine_list ?? [];

  return (
    <Card title="Next Strength" action={<button onClick={refetch} style={btnStyle}>Refresh</button>}>
      {loading && <div>Loading…</div>}
      {error && <div style={{ color: "#b91c1c" }}>Error: {String(error.message || error)}</div>}
      {!loading && !error && (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
            <Pill>Predicted</Pill>
            <div style={{ fontSize: 16, fontWeight: 600 }}>{nextRoutine ? nextRoutine.name : "\u2014"}</div>
          </div>
          <Row left={<strong>Next goal</strong>} right={nextGoalDisplay} />
          <div style={{ height: 8 }} />
          <div style={{ fontWeight: 600, marginBottom: 6 }}>Queue</div>
          <ol style={{ margin: 0, paddingInlineStart: 18 }}>
            {routineList.map((r, i) => (
              <li key={`${r.id}-${i}`} style={{ padding: "4px 0" }}>
                {r.name}
                {nextRoutine && r.id === nextRoutine.id ? <span style={{ marginLeft: 8 }}><Pill>next</Pill></span> : null}
              </li>
            ))}
          </ol>
        </>
      )}
    </Card>
  );
}
