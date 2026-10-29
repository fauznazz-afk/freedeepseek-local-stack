# Memori & konteks panjang

Perubahan pada proxy di root repo ini supaya sesi panjang tidak "lupa" dan
tidak mengarang. Semua di `lib/context.js` (baru) + sambungan di `server.js`.

## Masalah yang diperbaiki

Sebelumnya ada tiga sumber halusinasi, bukan sekadar "konteks kurang":

**1. Riwayat hanya menyimpan 500 karakter terakhir**

`storeHistory()` menyimpan `'...' + prompt.substring(prompt.length - 500)`.
Saat sesi DeepSeek di-reset (TTL 2 jam atau 100 pesan), riwayat inilah yang
diputar ulang — potongan prompt yang terputus di tengah kalimat. Model lalu
menambal bagian yang hilang dengan karangan.

Sekarang: seluruh prompt disimpan, dibatasi 12.000 karakter per entri dengan
potongan yang menjaga **awal dan akhir** (`boundHistoryText`). Total budget
riwayat naik dari 100k → 400k karakter.

**2. Pemotongan gunting-buta**

`autoCompactIfNeeded()` memotong head 25% + tail 35%, membuang 40% jatah secara
sia-sia, dan menyisipkan `[Earlier context compacted]` tanpa menjelaskan apa pun.

Sekarang: `structuredCompact()` menyeimbangkan budget antar-turn (water-filling).
Turn pendek dapat persis yang dibutuhkan, sisanya untuk turn panjang. Terukur:
52k karakter → 5.967 dari 8.000 budget (sebelumnya hanya 2.637).

**3. Pemotongan tanpa jejak**

`compactConversation()` menghapus turn tengah (`splice`) diam-diam.

Sekarang: setiap turn diringkas dengan mempertahankan **anchor** — path file,
perintah shell, URL, dan baris error. Kalau ada yang benar-benar dibuang,
model diberi tahu jumlahnya.

## Kunci anti-halusinasi

Setiap prompt yang dipadatkan membawa `COMPACTION_NOTICE`:

```
[Context notice: this conversation was condensed to fit the model context window.]
...
- Do not claim to remember details that are not shown above.
- Do not invent file contents, paths, command output, test results, error messages, or earlier statements.
- If a detail you need is missing, say so plainly and re-read the source with a tool instead of guessing.
```

Ini inti perbaikannya. Kegagalan model bukan "lupa", tapi **tidak sadar kalau
lupa** lalu menutupinya dengan detail yang masuk akal. Model yang tahu ada yang
hilang akan bertanya atau membaca ulang file; model yang tidak tahu akan menebak.

Riwayat yang diputar ulang juga dilabeli eksplisit sebagai
`[Recovered record of this conversation...]` + "bukan teks verbatim, jangan
anggap lengkap" — supaya sesi hasil rebuild tidak terbaca sebagai riwayat utuh.

## Yang dipertahankan saat memadatkan

| Bagian | Perlakuan |
|---|---|
| Turn pertama (tugas awal) | Dipertahankan, maks 30% budget |
| 35% turn terbaru | Verbatim selama muat |
| Turn tengah | Diringkas, anchor tetap |
| Tool result besar | Diringkas, path/perintah/error disimpan |
| Kelebihan | Dibuang dari tengah, **dengan hitungan** |

## Konfigurasi

| Env var | Default | Arti |
|---|---|---|
| `DEEPSEEK_MAX_PROMPT_CHARS` | 800000 | Plafon prompt ke upstream |
| `DEEPSEEK_ACCOUNT_COOLDOWN_MS` | 600000 | Cooldown akun saat kena rate limit |

Cooldown 10 menit mengikuti pesan asli DeepSeek ("Слишком частые сообщения"
= terlalu sering mengirim). Cooldown 10 detik membuat login yang masih
di-throttle langsung dihajar lagi — rate limit lunak berubah jadi keras.

## Batas jujur

- Ini **bukan** context window 1M token sungguhan. Proxy tetap dibatasi
  ~800k karakter (±200k token) karena itu plafon web DeepSeek.
- Pemadatan bersifat **ekstraktif** (memilih & memotong), bukan abstraktif
  (meringkas dengan model lain). Tidak ada panggilan LLM tambahan, jadi tidak
  ada biaya/latensi ekstra — tapi ringkasannya kurang "pintar" dibanding
  summarization sejati.
- Anchor berbasis regex: path Windows/POSIX, URL, perintah CLI umum, baris
  error. Format log yang tidak lazim bisa lolos tanpa anchor.
- Memori **per-agen**, disimpan di `data/sessions.json` (TTL 2 jam).

## Verifikasi

```powershell
cd <repo root>
node --test tests/unit.test.js          # 99 lulus
node --test tests/*.test.js             # 287 lulus, 13 gagal (pre-existing)
```

Tes baru yang mengunci perilaku ini:

- `compaction announces itself so the model cannot mistake a hole for memory`
- `compaction does not stack duplicate notices when it runs twice`
- `compaction uses the whole budget instead of wasting it on an even split`
- `replayed history is labelled as a recovered summary, not verbatim memory`
- `history entries keep both ends instead of a mid-sentence tail`
