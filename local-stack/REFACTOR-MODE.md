# Mode refactor (tanpa blok pembatas)

Proxy di root repo ini menambahkan dua blok ke prompt upstream. Keduanya
membatasi **apa yang boleh model tulis**, dan salah satunya secara eksplisit
melarang hal yang justru kamu inginkan saat refactor.

## Dua blok itu

| Blok | Isi | Kapan dipasang |
|---|---|---|
| `NO-TOOLS CONTRACT` | "Do NOT use any tools... plain text final answer only" | request **tanpa** tools, atau `tool_choice:"none"` |
| `TOOL REMINDER` | envelope `{"tool_call":...}` **+ "Do not paste source files or diffs"** | request **dengan** tools |

Baris `Do not paste source files or diffs` adalah masalahnya. Untuk refactor,
jawabannya *adalah* source code. Model yang dilarang menempel file hanya bisa
menjelaskan perubahan dalam prosa — bukan memberi kode.

## Cara mematikannya

### Lewat 9router (yang kamu pakai)

9router **membuang header klien**. Sudah saya uji: kirim `x-deepseek-guard-blocks: off`
ke port 20128 → proxy tidak menerimanya. Header `x-agent-session` pun ikut hilang
(semua request tercatat `unkeyed-...`).

Yang **lolos** adalah field body. Jadi lewat 9router pakai:

```json
{
  "model": "ds/deepseek-v4-flash",
  "guard_blocks": false,
  "tool_choice": "none",
  "messages": [ ... ]
}
```

Bukti dari log proxy (uji nyata, request yang sama):

```
[chan-header-...]  <- tidak ada baris "Guard blocks relaxed"  (header dibuang)
[chan-body-...]    <- "Guard blocks relaxed for this request"  (body lolos)
```

Karena itu **tidak perlu menambal build 9router**. Cukup field body.

### Langsung ke proxy (tanpa 9router)

Header **dan** body sama-sama bekerja:

```bash
curl http://127.0.0.1:9655/v1/chat/completions \
  -H "Authorization: Bearer local" \
  -H "Content-Type: application/json" \
  -H "x-deepseek-guard-blocks: off" \
  -d '{"model":"deepseek-v4-flash","messages":[...]}'
```

Field body juga bisa: `{"guard_blocks": false}`.

### Global (kalau memang mau permanen)

Set env sebelum proxy start:

```powershell
$env:DEEPSEEK_GUARD_BLOCKS = 'off'
node server.js
```

Default **on**. Nilai yang dianggap off: `off`, `0`, `false`, `no`, `none`,
`disabled` (case-insensitive). Nilai tak dikenal tetap **on** — fail closed.

## Yang TIDAK dihapus

Envelope `{"tool_call":{"name":...}}` tetap dikirim saat tools diiklankan.
Itu bukan aturan gaya, itu **kontrak parsing**: proxy memakai envelope itu untuk
mengenali tool request. Menghapusnya sambil tetap mengiklankan tools membuat
jawaban valid berubah jadi `502 malformed_tool_call`.

Jadi `off` berarti: *"berhenti melarang model menulis kode"*, bukan
*"berhenti memberi tahu format kawatnya"*.

Prompt pengganti saat `off`:

```
--- TOOL FORMAT ---
This computer: output only {"tool_call":{"name":"<function_name>","arguments":{...}}} ...
Available tools: write_file, read_file
--- END TOOL FORMAT ---
```

Tanpa baris larangan, tanpa "do not paste".

## Jalur error ikut dilonggarkan

Kalau guard dimatikan dan model tetap mengeluarkan markup tool pada request
tanpa tools, proxy **tidak** lagi menjawab `502 no_tools_but_tool_markup`.
Model tidak pernah diberi tahu larangan itu, jadi menghukumnya tidak adil —
teks dikembalikan apa adanya. Retry "strict instruction" juga dilewati.

Saat guard **on**, semua perilaku lama tidak berubah.

## Temuan dari uji hidup

Diuji ke proxy nyata dengan file 8–12 handler:

| Setup | Hasil |
|---|---|
| tanpa tools, guard on | ✅ kode utuh (2.801 char) |
| tanpa tools, guard off | ✅ kode utuh (2.414 char) |
| tools + `tool_choice:"none"`, guard on | ✅ kode utuh (2.342 char) |
| tools diiklankan (tanpa `tool_choice`), guard on/off | ❌ model memilih `write_file` |

**Kesimpulan penting:** kalau tools diiklankan dan `tool_choice` tidak
dibatasi, model akan memilih memanggil tool — bukan menulis kode di jawaban.
Flag guard tidak mengubah ini, karena ini soal *affordance* tool, bukan soal
larangan teks.

Jadi untuk refactor yang jawabannya berupa kode, kombinasikan:

```
x-deepseek-guard-blocks: off
tool_choice: "none"
```

## Ringkasan praktis

| Mau apa | Setelan |
|---|---|
| Agent normal (pakai tool) | default, tidak perlu apa-apa |
| Refactor lewat 9router | body `"guard_blocks": false` + `"tool_choice": "none"` |
| Refactor langsung ke proxy | header `x-deepseek-guard-blocks: off` + `tool_choice:"none"` |
| Chat biasa tanpa tool | default sudah cukup |

## Kenapa `tool_choice: "none"` wajib untuk refactor

Kalau tools diiklankan dan `tool_choice` tidak dibatasi, model akan memilih
memanggil `write_file` — bukan menulis kode di jawaban. Ini soal *affordance*
tool, bukan larangan teks, jadi flag guard tidak mengubahnya. Sudah diuji:
guard on maupun off, hasilnya sama-sama `tool_calls: 1 -> write_file`.

## Kalau ingin dari OpenCode

OpenCode memakai `@ai-sdk/openai-compatible`. Field body tambahan bisa
disisipkan lewat blok `options` provider, tapi cara paling andal adalah memakai
`freedeepseek/` (langsung ke proxy, tanpa 9router) untuk sesi refactor — di
jalur itu header maupun body sama-sama bekerja.

## Verifikasi

```powershell
cd <repo root>
node --test tests/unit.test.js    # 103 lulus
```

Tes yang mengunci perilaku ini:

- `DEEPSEEK_GUARD_BLOCKS=off drops the prohibitions but keeps the wire format`
- `guard blocks default to on so a missing env var cannot weaken the proxy`
- `guard blocks can be relaxed for one request without weakening the others`
- `relaxed guard blocks still let the model return whole files`

## Catatan rate limit

Uji beruntun memicu throttle asli DeepSeek (cooldown 600s). Itu bukan efek
flag — proxy memang membatasi diri agar login tidak dihajar saat masih diblokir.
Kalau kena 429, tunggu sesuai `Retry-After`.
