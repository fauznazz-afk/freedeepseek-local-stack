# Models

One model: **DeepSeek-V4.1-Flash** (upstream release 2026-10-17). The proxy talks to [chat.deepseek.com](https://chat.deepseek.com), not the paid `api.deepseek.com` key.

`deepseek-flash` is the official paid-API ID for V4.1-Flash. On this proxy it is an alias of `deepseek-v4-flash`: `canonicalizeModelId()` rewrites any `deepseek-flash*` prefix to `deepseek-v4-flash*`, so both spellings reach the same Web weight. The suffixes are the two switches from the DeepSeek chat composer. They do not select a different model.

| ID | DeepThink | Native web search |
|---|---|---|
| `deepseek-v4-flash` / `deepseek-flash` | off | on |
| `deepseek-v4-flash-thinking` | on | on |
| `deepseek-v4-flash-nosearch` | off | off |
| `deepseek-v4-flash-thinking-nosearch` | on | off |

**`-thinking` turns DeepThink on.** V4.1-Flash reasons before it answers. The underlying model stays DeepSeek-V4.1-Flash.

**Native Web Search of chat.deepseek.com is on by default.** Internet lookups go through that search. A harness `websearch`, `webfetch`, or `WebFetch` tool is not a substitute; the proxy drops those tools while search is on.

**`-nosearch` turns search off.** So does `"web_search": false` in the request body, on any id. `"web_search": true` turns it back on for a `-nosearch` id. Any other value returns `400 invalid_request_error`. With search off, a coding agent keeps its own web tools.

**Former `-search` IDs.** `deepseek-v4-flash-search` and `deepseek-v4-flash-thinking-search` still work and mean `deepseek-v4-flash` and `deepseek-v4-flash-thinking`. They are not listed in `/v1/models`.

**Not served.** `deepseek-v4-pro` (V4-Pro 0813) exists on the paid API, but the Web chat no longer offers a Pro weight, so it returns `400 invalid_model` here. Also not registered: `deepseek-chat`, `deepseek-reasoner` (retired upstream 2026-07-24), `deepseek-r1`, `deepseek-instant`, `deepseek-expert`, and vision.

Claude Code names such as `claude-sonnet-*` and `claude-opus-*` map onto DeepSeek-V4.1-Flash and DeepSeek-V4.1-Flash with DeepThink.

List: `GET /v1/models`. Full map: `GET /v1/model-capabilities`.
