# Local stack settings, read by start.ps1 on every launch.
#
# This file is git-ignored on purpose: it holds *your* machine's tuning, not
# something that should ship in the repo. Delete a line to fall back to the
# proxy's built-in default. Syntax is PowerShell, so values are quoted strings.
#
# Check what actually took effect:  deepseek-local status
# or:                               curl http://127.0.0.1:9655/health

# --- Session lifetime -------------------------------------------------------
# A "session" here is the remote DeepSeek chat. When it expires the proxy opens
# a fresh chat and replays local history into it, so memory survives - these
# values trade freshness against how much transcript gets replayed.
#
# 7 days. Effectively "never expires while I am working on this project".
$env:DEEPSEEK_SESSION_TTL_MS = "604800000"

# How many messages before the remote chat is replaced (default 100).
$env:DEEPSEEK_MAX_MESSAGE_DEPTH = "400"

# How much local history is replayed into the replacement chat. These must move
# with MAX_MESSAGE_DEPTH: raising depth alone still replays only 100 entries.
# Defaults are 100 messages / 400000 chars.
#
# Kept at 800000 = the upstream prompt cap below. A larger budget buys nothing:
# the prompt is capped anyway, so the excess would only be condensed away by
# lib/context.js before sending.
$env:DEEPSEEK_MAX_HISTORY_MESSAGES = "400"
$env:DEEPSEEK_MAX_HISTORY_CHARS = "800000"

# Idle sessions are kept on disk 2x the TTL by default; that follows the TTL
# above, so it is left unset.
# $env:DEEPSEEK_SESSION_IDLE_EVICT_MS = "1209600000"

# Upstream prompt cap in characters (default 800000 ~= 200k tokens). Anything
# past this is condensed by lib/context.js, not dropped, so leaving it alone is
# usually right - raising it makes each request heavier.
# $env:DEEPSEEK_MAX_PROMPT_CHARS = "800000"

# --- Accounts ---------------------------------------------------------------
# DeepSeek throttles a browser login for ~10 minutes. Leave this alone unless
# you are testing against a friendlier endpoint.
# $env:DEEPSEEK_ACCOUNT_COOLDOWN_MS = "600000"
