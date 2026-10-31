# Shared-host tuning for FreeDeepseekAPI + 9router.
#
# Copy over settings.local.ps1 when several people (or several agents) share one
# proxy instance:
#
#   Copy-Item local-stack\settings.shared.example.ps1 local-stack\settings.local.ps1
#   deepseek-local restart
#
# Why a separate file: the single-user example keeps one chat alive for 7 days
# and replays 400 turns. That is fine for one laptop. On a shared host it pins
# a login per idle client, grows data/sessions.json, and multiplies the prompt
# size of every retry. Everything below trades memory and freshness for headroom.
#
# The hard limit is not CPU or RAM: ONE DeepSeek login serves ONE in-flight chat.
# Concurrency = number of ready logins. Ten users need ten logins or they queue.
# Budget logins first, then tune here.

# --- Session lifetime -------------------------------------------------------
# 12 hours instead of 7 days. An abandoned chat frees its remote context, and a
# new day starts clean. Raise only if users report losing context mid-task.
$env:DEEPSEEK_SESSION_TTL_MS = "43200000"

# 150 messages instead of 400. Shorter chains reset earlier, so the replay path
# is exercised sooner and each remote chat stays small.
$env:DEEPSEEK_MAX_MESSAGE_DEPTH = "150"

# Replay caps must move with depth. 150 turns, 200k chars: a shared box should
# not spend its whole prompt budget on history it has to condense again.
$env:DEEPSEEK_MAX_HISTORY_MESSAGES = "150"
$env:DEEPSEEK_MAX_HISTORY_CHARS = "200000"

# Keep idle sessions on disk only 1x the TTL (default is 2x). With many users the
# session file is the biggest thing on disk and the slowest thing at startup.
$env:DEEPSEEK_SESSION_IDLE_EVICT_MS = "43200000"
$env:DEEPSEEK_MAX_SESSIONS = "1000"

# --- Prompt ----------------------------------------------------------------
# 200k chars (~50k tokens), well under the ~500-760k where DeepSeek Web starts
# answering 502 "Сервер занят". Smaller prompts mean faster turns and fewer
# empty-reply retries, which matters when several users wait in the same queue.
$env:DEEPSEEK_MAX_PROMPT_CHARS = "200000"

# More retries than the default 2: a shared host sees more transient upstream
# trouble, and a retry is cheaper than a user-facing 502.
$env:DEEPSEEK_MAX_RETRIES = "3"

# --- Timeouts --------------------------------------------------------------
# Same 300s as single-user: DeepThink genuinely runs long. Cutting this just
# aborts work that was about to finish.
$env:DEEPSEEK_REQUEST_DEADLINE_MS = "300000"

# 90s idle per stream: search + thinking can pause the stream for a long time.
$env:DEEPSEEK_FETCH_TIMEOUT_MS = "90000"

# A user waiting on a busy login gets a fair queue slot, not a fast failure.
# 120s (default) is the right value for a shared box; do not lower it.
$env:DEEPSEEK_ACCOUNT_LOCK_WAIT_MS = "120000"

# --- Accounts and backpressure ---------------------------------------------
# Do NOT lower the cooldown here. 30s is a single-user trick that works because
# one person rarely bursts. Many users will re-hit the same throttled login and
# turn a soft rate limit into a hard ban. Keep the proxy default of 10 minutes,
# and give DeepSeek enough logins instead.
$env:DEEPSEEK_ACCOUNT_COOLDOWN_MS = "600000"

# Quarantine for a login whose token DeepSeek rejected twice. A shared box should
# drop a dead credential out of rotation for a while rather than burn a PoW solve
# per request.
$env:DEEPSEEK_AUTH_EXPIRED_COOLDOWN_MS = "1800000"

# Cooldowns must survive a restart. Leaving this at its default is correct; it is
# set explicitly here so nobody "fixes" a throttle by restarting the service.
$env:DEEPSEEK_COOLDOWN_STATE_PATH = "./data/cooldowns.json"

# Process-wide backpressure. Real parallelism is the number of idle logins, so a
# number far above the login count only builds a longer queue, not more speed.
$env:DEEPSEEK_MAX_CONCURRENT = "24"

# --- Memory ledgers --------------------------------------------------------
# Per-session ledger stays on (it is what keeps a long task workable after
# compaction). Keep it modest on a shared host: 16k chars x 1000 sessions adds up.
$env:DEEPSEEK_MAX_MEMORY_CHARS = "8000"

# Shared project ledger: leave it OFF. It pools facts from every user's session
# into one file inherited by new agent keys, which leaks one user's paths and
# errors into another user's prompt. Turn it on only for a single team that has
# agreed to share context.
$env:DEEPSEEK_SHARED_MEMORY_CHARS = "0"

# --- Guard blocks ----------------------------------------------------------
# Leave the process-wide switch alone. Per-request `guard_blocks: false` is the
# supported way to relax them; a global off weakens every user's agent traffic.
# $env:DEEPSEEK_GUARD_BLOCKS = "on"

# --- Network ---------------------------------------------------------------
# A shared instance is reachable from other machines, so it MUST have a key.
# Set a long random value, and keep REQUIRE_PROXY_API_KEY=1 so the proxy refuses
# to start without it. Without the key, anyone on the network can spend your
# DeepSeek logins and read /admin/accounts.
#
# $env:HOST = "0.0.0.0"
# $env:PROXY_API_KEY = "<long-random-value>"
# $env:REQUIRE_PROXY_API_KEY = "1"
# $env:PROXY_CORS_ORIGINS = "https://your-ui.example.com"
