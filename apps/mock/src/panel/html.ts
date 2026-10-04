// Panel kendali mock: HTML statis + JS kecil yang membaca /_panel/api/state. Gaya mengikuti token Klinis Bersih.
export const PANEL_HTML = /* html */ `<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Panel mock integrasi · SIM RS</title>
<style>
  :root { --brand:#0F766E; --brand-700:#0B5D56; --brand-50:#E6F4F1; --ink:#14212B; --ink-700:#3F4C58; --ink-500:#5B6B79;
    --line:#E3E8EE; --canvas:#F5F7F9; --danger:#B42318; --danger-bg:#FDECEA; --warning:#8A4B00; --warning-bg:#FFF3E0;
    --success:#1E6B34; --success-bg:#EAF5EC; }
  * { box-sizing: border-box; }
  body { margin:0; font-family:'IBM Plex Sans',system-ui,sans-serif; font-size:14px; color:var(--ink); background:var(--canvas);
    background-image:radial-gradient(circle at 1px 1px, rgba(20,33,43,.07) 1px, transparent 1.5px); background-size:22px 22px; }
  main { max-width:1200px; margin:0 auto; padding:24px 16px; display:flex; flex-direction:column; gap:20px; }
  h1 { margin:0; font-size:20px; } h2 { margin:0 0 12px; font-size:16px; }
  .muted { color:var(--ink-500); font-size:12.5px; }
  .card { background:#fff; border:1px solid var(--line); border-radius:14px; padding:16px; }
  .grid { display:grid; gap:12px; grid-template-columns:repeat(auto-fill,minmax(260px,1fr)); }
  .sys { border:1px solid var(--line); border-radius:10px; padding:12px; display:flex; flex-direction:column; gap:8px; }
  .row { display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
  button, select, input { font:inherit; height:40px; border-radius:10px; border:1px solid #CBD3DB; background:#fff; padding:0 12px; }
  button { cursor:pointer; font-weight:500; } button.primary { background:linear-gradient(180deg,#1D7E77,#0F766E); color:#fff; border-color:#0D6861; font-weight:600; }
  button.danger { color:var(--danger); border-color:#F0C2BD; }
  input[type=number] { width:96px; }
  .chip { display:inline-block; font-size:12px; font-weight:600; border-radius:999px; padding:2px 10px; }
  .ok { background:var(--success-bg); color:var(--success); } .warn { background:var(--warning-bg); color:var(--warning); }
  .bad { background:var(--danger-bg); color:var(--danger); } .neutral { background:#F1F3F5; color:var(--ink-700); }
  table { width:100%; border-collapse:collapse; font-size:13px; } th, td { text-align:left; padding:6px 8px; border-bottom:1px solid #EEF1F4; }
  th { color:var(--ink-500); font-weight:600; font-size:12px; } td.mono, .mono { font-family:'IBM Plex Mono',ui-monospace,monospace; }
  label { font-size:12.5px; font-weight:600; color:var(--ink-700); }
  :focus-visible { outline:2px solid var(--brand); outline-offset:2px; }
</style>
</head>
<body>
<main>
  <header class="row" style="justify-content:space-between">
    <div>
      <h1>Panel mock integrasi</h1>
      <span class="muted">BPJS · E-Klaim · SATUSEHAT · Dukcapil · TTE · TPDI · BTN — data fiktif, lokal saja</span>
    </div>
    <div class="row">
      <span id="updated" class="muted" role="status"></span>
      <button class="danger" id="reset">Reset data mock</button>
    </div>
  </header>

  <section class="card" aria-labelledby="h-sk">
    <h2 id="h-sk">Skenario per sistem</h2>
    <div class="grid" id="systems"></div>
    <div class="row" style="margin-top:12px">
      <label><input type="checkbox" id="enc" style="height:auto"> Enkripsi respons BPJS (AES-256-CBC + LZ-string)</label>
    </div>
    <p class="muted">Timeout: permintaan tetap diproses (mis. SEP terbit), jawabannya ditahan lalu dijawab 504 — meniru jawaban BPJS yang hilang di jalan.</p>
  </section>

  <section class="card" aria-labelledby="h-antrean">
    <h2 id="h-antrean">BPJS · Antrean dan task ID</h2>
    <table><thead><tr><th>Kode booking</th><th>Pasien</th><th>Poli · dokter</th><th>Jadwal</th><th>No. antrean</th><th>Task ID tercatat</th><th>Status</th></tr></thead>
    <tbody id="antrean"><tr><td colspan="7" class="muted">Belum ada antrean.</td></tr></tbody></table>
  </section>

  <section class="card" aria-labelledby="h-sep">
    <h2 id="h-sep">BPJS · SEP</h2>
    <table><thead><tr><th>No. SEP</th><th>Tanggal</th><th>No. kartu</th><th>Pelayanan</th><th>Poli · DPJP</th><th>Rujukan / surat</th><th>Versi</th><th>Status</th></tr></thead>
    <tbody id="seps"><tr><td colspan="8" class="muted">Belum ada SEP.</td></tr></tbody></table>
  </section>

  <section class="card" aria-labelledby="h-tpdi">
    <h2 id="h-tpdi">Tagihan TPDI</h2>
    <p class="muted" id="target"></p>
    <table><thead><tr><th>Invoice</th><th>Ref</th><th>Kanal</th><th>Nominal</th><th>Status</th><th>Webhook terakhir</th><th>Aksi</th></tr></thead>
    <tbody id="invoices"><tr><td colspan="7" class="muted">Belum ada tagihan.</td></tr></tbody></table>
  </section>

  <section class="card" aria-labelledby="h-echo">
    <h2 id="h-echo">Pesan outbox diterima (_echo)</h2>
    <table><thead><tr><th>Idempotency key</th><th>Operasi</th><th>Diterima</th><th>Jumlah kiriman</th></tr></thead>
    <tbody id="echoes"><tr><td colspan="4" class="muted">Belum ada pesan.</td></tr></tbody></table>
  </section>

  <section class="card" aria-labelledby="h-inbox">
    <h2 id="h-inbox">Kotak masuk email &amp; WhatsApp (mock)</h2>
    <table><thead><tr><th>Waktu</th><th>Kanal</th><th>Tujuan</th><th>Isi</th></tr></thead>
    <tbody id="inbox"><tr><td colspan="4" class="muted">Belum ada pesan.</td></tr></tbody></table>
  </section>

  <section class="card" aria-labelledby="h-log">
    <h2 id="h-log">50 request terakhir</h2>
    <table><thead><tr><th>Waktu</th><th>Sistem</th><th>Metode</th><th>Path</th><th>Status</th><th>Durasi</th></tr></thead>
    <tbody id="log"></tbody></table>
  </section>
</main>
<script>
const MODES = [['normal','Normal'],['lambat','Lambat'],['gagal','Gagal'],['acak','Acak'],['timeout','Timeout']];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const jam = (iso) => iso ? new Date(iso).toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta', hour12: false }) : '—';
const rp = (n) => 'Rp ' + String(n).replace(/\\B(?=(\\d{3})+(?!\\d))/g, '.');
const statusChip = (code) => '<span class="chip ' + (code === 'error' || code >= 500 ? 'bad' : code >= 400 ? 'warn' : 'ok') + '">' + esc(code) + '</span>';
async function post(path, body) {
  const r = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) });
  if (!r.ok) { const e = await r.json().catch(() => ({})); alert(e.message || ('Gagal: ' + r.status)); }
  await refresh();
}
let editing = false;
const setHtml = (id, html) => { const el = document.getElementById(id); if (el.dataset.html !== html) { el.innerHTML = html; el.dataset.html = html; } };
function renderSystems(systems) {
  if (editing) return;
  setHtml('systems', systems.map((s) =>
    '<div class="sys"><strong>' + esc(s.label) + '</strong>' +
    '<div class="row"><label for="m-' + s.id + '">Mode</label><select id="m-' + s.id + '" data-sys="' + s.id + '">' +
    MODES.map(([v, l]) => '<option value="' + v + '"' + (v === s.scenario.mode ? ' selected' : '') + '>' + l + '</option>').join('') + '</select>' +
    '<span class="chip ' + (s.scenario.mode === 'normal' ? 'ok' : s.scenario.mode === 'gagal' ? 'bad' : 'warn') + '">' + esc(s.scenario.mode) + '</span></div>' +
    '<div class="row"><label for="l-' + s.id + '">Latensi ms</label><input type="number" id="l-' + s.id + '" value="' + s.scenario.latencyMs + '">' +
    '<label for="f-' + s.id + '">Kode gagal</label><input type="number" id="f-' + s.id + '" value="' + s.scenario.failStatus + '"></div>' +
    '<div class="row"><label for="t-' + s.id + '">Tahan ms (timeout)</label><input type="number" id="t-' + s.id + '" value="' + s.scenario.timeoutMs + '"></div>' +
    '<button data-apply="' + s.id + '">Terapkan</button></div>').join(''));
}
document.getElementById('systems').addEventListener('focusin', () => { editing = true; });
document.getElementById('systems').addEventListener('focusout', () => { setTimeout(() => { editing = document.getElementById('systems').contains(document.activeElement); }, 0); });
document.getElementById('systems').addEventListener('click', (e) => {
  const id = e.target.getAttribute && e.target.getAttribute('data-apply'); if (!id) return;
  editing = false;
  post('/_panel/api/scenario', { system: id, mode: document.getElementById('m-' + id).value,
    latencyMs: Number(document.getElementById('l-' + id).value), failStatus: Number(document.getElementById('f-' + id).value),
    timeoutMs: Number(document.getElementById('t-' + id).value) });
});
document.getElementById('enc').addEventListener('change', (e) => post('/_panel/api/bpjs-encryption', { enabled: e.target.checked }));
document.getElementById('reset').addEventListener('click', () => { if (confirm('Hapus semua data mock (tagihan, antrean dan SEP BPJS, log, skenario)?')) post('/_panel/api/reset'); });
document.getElementById('invoices').addEventListener('click', (e) => {
  const a = e.target.getAttribute && e.target.getAttribute('data-act'); if (!a) return;
  const [id, act] = a.split('|'); post('/_panel/api/tpdi/invoices/' + encodeURIComponent(id) + '/' + act);
});
async function refresh() {
  const s = await fetch('/_panel/api/state').then((r) => r.json());
  renderSystems(s.systems);
  document.getElementById('enc').checked = s.bpjsEncryption;
  document.getElementById('target').textContent = 'Webhook dikirim ke ' + s.webhookTarget;
  setHtml('invoices', s.invoices.length ? s.invoices.map((i) => {
    const w = i.webhookDeliveries[0];
    return '<tr><td class="mono">' + esc(i.id) + '</td><td class="mono">' + esc(i.externalRef) + '</td><td>' + (i.channel === 'qris' ? 'QRIS' : 'VA ' + esc(i.vaNumber)) +
      '</td><td class="mono">' + rp(i.amount) + '</td><td><span class="chip ' + (i.status === 'paid' ? 'ok' : i.status === 'pending' ? 'neutral' : 'bad') + '">' + esc(i.status) +
      '</span></td><td>' + (w ? esc(w.event) + ' ' + statusChip(w.status) : '—') + '</td><td class="row">' +
      (i.status === 'pending' ? '<button class="primary" data-act="' + esc(i.id) + '|pay">Bayar</button><button data-act="' + esc(i.id) + '|expire">Kedaluwarsakan</button>' : '') +
      (w ? '<button data-act="' + esc(i.id) + '|resend">Kirim webhook ulang</button>' : '') + '</td></tr>';
  }).join('') : '<tr><td colspan="7" class="muted">Belum ada tagihan.</td></tr>');
  setHtml('echoes', s.echoes.length ? s.echoes.map((x) =>
    '<tr><td class="mono">' + esc(x.idempotencyKey) + '</td><td>' + esc(x.operation) + '</td><td>' + jam(x.receivedAt) + '</td><td>' + x.count + (x.count > 1 ? ' <span class="chip warn">duplikat ditolak</span>' : '') + '</td></tr>').join('')
    : '<tr><td colspan="4" class="muted">Belum ada pesan.</td></tr>');
  setHtml('inbox', s.messages.length ? s.messages.map((m) =>
    '<tr><td>' + jam(m.at) + '</td><td>' + (m.channel === 'email' ? 'Email' : 'WhatsApp') + '</td><td class="mono">' + esc(m.to) +
    '</td><td>' + (m.subject ? '<strong>' + esc(m.subject) + '</strong><br>' : '') + '<span style="white-space: pre-wrap">' + esc(m.text) + '</span></td></tr>').join('')
    : '<tr><td colspan="4" class="muted">Belum ada pesan.</td></tr>');
  setHtml('antrean', s.bpjs.antrean.length ? s.bpjs.antrean.map((a) =>
    '<tr><td class="mono">' + esc(a.kodebooking) + '</td><td>' + esc(a.jenispasien) + (a.nomorkartu ? ' <span class="mono">' + esc(a.nomorkartu) + '</span>' : '') +
    '</td><td>' + esc(a.kodepoli) + ' · ' + esc(a.namadokter) + '</td><td>' + esc(a.tanggalperiksa) + ' ' + esc(a.jampraktek) +
    '</td><td class="mono">' + esc(a.nomorantrean) + '</td><td>' + (a.tasks.length ? a.tasks.map((t) =>
      '<span class="chip ' + (t.taskid === 99 ? 'bad' : 'ok') + '" title="' + esc(t.taskname) + ' · ' + jam(t.waktuIso) + '">' + t.taskid + '</span>').join(' ') : '<span class="muted">belum ada</span>') +
    '</td><td><span class="chip ' + (a.status === 'aktif' ? 'neutral' : 'bad') + '">' + esc(a.status) + '</span></td></tr>').join('')
    : '<tr><td colspan="7" class="muted">Belum ada antrean.</td></tr>');
  setHtml('seps', s.bpjs.seps.length ? s.bpjs.seps.map((x) =>
    '<tr><td class="mono">' + esc(x.noSep) + '</td><td>' + esc(x.tglSep) + '</td><td class="mono">' + esc(x.noKartu) + '</td><td>' + esc(x.jnsPelayanan) +
    '</td><td>' + esc(x.poli || '—') + (x.dpjpLayan ? ' · ' + esc(x.dpjpLayan) : '') + '</td><td class="mono">' + esc(x.noRujukan || x.noSurat || '—') +
    '</td><td>' + x.versi + '</td><td><span class="chip ' + (x.status === 'terbit' ? 'ok' : 'bad') + '">' + esc(x.status) + '</span></td></tr>').join('')
    : '<tr><td colspan="8" class="muted">Belum ada SEP.</td></tr>');
  setHtml('log', s.log.map((l) =>
    '<tr><td>' + jam(l.at) + '</td><td>' + esc(l.system) + '</td><td>' + esc(l.method) + '</td><td class="mono">' + esc(l.path) + '</td><td>' + statusChip(l.status) + '</td><td>' + l.durationMs + ' ms</td></tr>').join(''));
  document.getElementById('updated').textContent = 'Diperbarui ' + jam(new Date().toISOString());
}
refresh(); setInterval(refresh, 2000);
</script>
</body>
</html>`;
