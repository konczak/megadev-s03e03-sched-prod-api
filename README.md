# sched-prod-api

The incidents API of `sched-prod`, a scheduling product. A Cloudflare Worker (`src/index.js`) that serves
production's incidents to the status page, the on-call board and the support console.

- `contract/api.md` — the pinned API contract.
- `decisions/TEMPLATE.md` — the shape of a decision record. The records themselves are on the tracker.
- `research/` — research the product team has collected.
- `AGENTS.md` — how work lands here and the tracker's calls. Read it before the first change.

## Run it

1. `npm install`
2. Copy `.dev.vars.example` to `.dev.vars` and set `FEED_URL` to the feed URL the round hands you.
3. `npm run dev`

## Live

`npm run deploy` ships production to your own Cloudflare account (Workers Free is enough), at a public
**https** address.

## The agent in this repo

- `dispatcher/`: a Cloudflare cron Worker that runs every minute. It reads the tracker, posts the pick-up comment
  on each new issue, and starts one `work-issue` run at a time: owner answers first, then new issues, oldest first.
- `.github/workflows/work-issue.yml`: one run works one issue. `agent/fetch-context.mjs` puts the issue and its
  context in `.work/`. Codex works it with the `triage` skill (`.agents/skills/triage`), with no network and no
  tokens. `agent/apply.mjs` checks the result, then commits, deploys, checks the live address, writes to the
  tracker and posts the ship line.
- ntfy pings the owner when a question or a record to sign waits on the round page.

## An agent that works while you are away

Issues arrive on the tracker while you are not watching. Something has to wake on each one, work it and
ship it. Pick a runner; any of these can do it:

- **A scheduled Worker or job** — a cron trigger every minute that reads the tracker and hands new work
  to a coding agent.
- **A cloud agent** — e.g. Claude Code on the web, Cursor background agents, Codex cloud, on a schedule.
- **Your own box** — a VPS or a spare machine with a loop and a headless CLI (`claude -p`,
  `codex exec`, `gemini`).
