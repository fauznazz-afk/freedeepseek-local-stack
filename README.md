<p align="center">
  <img src="docs/assets/logo.png" alt="FreeDeepseekAPI" width="160" />
</p>

<h1 align="center">FreeDeepseekAPI</h1>

<p align="center">
  <strong>Local OpenAI-compatible API proxy for DeepSeek Web Chat</strong>
</p>

<p align="center">
  <a href="https://github.com/fauznazz-afk/freedeepseek-local-stack/blob/main/LICENSE"><img alt="Apache License 2.0" src="https://img.shields.io/badge/license-Apache%202.0-green.svg" /></a>
  <img alt="Node.js 18 plus" src="https://img.shields.io/badge/node-18%2B-339933.svg" />
  <img alt="No npm dependencies" src="https://img.shields.io/badge/dependencies-0-blue.svg" />
  <img alt="OpenAI compatible" src="https://img.shields.io/badge/OpenAI-compatible-111111.svg" />
  <img alt="DeepSeek V4.1 Flash" src="https://img.shields.io/badge/DeepSeek-V4.1--Flash-4d6bfe.svg" />
</p>

<p align="center">
  <a href="#pasang">Pasang</a> •
  <a href="#cara-kerja">Cara kerja</a> •
  <a href="#perintah-harian">Perintah harian</a> •
  <a href="#model">Model</a> •
  <a href="#konfigurasi">Konfigurasi</a> •
  <a href="#masalah-umum">Masalah umum</a>
</p>

FreeDeepseekAPI menjalankan server API lokal di depan **DeepSeek Web Chat**
([chat.deepseek.com](https://chat.deepseek.com)). Arahkan Open WebUI, LiteLLM,
Hermes, Claude Code, Codex, OpenCode, OpenClaw, Cursor, atau klien OpenAI-compatible
mana pun ke sini.

Proxy memakai akun DeepSeek yang sudah kamu login di browser. Tidak ada API key
berbayar `api.deepseek.com`.

Satu model tersedia: **DeepSeek-V4.1-Flash**. Native Web Search chat.deepseek.com
**nyala secara default**, dan pencarian itulah yang menjawab pertanyaan internet
terbaru. `-thinking` menyalakan DeepThink. `-nosearch` atau `"web_search": false`
mematikan pencarian.

> Ini proxy eksperimental di atas Web chat. DeepSeek bisa mengubah API Web
> privatnya kapan saja. Kalau itu terjadi, proyek ini diperbarui mengikutinya.

---

## Isi

- [Pasang](#pasang)
- [Cara kerja](#cara-kerja)
- [Perintah harian](#perintah-harian)
- [Struktur repo](#struktur-repo)
- [Konfigurasi sesi](#konfigurasi-sesi)
- [Multi-akun](#multi-akun)
- [Model](#model)
- [Endpoint](#endpoint)
- [Konfigurasi env](#konfigurasi-env)
- [Memori jangka panjang](#memori-jangka-panjang)
- [Refactor mode](#refactor-mode)
- [Tes](#tes)
- [Masalah umum](#masalah-umum)
- [Lisensi](#lisensi)

---

## Pasang

### Prasyarat

- Windows + PowerShell 5.1 (atau `pwsh` 7)
- Node.js 18+
- Chrome (untuk login DeepSeek)
- `9router` terpasang global — **opsional**, hanya untuk rantai penuh:
  `npm i -g 9router`

### Langkah

Dari root repo:

```powershell
npm run setup     # cek Node, buat settings.local.ps1, pasang shim deepseek-local
npm run auth      # login DeepSeek di jendela Chrome yang terbuka
deepseek-local start
deepseek-local verify   # harus berakhir CHAIN_OK
```

`npm run setup` idempoten: file yang sudah ada tidak ditimpa. 9router hanya
peringatan kalau tidak ada — proxy tetap jalan tanpa 9router.

Setelah `npm run auth`, login di `chat.deepseek.com` di jendela Chrome yang
terbuka, kirim satu pesan singkat seperti `ok`, lalu kembali ke terminal dan
lanjutkan. File tersimpan sebagai `deepseek-auth.json` (mode `0600`, git-ignored).

### Tanpa shim

```bat
local-stack\Start-All.bat     :: nyalakan semua
local-stack\Verify-All.bat    :: cek rantai penuh
local-stack\Stop-All.bat      :: matikan semua
```

### Proxy saja (tanpa 9router)

```powershell
npm run setup
npm run auth
npm start
```

Endpoint: `http://127.0.0.1:9655/v1` plus dashboard di
`http://127.0.0.1:9655/dashboard`.

---

## Cara kerja

Rantai penuh:

```
klien → 9router (20128) → FreeDeepseekAPI (9655) → web DeepSeek
```

Tiga lapis:

1. **`server.js` + `lib/`** — proxy: streaming, parsing tool-call, recovery sesi,
   kompaksi konteks, POW, image safety.
2. **`public/dashboard/` + `scripts/`** — dashboard, auth, doctor, TUI menu,
   updater.
3. **`local-stack/`** — launcher PowerShell: start/stop/verify rantai, patch
   9router otomatis, `settings.local.ps1`.

### Sesi

Proxy tidak membuka chat DeepSeek baru setiap request.

- Satu `x-agent-session`, `session`, atau `user` = satu chat DeepSeek.
- Chat yang sudah ada dilanjutkan dengan `parent_message_id`.
- System prompt dan daftar tool dikirim ke upstream **sekali**. Giliran
  berikutnya hanya mengirim turn user/tool baru.
- Balasan kosong, tool-call rusak, atau timeout **mempertahankan** chat hidup.
- Chat baru dimulai saat sesi hilang, rantai menyentuh `DEEPSEEK_MAX_MESSAGE_DEPTH`,
  chat lebih tua dari `DEEPSEEK_SESSION_TTL_MS`, DeepSeek bilang prompt terlalu
  panjang, atau kamu memanggil `/reset-session`.

### Kompaksi konteks

Prompt panjang dipotong ke `DEEPSEEK_MAX_PROMPT_CHARS` sebelum dikirim. Ini
bukan potong gunting-buta:

- Turn pertama (tugas awal) dipertahankan, maks 30% budget.
- 35% turn terbaru verbatim.
- Turn tengah diringkas, anchor tetap: path file, perintah shell, URL, baris
  error.
- Setiap prompt yang dipadatkan membawa `COMPACTION_NOTICE` yang melarang model
  mengarang detail yang hilang.
- Riwayat yang diputar ulang dilabeli `[Recovered record of this conversation...]`
  supaya sesi hasil rebuild tidak terbaca sebagai riwayat utuh.

Batas jujur: ini **bukan** context window 1M token. Pemadatan bersifat
ekstraktif (memilih & memotong), bukan abstraktif. Anchor berbasis regex, jadi
format log tidak lazim bisa lolos tanpa anchor.

### Ledger memori sesi

Kalau kompaksi membuang satu turn, path, perintah, dan error di dalamnya
disimpan ke `session.memory` (cap `DEEPSEEK_MAX_MEMORY_CHARS`, default 16000,
persist di `data/sessions.json`). Ledger ini diputar ulang di kepala prefix
recovery pada reset/rebuild berikutnya.

Dengan `DEEPSEEK_SHARED_MEMORY_CHARS > 0`, anchor yang sama juga masuk ke
`data/shared-memory.json`. Agent key yang benar-benar baru mewarisinya lewat
prefix recovery — jadi sesi baru langsung tahu fakta proyek.

---

## Perintah harian

| Aksi | Perintah |
|---|---|
| Nyalakan semua | `deepseek-local` atau `deepseek-local start` |
| Matikan semua | `deepseek-local off` (alias `stop`) |
| Restart | `deepseek-local restart` — tunggu port benar-benar bebas |
| Status | `deepseek-local status` |
| Cek rantai | `deepseek-local verify` — harus `CHAIN_OK` |
| Login ulang DeepSeek | `npm run auth` |
| Diagnosa | `npm run doctor` |
| Tes unit | `node --test tests/unit.test.js` |
| Tes penuh | `npm test` |

Menyalakan yang sudah menyala aman: `start.ps1` mendeteksi port dan tidak
menjalankan proses kedua.

`restart` tidak sekadar tidur — ia menunggu sampai port 9655 dan 20128 benar-benar
tidak lagi `Listen` (socket `TIME_WAIT` masih menjawab probe dan dulu membuat
`start.ps1` mengira stack sudah hidup).

---

## Struktur repo

```
<repo root>/
├── server.js            # proxy (port 9655)
├── lib/                 # pow, updater, context compaction
├── public/, docs/, tests/, integrations/
├── scripts/
│   ├── start.js         # launcher: npm start
│   ├── setup.ps1        # setup Windows sekali jalan
│   └── install-shim.ps1 # menulis perintah deepseek-local
├── local-stack/         # launcher rantai penuh
│   ├── Start-All.bat / Stop-All.bat / Verify-All.bat
│   ├── start.ps1 / stop.ps1 / verify.ps1 / status.ps1
│   ├── deepseek-local.ps1, add-account.ps1
│   ├── patch-deepseek.ps1, clear-stale-errors.ps1
│   └── README.md, CONTEXT-MEMORY.md, REFACTOR-MODE.md
└── 9router-source/      # opsional: checkout 9router (git-ignored)
```

Skrip di `local-stack/` me-resolve proxy sebagai folder induknya (`..`), jadi repo
bisa dipindah/di-clone di mana saja. Override lewat `$env:FREEDEEPSEEK_DIR`.

### Di mana 9router jalan

`start.ps1` memilih 9router dengan urutan:

| Urutan | Lokasi | Kapan |
|---|---|---|
| 1 | `$env:NINEROUTER_APP` | kamu set sendiri, selalu menang |
| 2 | `9router-source\cli\app` | ada build dari checkout di repo ini |
| 3 | `%APPDATA%\npm\node_modules\9router\app` | `npm i -g 9router` |

Build lokal didahulukan supaya edit di `9router-source/` lalu build ulang
benar-benar berpengaruh. State runtime 9router tetap di `%APPDATA%\9router`
(SQLite, backup patch), jadi upgrade 9router tidak menyentuh akun atau setting.

### Build 9router dari checkout (Node 24+)

```powershell
cd 9router-source
npm install --ignore-scripts
cd cli; npm install --ignore-scripts; cd ..
npm run cli:pack
```

`--ignore-scripts` aman: `src/lib/db/driver.js` melewati `better-sqlite3` di
Node 24+ dan memakai `node:sqlite` bawaan.

Lengkapi bundle seperti `assemble.sh` di Linux, karena `build-cli.js` hanya
menyalin sebagian kecil `src/` padahal `custom-server.js` memuat beberapa modul
lewat path absolut:

```powershell
cd 9router-source
$app = "cli\app"
Remove-Item "$app\src" -Recurse -Force; Copy-Item src "$app\src" -Recurse -Force
Remove-Item "$app\scripts" -Recurse -Force; Copy-Item scripts "$app\scripts" -Recurse -Force
Copy-Item CHANGELOG.md "$app\CHANGELOG.md" -Force
Remove-Item "$app\node_modules\next" -Recurse -Force
Copy-Item node_modules\next "$app\node_modules\next" -Recurse -Force
```

Tanpa itu: `AuthGuard load failed: ENOENT ...node_modules\next\server.js`, atau
server diam-diam membaca modul dari `9router-source/src`.

**Build ulang = patch ulang.** `patch-deepseek.ps1` menulis ulang chunk JS yang
memuat `https://api.deepseek.com/...`, dan build ulang menghasilkan chunk baru
dengan URL asli. `start.ps1` sudah mem-patch setiap launch, jadi cukup restart.

---

## Konfigurasi sesi

`start.ps1` me-*dot-source* `local-stack\settings.local.ps1` setiap kali jalan.
Nilai di situ ikut ke proses proxy dan bertahan setelah reboot — tidak perlu
mengekspor env var manual.

```powershell
Copy-Item local-stack\settings.local.example.ps1 local-stack\settings.local.ps1
```

Kalau file itu rusak, `start.ps1` hanya memberi peringatan lalu lanjut dengan
default — stack tidak ikut mati gara-gara satu baris salah.

Nilai yang dipakai di mesin ini:

| Variabel | Nilai | Arti |
|---|---|---|
| `DEEPSEEK_SESSION_TTL_MS` | `604800000` | Chat dipakai 7 hari sebelum diganti |
| `DEEPSEEK_MAX_MESSAGE_DEPTH` | `400` | 400 pesan per chat sebelum reset paksa |
| `DEEPSEEK_MAX_HISTORY_MESSAGES` | `400` | 400 giliran lokal diputar ulang |
| `DEEPSEEK_MAX_HISTORY_CHARS` | `480000` | Anggaran karakter untuk replay |
| `DEEPSEEK_MAX_PROMPT_CHARS` | `480000` | Plafon prompt ke upstream |
| `DEEPSEEK_REQUEST_DEADLINE_MS` | `300000` | Deadline per request |
| `DEEPSEEK_ACCOUNT_COOLDOWN_MS` | `30000` | Cooldown akun saat rate limit |
| `DEEPSEEK_SHARED_MEMORY_CHARS` | `16000` | Ledger memori proyek bersama |

Dua hal yang wajib naik bersama: `DEEPSEEK_MAX_HISTORY_MESSAGES` dan
`DEEPSEEK_MAX_MESSAGE_DEPTH`. Menaikkan depth saja tidak ada gunanya — saat chat
diganti, replay dulu dipatok di 100 entri, jadi sesi "400 pesan" tetap hanya
memulihkan 100 giliran terakhir.

Anggaran karakter sengaja dipatok sama dengan plafon prompt (`480000`). Angka di
atas batas prompt tidak menambah apa pun: prompt tetap dipotong, kelebihannya
cuma jadi bahan pemadatan. Plafon 480000 (~128k token) dipilih dari log hidup:
DeepSeek Web membalas 502 "Сервер занят" untuk prompt di atas ~500–760k karakter.

Cek hasilnya benar-benar aktif:

```
deepseek-local status
```

```
  proxy    UP    port 9655  |  7 account(s), 6 ready
                 session: ttl 7.0 days, 400 msgs, replays 400 msgs / 480k chars
```

Atau `curl http://127.0.0.1:9655/health` dan lihat `session_reuse`.

---

## Multi-akun

Proxy mendukung banyak akun DeepSeek. Kalau satu kena cooldown, request
berikutnya otomatis pindah ke akun lain — rotasi bekerja tanpa kode tambahan.

Aturan pool: **satu chat in-flight per login**. Request kedua untuk login sibuk
menunggu, tidak menimpa. Ini mencegah DeepSeek mem-ban login karena dua chat
mengirim bersamaan.

### Tambah akun: helper dengan profil Chrome tersimpan

```powershell
# Akun baru: buka Chrome, login dengan email akun itu, kirim satu prompt
# singkat, lalu tekan Enter di terminal.
pwsh -File local-stack\add-account.ps1 -Name akun2 -Restart

# Token mulai 401? Perbarui tanpa login ulang (profil masih ter-log-in):
pwsh -File local-stack\add-account.ps1 -Name akun2 -Refresh -Restart
```

- Profil Chrome disimpan di `.chrome-profiles\<nama>` (git-ignored).
- File auth ditulis ke `accounts\<nama>.json` (git-ignored).
- Port DevTools otomatis: 9334 + angka di nama.
- Tanpa Chrome, skrip menawarkan instalasi.

Ini mekanisme yang sama dengan akun utama (`npm run deepseek:auth`): setiap akun
punya profil Chrome sendiri yang tetap login, jadi token bisa diperbarui kapan
saja dari sesi hidup — bukan ekspor cookie statis yang cepat hangus.

> **Penting:** Akun harus benar-benar berbeda (email DeepSeek berbeda). Dua file
> dari akun yang sama tetap berbagi kuota dan tidak menolong.

### Verifikasi

```
deepseek-local status
```

```
  proxy    UP    port 9655  |  2 account(s), 1 ready
                 cooling down: akun2 (rate_limit), ~24s left
  9router  UP    port 20128  |  local build v0.5.330
```

`1 ready` + satu cooling down berarti request masih dilayani akun siap tanpa 429.

### Dashboard

`http://127.0.0.1:9655/dashboard` menampilkan setiap login dengan status
(`ready`, `busy`, `cooldown`, `disabled`, `no_credentials`), hitung mundur
cooldown, jumlah gagal, error upstream terakhir, dan usage. Dari situ kamu bisa
pause/resume login, clear cooldown, dan reload file auth tanpa restart.

---

## Model

`GET /v1/models` hanya mendaftar DeepSeek-V4.1-Flash.

| ID | DeepThink | Native web search | Keterangan |
|---|---|---|---|
| `deepseek-v4-flash` | off | on | DeepSeek-V4.1-Flash. `deepseek-flash` alias |
| `deepseek-v4-flash-thinking` | on | on | DeepThink dulu, baru jawab |
| `deepseek-v4-flash-nosearch` | off | off | Tanpa pencarian |
| `deepseek-v4-flash-thinking-nosearch` | on | off | DeepThink tanpa pencarian |

Suffix itu adalah dua sakelar di composer DeepSeek. Mereka tidak memilih model
lain. `"web_search": true|false` di body request menimpa sakelar pencarian id
mana pun.

Lewat 9router, provider `ds` (DeepSeek) diarahkan ke proxy lokal dengan prefix
`ds/`. Lewat OpenCode langsung (tanpa 9router), prefix `freedeepseek/`.

ID lama tidak terdaftar dan mengembalikan `400 invalid_model`:
`deepseek-chat`, `deepseek-reasoner`, `deepseek-r1`, `deepseek-v3`,
`deepseek-instant`, `deepseek-expert`, `deepseek-v4-pro`.

---

## Endpoint

| Method | Path | Fungsi |
|---|---|---|
| `GET` | `/health` | Proses hidup. Status akun kalau tanpa proxy key |
| `GET` | `/readyz` | `200` hanya kalau ada login yang bisa melayani |
| `GET` | `/dashboard` | Dashboard akun (halaman statis) |
| `GET` | `/admin/accounts` | Pool dan status per login |
| `POST` | `/admin/accounts/<id>/{disable,enable,clear-cooldown}` | Pause, resume, un-cool |
| `POST` | `/admin/accounts/reload` | Baca ulang file auth tanpa restart |
| `GET` | `/v1/models` | Empat ID DeepSeek-V4.1-Flash |
| `GET` | `/v1/model-capabilities` | ID, DeepThink, native search |
| `POST` | `/v1/chat/completions` | OpenAI Chat Completions |
| `POST` | `/v1/messages` | Anthropic Messages |
| `POST` | `/v1/responses` | OpenAI Responses |
| `GET` | `/v1/sessions` | Sesi agent lokal |
| `POST` | `/reset-session?agent=<id>` | Buang satu chat Web |
| `POST` | `/reset-session?agent=all` | Buang semua chat Web |

Contoh cepat:

```bash
curl -X POST http://127.0.0.1:9655/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "x-agent-session: my-agent" \
  -d '{"model":"deepseek-v4-flash","messages":[{"role":"user","content":"Hello"}]}'
```

Dokumentasi protokol lengkap: [docs/api.md](docs/api.md) ·
[docs/models.md](docs/models.md) · [docs/agents.md](docs/agents.md).

---

## Konfigurasi env

| Variabel | Default | Arti |
|---|---|---|
| `HOST` | `127.0.0.1` | Bind address. Non-loopback tanpa proxy key memberi warning |
| `PORT` | `9655` | Port listen |
| `PROXY_API_KEY` | off | Bearer wajib di `/v1/*` dan `/admin/*` |
| `REQUIRE_PROXY_API_KEY` | off | Tolak start kalau key kosong |
| `PROXY_CORS_ORIGINS` | loopback | Origin browser tambahan |
| `PROXY_ADMIN_ALLOW_REMOTE` | off | `1` = `/admin/*` jawab klien non-loopback |
| `DEEPSEEK_AUTH_PATH` | `./deepseek-auth.json` | Satu file atau daftar koma |
| `DEEPSEEK_AUTH_DIR` | `./accounts` bila ada | Semua `*.json` di folder itu |
| `DEEPSEEK_MAX_PROMPT_CHARS` | `800000` (mesin ini `480000`) | Plafon prompt ke upstream. Minimum 16000 |
| `DEEPSEEK_MAX_RETRIES` | `2` | Retry balasan kosong di chat sama |
| `DEEPSEEK_REQUEST_DEADLINE_MS` | `120000` | Deadline per request |
| `DEEPSEEK_FETCH_TIMEOUT_MS` | `60000` | Idle timeout per stream upstream |
| `DEEPSEEK_MAX_CONCURRENT` | `24` | Cap proses. Paralelisme nyata = jumlah login idle |
| `DEEPSEEK_ACCOUNT_LOCK_WAIT_MS` | `120000` | Lama chat kedua menunggu login sibuk |
| `DEEPSEEK_ACCOUNT_COOLDOWN_MS` | `600000` | Cooldown dasar setelah 401/403/rate limit |
| `DEEPSEEK_AUTH_EXPIRED_COOLDOWN_MS` | `1800000` | Karantina login yang tokennya ditolak dua kali |
| `DEEPSEEK_COOLDOWN_STATE_PATH` | `./data/cooldowns.json` | Persist cooldown antar restart |
| `DEEPSEEK_GUARD_BLOCKS` | on | Fallback global blok guard. `off` melemahkan semua request |
| `DEEPSEEK_SESSION_TTL_MS` | `7200000` | Lama satu chat dipakai ulang |
| `DEEPSEEK_MAX_MESSAGE_DEPTH` | `100` | Pesan per chat sebelum reset paksa |
| `DEEPSEEK_MAX_HISTORY_MESSAGES` | `100` | Giliran lokal diputar ulang ke chat pengganti |
| `DEEPSEEK_MAX_HISTORY_CHARS` | `400000` | Anggaran karakter replay |
| `DEEPSEEK_MAX_MEMORY_CHARS` | `16000` | Cap ledger memori per sesi |
| `DEEPSEEK_SHARED_MEMORY_CHARS` | `0` | Cap ledger memori proyek bersama. `0` = mati |
| `DEEPSEEK_SESSION_IDLE_EVICT_MS` | `2 × TTL` | Umur sesi idle di disk |
| `DEEPSEEK_MAX_SESSIONS` | `500` | Cap sesi dimuat saat startup |
| `TRUST_PROXY` | off | `1` = ambil IP dari `X-Forwarded-For` |
| `MAX_REQUEST_BODY_BYTES` | `31457280` | Ukuran maksimum body JSON, termasuk base64 |
| `NON_INTERACTIVE` / `SKIP_ACCOUNT_MENU` | off | Lewati menu launch |

---

## Memori jangka panjang

Proxy **tidak punya** memori jangka panjang, dan itu disengaja. Ia lapisan
transport: meneruskan percakapan dan memutar ulang riwayat lokal yang dibatasi
saat chat remote mati. Ia tidak memutuskan apa yang layak diingat.

Memori jangka panjang datang dari **system prompt**, karena system prompt
dikirim ulang setiap request terlepas dari sesi.

| Lapis | Isi | Umur |
|---|---|---|
| Session store | Percakapan hari ini | TTL (default 2 jam) |
| System prompt / `AGENTS.md` | Aturan tetap: gaya, konvensi, larangan | Sampai file diedit |
| `MEMORY.md` per proyek | Fakta tahan lama: port, perintah, keputusan, jebakan | Sampai file diedit |

Batas praktis untuk memo yang harus diingat presisi: ~80.000 karakter. Di atas
itu kompaksi mulai memotong.

Aturan yang membuatnya bekerja ada di `AGENTS.md`: *baca `MEMORY.md` sebelum
perubahan pertama, tambahkan saat menemukan fakta tahan lama*. Memori adalah
filenya, bukan modelnya.

---

## Refactor mode

Proxy menambahkan dua blok ke prompt upstream: `NO-TOOLS CONTRACT` dan
`TOOL REMINDER`. Satu baris di reminder berbunyi **"Do not paste source files or
diffs"** — instruksi yang tepat untuk agent, tapi salah untuk refactor, di mana
jawabannya *adalah* source code.

Mematikan global adalah perbaikan yang salah: itu melemahkan setiap request agent
hanya untuk satu panggilan refactor. Jadi opt-out-nya **per request**:

| Di mana | Nilai |
|---|---|
| Body JSON | `"guard_blocks": false` |
| Header HTTP | `x-deepseek-guard-blocks: off` (menang atas body) |
| Fallback env | `DEEPSEEK_GUARD_BLOCKS=off` |

Nilai off yang diterima: `off`, `0`, `false`, `no`, `none`, `disabled`. Default on.

Yang tetap ada saat off: envelope `{"tool_call":...}` ketika tools diiklankan.
Itu kontrak parsing, bukan aturan gaya; menghapusnya menghasilkan
`502 malformed_tool_call`.

**Kedua setelan wajib saat lewat 9router:**

```json
{ "guard_blocks": false, "tool_choice": "none" }
```

Tanpa `tool_choice: "none"`, model akan memilih `write_file` walaupun guard
dimatikan — karena tool tersedia, bukan karena teks dilarang.

9router **membuang header klien**, termasuk `x-deepseek-guard-blocks`. Hanya
field body yang lolos. Header bekerja pada panggilan langsung ke proxy.

Detail dan bukti log: [local-stack/REFACTOR-MODE.md](local-stack/REFACTOR-MODE.md).

---

## Tes

```powershell
node --test tests/unit.test.js     # 123 pass, 0 fail
npm test                           # 312 pass, 13 fail
```

13 kegagalan `npm test` sudah ada sejak baseline upstream — butuh Chrome, macOS,
atau tooling yang tidak ada di mesin ini. Bukan regresi dari perubahan lokal.
Pakai `node --test tests/unit.test.js` untuk sinyal bersih.

Live smoke test terhadap proxy yang sudah jalan:

```bash
BASE_URL=http://127.0.0.1:9655 MODEL=deepseek-v4-flash npm run test:live
```

---

## Masalah umum

**`npm test` gagal 13 tes.** Baseline, bukan regresi. Pakai
`node --test tests/unit.test.js`.

**DeepSeek minta login ulang / 401 / 403.** Cookie web kedaluwarsa:

```powershell
npm run auth
deepseek-local restart
```

**9router "tidak mau start".** `cli.js` 9router adalah supervisor: membunuh
proses di port 20128 saja membuatnya dihidupkan lagi. `start.ps1` memanggil
`custom-server.js` langsung, jadi tidak ada supervisor atau tray. `stop.ps1`
membunuh supervisor lebih dulu.

**"Invalid API key" di 9router.** Dua sebab, keduanya sisa konfigurasi lama:
baris `providerNodes` dengan `id = 'deepseek'` menabrak provider bawaan, dan
`lastError` 401 plus `modelLock_*` di koneksi lama. Jalankan
`clear-stale-errors.ps1`.

**Rate limit "Слишком частые сообщения".** DeepSeek membatasi login ~10 menit.
Itu throttle asli, bukan bug proxy. `DEEPSEEK_ACCOUNT_COOLDOWN_MS` default
`600000` untuk alasan ini. Mesin ini memakai 30s karena burst throttle biasanya
pulih dalam 15–30s.

**Prompt panjang dibalas 502 "Сервер занят".** DeepSeek Web menolak prompt di
atas ~500–760k karakter dengan stream 0 karakter. Plafon efektif di mesin ini
`480000` karakter.

**Build ulang 9router memutus rantai.** Build ulang menghasilkan chunk dengan URL
`api.deepseek.com` asli. `start.ps1` mem-patch setiap launch; cukup restart.

**Restart menyisakan proses lama.** Socket `TIME_WAIT` masih menjawab probe.
`deepseek-local restart` menunggu port benar-benar bebas, bukan tidur tetap.

**Cooldown hilang setelah restart.** Itu perilaku lama. Sekarang cooldown
dipersist di `data/cooldowns.json` supaya restart tidak bisa dipakai keluar dari
throttle.

---

## Lisensi

Apache-2.0.

Fork lokal dari [dekrezz/FreeDeepseekAPI](https://github.com/dekrezz/FreeDeepseekAPI);
remote `upstream` dipertahankan supaya perubahan upstream tetap bisa ditarik.
