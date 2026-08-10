import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    watch: {
      /**
       * Directories the dev server must not watch.
       *
       * Without this, `npm run dev` dies on Linux with
       * `ENOSPC: System limit for number of file watchers reached` — every
       * watched file costs one inotify watch, the per-user budget is finite,
       * and `airflow/logs/` alone holds over fifteen thousand task logs and
       * grows with every DAG run. None of these paths can change what the
       * browser renders, so watching them buys nothing and costs the whole
       * dev server.
       *
       * Vite appends these to its own defaults (`.git`, `node_modules`), so
       * listing them here does not disable anything it already ignores.
       */
      ignored: [
        "**/airflow/logs/**",
        "**/airflow/plugins/**",
        "**/airflow/config/**",
        "**/supabase/.branches/**",
        "**/supabase/.temp/**",
        "**/dist/**",
        "**/coverage/**",
        "**/playwright-report/**",
        "**/e2e/screenshots/**",
        "**/__pycache__/**",
      ],
    },
  },
  plugins: [react(), mode === "development" && componentTagger()].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
// force vite restart
