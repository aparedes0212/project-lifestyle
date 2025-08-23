import { BrowserRouter, Routes, Route, Link } from "react-router-dom";
import NextCard from "./components/NextCard";
import RecentLogsCard from "./components/RecentLogsCard";
import LogDetailsPage from "./pages/LogDetailsPage";
import { API_BASE } from "./lib/config";

function Home() {
  return (
    <>
      <NextCard />
      <RecentLogsCard />
    </>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <div style={{ minHeight: "100vh", background: "#f8fafc", padding: 20, color: "#0f172a", fontFamily: "ui-sans-serif, -apple-system, Segoe UI, Roboto, Helvetica, Arial, Apple Color Emoji, Segoe UI Emoji" }}>
        <div style={{ maxWidth: 960, margin: "0 auto" }}>
          <header style={{ marginBottom: 16 }}>
            <h1 style={{ margin: 0, fontSize: 24 }}>
              <Link to="/" style={{ textDecoration: "none", color: "inherit" }}>Project Lifestyle — Cardio</Link>
            </h1>
            <div style={{ opacity: 0.7 }}>DRF-backed predictions & queues</div>
          </header>

          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/logs/:id" element={<LogDetailsPage />} />
          </Routes>

          <footer style={{ marginTop: 24, fontSize: 12, opacity: 0.6 }}>
            API base: <code>{API_BASE}</code>
          </footer>
        </div>
      </div>
    </BrowserRouter>
  );
}
