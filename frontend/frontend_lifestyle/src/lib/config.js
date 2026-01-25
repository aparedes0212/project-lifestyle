// Centralize base URL and anything else app-wide later
const envApiBase = import.meta.env.VITE_API_BASE?.replace(/\/$/, "");
const backendPort = import.meta.env.VITE_BACKEND_PORT ?? "8100";
const fallbackApiBase = `http://localhost:${backendPort}`;

export const API_BASE = envApiBase || fallbackApiBase;
