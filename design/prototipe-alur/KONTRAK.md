# Kontrak prototipe alur (tanpa backend)

Prototipe klik untuk semua fase. Semua data fiktif. Tidak ada `fetch`, tidak ada backend.

- **`index.html`**: inti. Berisi CSS "Klinis Bersih", registri layar, router, state, dan komponen string `ui.*`. Hanya orkestrator yang mengubahnya.
- **`screens-*.js`**: satu berkas per agen. Isinya hanya pemanggilan `SIM.register({...})`.
- **`cek.mjs`**: uji asap. Jalankan `node cek.mjs screens-xx.js`. Uji ini merender setiap layar dan menjalankan setiap aksi; wajib LULUS.

## Bentuk layar

```js
(function () {
  const { ui, PEOPLE } = SIM;
  const P = PEOPLE.suryo;

  SIM.register({
    id: 'pendaftaran',            // unik, huruf kecil-strip; dipakai di tur & data-go
    phase: 2,                     // 0–10 → grup sidebar
    title: 'Pendaftaran',         // judul halaman
    nav: 'Pendaftaran',           // (opsional) label menu pendek
    codes: 'F03 · F06',           // kode komponen katalog docs/02
    role: 'daftar',               // kunci SIM.STAFF (siapa yang "masuk")
    device: null,                 // 'anjungan' | 'TV' | 'tablet' | 'ponsel' → label kecil di menu
    desc: 'Kalimat pendek apa yang dikerjakan di layar ini.',
    hint: 'Apa yang diklik di layar ini, satu kalimat (tampil di bilah tur).',
    init: { step: 0, q: '' },     // state lokal awal (JSON murni)
    render(L, J, SIM) { return '…HTML string…'; },
    actions: {
      cari(L, J, el, SIM) { L.step = 1; SIM.note('Pasien ditemukan di MPI'); },  // return false = jangan render ulang
    },
    onEnter(L, J) {},             // (opsional) setiap kali layar dibuka
    onChange(key, L, J, SIM) {},  // (opsional) setelah select/checkbox berubah
    headActions(L, J) { return ui.btn('…'); }, // (opsional) tombol di kanan judul
    noHead: false,                // true = layar menggambar judulnya sendiri (mis. perangkat)
  });
})();
```

## Interaksi lewat atribut (didelegasikan oleh inti)

| Atribut | Efek |
|---|---|
| `data-act="nama" data-arg="x"` | Memanggil `actions.nama(L, J, el)`. Argumen ada di `el.dataset.arg`. Setelah itu layar dirender ulang. |
| `data-go="idLayar"` | Pindah ke layar lain (`peta` = beranda). |
| `data-set="kunci=nilai"` | Menyetel `L.kunci = 'nilai'` (string), lalu render ulang. Dipakai untuk tab, segmen, dan pilihan kartu. |
| `data-bind="kunci"` di input | Isian teks mengisi `L.kunci` tanpa render ulang. Select/checkbox (`data-rerender`) memicu render ulang. |
| `data-needs="kunci:10"` | Tombol aktif hanya bila `L.kunci` minimal 10 huruf. Dipakai untuk alasan override. |

Semua nilai dari `data-set`, `data-arg`, dan `data-bind` berbentuk **string**. Ubah ke angka bila perlu.

## Helper

- **`ui.*`**:
  - `ui.btn(label, {act, arg, go, set, variant:'primary'|'danger'|'ghost', size:'sm'|'lg'|'xl', disabled, reason, needs})`. Tombol nonaktif wajib diberi `reason` (aturan docs/08).
  - `ui.chip(text, tone)` dengan tone `brand|success|warning|danger|info|solid-danger`.
  - `ui.card({title, sub, actions, body, flush, tone})`, `ui.kpi(label, value, foot, 'up'|'down')`, `ui.alert(tone, title, bodyHtml)`.
  - `ui.gate({title, body, follow:{label, act}, override:{label, act}, reasonKey, reasonValue})`: gerbang keselamatan.
  - Isian: `ui.field(label, control, help, id)`, `ui.input(key, value, {placeholder, area, mono})`, `ui.select(key, value, options)`, `ui.check(key, checked, label)`.
  - Navigasi: `ui.tabs(key, value, [{value,label}])`, `ui.seg(key, value, opts)`.
  - Daftar: `ui.table(cols, rows, {act, sel, rowArgs})` dengan `cols` berisi `'Label'` atau `{label, r:true}` (rata kanan, angka mono); `ui.list(items, act)`.
  - Pasien dan alur: `ui.banner(PEOPLE.x, extraHtml)`, `ui.steps(labels, idx)`, `ui.timeline([{t, text, sub, tone}])`.
  - Tata letak dan sisanya: `ui.next(idLayar, teksSelesai)`, `ui.device('kiosk'|'tv'|'tablet'|'phone', innerHtml, caption)`, `ui.split(kiriHtml, kananHtml)`, `ui.empty(teks)`, `ui.sig(key, signed, nama)`, `ui.rupiah(n)`, `ui.esc(s)`.
  - Kelas CSS siap pakai: `grid g2 g3 g4`, `row`, `row between`, `stack`, `muted`, `small`, `label`, `mono`, `num`, `code`, `hr.sep`.
- **`SIM.*`**:
  - `SIM.now(menit=2)` memajukan jam simulasi dan mengembalikan "HH.MM"; `SIM.time()` hanya membaca jam.
  - `SIM.note(teks, tone)` mencatat ke Jejak alur. Catat hanya langkah penting, satu kalimat dengan bahasa pengguna.
  - `SIM.done()` menandai layar sudah dicoba; panggil saat tugas utama layar selesai.
  - `SIM.toast(teks, tone)` dan `SIM.go(id)`.
- **Teks bebas**: setiap teks bebas yang dimasukkan ke HTML wajib lewat `ui.esc()`.

## Data bersama

- **Pasien**: `SIM.PEOPLE.suryo` (rawat jalan BPJS, DM), `.hartono` (IGD → rawat inap), `.ratna` (operasi elektif + pembiayaan BTN, alergi amoksisilin). Ada juga `SIM.PEOPLE.rs`.
- **Staf**: `SIM.STAFF` (kunci `role`).
- **Fakta perjalanan** disimpan di `SIM.j` (`J` di render/aksi). Layar yang **menulis** kunci memakai bentuk di tabel bawah. Layar yang **membaca** wajib punya nilai bawaan yang masuk akal bila kuncinya belum ada; tandai dengan chip "data contoh" agar layar tetap bisa dibuka langsung tanpa urutan.

| Kunci `J` | Ditulis oleh | Bentuk |
|---|---|---|
| `J.loggedIn` | masuk | `true` |
| `J.booking` | app-pasien / jadwal | `{ code:'2610050042', date:'Senin, 5 Okt 2026', poli:'Poli Penyakit Dalam', dokter:'dr. Andi Wiratama, Sp.PD', sesi:'08.00–12.00', no:'PD-007', patient:'suryo' }` |
| `J.checkin` | anjungan | `{ ticket:'A-012', t:'07.52' }` |
| `J.encounter` | pendaftaran | `{ no:'RJ-261005-0042', t, patient:'suryo' }` |
| `J.sep` | pendaftaran | `{ no:'0901R0011025V000123', status:'pending'|'issued' }` |
| `J.called` | kendali | `{ ticket:'PD-007', room:'Poli PD 2', t }` |
| `J.soap` | poli | `{ s, o, a, p, ttv:{td:'148/92', n:88, rr:18, s:36.7, spo2:98, gds:286} }` |
| `J.orders` | cpoe | `[{ kind:'lab'|'rad', code, name, price }]` |
| `J.rx` | cpoe | `[{ name, sig, qty, price }]` |
| `J.labResult` | lab | `{ items:[{name, value, unit, ref, flag}], validatedAt, critical:false }` |
| `J.dispensed` | farmasi | `{ t, by }` |
| `J.igd` | igd | `{ patient:'hartono', triage:2, t }` |
| `J.bed` | bed | `{ ward:'Melati', room:'3-02', cls:'Kelas 1' }` |
| `J.emar` | ranap | `{ given:n, override:false }` |
| `J.consent` | consent | `{ patient:'ratna', procedure:'Kolesistektomi laparoskopik', signedAt }` |
| `J.surgery` | ok | `{ patient:'ratna', signIn, timeOut, signOut, done:true }` |
| `J.discharge` | resume | `{ patient:'hartono', t }` |
| `J.bill` | kasir | `{ patient:'suryo', items:[{name, qty, price}], total, payer:'BPJS'|'Umum' }` |
| `J.payment` | kasir / pembayaran | `{ method:'QRIS'|'VA BTN'|'Tunai', amount, ref, status:'paid' }` |
| `J.claim` | klaim | `{ cbg:'Q-5-44-0', tariff, status:'grouped'|'sent'|'paid' }` |
| `J.financing` | pembiayaan | `{ amount, status }` |
| `J.satusehat` | integrasi | `{ sent:n, failed:n }` |
| `J.downtime` | downtime | `{ active:bool, backlog:n }` |

## Aturan isi

- **Bahasa**: Indonesia yang wajar, dengan istilah RS yang dikenal petugas (SEP, CPPT, eMAR, INA-CBG, task ID). Jangan pakai istilah teknis sistem di layar petugas.
- **Isi layar**: tiap layar menunjukkan alur kerjanya yang **utuh**, dengan tahap jelas, aksi utama, gerbang, dan umpan balik berjam (mis. "Tervalidasi · 10.41"). Sumbernya mockup `design/mockups/<Nama>.dc.html` (tata letak dan data contoh) dan rencana fase di `docs/rencana/`. Layar terbuka dalam keadaan kerja yang realistis, bukan kosong.
- **Akhir tugas**: setelah tugas utama layar selesai, panggil `SIM.done()` dan tampilkan `ui.next(idLayarBerikutnyaDiTur, 'apa yang barusan terjadi')`.
- **Urutan tur**: fondasi → masuk → akses → mpi → jadwal → app-pasien → anjungan → pendaftaran → kendali → display → poli → cpoe → lab → farmasi → kasir → pembayaran → klaim → igd → bed → ranap → consent → ok → resume → pembiayaan → integrasi → akuntansi → logistik → mutu → dasbor → app-dokter → simulasi → downtime → golive.
- **Perangkat**: layar anjungan, TV, tablet, dan ponsel digambar di dalam `ui.device(...)`. Anjungan memakai target sentuh besar (≥ 64 px, `size:'xl'`).
- **Gaya**: jangan menambah `<style>`. Pakai kelas dan komponen yang ada; atribut `style="..."` kecil boleh untuk tata letak. Warna hanya dari token `var(--…)`.
- **Teknis**: tanpa library, `fetch`, `alert`, atau `confirm`. Konfirmasi dibangun di dalam layar.
- **Lebar**: semua layar halaman harus tetap rapi di lebar 768 px. Tabel lebar dibungkus `ui.table`, yang sudah bisa digulir sendiri.
