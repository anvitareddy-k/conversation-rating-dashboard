import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Must match your GitHub repo name (Pages URL: https://<user>.github.io/<repo-name>/)
const repoName = "conversation-rating-dashboard";

export default defineConfig({
  base: `/${repoName}/`,
  plugins: [react()],
  server: {
    port: 5173,
    open: true,
  },
});
