<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Deploying

**Deploy by pushing.** `git push origin main` triggers the production deploy. That is the only supported route, and it is already configured.

**Never run `vercel --prod`.** A hook blocks it. The Vercel CLI prefers a `.vercel` link found in an **ancestor** directory over the one in the repo you are standing in, so a stale link at the workspace root silently deploys this app into a different project. On 2026-07-29 that put the Velluma app on sollos3.com, and later put CleanOps on app.velluma.co. `cd`-ing into the repo does not protect you, and neither does reading `.vercel/project.json` — the CLI ignores it. Delete any `.vercel/` you find above this repo.

**The push IS the deploy.** Run pending migration SQL *before* pushing, never after: production picks up the new code within about a minute, so pushing migration-dependent code first breaks the live app.

**Recovery.** If a domain ever serves the wrong app, `npx vercel promote <last-good-deployment-url> --scope <team-id>` restores it in seconds and is not blocked. Identify the last good deployment by build size — this app builds ~150 pages in ~30s; a stray small app builds a handful in ~3s.

# Working alongside another session

More than one agent may be in this repo at once. Stage explicit paths — `git add <file> ...` — never `git add -A` or `git commit -a`. On 2026-07-29 a blanket `git add -A` swept another session's in-progress files into an unrelated commit.
