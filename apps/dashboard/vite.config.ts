import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// VITE_* variables come from the repo-root .env (written by `pnpm env:local`).
export default defineConfig({
  plugins: [react()],
  envDir: "../..",
  server: { port: 5173 },
});
