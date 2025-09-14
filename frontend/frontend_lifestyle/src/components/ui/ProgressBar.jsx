import React from "react";

export default function ProgressBar({ value = 0, max = 0, extraMarks = [] }) {
  const percent = max > 0 ? Math.min(value, max) / max : 0;
  const quarterMarks = [0.25, 0.5, 0.75];
  const seventhMarks = [1/7, 2/7, 3/7, 4/7, 5/7, 6/7];

  return (
    <div style={{ position: "relative", height: 12, background: "#e5e7eb", borderRadius: 4, overflow: "hidden" }}>
      <div style={{ width: `${percent * 100}%`, height: "100%", background: "#3b82f6" }} />
      {quarterMarks.map((m, i) => (
        <div
          key={`q-${i}`}
          style={{ position: "absolute", left: `${m * 100}%`, top: 0, bottom: 0, width: 2, background: "#1d4ed8" }}
        />
      ))}
      {seventhMarks.map((m, i) => (
        <div
          key={`s-${i}`}
          style={{ position: "absolute", left: `${m * 100}%`, top: "25%", bottom: "25%", width: 2, background: "#16a34a" }}
        />
      ))}
      {(extraMarks || []).map((mark, i) => (
        <div
          key={`x-${i}`}
          style={{ position: "absolute", left: `${(mark.fraction || 0) * 100}%`, top: "25%", bottom: "25%", width: 2, background: mark.color || "#f59e0b" }}
        />
      ))}
    </div>
  );
}

