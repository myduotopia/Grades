import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

declare const process: { env: Record<string, string | undefined> }

// Per-issue preview: on Vercel preview builds for branches other than
// `staging` / `main`, derive the backend URL from the branch name so each
// PR's frontend talks to its own backend deployment instead of staging's.
// Vercel slugifies branch names by replacing `/` and `_` with `-` and
// lowercasing — must match exactly or CORS / 404 will follow.
// See docs/deployment.md "Per-issue preview" section.
const branch = process.env.VERCEL_GIT_COMMIT_REF
const isVercelPreview = process.env.VERCEL_ENV === 'preview'
const longLivedBranches = new Set(['staging', 'main'])

if (
  isVercelPreview &&
  branch &&
  !longLivedBranches.has(branch)
) {
  const slug = branch.replace(/[\/_]/g, '-').toLowerCase()
  process.env.VITE_API_BASE_URL = `https://grades-backend-git-${slug}-kaddyeunice.vercel.app`
}

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5000,
  },
})
