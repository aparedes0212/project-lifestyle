import { useEffect, useState } from "react";
import { BrowserRouter, Link, Navigate, Route, Routes, useLocation } from "react-router-dom";
import SettingsModal from "./components/SettingsModal";
import HomePage from "./pages/HomePage";
import LogDetailsPage from "./pages/LogDetailsPage";
import CardioRoutinePage from "./pages/CardioRoutinePage";
import StrengthPage from "./pages/StrengthPage";
import StrengthLogDetailsPage from "./pages/StrengthLogDetailsPage";
import SupplementalLogDetailsPage from "./pages/SupplementalLogDetailsPage";
import SupplementalPage from "./pages/SupplementalPage";
import { API_BASE } from "./lib/config";
import { sectionForPath } from "./lib/routineRoutes";

let cardioGoalsRefreshRequested = false;

function Header({ onOpenSettings }) {
  const loc = useLocation();
  const section = sectionForPath(loc.pathname);

  return (
    <header style={{ marginBottom: 16 }}>
      <h1 style={{ margin: 0, fontSize: 24 }}>
        <Link to="/" style={{ textDecoration: "none", color: "inherit" }}>Project Lifestyle - {section}</Link>
      </h1>
      <nav style={{ marginTop: 4 }}>
        <Link to="/" style={{ marginRight: 12 }}>Home</Link>
        <Link to="/5k-prep" style={{ marginRight: 12 }}>5K Prep</Link>
        <Link to="/sprints" style={{ marginRight: 12 }}>Sprints</Link>
        <Link to="/strength" style={{ marginRight: 12 }}>Strength</Link>
        <Link to="/supplemental">Supplemental</Link>
        <button
          type="button"
          onClick={onOpenSettings}
          style={{ marginLeft: 12, border: "1px solid #e5e7eb", background: "#f9fafb", borderRadius: 6, padding: "2px 8px", cursor: "pointer" }}
        >
          Settings
        </button>
      </nav>
      <div style={{ opacity: 0.7 }}>DRF-backed predictions and queues</div>
    </header>
  );
}

function RefreshCardioGoalsOnLanding() {
  const loc = useLocation();

  useEffect(() => {
    const pathname = loc.pathname || "";
    const isLandingRoute = pathname === "/"
      || pathname === "/cardio"
      || pathname === "/cardio/"
      || pathname === "/5k-prep"
      || pathname === "/5k-prep/"
      || pathname === "/sprints"
      || pathname === "/sprints/";
    if (!isLandingRoute || cardioGoalsRefreshRequested) return;
    cardioGoalsRefreshRequested = true;

    fetch(`${API_BASE}/api/cardio/goals/refresh-all/`, { method: "POST" }).catch(() => {
      // Best-effort background refresh; UI data fetches handle eventual consistency.
    });
  }, [loc.pathname]);

  return null;
}

export default function App() {
  const [settingsOpen, setSettingsOpen] = useState(false);

  return (
    <BrowserRouter>
      <RefreshCardioGoalsOnLanding />
      <div
        style={{
          minHeight: "100vh",
          background: "#f8fafc",
          padding: 20,
          color: "#0f172a",
          fontFamily: "ui-sans-serif, -apple-system, Segoe UI, Roboto, Helvetica, Arial, Apple Color Emoji, Segoe UI Emoji",
        }}
      >
        <div style={{ maxWidth: 960, margin: "0 auto" }}>
          <Header onOpenSettings={() => setSettingsOpen(true)} />

          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route
              path="/5k-prep"
              element={(
                <CardioRoutinePage
                  routineName="5K Prep"
                  description="Log your 5K Prep work here. This page only surfaces 5K Prep workouts and recent 5K Prep sessions."
                />
              )}
            />
            <Route
              path="/sprints"
              element={(
                <CardioRoutinePage
                  routineName="Sprints"
                  description="Log your sprint work here. This page only surfaces sprint workouts and recent sprint sessions."
                />
              )}
            />
            <Route path="/cardio" element={<Navigate to="/5k-prep" replace />} />
            <Route path="/logs/:id" element={<LogDetailsPage />} />
            <Route path="/strength" element={<StrengthPage />} />
            <Route path="/strength/logs/:id" element={<StrengthLogDetailsPage />} />
            <Route path="/supplemental" element={<SupplementalPage />} />
            <Route path="/supplemental/logs/:id" element={<SupplementalLogDetailsPage />} />
          </Routes>

          <footer style={{ marginTop: 24, fontSize: 12, opacity: 0.6 }}>
            API base: <code>{API_BASE}</code>
          </footer>
          <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
        </div>
      </div>
    </BrowserRouter>
  );
}
