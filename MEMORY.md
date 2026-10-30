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

- Start everything: `deepseek-local` (shim) or `local-stack\Start-All.bat`
- Stop everything: `deepseek-local off` (alias `stop`) or `local-stack\Stop-All.bat`
- Restart: `deepseek-local restart` - waits for ports 9655/20128 to stop listening
  before starting, instead of a fixed sleep that raced TIME_WAIT sockets
- Full chain check: `deepseek-local verify` or `local-stack\Verify-All.bat` - expect `CHAIN_OK`
- Unit tests: `node --test tests/unit.test.js` - expect 106 pass
- Full suite: `npm test` - 291 pass, 13 fail (pre-existing: need Chrome/macOS)

## Decisions

- `2026-10-29` - Proxy is the repo root and `local-stack/` is a subfolder, so one
  clone gives the whole chain. Scripts resolve the proxy as `..` from
  `$PSScriptRoot`; override with `$env:FREEDEEPSEEK_DIR`.
- `2026-10-29` - Guard blocks are disabled **per request** (`guard_blocks: false`
  in the body, or the `x-deepseek-guard-blocks` header), never globally. A global
  switch would weaken every agent request to serve one refactor call.
- `2026-10-29` - Session limits became env-driven (`DEEPSEEK_SESSION_TTL_MS` etc.)
  with the old values as defaults. Raising them extends a working session; it is
  not long-term memory.
- `2026-10-29` - `MAX_HISTORY_LENGTH` / `MAX_HISTORY_CHARS` also became env-driven
  (`DEEPSEEK_MAX_HISTORY_MESSAGES` / `DEEPSEEK_MAX_HISTORY_CHARS`). They are the
  real limit on recovery: raising `DEEPSEEK_MAX_MESSAGE_DEPTH` alone still replays
  only the last 100 turns after a rollover, so the two must move together.
- `2026-10-29` - An oversized recovery history is condensed, never dropped. It used
  to be thrown away whenever the replay pushed the prompt past the cap, which
  emptied a long session at exactly the moment recovery mattered (measured:
  948,868 chars in, 46 chars out). Now it gets `HISTORY_BUDGET_SHARE` (35%) of the
  prompt and is compacted by `lib/context.js`.
- `2026-10-29` - Machine tuning lives in `local-stack\settings.local.ps1`
  (git-ignored, example shipped). `start.ps1` dot-sources it so the values reach
  the spawned proxy and survive reboots without re-exporting env vars. A broken
  file warns and falls back to defaults instead of blocking startup.
- `2026-10-29` - This machine runs 7-day TTL / 400 messages / 400-message replay
  over 800k chars. The replay char budget is pinned to `DEEPSEEK_MAX_PROMPT_CHARS`:
  anything above the prompt cap cannot be sent, so a larger budget only adds
  material for `lib/context.js` to condense away. Verified live: a token set
  before `deepseek-local restart` was still recalled after it, and a 10s TTL test
  proved rollover replays local history rather than dropping it.
- `2026-10-29` - Long-term memory lives in the system prompt (`AGENTS.md` +
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
  supervisor first. The pattern must cover **both** the global install
  (`node_modules\9router\app`) and the local build
  (`9router-source\cli\app\custom-server.js`); a global-only pattern leaves the
  local build running and `off` reports success with the port still listening.
- **`restart` must wait for the ports, not sleep.** A socket in `TIME_WAIT` still
  answers a connect probe, so `start.ps1` decides the stack is already up, skips
  launching, and `restart` silently leaves the old process in place. Poll
  `Get-NetTCPConnection -State Listen` until empty (20s cap) before starting.
- `git push` is rejected with `GH007` if the commit email is private on GitHub.
  This repo uses `193550268+fauznazz-afk@users.noreply.github.com`.
- Reading the 9router DB: `9router-source/node_modules/better-sqlite3` has NO
  compiled bindings (dead end), but Node's built-in `node:sqlite` (`DatabaseSync`)
  works fine on the live `%APPDATA%/9router/db/data.sqlite` — copy the
  `data.sqlite-wal`/`-shm` next to the copy under the same names (`*.sqlite-wal`)
  or WAL content is missed. Working prebuilt bindings also exist in
  `%APPDATA%/9router/runtime/node_modules/better-sqlite3/prebuilds/win32-x64.node`.
- The "lag 4–5 menit lalu sukses" pattern (2026-10-30) was NOT a combo the user
  defined and NOT the proxy: 9router's **capacity adapter** prepends
  `oc/mimo-v2.6-flash-free` (the hardcoded DEFAULT_FALLBACK_MODEL) whenever a
  request needs vision and the target model lacks it, and that upstream hung
  272s before answering 429 FreeUsageLimitError. Fix: write
  `capacityAdapter` into the `settings` row (scope NOT `kv`) pointing
  vision/pdf/audio/video pools at `ag/gemini-3.8-flash` (vision-capable, active,
  auto-refreshed Google token). `getSettings()` re-reads the DB per request, so
  the change applies without a restart; verified live via image test request.
- DeepSeek web bounces over-length prompts with a 0-char stream mapped to a
  502 "Сервер занят" (upstream's own Russian "server busy" text). Cap for the
  upstream prompt is now 480000 chars via DEEPSEEK_MAX_PROMPT_CHARS in
  settings.local.ps1 (was the 800k built-in default; a compaction result of
  761k chars bounced repeatedly on 2026-10-30). Verified: 798k-char prompt
  compacts to 479998 chars and answers normally.
- Session memory ledger (2026-10-30, commit b2d5b57): when compaction loses a
  turn (dropped outright, or condensed into a <120-char stub), its paths,
  commands and errors are banked into `session.memory` (cap DEEPSEEK_MAX_MEMORY_CHARS=16000,
  persisted in data/sessions.json) and replayed at the head of the recovery
  prefix on the next reset/rebuild. Sticky continuations skip it (the live
  remote chat still holds those turns). First production bank: 162 anchors on
  unkeyed-00b5c6e89a38 from a 2M-char conversation.
- Shared project ledger (2026-10-30, commit 588fddc): with
  DEEPSEEK_SHARED_MEMORY_CHARS > 0 (set to 16000 in settings.local.ps1), every
  harvested anchor also banks into data/shared-memory.json (persisted by
  saveSessions, loaded at startup). A brand-NEW agent key inherits it via the
  recovery prefix. Verified live: fresh key with no history answered both
  seeded shared lines exactly. Render skips lines already in the shared block,
  so nothing doubles. Isolation claim locked by tests: ledger is per-session,
  and anchors that survive in the prompt are never banked.
- Refreshing 9router's model list: the RUNNING build is bundled in
  `9router-source/cli/app/.next-cli-build/server/*.js` — editing
  `open-sse/providers/registry/*.js` alone has no effect until the bundle is
  rebuilt. Follow `patch-deepseek.ps1`: exact-substring surgery on the
  minified chunks with a backup in `%APPDATA%/9router/patch-backup/<stamp>`
  (always verify via `IndexOf` on the BACKUP that the slice is the right
  array — two registry copies and unrelated `models:[...]` arrays share ids).
  Applied 2026-10-30: removed the stale oc/ static array
  (muse-spark-1.2/1.3-contributor-free, union-alpha, jev-1.13-free — dead
  upstream, verified against live https://opencode.ai/zen/v1/models); the
  live-catalog passthrough in /v1/models now supplies exactly what upstream
  lists. DeepSeek (ds/) model ids come from capabilities/pricing maps in the
  same chunks and are unaffected.

## User preferences

- Respond in Indonesian, concise and practical.
- Prove claims with a real run, not with reasoning about the code.
- Never commit credentials. Redact or move to an env var.
- Do not push to `dekrezz/FreeDeepseekAPI`; that is someone else's repo.
