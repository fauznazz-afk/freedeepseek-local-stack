# local-stack - DeepSeek lewat FreeDeepseekAPI

Jalur: **klien -> 9router (20128) -> FreeDeepseekAPI (9655) -> web DeepSeek**.
Tanpa API key resmi DeepSeek; proxy memakai cookie sesi browser.

Folder ini bagian dari repo proxy: proxy di root repo (satu tingkat di atas),
launcher di sini. Skrip me-resolve proxy ke `..` dari lokasinya sendiri, jadi repo
bisa dipindah/di-clone di mana saja. Override lewat `$env:FREEDEEPSEEK_DIR`.

## Pasang dari nol

Dari root repo:

```powershell
npm run setup     # cek Node, buat settings.local.ps1, pasang shim deepseek-local
npm run auth      # login DeepSeek di jendela Chrome yang terbuka
deepseek-local start
deepseek-local verify   # harus berakhir CHAIN_OK
```

`npm run setup` idempoten: file yang sudah ada tidak ditimpa. 9router hanya
peringatan kalau tidak ada - proxy tetap jalan tanpa 9router.

## Prasyarat

- Windows + PowerShell 5.1 (atau `pwsh` 7)
- Node.js 18+
- Chrome (untuk login DeepSeek)
- `9router` global: `npm i -g 9router` (opsional, untuk rantai penuh)

## Di mana 9router sebenarnya jalan

`start.ps1` memilih 9router dengan urutan:

| Urutan | Lokasi | Kapan dipakai |
|---|---|---|
| 1 | `$env:NINEROUTER_APP` | kamu set sendiri, selalu menang |
| 2 | `9router-source\cli\app` | ada hasil build dari checkout di repo ini |
| 3 | `%APPDATA%\npm\node_modules\9router\app` | hasil `npm i -g 9router` (cadangan) |

Build lokal didahulukan supaya edit di `9router-source/` lalu build ulang
benar-benar berpengaruh. `patch-deepseek.ps1` memakai urutan yang sama, jadi
patch selalu mengenai build yang benar-benar akan dijalankan.

State runtime 9router tetap di luar keduanya: `%APPDATA%\9router` (SQLite,
backup patch). Upgrade 9router tidak menyentuh akun atau setting.

`9router-source/` git-ignored karena clone terpisah dengan histori sendiri.

### Build 9router di Windows (Node 24+)

```powershell
cd 9router-source
npm install --ignore-scripts
cd cli; npm install --ignore-scripts; cd ..
npm run cli:pack
```

`--ignore-scripts` aman: `src/lib/db/driver.js` melewati `better-sqlite3` di
Node 24+ dan memakai `node:sqlite` bawaan, tanpa compile.

Lengkapi bundle seperti `assemble.sh` di Linux:

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
server membaca modul dari `9router-source/src` bukan foldernya sendiri.

**Build ulang = patch ulang.** `patch-deepseek.ps1` menulis ulang chunk JS yang
memuat `https://api.deepseek.com/...`, dan build ulang menghasilkan chunk baru
dengan URL asli. `start.ps1` sudah mem-patch setiap launch - cukup restart.

## Cara pakai

```
deepseek-local            nyalakan semua
deepseek-local off        matikan semua (alias: stop)
deepseek-local restart    matikan, tunggu port bebas, lalu nyalakan
deepseek-local status     sedang jalan? 9router versi mana?
deepseek-local verify     buktikan rantai penuh sampai CHAIN_OK
```

Menyalakan yang sudah menyala aman: `start.ps1` mendeteksi port dan tidak
menjalankan proses kedua. `restart` menunggu sampai port 9655 dan 20128
benar-benar tidak `Listen` (socket `TIME_WAIT` masih menjawab probe dan dulu
membuat `start.ps1` melewati peluncuran). Kalau setelah 20 detik port masih
dipegang proses lain, ia berhenti dengan pesan jelas.

Tanpa shim:

| Aksi | Perintah |
|---|---|
| Nyalakan semua | `local-stack\Start-All.bat` |
| Matikan semua | `local-stack\Stop-All.bat` |
| Cek rantai penuh | `local-stack\Verify-All.bat` |
| Nyalakan tanpa patch | `powershell -File local-stack\start.ps1 -Patch:$false` |

### Memasang perintah `deepseek-local`

Logika ada di `local-stack\deepseek-local.ps1`; shim di PATH hanya meneruskan
argumen. Dari root repo:

```powershell
npm run shim
```

Itu menulis `%USERPROFILE%\.local\bin\deepseek-local.cmd` dengan path repo ini
dan menambahkan folder itu ke PATH user (buka terminal baru). Kalau repo dipindah,
jalankan lagi. Hapus dengan:

```powershell
powershell -File scripts\install-shim.ps1 -Uninstall
```

### Menyetel batas sesi (`settings.local.ps1`)

`start.ps1` me-*dot-source* `local-stack\settings.local.ps1` setiap kali jalan,
jadi nilainya ikut ke proses proxy dan bertahan setelah reboot. File itu
git-ignored; contohnya `settings.local.example.ps1`:

```powershell
Copy-Item local-stack\settings.local.example.ps1 local-stack\settings.local.ps1
```

Kalau file rusak, `start.ps1` hanya memberi peringatan lalu lanjut dengan default.

Setelan mesin ini:

| Variabel | Nilai | Arti |
|---|---|---|
| `DEEPSEEK_SESSION_TTL_MS` | `604800000` | Chat dipakai 7 hari sebelum diganti |
| `DEEPSEEK_MAX_MESSAGE_DEPTH` | `400` | 400 pesan per chat sebelum reset paksa |
| `DEEPSEEK_MAX_HISTORY_MESSAGES` | `400` | 400 giliran lokal diputar ulang |
| `DEEPSEEK_MAX_HISTORY_CHARS` | `480000` | Anggaran karakter replay |
| `DEEPSEEK_MAX_PROMPT_CHARS` | `480000` | Plafon prompt ke upstream |
| `DEEPSEEK_REQUEST_DEADLINE_MS` | `300000` | Deadline per request |
| `DEEPSEEK_ACCOUNT_COOLDOWN_MS` | `30000` | Cooldown akun saat rate limit |
| `DEEPSEEK_SHARED_MEMORY_CHARS` | `16000` | Ledger memori proyek bersama |

Dua tengah harus naik bersama `DEEPSEEK_MAX_MESSAGE_DEPTH`. Menaikkan depth saja
tidak ada gunanya: saat chat diganti, replay dulu dipatok 100 entri, jadi sesi
"400 pesan" tetap hanya memulihkan 100 giliran terakhir.

Anggaran karakter dipatok sama dengan plafon prompt: angka di atas batas prompt
tidak menambah apa pun, prompt tetap dipotong. Plafon 480000 (~128k token) dipilih
dari log hidup - DeepSeek Web membalas 502 "Сервер занят" untuk prompt di atas
~500-760k karakter.

Cek hasilnya benar-benar aktif, jangan percaya file saja:

```
deepseek-local status
```

```
  proxy    UP    port 9655  |  7 account(s), 6 ready
                 session: ttl 7.0 days, 400 msgs, replays 400 msgs / 480k chars
  9router  UP    port 20128  |  local build v0.5.330
```

Atau `curl http://127.0.0.1:9655/health` dan lihat `session_reuse`.

Dashboard proxy: <http://127.0.0.1:9655/dashboard> - 9router: <http://127.0.0.1:20128>

`verify.ps1` membaca API key 9router dari `$env:NINEROUTER_KEY` (default `local`,
karena proxy menerima key apa pun). Jangan pernah hardcode key asli di skrip.

## Model yang dipakai

Lewat 9router, provider `ds` (DeepSeek) diarahkan ke proxy lokal:

- `ds/deepseek-v4-flash`
- `ds/deepseek-v4-flash-thinking`
- `ds/deepseek-v4-flash-nosearch`
- `ds/deepseek-v4-flash-thinking-nosearch`

Lewat OpenCode langsung (tanpa 9router), prefix `freedeepseek/`:

- `freedeepseek/deepseek-v4-flash`
- `freedeepseek/deepseek-v4-flash-thinking`
- `freedeepseek/deepseek-v4-flash-nosearch`
- `freedeepseek/deepseek-v4-flash-thinking-nosearch`

ID lama `ds/deepseek-v4-pro` dan `ds/deepseek-v4-flash-vision-exp` sudah tidak
dilayani proxy dan mengembalikan `400 invalid_model`.

## Kenapa dulu 9router "tidak mau start"

Bukan masalah conda/PowerShell. `cli.js` 9router adalah **supervisor**: ia
men-spawn `app/custom-server.js`, lalu men-spawn salinan `--tray` detached dan
menghidupkan ulang anaknya setiap kali mati. Jadi:

- membunuh proses di port 20128 saja -> langsung dihidupkan lagi;
- menjalankan `cli.js` tanpa TTY -> otomatis masuk mode tray;
- `start /B` + `pause` di .bat -> jendela induk hilang, anak ikut terbunuh.

`start.ps1` memanggil `custom-server.js` **langsung**, jadi tidak ada supervisor,
tray, cek update, atau hook shell. `stop.ps1` membunuh supervisor lebih dulu
(beberapa pass), baru anaknya.

## Kenapa dulu muncul "Invalid API key"

Dua sebab, keduanya sisa konfigurasi lama:

1. `providerNodes` berisi baris dengan `id = 'deepseek'` - id itu milik provider
   bawaan 9router, jadi baris custom menabraknya dan tidak pernah dipakai untuk
   routing. Baris itu sudah dihapus.
2. Koneksi `deepseek-local-connection` menyimpan `lastError` 401 dari masa sebelum
   proxy terpasang, plus `modelLock_*` yang membuat model tampak terkunci.
   `clear-stale-errors.ps1` menghapus keduanya.

Proxy lokal menerima API key apa pun, jadi 401 hanya bisa berasal dari state lama
semacam ini - bukan dari proxy.

## Menambah akun kedua (rotasi saat rate-limit)

Proxy mendukung banyak akun DeepSeek. Kalau satu kena cooldown, request
berikutnya otomatis pindah ke akun lain - **rotasi bekerja tanpa kode tambahan**.

Aturan pool: **satu chat in-flight per login**. Request kedua untuk login sibuk
menunggu, tidak menimpa. Dua chat bersamaan di satu login memicu ban multi-hari
dari DeepSeek.

### Cara terbaik: helper `add-account.ps1`

Mekanisme sama dengan akun utama (`npm run deepseek:auth`): setiap akun punya
profil Chrome sendiri yang disimpan dan tetap login, jadi token bisa diperbarui
kapan saja dari sesi hidup - bukan ekspor cookie statis yang cepat hangus.

```powershell
# Akun baru: buka Chrome, login dengan email akun itu, kirim satu prompt
# singkat, lalu tekan Enter di terminal.
pwsh -File local-stack\add-account.ps1 -Name akun2 -Restart

# Token mulai 401? Perbarui tanpa login ulang (profil masih ter-log-in):
pwsh -File local-stack\add-account.ps1 -Name akun2 -Refresh -Restart
```

- Profil disimpan di `.chrome-profiles\<nama>` (git-ignored).
- File auth ditulis ke `accounts\<nama>.json` (git-ignored).
- Port DevTools otomatis: 9334 + angka di nama (akun3 -> 9337), jadi dua jendela
  auth bisa jalan bersamaan.
- Tanpa Chrome, skrip menawarkan instalasi (lihat `npm run deepseek:auth`).

### Verifikasi

```
deepseek-local status
```

```
  proxy    UP    port 9655  |  2 account(s), 1 ready
                 cooling down: akun2 (rate_limit), ~24s left
  9router  UP    port 20128  |  local build v0.5.330
```

Satu cooling down berarti request masih dilayani akun siap tanpa 429.

> **Penting:** Akun harus benar-benar berbeda (email DeepSeek berbeda). Dua file
> dari akun yang sama tetap berbagi kuota dan tidak menolong.

### Cara manual: ekspor cookie browser biasa

```powershell
# 1. Login di browser ke akun DeepSeek kedua (profil/email berbeda)
# 2. Ekspor cookie (ekstensi "Get cookies.txt LOCALLY" atau sejenis)
# 3. Import ke proxy (token dari variabel, aman dari history shell)
$env:DEEPSEEK_TOKEN = "<token akun kedua>"
npm run auth:import -- --input .\accounts\cookies-akun2.json
# 4. Restart
deepseek-local restart
```

Cara manual cepat habis: snapshot cookie ikut keusang WAF/token di browser
asalnya. Untuk akun jangka panjang, pakai helper di atas.

### Alternatif: dashboard admin

Buka `/dashboard` -> **Import account** -> pilih file cookies.json -> isi nama ->
Simpan (butuh `PROXY_API_KEY` kalau diaktifkan). Setelah menambah file secara
manual, tekan **Reload accounts** supaya pool membacanya tanpa restart.

## Cooldown

Cooldown dipersist di `data/cooldowns.json` (`DEEPSEEK_COOLDOWN_STATE_PATH`),
jadi restart tidak bisa dipakai keluar dari throttle. Login yang tokennya ditolak
dua kali berturut-turut masuk karantina lebih lama
(`DEEPSEEK_AUTH_EXPIRED_COOLDOWN_MS`, default 30 menit), karena token mati tidak
pulih dengan menunggu. Login ulang menulis fingerprint kredensial baru dan
melepas karantina.

## File

| File | Fungsi |
|---|---|
| `start.ps1` | Start proxy + 9router hidden, **patch 9router otomatis**, tunggu HTTP siap |
| `stop.ps1` | Stop berbasis PID file + pola command line (tidak menyentuh node lain) |
| `verify.ps1` | Uji `/health`, `/v1/models`, dan satu completion nyata lewat 9router |
| `status.ps1` | Satu pandangan: proxy up? 9router build mana? akun siap? |
| `deepseek-local.ps1` | Dispatcher (`start`/`off`/`restart`/`status`/`verify`) |
| `add-account.ps1` | Tambah/perbarui satu login lewat profil Chrome tersimpan |
| `patch-deepseek.ps1` | Idempoten: arahkan build 9router ke proxy |
| `clear-stale-errors.ps1` | Hapus error 401 lama + model lock di SQLite 9router |
| `settings.local.example.ps1` | Contoh tuning sesi; disalin oleh `npm run setup` |
| `logs/`, `run/` | Log dan PID file |

## Dokumentasi tambahan

| Dokumen | Isi |
|---|---|
| `CONTEXT-MEMORY.md` | Cara proxy memadatkan konteks panjang tanpa memicu halusinasi |
| `REFACTOR-MODE.md` | Mematikan blok `NO-TOOLS CONTRACT` / `TOOL REMINDER` untuk refactor |

## Setelah update 9router

**Tidak ada langkah manual.** `start.ps1` menjalankan `patch-deepseek.ps1` setiap
kali start, jadi `npm i -g 9router@latest` atau rebuild `cli:pack` langsung
ter-patch sebelum 9router dipakai.

```powershell
deepseek-local restart
deepseek-local verify      # harus berakhir CHAIN_OK
```

Skip patch untuk satu kali jalan: `powershell -File local-stack\start.ps1 -Patch:$false`.
Kalau 9router tidak terpasang, patch hanya memberi warning dan proxy tetap start.

Patcher membuat backup di `%APPDATA%\9router\patch-backup\<timestamp>\`.

## Kalau DeepSeek minta login ulang

Cookie web kedaluwarsa. Dari root repo:

```powershell
npm run auth
deepseek-local restart
```

## Catatan

- Proxy lokal menerima API key apa pun - jangan pernah bind ke `0.0.0.0` tanpa
  `PROXY_API_KEY`.
- `data/sessions.json` menyimpan riwayat sesi dan ledger memori per sesi.
- `deepseek-auth.json`, `accounts/*.json`, `data/`, `local-stack/logs|run`,
  `.chrome-profiles/` semuanya git-ignored. Jangan pernah commit.
- Error 401 lama di DB 9router adalah sisa sebelum proxy terpasang; jalankan
  `clear-stale-errors.ps1` saat 9router berhenti kalau model masih tampak terkunci.
