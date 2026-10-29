# local-stack — DeepSeek lewat FreeDeepseekAPI

Jalur: **klien → 9router (20128) → FreeDeepseekAPI (9655) → web DeepSeek**.
Tanpa API key resmi DeepSeek; proxy memakai cookie sesi browser.

Folder ini adalah bagian dari repo proxy: proxy ada di root repo (satu tingkat di
atas), launcher ada di sini. Skrip men resolve proxy ke `..` dari lokasinya sendiri,
jadi repo bisa dipindah/di-clone di mana saja. Override lewat `$env:FREEDEEPSEEK_DIR`.

## Prasyarat

- Windows + PowerShell 5.1 (atau `pwsh` 7)
- Node.js 18+
- `9router` terpasang global: `npm i -g 9router`
- Sudah login DeepSeek di mesin ini (`npm run auth` dari root repo)

## Di mana 9router sebenarnya jalan

`start.ps1` memilih 9router dengan urutan ini:

| Urutan | Lokasi | Kapan dipakai |
|--------|--------|---------------|
| 1 | `$env:NINEROUTER_APP` | kamu set sendiri, selalu menang |
| 2 | `9router-source\cli\app` | ada hasil build dari checkout di repo ini |
| 3 | `%APPDATA%\npm\node_modules\9router\app` | hasil `npm i -g 9router` (cadangan) |

Build lokal didahulukan supaya mengedit `9router-source/` lalu build ulang benar-benar
berpengaruh. Kalau kamu clone repo ini tapi belum pernah build 9router, launcher
otomatis pakai instalasi global dan tetap jalan.

`patch-deepseek.ps1` memakai urutan yang sama, jadi `-Patch` selalu mem-patch build
yang benar-benar akan dijalankan.

State runtime 9router tetap di luar keduanya: `%APPDATA%\9router` (SQLite, backup
patch). Jadi upgrade 9router tidak menyentuh akun atau setting-mu.

`9router-source/` di-ignore git karena clone terpisah dengan histori sendiri.

### Build 9router di Windows (Node 24+)

`npm run cli:pack` adalah build resmi; hasilnya `cli/app` dengan layout sama seperti
paket npm. Di Node 24+ ada dua penyesuaian:

```powershell
cd 9router-source
npm install --ignore-scripts              # better-sqlite3 tidak bisa compile di Node 24+
cd cli; npm install --ignore-scripts; cd ..  # menyediakan esbuild untuk build MITM
npm run cli:pack                          # -> 9router-source\cli\app
```

`--ignore-scripts` aman: `src/lib/db/driver.js` melewati `better-sqlite3` di Node 24+
(addon native-nya SIGSEGV di sana) dan memakai `node:sqlite` bawaan, tanpa compile.

Setelah itu lengkapi bundle seperti yang dilakukan `assemble.sh` di Linux, karena
`build-cli.js` hanya menyalin sebagian kecil `src/` padahal `custom-server.js`
memuat beberapa modul lewat path absolut:

```powershell
cd 9router-source
$app = "cli\app"
Remove-Item "$app\src" -Recurse -Force; Copy-Item src "$app\src" -Recurse -Force
Remove-Item "$app\scripts" -Recurse -Force; Copy-Item scripts "$app\scripts" -Recurse -Force
Copy-Item CHANGELOG.md "$app\CHANGELOG.md" -Force
Remove-Item "$app\node_modules\next" -Recurse -Force
Copy-Item node_modules\next "$app\node_modules\next" -Recurse -Force
```

Tanpa empat salinan itu, build tetap start tapi gagal saat dipakai:
`AuthGuard load failed: ENOENT ...node_modules\next\server.js`, atau server diam-diam
membaca modul dari `9router-source/src` bukan dari foldernya sendiri.

Terakhir arahkan build baru ke proxy, lalu restart:

```powershell
local-stack\patch-deepseek.ps1   # otomatis mendeteksi 9router-source\cli\app
local-stack\Start-All.bat
local-stack\Verify-All.bat       # harus berakhir CHAIN_OK
```

**Build ulang = patch ulang.** `patch-deepseek.ps1` menulis ulang chunk JS yang memuat
`https://api.deepseek.com/...`, dan build ulang menghasilkan chunk baru dengan URL asli.
Selalu jalankan patch lagi setelah build, kalau tidak 9router akan memanggil DeepSeek
langsung, bukan lewat proxy.

## Cara pakai

Kalau shim `deepseek-local` sudah dipasang (lihat bawah), satu perintah saja:

```
deepseek-local            nyalakan semua
deepseek-local off        matikan semua (alias: stop)
deepseek-local restart    matikan, tunggu port benar-benar bebas, lalu nyalakan
deepseek-local status     sedang jalan? 9router versi mana yang dipakai?
deepseek-local verify     buktikan rantai penuh sampai CHAIN_OK
```

Menyalakan yang sudah menyala aman: `start.ps1` mendeteksi port dan tidak
menjalankan proses kedua. `restart` tidak sekadar tidur 3 detik — ia menunggu
sampai port 9655 dan 20128 benar-benar tidak lagi `Listen`, karena socket yang
masih di `TIME_WAIT` membuat `start.ps1` mengira stack sudah hidup dan melewati
peluncuran. Kalau setelah 20 detik port masih dipegang proses lain, ia berhenti
dengan pesan jelas daripada menyalakan setengah jalan.

Tanpa shim, pakai file .bat langsung:

| Aksi | Perintah |
|------|----------|
| Nyalakan semua | `local-stack\Start-All.bat` |
| Matikan semua | `local-stack\Stop-All.bat` |
| Cek rantai penuh | `local-stack\Verify-All.bat` |
| Nyalakan + re-patch | `powershell -File local-stack\start.ps1 -Patch` |

### Memasang perintah `deepseek-local`

Logika sebenarnya ada di `local-stack\deepseek-local.ps1`; shim di PATH hanya
meneruskan argumen. Buat `%USERPROFILE%\.local\bin\deepseek-local.cmd`:

```bat
@echo off
setlocal
set "STACK_DIR=D:\FreeDeepseekAPI\local-stack"
if not exist "%STACK_DIR%\deepseek-local.ps1" (
    echo deepseek-local: cannot find "%STACK_DIR%\deepseek-local.ps1"
    exit /b 1
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%STACK_DIR%\deepseek-local.ps1" %*
exit /b %ERRORLEVEL%
```

Pastikan `%USERPROFILE%\.local\bin` ada di PATH. Kalau repo dipindah, cukup ubah
`STACK_DIR` di satu file itu.

### Menyetel batas sesi (`settings.local.ps1`)

`start.ps1` me-*dot-source* `local-stack\settings.local.ps1` setiap kali jalan,
jadi nilai di situ ikut ke proses proxy yang ia lahirkan dan bertahan setelah
reboot — tidak perlu mengekspor env var manual tiap kali. File itu git-ignored
karena isinya tuning mesin ini, bukan sesuatu untuk ikut ke repo. Contohnya
disediakan sebagai `settings.local.example.ps1`:

```powershell
Copy-Item local-stack\settings.local.example.ps1 local-stack\settings.local.ps1
```

Kalau file itu rusak, `start.ps1` hanya memberi peringatan lalu lanjut dengan
default — stack tidak ikut mati gara-gara satu baris salah.

Setelan yang dipakai di mesin ini:

| Variabel | Nilai | Arti |
|---|---|---|
| `DEEPSEEK_SESSION_TTL_MS` | `604800000` | Chat DeepSeek dipakai 7 hari sebelum diganti |
| `DEEPSEEK_MAX_MESSAGE_DEPTH` | `400` | 400 pesan per chat sebelum reset paksa |
| `DEEPSEEK_MAX_HISTORY_MESSAGES` | `400` | 400 giliran lokal diputar ulang ke chat pengganti |
| `DEEPSEEK_MAX_HISTORY_CHARS` | `800000` | Anggaran karakter untuk pemutaran ulang itu |

Dua yang terakhir harus naik bersama `DEEPSEEK_MAX_MESSAGE_DEPTH`. Menaikkan
depth saja tidak ada gunanya: saat chat diganti, proxy memutar ulang riwayat
lokal, dan pemutaran itu dulu dipatok di 100 entri — sesi "400 pesan" tetap
hanya memulihkan 100 giliran terakhir.

Anggaran karakter sengaja dipatok di `800000`, sama dengan
`DEEPSEEK_MAX_PROMPT_CHARS`. Angka di atas batas prompt tidak menambah apa pun:
prompt tetap dipotong di 800 ribu, jadi kelebihannya cuma jadi bahan pemadatan.

Ini juga menutup bug yang ditemukan saat menguji: dulu, kalau riwayat yang
diputar ulang melebihi batas prompt, seluruh blok riwayat dibuang — sesi panjang
kehilangan semua ingatannya tepat saat pemulihan paling dibutuhkan. Sekarang
riwayat dipadatkan ke sekitar sepertiga anggaran prompt, jadi awal sesi, bagian
tengah yang penting, dan giliran terbaru tetap ada.

Cek hasilnya benar-benar aktif, jangan percaya file saja:

```
deepseek-local status
```

```
  proxy    UP    port 9655  |  1 account(s), 1 ready
                 session: ttl 7.0 days, 400 msgs, replays 400 msgs / 800k chars
```

Atau `curl http://127.0.0.1:9655/health` dan lihat `session_reuse`.

Dashboard proxy: <http://127.0.0.1:9655/dashboard> · 9router: <http://127.0.0.1:20128>

`verify.ps1` membaca API key 9router dari `$env:NINEROUTER_KEY` (default `local`,
karena proxy menerima key apa pun). Jangan pernah hardcode key asli di skrip.

## Model yang dipakai

Lewat 9router, provider `ds` (DeepSeek) sudah diarahkan ke proxy lokal:

- `ds/deepseek-v4-flash`
- `ds/deepseek-v4-flash-thinking`
- `ds/deepseek-v4-pro`
- `ds/deepseek-v4-flash-vision-exp`

Lewat OpenCode langsung (tanpa 9router), prefix `freedeepseek/`:

- `freedeepseek/deepseek-v4-flash`
- `freedeepseek/deepseek-v4-flash-thinking`
- `freedeepseek/deepseek-v4-flash-nosearch`
- `freedeepseek/deepseek-v4-flash-thinking-nosearch`

## Kenapa dulu 9router "tidak mau start"

Bukan masalah conda/PowerShell. `cli.js` 9router adalah **supervisor**: ia
men-spawn `app/custom-server.js`, lalu men-spawn salinan `--tray` yang detached dan
menghidupkan ulang anaknya setiap kali mati. Jadi:

- membunuh proses di port 20128 saja → langsung dihidupkan lagi (terlihat seperti gagal start);
- menjalankan `cli.js` tanpa TTY → otomatis masuk mode tray (proses latar);
- `start /B` + `pause` di .bat → jendela induk hilang, anak ikut terbunuh.

`start.ps1` memanggil `custom-server.js` **langsung**, jadi tidak ada supervisor,
tray, cek update, atau hook shell. `stop.ps1` membunuh supervisor lebih dulu
(beberapa pass), baru anaknya.

## Kenapa dulu muncul "Invalid API key"

Ada dua sebab, keduanya sisa konfigurasi lama:

1. `providerNodes` berisi baris dengan `id = 'deepseek'` — id itu milik provider
   bawaan 9router, jadi baris custom menabraknya dan tidak pernah dipakai untuk
   routing. Baris itu sudah dihapus; routing `ds/*` sepenuhnya lewat provider
   bawaan yang URL-nya dipatch ke proxy.
2. Koneksi `deepseek-local-connection` menyimpan `lastError` 401 dari masa sebelum
   proxy terpasang, plus `modelLock_*` yang membuat model tampak terkunci.
   `clear-stale-errors.ps1` menghapus keduanya.

Proxy lokal menerima API key apa pun, jadi 401 hanya bisa berasal dari state lama
semacam ini — bukan dari proxy.

## Menambah akun kedua (rotasi saat rate-limit)

Proxy mendukung banyak akun DeepSeek. Kalau satu kena cooldown, request berikutnya
otomatis pindah ke akun yang lain — **rotasi bekerja tanpa kode tambahan**.

### Caranya

```powershell
# 1. Siapkan folder accounts (hanya sekali)
mkdir D:\FreeDeepseekAPI\accounts

# 2. Login di browser ke akun DeepSeek kedua (profil/email berbeda)
# 3. Ekspor cookie (dengan ekstensi "Get cookies.txt LOCALLY" atau sejenis)
#    Simpan sebagai D:\FreeDeepseekAPI\accounts\cookies-akun2.json

# 4. Import ke proxy (minta token dari variabel, aman dari history shell)
$env:DEEPSEEK_TOKEN = "<token akun kedua>"
npm run auth:import -- --input D:\FreeDeepseekAPI\accounts\cookies-akun2.json
# Output: "Wrote D:\FreeDeepseekAPI\accounts\akun2.json"

# 5. Restart
deepseek-local restart
```

### Verifikasi

```
deepseek-local status
```

```
  proxy    UP    port 9655  |  2 account(s), 2 ready
                 cooling down: akun1 (rate_limit), ~5m 12s left
  9router  UP    port 20128  |  local build v0.5.330
```

Dua akun berarti `2 ready` — kalau `akun1` cooling down, request masih dilayani
`akun2` tanpa 429.

> **Penting:** Akun harus benar-benar berbeda (email DeepSeek berbeda). Dua file
> dari akun yang sama tetap berbagi kuota dan tidak menolong.

### Alternatif: dashboard admin

```
# Buka dashboard
# Klik "Import account" → pilih file cookies.json → isi nama → Simpan
# (butuh PROXY_API_KEY kalau diaktifkan)
```

## File

| File | Fungsi |
|------|--------|
| `start.ps1` | Start proxy + 9router hidden, tunggu sampai HTTP benar-benar siap |
| `stop.ps1` | Stop berbasis PID file + pola command line (tidak menyentuh node lain) |
| `verify.ps1` | Uji `/health`, `/v1/models`, dan satu completion nyata lewat 9router |
| `patch-deepseek.ps1` | Idempoten: arahkan build 9router dari `api.deepseek.com` ke proxy |
| `clear-stale-errors.ps1` | Hapus error 401 lama + model lock di SQLite 9router |
| `logs/`, `run/` | Log dan PID file |

## Dokumentasi tambahan

| Dokumen | Isi |
|---------|-----|
| `CONTEXT-MEMORY.md` | Cara proxy memadatkan konteks panjang tanpa memicu halusinasi |
| `REFACTOR-MODE.md` | Mematikan blok `NO-TOOLS CONTRACT` / `TOOL REMINDER` untuk refactor |

## Setelah update 9router

`npm i -g 9router@latest` menimpa `.next-cli-build` dan mengembalikan URL DeepSeek
ke `api.deepseek.com`. Jalankan:

```powershell
powershell -File local-stack\stop.ps1
powershell -File local-stack\patch-deepseek.ps1
powershell -File local-stack\start.ps1
```

Patcher membuat backup di `%APPDATA%\9router\patch-backup\<timestamp>\`.

## Kalau DeepSeek minta login ulang

Cookie web kedaluwarsa. Dari root repo:

```powershell
npm run auth
```

Lalu restart proxy (`Stop-All.bat`, `Start-All.bat`).

## Catatan

- Proxy lokal menerima API key apa pun — jangan pernah bind ke `0.0.0.0` tanpa `PROXY_API_KEY`.
- `data/sessions.json` menyimpan riwayat sesi (TTL 2 jam, maks 100 entri per agen).
- Error 401 lama di DB 9router adalah sisa sebelum proxy terpasang; jalankan
  `clear-stale-errors.ps1` saat 9router berhenti kalau model masih tampak terkunci.
