// Centralize base URL and anything else app-wide later
export const API_BASE = (import.meta.env.VITE_API_BASE?.replace(/\/$/, "")) || "http://localhost:8000";
