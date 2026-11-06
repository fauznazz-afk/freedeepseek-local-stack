<p align="center">
  <img src="docs/assets/logo.png" alt="FreeDeepseekAPI" width="160" />
</p>

<h1 align="center">FreeDeepseekAPI</h1>

<p align="center">
  <strong>Pakai akun DeepSeek gratis sebagai API</strong>
</p>

<p align="center">
  <a href="https://github.com/fauznazz-afk/freedeepseek-local-stack/blob/main/LICENSE"><img alt="Apache License 2.0" src="https://img.shields.io/badge/license-Apache%202.0-green.svg" /></a>
  <img alt="Node.js 18 plus" src="https://img.shields.io/badge/node-18%2B-339933.svg" />
  <img alt="No npm dependencies" src="https://img.shields.io/badge/dependencies-0-blue.svg" />
  <img alt="OpenAI compatible" src="https://img.shields.io/badge/OpenAI-compatible-111111.svg" />
</p>

Proxy API lokal di depan **DeepSeek Web Chat** ([chat.deepseek.com](https://chat.deepseek.com)).
Arahkan Open WebUI, LiteLLM, Hermes, Claude Code, Codex, OpenCode, Cursor, atau klien
OpenAI-compatible mana pun ke sini. Tanpa API key berbayar `api.deepseek.com`.

Satu model: **DeepSeek-V4.1-Flash**. Native Web Search **nyala default**;
`-thinking` menyalakan DeepThink, `-nosearch` atau `"web_search": false` mematikan pencarian.

> Proxy eksperimental di atas Web chat. DeepSeek bisa mengubah API Web privatnya kapan saja.

---

## Isi

- [Pasang](#pasang)
- [Perintah harian](#perintah-harian)
- [Model](#model)
- [Endpoint](#endpoint)
- [Cara kerja](#cara-kerja)
- [Multi-akun](#multi-akun)
- [Konfigurasi](#konfigurasi)
- [Tes](#tes)
- [Masalah umum](#masalah-umum)

---

## Pasang

Butuh Windows 10/11 + PowerShell, Node.js 18+, npm, Chrome (untuk login), dan akun
DeepSeek. `9router` opsional untuk rantai penuh.

```powershell
Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned
powershell -ExecutionPolicy Bypass -File install.ps1
npm run auth            # login DeepSeek di Chrome
deepseek-local start
deepseek-local verify   # harus CHAIN_OK
```

`install.ps1` idempoten dan fail-closed. Flag: `-Check` (laporan saja),
`-SkipRouter` (proxy saja), `-SkipShim` (tanpa PATH shim).

**Login DeepSeek:** setelah `npm run auth`, login di Chrome, kirim satu pesan (`ok`),
Enter. Hasil `deepseek-auth.json` (mode 0600, git-ignored). Jangan commit.

**Tanpa shim:** `local-stack\Start-All.bat`, `Verify-All.bat`, `Stop-All.bat`.

**Proxy saja:** `install.ps1 -SkipRouter` lalu `npm start`. Endpoint `http://127.0.0.1:9655/v1`,
dashboard `http://127.0.0.1:9655/dashboard`.

**Akun tambahan:** `powershell -File local-stack\add-account.ps1 -Name akun2`. Harus email berbeda.

**Upgrade:** `git pull --ff-only` lalu `install.ps1` ulang. Tuning dan sesi tidak disentuh.

---

## Perintah harian

| Aksi | Perintah |
|---|---|
| Nyalakan semua | `deepseek-local` atau `deepseek-local start` |
| Matikan semua | `deepseek-local off` (alias `stop`) |
| Restart | `deepseek-local restart` |
| Status | `deepseek-local status` |
| Cek rantai | `deepseek-local verify` |
| Login ulang | `npm run auth` |
| Diagnosa | `npm run doctor` |

---

## Model

| ID | DeepThink | Web search |
|---|---|---|
| `deepseek-v4-flash` | off | on |
| `deepseek-v4-flash-thinking` | on | on |
| `deepseek-v4-flash-nosearch` | off | off |
| `deepseek-v4-flash-thinking-nosearch` | on | off |

`"web_search": true|false` menimpa sakelar pencarian id mana pun. Lewat 9router prefix
`ds/`; langsung ke proxy prefix `freedeepseek/`. ID lama (`deepseek-chat`, `deepseek-reasoner`,
dll.) mengembalikan `400 invalid_model`.

---

## Endpoint

| Method | Path | Fungsi |
|---|---|---|
| `GET` | `/health` | Proses hidup + status akun |
| `GET` | `/readyz` | `200` hanya kalau ada login siap |
| `GET` | `/dashboard` | Dashboard akun |
| `GET` | `/v1/models` | Empat ID DeepSeek-V4.1-Flash |
| `POST` | `/v1/chat/completions` | OpenAI Chat Completions |
| `POST` | `/v1/messages` | Anthropic Messages |
| `POST` | `/v1/responses` | OpenAI Responses |
| `GET` | `/v1/sessions` | Sesi agent lokal |
| `POST` | `/reset-session?agent=<id>` | Buang satu chat Web |
| `GET` | `/admin/{accounts,requests,usage,agents}` | Admin API |

Contoh:

```bash
curl -X POST http://127.0.0.1:9655/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "x-agent-session: my-agent" \
  -d '{"model":"deepseek-v4-flash","messages":[{"role":"user","content":"Hello"}]}'
```

Protokol lengkap: [docs/api.md](docs/api.md) · [docs/models.md](docs/models.md) ·
[docs/agents.md](docs/agents.md).

---

## Cara kerja

```
klien → 9router (20128) → FreeDeepseekAPI (9655) → web DeepSeek
```

Tiga lapis: `server.js` + `lib/` (proxy, parser, recovery, kompaksi, POW),
`public/dashboard/` + `scripts/` (dashboard, auth, doctor), `local-stack/` (launcher PowerShell).

**Sesi:** satu `x-agent-session`/`session`/`user` = satu chat DeepSeek. System prompt dan
tool dikirim sekali; giliran berikutnya hanya delta. Balasan kosong/tool-call rusak/timeout
mempertahankan chat. Chat baru saat sesi hilang, `DEEPSEEK_MAX_MESSAGE_DEPTH` tercapai,
TTL habis, prompt terlalu panjang, atau `/reset-session`.

**Kompaksi:** prompt dipotong ke `DEEPSEEK_MAX_PROMPT_CHARS`. Turn pertama dipertahankan
(maks 30%), 35% terbaru verbatim, sisanya diringkas dengan anchor (path, perintah, URL, error).
Ini ekstraktif, bukan context window 1M token.

**Token:** `prompt_tokens` = input klien; `upstream_prompt_tokens` = yang benar-benar dikirim
ke DeepSeek. Rasio besar normal untuk klien yang mengirim ulang transkrip tiap turn.

---

## Multi-akun

Rotasi otomatis: satu login kena cooldown, request pindah ke akun lain. Aturan pool:
**satu chat in-flight per login**; request kedua menunggu, tidak menimpa.

```powershell
pwsh -File local-stack\add-account.ps1 -Name akun2 -Restart
pwsh -File local-stack\add-account.ps1 -Name akun2 -Refresh -Restart
```

Profil Chrome di `.chrome-profiles\<nama>`, auth di `accounts\<nama>.json` (git-ignored).
Akun harus email berbeda. Dashboard menampilkan status per login dan bisa pause/resume/clear cooldown.

---

## Konfigurasi

`start.ps1` dot-source `local-stack\settings.local.ps1` setiap launch. Clone baru memakai
`settings.local.example.ps1`.

| Variabel | Default | Arti |
|---|---|---|
| `HOST` | `127.0.0.1` | Bind address |
| `PORT` | `9655` | Port listen |
| `PROXY_API_KEY` | off | Bearer wajib untuk `/v1/*` dan `/admin/*` |
| `DEEPSEEK_MAX_PROMPT_CHARS` | `800000` (mesin ini `480000`) | Plafon prompt upstream |
| `DEEPSEEK_REQUEST_DEADLINE_MS` | `120000` | Deadline per request |
| `DEEPSEEK_ACCOUNT_COOLDOWN_MS` | `600000` | Cooldown dasar setelah 401/403/rate limit |
| `DEEPSEEK_SESSION_TTL_MS` | `7200000` | Lama chat dipakai ulang |
| `DEEPSEEK_MAX_MESSAGE_DEPTH` | `100` | Pesan per chat sebelum reset |
| `DEEPSEEK_MAX_HISTORY_MESSAGES` | `100` | Giliran lokal diputar ulang |
| `DEEPSEEK_MAX_HISTORY_CHARS` | `400000` | Anggaran replay, otomatis dipotong ke 35% plafon prompt |
| `DEEPSEEK_AUTO_COMPACT` | on | Fakta giliran dibuang disimpan ke ledger dulu |
| `DEEPSEEK_SHARED_MEMORY_CHARS` | `0` | Ledger memori proyek bersama |
| `DEEPSEEK_GUARD_BLOCKS` | on | Fallback global guard blocks |

Daftar lengkap: [docs/api.md](docs/api.md) dan `server.js`.

**Refactor mode:** `"guard_blocks": false` (body) atau `x-deepseek-guard-blocks: off`.
Lewat 9router wajib `{"guard_blocks": false, "tool_choice": "none"}` — 9router membuang header klien.

**Mode otonom:** `"agent_autonomy": true` atau `x-agent-autonomy: full`. Mati otomatis di refactor mode.

---

## Tes

```powershell
node --test tests/unit.test.js          # 158 pass
node --test tests/concurrency.test.js    # 18 pass
npm run test:unit                        # 356 pass (tanpa chrome-setup/agents-api)
```

`npm test` di mesin Windows masih gagal di `chrome-setup` (path macOS) dan `agents-api`
(mode file 0600) — baseline upstream, bukan regresi lokal.

---

## Masalah umum

- **401/403:** cookie web kedaluwarsa → `npm run auth` lalu `deepseek-local restart`.
- **9router tidak start:** supervisor `cli.js` respawn proses; `stop.ps1` bunuh supervisor dulu.
- **Rate limit "Слишком частые сообщения":** throttle asli DeepSeek ~10 menit, bukan bug proxy.
- **502 "Сервер занят":** prompt di atas ~500–760k karakter ditolak DeepSeek Web.
- **Cooldown hilang:** kini dipersist di `data/cooldowns.json`.
- **Build ulang 9router:** URL `api.deepseek.com` kembali; `start.ps1` mem-patch tiap launch.

---

## Lisensi

Apache-2.0. Fork lokal dari [dekrezz/FreeDeepseekAPI](https://github.com/dekrezz/FreeDeepseekAPI);
remote `upstream` dipertahankan untuk menarik perubahan upstream.
