import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// On GitHub Pages the site is served from https://<user>.github.io/<repo>/, so assets
// need the repo name as a base. VITE_BASE overrides this for custom domains.
const repoName = process.env.GITHUB_REPOSITORY?.split('/')[1];
const base = process.env.VITE_BASE ?? (repoName ? `/${repoName}/` : '/');

export default defineConfig({
  base,
  plugins: [react(), tailwindcss()],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
