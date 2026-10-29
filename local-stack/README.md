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

## Cara pakai

| Aksi | Perintah |
|------|----------|
| Nyalakan semua | `local-stack\Start-All.bat` |
| Matikan semua | `local-stack\Stop-All.bat` |
| Cek rantai penuh | `local-stack\Verify-All.bat` |
| Nyalakan + re-patch | `powershell -File local-stack\start.ps1 -Patch` |

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
