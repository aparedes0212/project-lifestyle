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

function formatOptionLastDone(option) {
  if (!option) return "--";
  if (option.never_done) return "Never done";
  if (option.last_completed_days_ago == null) return "Last completed date unavailable";
  const dayLabel = option.last_completed_days_ago === 1 ? "day" : "days";
  const dateLabel = option.last_completed_date ? formatDateLabel(option.last_completed_date) : "--";
  return `${option.last_completed_days_ago} ${dayLabel} ago (${dateLabel})`;
}

function candidateOptionLabel(candidate) {
  if (!candidate) return "";
  return `${candidate.label} - ${formatOptionLastDone(candidate)} - ${candidate.day_label || "Unscheduled"}`;
}

function modelDayOptionLabel(day) {
  if (!day) return "";
  return `${day.day_label || `Day ${day.day_number}`} - ${day.label} - ${formatOptionLastDone(day)}`;
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
  const [selectedOptionValue, setSelectedOptionValue] = useState("");
  const [viewMoreOptions, setViewMoreOptions] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);
  const [result, setResult] = useState(null);

  const recommendedCandidate = data?.recommended_candidate ?? null;
  const alternativeCandidates = Array.isArray(data?.alternative_candidates) ? data.alternative_candidates : [];
  const allCandidates = Array.isArray(data?.all_candidates) ? data.all_candidates : [];
  const modelDays = Array.isArray(data?.model_days) ? data.model_days : [];
  const rankedModelDays = Array.isArray(data?.ranked_model_days) ? data.ranked_model_days : [];
  const todaySelection = data?.today_selection ?? null;
  const referenceEntry = data?.reference_entry ?? null;

  useEffect(() => {
    setSelectedOptionValue("");
    setViewMoreOptions(false);
    setResult(null);
    setSubmitError(null);
  }, [data?.today, recommendedCandidate?.day_number]);

  useEffect(() => {
    const handleWeeklyModelUpdated = () => {
      refetch();
    };
    window.addEventListener("weekly-model-updated", handleWeeklyModelUpdated);
    return () => {
      window.removeEventListener("weekly-model-updated", handleWeeklyModelUpdated);
    };
  }, [refetch]);

  useEffect(() => {
    setResult(null);
    setSubmitError(null);
  }, [selectedOptionValue, viewMoreOptions]);

  const allModelDayOptions = useMemo(() => {
    if (rankedModelDays.length > 0) return rankedModelDays;
    return modelDays
      .slice()
      .sort((a, b) => {
        if (!!a?.never_done !== !!b?.never_done) return a?.never_done ? -1 : 1;
        if (!a?.never_done) {
          const aDate = String(a?.last_completed_date || "");
          const bDate = String(b?.last_completed_date || "");
          if (aDate !== bDate) return aDate.localeCompare(bDate);
        }
        return Number(a?.day_number || 0) - Number(b?.day_number || 0);
      });
  }, [modelDays, rankedModelDays]);

  const selectedOption = useMemo(() => {
    if (!selectedOptionValue) {
      return { mode: "recommended", data: recommendedCandidate };
    }
    if (selectedOptionValue.startsWith("day:")) {
      const dayNumber = Number(selectedOptionValue.slice("day:".length));
      return {
        mode: "day",
        data: (
          allCandidates.find((candidate) => Number(candidate?.day_number) === dayNumber)
          ?? allModelDayOptions.find((day) => Number(day?.day_number) === dayNumber)
          ?? recommendedCandidate
        ),
      };
    }
    return { mode: "recommended", data: recommendedCandidate };
  }, [allCandidates, allModelDayOptions, recommendedCandidate, selectedOptionValue]);

  const selectedCandidate = selectedOption.data ?? recommendedCandidate;
  const currentSelection = todaySelection ?? selectedCandidate;
  const removedItems = Array.isArray(result?.removed_items) ? result.removed_items : [];
  const actionLabel = todaySelection
    ? (selectedOptionValue ? "Replace Today's Routines" : "Replace Today's Routines With Recommendation")
    : "Create Today's Routines";
  const selectionHeading = todaySelection
    ? "Current Selection"
    : (selectedOptionValue ? "Selected Alternative" : "Recommended Selection");
  const selectionStatus = todaySelection
    ? "Already created for today"
    : formatOptionLastDone(currentSelection);

  const handleAccept = async () => {
    if (!selectedCandidate) return;
    if (
      todaySelection
      && !window.confirm(`Replace today's routines (${todaySelection.label}) with ${selectedCandidate.label}?`)
    ) {
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
      let payload = {};
      if (selectedOption.mode === "day" && selectedCandidate?.day_number != null) {
        payload = { day_number: selectedCandidate.day_number };
      }
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
                <div style={{ color: "#6b7280", marginTop: 4 }}>{formatOptionLastDone(recommendedCandidate)}</div>
              </div>
            </div>

            {recommendedCandidate ? (
              <>
                <div style={{ border: "1px solid #dbeafe", background: "#eff6ff", borderRadius: 12, padding: 14 }}>
                  <div style={{ fontSize: 12, color: "#1d4ed8", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                    {selectionHeading}
                  </div>
                  <div style={{ fontSize: 24, fontWeight: 800, marginTop: 4 }}>{currentSelection?.label}</div>
                  <div style={{ color: "#475569", marginTop: 6 }}>
                    {currentSelection?.day_label} | {selectionStatus}
                  </div>
                </div>

                <div style={{ display: "grid", gap: 10 }}>
                  {todaySelection && (
                    <div style={{ color: "#475569", fontSize: 14 }}>
                      Replacement target: <strong>{selectedCandidate?.label ?? recommendedCandidate?.label}</strong>
                      {" "} | {selectedCandidate?.day_label} | {formatOptionLastDone(selectedCandidate)}
                    </div>
                  )}

                  <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <input
                      type="checkbox"
                      checked={viewMoreOptions}
                      onChange={(e) => {
                        setViewMoreOptions(e.target.checked);
                        setSelectedOptionValue("");
                      }}
                    />
                    <span style={{ fontSize: 14, fontWeight: 600 }}>View more options</span>
                  </label>

                  <div style={{ display: "grid", gap: 10, gridTemplateColumns: "minmax(0, 1fr) auto" }}>
                    <label style={{ display: "grid", gap: 6 }}>
                      <span style={{ fontSize: 14, fontWeight: 600 }}>
                        {viewMoreOptions ? "All Days" : "Alternatives"}
                      </span>
                      <select
                        value={selectedOptionValue}
                        onChange={(e) => setSelectedOptionValue(e.target.value)}
                        style={{ minHeight: 40 }}
                      >
                        <option value="">Use recommended: {recommendedCandidate.label}</option>
                        {viewMoreOptions
                          ? allModelDayOptions.map((day) => (
                            <option key={`day-${day.day_number}`} value={`day:${day.day_number}`}>
                              {modelDayOptionLabel(day)}
                            </option>
                          ))
                          : alternativeCandidates.map((candidate) => (
                            <option key={`day-${candidate.day_number}`} value={`day:${candidate.day_number}`}>
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
                        {submitting ? "Saving..." : actionLabel}
                      </button>
                    </div>
                  </div>

                  {viewMoreOptions && (
                    <div style={{ color: "#6b7280", fontSize: 13 }}>
                      Showing all 7 model days, ranked from longest ago to most recent. Ties fall back to earliest day.
                    </div>
                  )}
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
                    {removedItems.length > 0 && (
                      <div style={{ display: "grid", gap: 8 }}>
                        <div style={{ fontWeight: 700, color: "#166534" }}>Removed</div>
                        {removedItems.map((item) => (
                          <div
                            key={`removed-${item.routine_code}-${item.log?.id ?? item.label}`}
                            style={{ border: "1px solid #bbf7d0", borderRadius: 10, background: "white", padding: 12 }}
                          >
                            <div style={{ fontWeight: 700 }}>{item.label}</div>
                            <div style={{ color: "#475569" }}>Removed from today's selection</div>
                          </div>
                        ))}
                      </div>
                    )}
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
