import { BrowserRouter, Routes, Route, Link, useLocation } from "react-router-dom";
import NextCard from "./components/NextCard";
import RecentLogsCard from "./components/RecentLogsCard";
import StrengthRecentLogsCard from "./components/StrengthRecentLogsCard";
import LogDetailsPage from "./pages/LogDetailsPage";
import StrengthLogDetailsPage from "./pages/StrengthLogDetailsPage";
import { API_BASE } from "./lib/config";

function CardioHome() {
  return (
    <>
      <NextCard />
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

function Header() {
  const loc = useLocation();
  const section = loc.pathname.startsWith("/strength") ? "Strength" : "Cardio";
  return (
    <header style={{ marginBottom: 16 }}>
      <h1 style={{ margin: 0, fontSize: 24 }}>
        <Link to="/" style={{ textDecoration: "none", color: "inherit" }}>Project Lifestyle — {section}</Link>
      </h1>
      <nav style={{ marginTop: 4 }}>
        <Link to="/" style={{ marginRight: 12 }}>Cardio</Link>
        <Link to="/strength">Strength</Link>
      </nav>
      <div style={{ opacity: 0.7 }}>DRF-backed predictions & queues</div>
    </header>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <div style={{ minHeight: "100vh", background: "#f8fafc", padding: 20, color: "#0f172a", fontFamily: "ui-sans-serif, -apple-system, Segoe UI, Roboto, Helvetica, Arial, Apple Color Emoji, Segoe UI Emoji" }}>
        <div style={{ maxWidth: 960, margin: "0 auto" }}>
          <Header />

          <Routes>
            <Route path="/" element={<CardioHome />} />
            <Route path="/logs/:id" element={<LogDetailsPage />} />
            <Route path="/strength" element={<StrengthHome />} />
            <Route path="/strength/logs/:id" element={<StrengthLogDetailsPage />} />
          </Routes>

          <footer style={{ marginTop: 24, fontSize: 12, opacity: 0.6 }}>
            API base: <code>{API_BASE}</code>
          </footer>
        </div>
      </div>
    </BrowserRouter>
  );
}
