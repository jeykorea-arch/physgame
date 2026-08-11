import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

function githubPagesBase() {
  const repository = process.env.GITHUB_REPOSITORY?.split("/")[1];
  if (!repository || repository.endsWith(".github.io")) return "/";
  return `/${repository}/`;
}

export default defineConfig({
  base: githubPagesBase(),
  plugins: [react()],
  build: {
    outDir: "pages-dist",
    emptyOutDir: true,
  },
});
