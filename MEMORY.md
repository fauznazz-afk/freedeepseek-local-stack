# freedeepseek-local-stack

Local OpenAI-compatible proxy for DeepSeek Web Chat, plus a launcher that wires it
to 9router. Runs on Windows on this machine.

## Facts

- Repo root: `D:\FreeDeepseekAPI` (proxy at root, launcher in `local-stack/`)
- Upstream: `dekrezz/FreeDeepseekAPI` (remote name `upstream`); origin is `fauznazz-afk/freedeepseek-local-stack`
- Branch: `main`
- Ports: proxy `9655`, 9router `20128`
- Node 18+, zero npm dependencies in the proxy
- Auth: `deepseek-auth.json` at repo root, git-ignored. Never commit it.
- Local data lives in `data/sessions.json`, also git-ignored
- 9router runtime: `9router-source\cli\app` (local build, v0.5.330) - launcher prefers it
- 9router fallback: `%APPDATA%\npm\node_modules\9router\app` (global install, v0.5.112)
- 9router state: `%APPDATA%\9router` (SQLite + patch backups), shared by both builds
- 9router source checkout: `9router-source/` (v0.5.330, git-ignored)

## Commands

- Start everything: `local-stack\Start-All.bat`
- Stop everything: `local-stack\Stop-All.bat`
- Full chain check: `local-stack\Verify-All.bat` — expect `CHAIN_OK`
- Unit tests: `node --test tests/unit.test.js` — expect 105 pass
- Full suite: `npm test` — 291 pass, 13 fail (pre-existing: need Chrome/macOS)

## Decisions

- `2026-10-29` — Proxy is the repo root and `local-stack/` is a subfolder, so one
  clone gives the whole chain. Scripts resolve the proxy as `..` from
  `$PSScriptRoot`; override with `$env:FREEDEEPSEEK_DIR`.
- `2026-10-29` — Guard blocks are disabled **per request** (`guard_blocks: false`
  in the body, or the `x-deepseek-guard-blocks` header), never globally. A global
  switch would weaken every agent request to serve one refactor call.
- `2026-10-29` — Session limits became env-driven (`DEEPSEEK_SESSION_TTL_MS` etc.)
  with the old values as defaults. Raising them extends a working session; it is
  not long-term memory.
- `2026-10-29` — Long-term memory lives in the system prompt (`AGENTS.md` +
  `MEMORY.md`), not in the session store. Measured ceiling for a memo that must be
  recalled precisely: ~80,000 characters.

## Traps

- **Rebuilding 9router un-patches it.** `patch-deepseek.ps1` rewrites compiled JS
  chunks that contain `https://api.deepseek.com/...`. `npm run cli:pack` regenerates
  those chunks with the upstream URLs, so always re-run the patch after a build or
  9router calls DeepSeek directly instead of through the proxy.
- **`build-cli.js` output is not self-contained.** It copies only a few `src/` files,
  but `custom-server.js` loads `src/dashboardGuard.js`, `src/shared/services/
  telegramBackup.js`, `src/sse/services/backgroundTokenRefresh.js`,
  `src/lib/db/repos/securityLogRepo.js`, `src/lib/auth/dashboardSession.js` and
  `scripts/auth-guard-hooks.mjs` by absolute path, probing parent dirs. Copy the full
  `src/`, `scripts/`, `CHANGELOG.md`, and mirror `node_modules/next` (assemble.sh does
  this on Linux). Without it: `AuthGuard load failed: ENOENT ...next\server.js`.
- **`npm install` fails on Node 24+ because of `better-sqlite3`.** It has no prebuilt
  binary for Node 25 and node-gyp needs a VS C++ workload. Use `--ignore-scripts`: the
  driver skips `better-sqlite3` on Node 24+ anyway and uses built-in `node:sqlite`.
- **9router drops client headers.** `x-agent-session` and
  `x-deepseek-guard-blocks` never reach the proxy through 9router. Use body fields
  (`user`, `guard_blocks`) instead.
- Refactoring through 9router needs **both** `guard_blocks: false` **and**
  `tool_choice: "none"`. Without `tool_choice` the model calls `write_file`
  instead of returning code.
- Removing the `{"tool_call":...}` envelope when tools are advertised produces
  `502 malformed_tool_call`. It is a parsing contract, not a style rule.
- `npm test` fails 13 tests on this machine. That is the baseline, not a
  regression. Use `node --test tests/unit.test.js` for a clean signal.
- DeepSeek rate-limits a login for ~10 minutes with "Слишком частые сообщения".
  Rapid test runs trigger it; it is not a proxy bug. `DEEPSEEK_ACCOUNT_COOLDOWN_MS`
  defaults to 600000 for this reason.
- Killing only the process on port 20128 makes 9router look like it fails to
  start: its `cli.js` supervisor respawns the child. `stop.ps1` kills the
  supervisor first.
- `git push` is rejected with `GH007` if the commit email is private on GitHub.
  This repo uses `193550268+fauznazz-afk@users.noreply.github.com`.

## User preferences

- Respond in Indonesian, concise and practical.
- Prove claims with a real run, not with reasoning about the code.
- Never commit credentials. Redact or move to an env var.
- Do not push to `dekrezz/FreeDeepseekAPI`; that is someone else's repo.
