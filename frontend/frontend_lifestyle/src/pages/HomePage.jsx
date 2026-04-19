import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import Card from "../components/ui/Card";
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

function formatDateLabel(value) {
  if (!value) return "--";
  const date = new Date(`${value}T12:00:00`);
  if (!Number.isFinite(date.getTime())) return value;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function formatCandidateLastDone(candidate) {
  if (!candidate) return "--";
  if (candidate.never_done) return "Never done";
  if (candidate.last_completed_days_ago == null) return "Last completed date unavailable";
  const dayLabel = candidate.last_completed_days_ago === 1 ? "day" : "days";
  const dateLabel = candidate.last_completed_date ? formatDateLabel(candidate.last_completed_date) : "--";
  return `${candidate.last_completed_days_ago} ${dayLabel} ago (${dateLabel})`;
}

function candidateOptionLabel(candidate) {
  if (!candidate) return "";
  return `${candidate.label} - ${formatCandidateLastDone(candidate)} - ${candidate.day_label || "Unscheduled"}`;
}

function itemSummary(item) {
  if (!item?.log) return "";
  if (item.routine_code === "5k_prep" || item.routine_code === "sprints") {
    const workoutName = item.log?.workout?.name;
    const goal = item.log?.goal;
    if (workoutName && goal != null && goal !== "") return `${workoutName} | Goal ${goal}`;
    if (workoutName) return workoutName;
    return "";
  }
  if (item.routine_code === "strength") {
    const repGoal = item.log?.rep_goal;
    return repGoal != null ? `Rep goal ${repGoal}` : "";
  }
  const goal = item.log?.goal;
  return goal ? String(goal) : "";
}

export default function HomePage() {
  const { data, loading, error, refetch } = useApi(`${API_BASE}/api/home/recommendation/`, { deps: [] });
  const [selectedAlternativeKey, setSelectedAlternativeKey] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);
  const [result, setResult] = useState(null);

  const recommendedCandidate = data?.recommended_candidate ?? null;
  const alternativeCandidates = Array.isArray(data?.alternative_candidates) ? data.alternative_candidates : [];
  const allCandidates = Array.isArray(data?.all_candidates) ? data.all_candidates : [];
  const modelDays = Array.isArray(data?.model_days) ? data.model_days : [];
  const referenceEntry = data?.reference_entry ?? null;

  useEffect(() => {
    setSelectedAlternativeKey("");
    setResult(null);
    setSubmitError(null);
  }, [data?.today, recommendedCandidate?.candidate_key]);

  useEffect(() => {
    setResult(null);
    setSubmitError(null);
  }, [selectedAlternativeKey]);

  const selectedCandidate = useMemo(() => {
    if (!selectedAlternativeKey) return recommendedCandidate;
    return allCandidates.find((candidate) => candidate?.candidate_key === selectedAlternativeKey) ?? recommendedCandidate;
  }, [allCandidates, recommendedCandidate, selectedAlternativeKey]);

  const handleAccept = async () => {
    if (!selectedCandidate) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const payload = selectedAlternativeKey ? { candidate_key: selectedAlternativeKey } : {};
      const res = await fetch(`${API_BASE}/api/home/recommendation/accept/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const json = await res.json();
      setResult(json);
    } catch (err) {
      setSubmitError(err);
    } finally {
      setSubmitting(false);
    }
  };

  const resultItems = Array.isArray(result?.items) ? result.items : [];

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <Card
        title="Today's Recommendation"
        action={(
          <button onClick={refetch} style={btnStyle}>
            Refresh
          </button>
        )}
      >
        {loading && <div>Loading...</div>}
        {error && <div style={{ color: "#b91c1c" }}>Error: {String(error.message || error)}</div>}

        {!loading && !error && (
          <div style={{ display: "grid", gap: 14 }}>
            <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
              <div style={{ border: "1px solid #e5e7eb", borderRadius: 10, padding: 12 }}>
                <div style={{ fontSize: 12, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.04em" }}>Today</div>
                <div style={{ fontWeight: 700 }}>{formatDateLabel(data?.today)}</div>
              </div>
              <div style={{ border: "1px solid #e5e7eb", borderRadius: 10, padding: 12 }}>
                <div style={{ fontSize: 12, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                  {data?.reference_source_label ?? "Reference"}
                </div>
                <div style={{ fontWeight: 700 }}>
                  {referenceEntry ? referenceEntry.label : "No prior activity found"}
                </div>
                <div style={{ color: "#6b7280", marginTop: 4 }}>
                  {referenceEntry ? formatDateLabel(referenceEntry.activity_date) : "Using the earliest model day as the fallback."}
                </div>
              </div>
              <div style={{ border: "1px solid #e5e7eb", borderRadius: 10, padding: 12 }}>
                <div style={{ fontSize: 12, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.04em" }}>Recommended</div>
                <div style={{ fontWeight: 700 }}>{recommendedCandidate?.label ?? "No candidate available"}</div>
                <div style={{ color: "#6b7280", marginTop: 4 }}>{formatCandidateLastDone(recommendedCandidate)}</div>
              </div>
            </div>

            {recommendedCandidate ? (
              <>
                <div style={{ border: "1px solid #dbeafe", background: "#eff6ff", borderRadius: 12, padding: 14 }}>
                  <div style={{ fontSize: 12, color: "#1d4ed8", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                    {selectedAlternativeKey ? "Selected Alternative" : "Current Selection"}
                  </div>
                  <div style={{ fontSize: 24, fontWeight: 800, marginTop: 4 }}>{selectedCandidate?.label}</div>
                  <div style={{ color: "#475569", marginTop: 6 }}>
                    {selectedCandidate?.day_label} | {formatCandidateLastDone(selectedCandidate)}
                  </div>
                </div>

                <div style={{ display: "grid", gap: 10, gridTemplateColumns: "minmax(0, 1fr) auto" }}>
                  <label style={{ display: "grid", gap: 6 }}>
                    <span style={{ fontSize: 14, fontWeight: 600 }}>Alternatives</span>
                    <select
                      value={selectedAlternativeKey}
                      onChange={(e) => setSelectedAlternativeKey(e.target.value)}
                      style={{ minHeight: 40 }}
                    >
                      <option value="">Use recommended: {recommendedCandidate.label}</option>
                      {alternativeCandidates.map((candidate) => (
                        <option key={candidate.candidate_key} value={candidate.candidate_key}>
                          {candidateOptionLabel(candidate)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div style={{ alignSelf: "end" }}>
                    <button
                      type="button"
                      onClick={handleAccept}
                      disabled={submitting || !selectedCandidate}
                      style={{ ...btnStyle, minHeight: 40 }}
                    >
                      {submitting ? "Creating..." : "Create Today's Routines"}
                    </button>
                  </div>
                </div>

                {submitError && (
                  <div style={{ color: "#b91c1c" }}>
                    Error: {String(submitError.message || submitError)}
                  </div>
                )}

                {result && (
                  <div style={{ border: "1px solid #dcfce7", background: "#f0fdf4", borderRadius: 12, padding: 14, display: "grid", gap: 10 }}>
                    <div>
                      <div style={{ fontSize: 12, color: "#166534", textTransform: "uppercase", letterSpacing: "0.04em" }}>Created For Today</div>
                      <div style={{ fontWeight: 700 }}>{result?.accepted_candidate?.label ?? selectedCandidate?.label}</div>
                    </div>
                    <div style={{ display: "grid", gap: 8 }}>
                      {resultItems.map((item) => {
                        const summary = itemSummary(item);
                        return (
                          <div
                            key={`${item.routine_code}-${item.log?.id ?? item.label}`}
                            style={{ border: "1px solid #bbf7d0", borderRadius: 10, background: "white", padding: 12 }}
                          >
                            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                              <div>
                                <div style={{ fontWeight: 700 }}>{item.label}</div>
                                <div style={{ color: item.created ? "#166534" : "#475569" }}>
                                  {item.created ? "Created new log" : "Using existing log"}
                                </div>
                                {summary ? <div style={{ color: "#475569", marginTop: 4 }}>{summary}</div> : null}
                              </div>
                              <Link to={item.detail_path} style={btnStyle}>
                                Open Log
                              </Link>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div style={{ color: "#475569" }}>
                No schedule candidate is available yet. Check that the routine schedule migration has been applied.
              </div>
            )}
          </div>
        )}
      </Card>

      <Card title="Weekly Model" action={null}>
        <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
          {modelDays.map((day) => (
            <div key={day.day_number} style={{ border: "1px solid #e5e7eb", borderRadius: 10, padding: 12 }}>
              <div style={{ fontSize: 12, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                Day {day.day_number}
              </div>
              <div style={{ fontWeight: 700, marginTop: 4 }}>{day.label}</div>
            </div>
          ))}
        </div>
      </Card>

      <Card title="Routine Pages" action={null}>
        <div style={{ marginBottom: 12, color: "#475569" }}>
          Each routine now has its own page. Use these directly if you want to inspect logs outside the recommendation flow.
        </div>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <Link to="/5k-prep" style={btnStyle}>5K Prep</Link>
          <Link to="/sprints" style={btnStyle}>Sprints</Link>
          <Link to="/strength" style={btnStyle}>Strength</Link>
          <Link to="/supplemental" style={btnStyle}>Supplemental</Link>
          <Link to="/metrics" style={btnStyle}>Metrics</Link>
        </div>
      </Card>
    </div>
  );
}
