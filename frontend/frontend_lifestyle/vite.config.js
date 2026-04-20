import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import process from "node:process";

const rawFrontendPort = process.env.FRONTEND_PORT ?? process.env.PORT;
const parsedPort = Number(rawFrontendPort);
const frontendPort = Number.isFinite(parsedPort) && parsedPort > 0 ? parsedPort : 5200;

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: frontendPort,
  },
});
