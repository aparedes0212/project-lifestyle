import { BrowserRouter, Routes, Route, Link, useLocation } from "react-router-dom";
import RecentLogsCard from "./components/RecentLogsCard";
import StrengthRecentLogsCard from "./components/StrengthRecentLogsCard";
import LogDetailsPage from "./pages/LogDetailsPage";
import StrengthLogDetailsPage from "./pages/StrengthLogDetailsPage";
import { API_BASE } from "./lib/config";
import { useState } from "react";
import SettingsModal from "./components/SettingsModal";
import HomePage from "./pages/HomePage";

function CardioHome() {
  return (
    <>
      <RecentLogsCard />
    </>
  );
}

function StrengthHome() {
  return (
    <>
      <StrengthRecentLogsCard />
    </>
  );
}

function Header({ onOpenSettings }) {
  const loc = useLocation();
  let section = "Home";
  if (loc.pathname.startsWith("/strength")) section = "Strength";
  else if (loc.pathname.startsWith("/cardio") || loc.pathname.startsWith("/logs/")) section = "Cardio";
  return (
    <header style={{ marginBottom: 16 }}>
      <h1 style={{ margin: 0, fontSize: 24 }}>
        <Link to="/" style={{ textDecoration: "none", color: "inherit" }}>Project Lifestyle — {section}</Link>
      </h1>
      <nav style={{ marginTop: 4 }}>
        <Link to="/" style={{ marginRight: 12 }}>Home</Link>
        <Link to="/cardio" style={{ marginRight: 12 }}>Cardio</Link>
        <Link to="/strength">Strength</Link>
        <button type="button" onClick={onOpenSettings} style={{ marginLeft: 12, border: "1px solid #e5e7eb", background: "#f9fafb", borderRadius: 6, padding: "2px 8px", cursor: "pointer" }}>Settings</button>
      </nav>
      <div style={{ opacity: 0.7 }}>DRF-backed predictions & queues</div>
    </header>
  );
}

export default function App() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  return (
    <BrowserRouter>
      <div style={{ minHeight: "100vh", background: "#f8fafc", padding: 20, color: "#0f172a", fontFamily: "ui-sans-serif, -apple-system, Segoe UI, Roboto, Helvetica, Arial, Apple Color Emoji, Segoe UI Emoji" }}>
        <div style={{ maxWidth: 960, margin: "0 auto" }}>
          <Header onOpenSettings={() => setSettingsOpen(true)} />

          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/cardio" element={<CardioHome />} />
            <Route path="/logs/:id" element={<LogDetailsPage />} />
            <Route path="/strength" element={<StrengthHome />} />
            <Route path="/strength/logs/:id" element={<StrengthLogDetailsPage />} />
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
