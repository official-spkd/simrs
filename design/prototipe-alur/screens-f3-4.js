/* Layar fase 3 (Klinis RME) dan fase 4 (Penunjang) untuk prototipe alur tanpa backend.
 * Sumber tata letak & data contoh: design/mockups/{Main,CPOE,IGD,BedManagement,Ranap,Consent,Resume,Lab,Farmasi,OK}.dc.html
 * dan docs/rencana/fase-3-klinis-rme.md, fase-4-penunjang.md (DoD: alergi diblokir, gelang sebelum obat, nilai kritis
 * read-back, stok berkurang + FEFO, time out terkunci). Semua data fiktif. */
(function () {
  const { ui, PEOPLE, STAFF } = SIM;
  const E = ui.esc;
  const contoh = () => ui.chip('data contoh', 'warning');
  /** Angka dari isian ("36,7" → 36.7); null bila kosong/tidak valid. */
  const num = (v) => { const n = parseFloat(String(v ?? '').replace(',', '.')); return Number.isFinite(n) ? n : null; };
  const dec = (n) => String(n).replace('.', ',');
  const fmt = (n) => Math.round(n).toLocaleString('id-ID');
  /** Tombol yang nonaktif bila `why` terisi, lengkap dengan alasannya. */
  const btnIf = (label, o, why) => ui.btn(label, why ? Object.assign({}, o, { disabled: true, reason: why }) : o);
  const kv = (k, v) => `<div class="row between small" style="padding:5px 0;border-bottom:1px solid var(--line-soft)"><span class="muted">${E(k)}</span><span style="text-align:right">${v}</span></div>`;
  const tile = (label, value, sub, tone) => `<div style="padding:10px 12px;border-radius:10px;border:1px solid ${tone === 'danger' ? 'var(--danger-border)' : tone === 'warning' ? 'var(--warning-border)' : 'var(--line-soft)'};background:${tone === 'danger' ? 'var(--danger-bg)' : tone === 'warning' ? 'var(--warning-bg)' : 'var(--subtle)'}"><div class="small muted">${E(label)}</div><div class="num" style="font-size:18px;font-weight:600;color:${tone === 'danger' ? 'var(--danger)' : tone === 'warning' ? 'var(--warning)' : 'var(--ink-900)'}">${E(value)}</div>${sub ? `<div class="small muted">${E(sub)}</div>` : ''}</div>`;
  const TRI = { 1: ['Resusitasi', 'solid-danger'], 2: ['Emergensi', 'danger'], 3: ['Urgen', 'warning'], 4: ['Semi-urgen', 'success'], 5: ['Tidak urgen', 'info'] };
  const triChip = (n) => (TRI[n] ? ui.chip(`${n} · ${TRI[n][0]}`, TRI[n][1]) : ui.chip('Belum triase', ''));

  /** Skor peringatan dini (NEWS dewasa, disederhanakan) + bendera gula darah. */
  function ews(v) {
    const rr = num(v.rr), sp = num(v.spo2), sys = num(String(v.td || '').split('/')[0]), n = num(v.n), s = num(v.s), g = num(v.gds);
    let score = 0;
    const flags = [];
    const add = (pts, label) => { if (pts) { score += pts; flags.push(`${label} (+${pts})`); } };
    if (rr !== null) add(rr <= 8 ? 3 : rr <= 11 ? 1 : rr <= 20 ? 0 : rr <= 24 ? 2 : 3, `Napas ${rr}/mnt`);
    if (sp !== null) add(sp <= 91 ? 3 : sp <= 93 ? 2 : sp <= 95 ? 1 : 0, `SpO2 ${sp}%`);
    if (sys !== null) add(sys <= 90 ? 3 : sys <= 100 ? 2 : sys <= 110 ? 1 : sys <= 219 ? 0 : 3, `TD sistolik ${sys}`);
    if (n !== null) add(n <= 40 ? 3 : n <= 50 ? 1 : n <= 90 ? 0 : n <= 110 ? 1 : n <= 130 ? 2 : 3, `Nadi ${n}/mnt`);
    if (s !== null) add(s <= 35 ? 3 : s <= 36 ? 1 : s <= 38 ? 0 : s <= 39 ? 1 : 2, `Suhu ${dec(s)} °C`);
    let tone = score >= 5 ? 'danger' : score >= 1 ? 'warning' : 'success';
    if (g !== null && g >= 200) { flags.push(`GDS ${g} mg/dL ≥ 200: hiperglikemia, beri tahu dokter`); if (tone === 'success') tone = 'warning'; }
    if (g !== null && g < 70) { flags.push(`GDS ${g} mg/dL < 70: hipoglikemia`); tone = 'danger'; }
    if (sys !== null && sys >= 140 && sys < 220) flags.push(`TD ${v.td} di atas target (< 140/90)`);
    return { score, flags, tone, name: { success: 'Hijau', warning: 'Kuning', danger: 'Merah' }[tone] };
  }

  /* =====================================================================
   * FASE 3 · Klinis RME
   * ===================================================================== */

  /* ---------- Poli: pemeriksaan rawat jalan (K01, K02, K06, K08) ---------- */
  const ICD = {
    'E11.9': 'Diabetes melitus tipe 2 tanpa komplikasi',
    'E11.65': 'Diabetes melitus tipe 2 dengan hiperglikemia',
    I10: 'Hipertensi esensial (primer)',
    'E78.5': 'Hiperlipidemia, tidak spesifik',
    'N18.3': 'Penyakit ginjal kronik stadium 3',
    'R51': 'Nyeri kepala',
  };
  const POLI_Q = [
    { id: 'siti', no: 'PD-005', name: 'Ny. Siti Rahmawati', meta: 'RM 00-12-45-78 · 54 th · BPJS', status: 'Selesai', tone: 'success', note: 'selesai 08.31', cc: 'Kontrol hipertensi. SOAP sudah ditandatangani.' },
    { id: 'budi', no: 'PD-006', name: 'Tn. Budi Santoso', meta: 'RM 00-09-33-21 · 61 th · BPJS', status: 'Menunggu hasil', tone: 'warning', note: 'lab 25 mnt', cc: 'Kontrol pasca rawat inap gout. Menunggu asam urat dan profil lipid.' },
    { id: 'maria', no: 'PD-008', name: 'Ny. Maria Kristina', meta: 'RM 00-15-02-66 · 38 th · Umum', status: 'Menunggu', tone: '', note: 'tunggu 9 mnt', cc: 'Demam dan nyeri ulu hati 2 hari. Alergi NSAID tercatat.' },
    { id: 'fauzi', no: 'PD-009', name: 'Tn. Ahmad Fauzi', meta: 'RM 00-04-87-10 · 47 th · Asuransi', status: 'Menunggu', tone: '', note: 'tunggu 4 mnt', cc: 'Kontrol dispepsia.' },
  ];

  SIM.register({
    id: 'poli',
    phase: 3,
    title: 'Pemeriksaan poli',
    nav: 'Poli (pemeriksaan)',
    codes: 'K01 · K02 · K06 · K08',
    role: 'dokter',
    desc: 'Worklist Poli Penyakit Dalam: tanda vital dari perawat dengan peringatan dini, SOAP/CPPT dokter, diagnosis ICD-10, lalu tanda tangan.',
    hint: 'Pilih Tn. Suryo, simpan tanda vital (GDS 286 memicu peringatan kuning), lengkapi SOAP + ICD-10, lalu tanda tangani.',
    init: {
      sel: 'suryo', ttvAt: '', td: '148/92', n: '88', rr: '18', s: '36,7', spo2: '98', gds: '286',
      S: 'Kontrol rutin DM. Sering haus dan buang air kecil malam 2 minggu terakhir. Obat diminum teratur, pusing ringan.',
      O: '', Pl: 'Cek HbA1c, GDP, profil lipid, kreatinin. Tambah glimepirid 2 mg pagi; amlodipin naik ke 10 mg. Edukasi diet DM dan tanda hipoglikemia. Kontrol 4 minggu.',
      dx: ['E11.9', 'I10'], pick: 'E78.5', savedAt: '', signedAt: '',
    },
    render(L, J) {
      const P = PEOPLE.suryo;
      const called = J.called ? `dipanggil ${J.called.t || ''} · ${J.called.room || 'Poli PD 2'}` : 'dipanggil (contoh)';
      const sStatus = L.signedAt ? ['Selesai', 'success', `selesai ${L.signedAt}`] : ['Diperiksa', 'brand', called];
      const ticket = J.called && J.called.ticket ? J.called.ticket : 'PD-007';
      const rows = POLI_Q.slice(0, 2).concat([{ id: 'suryo', no: ticket, name: P.name, meta: `RM ${P.rm} · ${P.age} th · BPJS`, status: sStatus[0], tone: sStatus[1], note: sStatus[2] }], POLI_Q.slice(2));
      const list = ui.list(rows.map((r) => ({
        arg: r.id, sel: L.sel === r.id, title: `${r.no} · ${r.name}`, sub: r.meta,
        right: `${ui.chip(r.status, r.tone)}<span class="small muted">${E(r.note)}</span>`,
      })), 'pilih');
      const left = ui.card({ title: 'Antrean poli hari ini', sub: `${P.poli} · ${STAFF.dokter.name}`, flush: true, body: list + `<div class="cb small muted">${J.called ? 'Urutan dari kendali antrean.' : `Belum ada panggilan dari kendali antrean ${contoh()}`}</div>` });

      if (L.sel !== 'suryo') {
        const o = POLI_Q.find((x) => x.id === L.sel) || POLI_Q[0];
        return ui.split(left, `<div class="stack">${ui.card({ title: o.name, sub: `${o.no} · ${o.meta}`, body: `<p style="margin:0 0 10px">${E(o.cc)}</p>${ui.alert('info', 'Pasien contoh di luar tur', 'Tur alur mengikuti Tn. Suryo. Pasien ini hanya pengisi antrean.')}<div style="margin-top:10px">${ui.btn('Kembali ke Tn. Suryo', { act: 'pilih', arg: 'suryo', variant: 'primary' })}</div>` })}</div>`);
      }

      const enc = J.encounter ? J.encounter.no : 'RJ-261005-0042';
      const extra = `${ui.chip(`Kunjungan ${enc}`, 'brand')}${J.encounter ? '' : contoh()}${J.sep ? ui.chip(`SEP ${J.sep.status === 'issued' ? 'terbit' : 'menunggu'}`, J.sep.status === 'issued' ? 'success' : 'warning') : ''}`;
      const idx = J.orders && L.signedAt ? 4 : L.signedAt ? 3 : L.ttvAt ? 1 : 0;
      const hist = `<div class="grid g3">
        <div class="stack" style="gap:4px"><span class="label">Riwayat</span><span class="small">${E(P.history)}</span><span class="small muted">Kunjungan terakhir 6 Jul 2026 · Poli PD · E11.9, I10</span></div>
        <div class="stack" style="gap:4px"><span class="label">Obat aktif</span><span class="small">Metformin 500 mg · 2×1 · sejak 2018</span><span class="small">Amlodipin 5 mg · 1×1 pagi · sejak 2024</span><span class="small muted">Glimepirid dihentikan Mar 2025 (hipoglikemia berat)</span></div>
        <div class="stack" style="gap:4px"><span class="label">Lab terakhir · 6 Jul 2026</span><span class="small">HbA1c <b class="num" style="color:var(--danger)">7,9 % H</b> · rujukan &lt; 5,7</span><span class="small">GDP <b class="num" style="color:var(--danger)">168 mg/dL H</b></span><span class="small">Kreatinin <b class="num">1,0 mg/dL</b> · eGFR 78</span></div></div>`;

      // Tanda vital (diisi perawat)
      const w = ews(L);
      let ttv;
      if (!L.ttvAt) {
        const f = (k, label, help) => ui.field(label, ui.input(k, L[k], { mono: true, rerender: true }), help, `f-${k}`);
        ttv = `<div class="grid g3">${f('td', 'Tekanan darah (mmHg)')}${f('n', 'Nadi (x/mnt)')}${f('rr', 'Napas (x/mnt)')}${f('s', 'Suhu (°C)')}${f('spo2', 'SpO2 (%)')}${f('gds', 'GDS (mg/dL)', 'Glukometer di poli')}</div>
          <div class="row between" style="margin-top:12px"><span class="small muted">Diisi ${E(STAFF.perawat.name)} (perawat poli). Skor peringatan dini dihitung saat disimpan.</span>${ui.btn('Simpan tanda vital', { act: 'simpanTtv', variant: 'primary' })}</div>`;
      } else {
        ttv = `<div class="grid g3">${tile('Tekanan darah', `${L.td}`, 'mmHg', num(String(L.td).split('/')[0]) >= 140 ? 'warning' : '')}${tile('Nadi', L.n, 'x/mnt')}${tile('Napas', L.rr, 'x/mnt')}${tile('Suhu', L.s, '°C')}${tile('SpO2', L.spo2, '%')}${tile('GDS', L.gds, 'mg/dL', num(L.gds) >= 200 ? 'warning' : '')}</div>
          <div style="margin-top:12px">${ui.alert(w.tone === 'success' ? 'success' : w.tone, `Peringatan dini ${w.name} · skor ${w.score}`, E(w.flags.length ? w.flags.join(' · ') : 'Semua parameter dalam batas.'))}</div>`;
      }
      const ttvCard = ui.card({ title: 'Tanda vital', sub: L.ttvAt ? `Diukur ${STAFF.perawat.name} · ${L.ttvAt}` : 'Belum diukur hari ini', actions: L.ttvAt ? ui.chip(`EWS ${w.name}`, w.tone) : '', tone: L.ttvAt && w.tone !== 'success' ? 'warning' : '', body: ttv });

      // SOAP / CPPT
      let soap;
      if (L.signedAt) {
        soap = `<div class="stack">${kv('S · Subjektif', E(L.S))}${kv('O · Objektif', E(L.O))}${kv('A · Asesmen', L.dx.map((c, i) => `<span class="mono">${E(c)}</span> ${E(ICD[c] || '')}${i === 0 ? ' (utama)' : ''}`).join('<br>'))}${kv('P · Rencana', E(L.Pl))}
          ${ui.alert('success', `Tersimpan · ditandatangani ${L.signedAt}`, `${E(STAFF.dokter.name)} · versi final. Koreksi hanya lewat addendum berversi.`)}
          <div class="row">${ui.btn('Buka CPOE: order dan resep', { go: 'cpoe', variant: 'primary' })}</div>
          ${ui.next('cpoe', `SOAP Tn. Suryo dengan diagnosis ${L.dx.join(', ')} ditandatangani ${L.signedAt}`)}</div>`;
      } else {
        const dxList = L.dx.length ? L.dx.map((c, i) => `<div class="row between" style="padding:6px 10px;border:1px solid ${i === 0 ? 'var(--brand-200)' : 'var(--line)'};border-radius:10px;background:${i === 0 ? 'var(--selected)' : 'var(--card)'}"><span><b class="mono">${E(c)}</b> ${E(ICD[c] || '')}${i === 0 ? ' · utama' : ''}</span>${ui.btn('Hapus', { act: 'hapusDx', arg: c, size: 'sm', variant: 'ghost' })}</div>`).join('')
          : ui.alert('warning', 'Belum ada diagnosis', 'Minimal satu diagnosis ICD-10 wajib diisi sebelum tanda tangan.');
        const why = !L.ttvAt ? 'Tanda vital belum disimpan perawat.' : !L.dx.length ? 'Isi minimal satu diagnosis ICD-10.' : '';
        soap = `<div class="stack">
          ${ui.field('S · Subjektif', ui.input('S', L.S, { area: true }), '', 'f-S')}
          ${ui.field('O · Objektif', ui.input('O', L.O, { area: true, placeholder: 'Terisi otomatis dari tanda vital setelah disimpan' }), '', 'f-O')}
          <div class="field"><label>A · Asesmen (ICD-10)</label><div class="stack" style="gap:6px">${dxList}</div>
            <div class="row" style="margin-top:6px"><div style="flex:1;min-width:200px">${ui.select('pick', L.pick, Object.keys(ICD).map((c) => ({ value: c, label: `${c} · ${ICD[c]}` })))}</div>${ui.btn('+ Tambah diagnosis', { act: 'tambahDx' })}</div></div>
          ${ui.field('P · Rencana', ui.input('Pl', L.Pl, { area: true }), 'Order penunjang dan resep ditulis di CPOE.', 'f-Pl')}
          ${L.dx.includes('E11.9') && num(L.gds) >= 200 ? ui.alert('info', 'Saran klinis', 'GDS 286 mg/dL pada DM tipe 2: pertimbangkan kode E11.65 (dengan hiperglikemia) dan cek HbA1c.') : ''}
          <div class="row between"><span class="small muted">Penulis: ${E(STAFF.dokter.name)} · ${L.savedAt ? `draf disimpan ${E(L.savedAt)}` : 'versi 1 (draf)'} · setiap perubahan tercatat</span>
            <div class="row">${ui.btn('Simpan draf', { act: 'draf' })}${btnIf('Tanda tangani SOAP', { act: 'ttd', variant: 'primary' }, why)}</div></div></div>`;
      }
      const soapCard = ui.card({ title: 'CPPT · SOAP dokter', sub: L.signedAt ? `Final · ${L.signedAt}` : 'Draf', actions: L.signedAt ? ui.chip('Ditandatangani', 'success') : ui.btn('CPOE', { go: 'cpoe', size: 'sm' }), body: soap });

      return ui.split(left, `<div class="stack">${ui.banner(P, extra)}${ui.steps(['Tanda vital (perawat)', 'SOAP + ICD-10', 'Tanda tangan', 'Order CPOE'], idx)}
        ${ui.card({ title: 'Ringkasan riwayat', sub: 'dihimpun dari kunjungan sebelumnya', body: hist })}${ttvCard}${soapCard}</div>`);
    },
    actions: {
      pilih(L, J, el) { L.sel = el.dataset.arg || 'suryo'; },
      simpanTtv(L) {
        if (L.ttvAt) return false;
        if (num(L.n) === null || num(L.rr) === null || num(L.spo2) === null || !String(L.td || '').includes('/')) { SIM.toast('Lengkapi tanda vital: TD (mis. 148/92), nadi, napas, SpO2.', 'warning'); return; }
        L.ttvAt = SIM.now(3);
        if (!String(L.O || '').trim()) L.O = `TD ${L.td} mmHg, N ${L.n}/mnt, RR ${L.rr}/mnt, S ${L.s} °C, SpO2 ${L.spo2}%, GDS ${L.gds} mg/dL. Kompos mentis. Kaki: sensasi monofilamen baik, tidak ada luka.`;
        const w = ews(L);
        SIM.note(`Tanda vital Tn. Suryo disimpan perawat · EWS ${w.name}${num(L.gds) >= 200 ? ` (GDS ${L.gds})` : ''}`, w.tone === 'success' ? 'success' : 'warning');
        if (w.tone !== 'success') SIM.toast(`Peringatan ${w.name}: dokter diberi tahu`, 'warning');
      },
      tambahDx(L) {
        if (L.signedAt) return false;
        if (!L.pick || !ICD[L.pick]) return false;
        if (L.dx.includes(L.pick)) { SIM.toast(`${L.pick} sudah ada di daftar diagnosis`, 'warning'); return; }
        L.dx.push(L.pick);
      },
      hapusDx(L, J, el) { if (!L.signedAt) L.dx = L.dx.filter((c) => c !== el.dataset.arg); },
      draf(L) { if (!L.signedAt) { L.savedAt = SIM.now(1); SIM.toast(`Draf SOAP disimpan ${L.savedAt}`, 'success'); } },
      ttd(L, J) {
        if (L.signedAt) return false;
        if (!L.ttvAt || !L.dx.length || !String(L.S || '').trim()) { SIM.toast('Belum bisa ditandatangani: tanda vital, S, dan diagnosis wajib ada.', 'warning'); return; }
        L.signedAt = SIM.now(4);
        J.soap = {
          s: L.S, o: L.O, a: L.dx.map((c) => `${c} ${ICD[c] || ''}`.trim()).join('; '), p: L.Pl,
          ttv: { td: L.td, n: num(L.n), rr: num(L.rr), s: num(L.s), spo2: num(L.spo2), gds: num(L.gds) },
        };
        SIM.note(`SOAP Tn. Suryo ditandatangani DPJP · ${L.dx.join(', ')}`, 'success');
        SIM.done();
      },
    },
  });

  /* ---------- CPOE: order, resep, dan CDS (K09) ---------- */
  const METF = {
    '500x2': { label: '500 mg · 2 × 1 sesudah makan (1.000 mg/hari)', sig: '500 mg 2 × 1 sesudah makan', qty: 60, daily: 1000 },
    '850x3': { label: '850 mg · 3 × 1 sesudah makan (2.550 mg/hari)', sig: '850 mg 3 × 1 sesudah makan', qty: 90, daily: 2550 },
    '1000x3': { label: '1.000 mg · 3 × 1 sesudah makan (3.000 mg/hari)', sig: '1.000 mg 3 × 1 sesudah makan', qty: 90, daily: 3000 },
  };
  const CAT = {
    hba1c: { kind: 'lab', code: 'HBA1C', name: 'HbA1c', detail: 'Lab PK · evaluasi kontrol glikemik 3 bulan', price: 95000, cds: 'Terakhir 6 Jul 2026 (7,9 %). Diulang ≥ 3 bulan sesuai PPK.' },
    gdp: { kind: 'lab', code: 'GDP', name: 'Glukosa darah puasa', detail: 'Lab PK · puasa 8–10 jam', price: 25000, cds: 'Tidak ada duplikasi dalam 1 bulan.' },
    lipid: { kind: 'lab', code: 'LIPID', name: 'Profil lipid', detail: 'Kolesterol total, LDL, HDL, trigliserida · puasa 10 jam', price: 120000, cds: 'Tidak ada duplikasi dalam 6 bulan.' },
    kreat: { kind: 'lab', code: 'KREAT', name: 'Kreatinin serum', detail: 'Pemantauan fungsi ginjal pada terapi metformin', price: 45000, cds: 'eGFR terakhir 78 · pemantauan rutin.' },
    gds: { kind: 'lab', code: 'GDS', name: 'Glukosa darah sewaktu', detail: 'Lab PK · sampel vena', price: 20000, warn: 'gds', cds: 'Duplikasi: GDS sudah diukur hari ini di poli (286 mg/dL, glukometer).' },
    toraks: { kind: 'rad', code: 'RO-TORAKS', name: 'Foto toraks PA', detail: 'Radiologi · posisi tegak · ICD-9-CM 87.44', price: 150000, cds: 'Tidak ada foto toraks dalam 30 hari.' },
    dl: { kind: 'lab', code: 'DL', name: 'Darah lengkap', detail: 'Hb, leukosit, hitung jenis, trombosit', price: 65000, cds: 'Pra-operasi elektif.' },
    ptt: { kind: 'lab', code: 'PT-APTT', name: 'PT / APTT', detail: 'Skrining hemostasis pra-operasi', price: 110000, cds: 'Tidak ada duplikasi dalam 1 bulan.' },
    metf: { kind: 'obat', name: 'Metformin 500 mg tablet', unit: 300, cds: 'eGFR 78: dosis aman.' },
    glim: { kind: 'obat', name: 'Glimepirid 2 mg tablet', sig: '1 × 1 sebelum makan pagi', qty: 30, unit: 700, warn: 'glim', cds: 'Kombinasi dengan metformin + riwayat hipoglikemia berat Mar 2025 saat glimepirid: risiko hipoglikemia tinggi. Mulai dosis terendah, edukasi tanda hipoglikemia.' },
    amlo: { kind: 'obat', name: 'Amlodipin 10 mg tablet', sig: '1 × 1 pagi', qty: 30, unit: 500, cds: 'Dosis naik dari 5 mg. Pantau edema tungkai dan TD 2 minggu.' },
    amox: { kind: 'obat', name: 'Amoksisilin 500 mg kapsul', sig: '3 × 1 · 5 hari', qty: 15, unit: 600, allergy: true, cds: '' },
    klin: { kind: 'obat', name: 'Klindamisin 300 mg kapsul', sig: '3 × 1 · 5 hari', qty: 15, unit: 1500, cds: 'Bukan beta-laktam: aman dengan alergi amoksisilin.' },
  };
  const CAT_FOR = { suryo: ['hba1c', 'gdp', 'lipid', 'kreat', 'gds', 'toraks', 'metf', 'glim', 'amlo'], ratna: ['dl', 'ptt', 'toraks', 'amox', 'klin'] };
  const SET_DM = ['hba1c', 'gdp', 'lipid', 'kreat', 'metf', 'glim', 'amlo'];
  /** Satu baris order dengan sig/qty/nilai baris (Rp) yang sudah dihitung. */
  function cpoeLine(id, L) {
    const c = CAT[id];
    if (c.kind !== 'obat') return Object.assign({ id }, c);
    if (id === 'metf') { const d = METF[L.metfDose] || METF['500x2']; return Object.assign({ id }, c, { sig: d.sig, qty: d.qty, price: d.qty * c.unit, daily: d.daily }); }
    return Object.assign({ id }, c, { price: c.qty * c.unit });
  }

  SIM.register({
    id: 'cpoe',
    phase: 3,
    title: 'CPOE · order dan resep',
    nav: 'CPOE',
    codes: 'K09',
    role: 'dokter',
    desc: 'Order lab, radiologi, dan resep elektronik dengan pemeriksaan klinis otomatis: alergi, interaksi, duplikasi, dan batas dosis.',
    hint: 'Tanggapi peringatan glimepirid, coba naikkan dosis metformin ke 3.000 mg/hari (gerbang), lalu kirim order.',
    init: { pt: 'suryo', ls: SET_DM.slice(), lr: ['dl', 'ptt', 'amox'], metfDose: '500x2', doseOv: '', doseReason: '', ackGlim: '', ackGds: '', amoxOv: '', allergyReason: '', sentAt: '', note: '' },
    onChange(key, L) { if (key === 'metfDose') L.doseOv = ''; },
    render(L, J) {
      const ratna = L.pt === 'ratna';
      const P = ratna ? PEOPLE.ratna : PEOPLE.suryo;
      const ids = ratna ? L.lr : L.ls;
      const sent = !ratna && !!L.sentAt;
      const lines = ids.map((id) => cpoeLine(id, L));
      const issues = [];
      lines.forEach((x) => {
        if (x.id === 'metf' && x.daily > 2550 && !L.doseOv) issues.push('dosis metformin melebihi batas harian');
        if (x.warn === 'glim' && !L.ackGlim) issues.push('peringatan risiko hipoglikemia belum ditanggapi');
        if (x.warn === 'gds' && !L.ackGds) issues.push('duplikasi GDS belum ditanggapi');
        if (x.allergy && !L.amoxOv) issues.push('resep diblokir karena alergi');
      });
      const extra = `${ui.chip(`BB ${ratna ? '58' : '74'} kg · eGFR ${ratna ? '96' : '78'}`, '')}${!ratna && !J.soap ? contoh() : ''}`;
      const switcher = `<div class="row between">${ui.seg('pt', L.pt, [{ value: 'suryo', label: 'Tn. Suryo (tur)' }, { value: 'ratna', label: 'Ny. Ratna (contoh alergi)' }])}<span class="small muted">${ratna ? 'Contoh pemeriksaan alergi; order tur tetap untuk Tn. Suryo.' : J.soap ? `Dari SOAP: ${E(J.soap.a)}` : 'Diagnosis contoh: E11.9, I10'}</span></div>`;

      const catalog = sent ? '<span class="small muted">Order sudah dikirim; katalog dikunci.</span>' : (CAT_FOR[L.pt] || []).map((id) => ui.btn(`+ ${CAT[id].name}`, { act: 'tambah', arg: id, size: 'sm' })).join(' ');
      const left = ui.card({
        title: 'Katalog dan order set', sub: 'Fornas · katalog lab/radiologi RS',
        body: `<div class="stack">${!ratna ? `<div style="padding:10px 12px;border:1px solid var(--brand-100);border-radius:10px;background:var(--selected)"><b>Kontrol hipertensi + DM tipe 2</b><div class="small muted">7 item · PPK Penyakit Dalam 2026 · clinical pathway</div><div style="margin-top:8px">${btnIf('Terapkan order set', { act: 'orderSet', size: 'sm' }, sent ? 'Order sudah dikirim.' : '')}</div></div>` : ''}
          <div class="row">${catalog}</div>
          ${L.note ? ui.alert('info', L.note) : ''}
          <span class="small muted">Duplikasi dicegah otomatis. Item di luar paket INA-CBG ditandai.</span></div>`,
      });

      const group = (kind, title, dest) => {
        const g = lines.filter((x) => x.kind === kind);
        if (!g.length) return '';
        return `<div class="stack" style="gap:8px"><div class="row between"><span class="label">${E(title)}</span><span class="small muted">${E(dest)}</span></div>${g.map((x) => {
          let cds;
          if (x.allergy) {
            cds = L.amoxOv ? ui.alert('warning', 'Override alergi tercatat', `Alasan: ${E(L.amoxOv)} · ${E(STAFF.dokter.name)}`)
              : ui.gate({ title: 'Diblokir: alergi amoksisilin tercatat (ruam)', body: 'Pasien punya riwayat alergi amoksisilin. Pilih antibiotik non-beta-laktam, atau override dengan alasan klinis yang tercatat dan ditinjau.', follow: { label: 'Ganti klindamisin 300 mg', act: 'gantiAlergi' }, override: { label: 'Override alergi', act: 'overrideAlergi' }, reasonKey: 'allergyReason', reasonValue: L.allergyReason });
          } else if (x.id === 'metf' && x.daily > 2550) {
            cds = L.doseOv ? ui.alert('warning', `Override dosis tercatat · ${fmt(x.daily)} mg/hari`, `Alasan: ${E(L.doseOv)}`)
              : ui.gate({ title: `Dosis melebihi batas: metformin ${fmt(x.daily)} mg/hari`, body: 'Batas harian metformin 2.550 mg. Dosis ini meningkatkan risiko asidosis laktat dan efek samping saluran cerna.', follow: { label: 'Kembalikan ke 500 mg 2 × 1', act: 'ikutDosis' }, override: { label: 'Override dosis', act: 'overrideDosis' }, reasonKey: 'doseReason', reasonValue: L.doseReason });
          } else if (x.warn === 'glim') {
            cds = L.ackGlim ? ui.alert('success', `Peringatan ditanggapi ${L.ackGlim}`, 'Edukasi hipoglikemia masuk instruksi farmasi.') : `${ui.alert('warning', 'Interaksi / risiko hipoglikemia', E(x.cds))}<div style="margin-top:6px">${ui.btn('Sudah dipertimbangkan · lanjutkan', { act: 'ack', arg: 'glim', size: 'sm' })}</div>`;
          } else if (x.warn === 'gds') {
            cds = L.ackGds ? ui.alert('success', `Duplikasi dikonfirmasi ${L.ackGds}`, 'Diperlukan pembanding vena.') : `${ui.alert('warning', 'Duplikasi pemeriksaan', E(x.cds))}<div class="row" style="margin-top:6px">${ui.btn('Hapus GDS', { act: 'hapus', arg: 'gds', size: 'sm' })}${ui.btn('Tetap order', { act: 'ack', arg: 'gds', size: 'sm' })}</div>`;
          } else cds = `<span class="small" style="color:var(--success)">✓ ${E(x.cds)}</span>`;
          const status = sent ? ui.chip(x.kind === 'lab' ? 'Diterima lab · menunggu sampel' : x.kind === 'rad' ? 'Masuk worklist radiologi' : 'Antrean telaah farmasi', 'success') : '';
          const dose = x.id === 'metf' && !sent ? `<div style="max-width:420px;margin-top:6px">${ui.select('metfDose', L.metfDose, Object.keys(METF).map((k) => ({ value: k, label: METF[k].label })))}</div>` : '';
          return `<div style="padding:10px 12px;border:1px solid var(--line);border-radius:10px"><div class="row between"><div><b>${E(x.name)}</b> <span class="small muted">${E(x.kind === 'obat' ? `${x.sig} · ${x.qty} ${x.name.includes('kapsul') ? 'kapsul' : 'tablet'}` : x.detail)}</span></div><div class="row"><span class="num small">${ui.rupiah(x.price)}</span>${sent ? status : ui.btn('Hapus', { act: 'hapus', arg: x.id, size: 'sm', variant: 'ghost' })}</div></div>${dose}<div style="margin-top:6px">${cds}</div></div>`;
        }).join('')}</div>`;
      };
      const total = lines.reduce((a, b) => a + b.price, 0);
      const why = ratna ? 'Contoh pemeriksaan alergi saja; order tur dikirim untuk Tn. Suryo.' : !lines.length ? 'Belum ada order.' : issues.length ? `Selesaikan dulu: ${issues.join('; ')}.` : '';
      const checks = [
        ['Alergi', lines.some((x) => x.allergy) ? (L.amoxOv ? 'override beralasan' : 'diblokir') : 'tidak ada konflik', lines.some((x) => x.allergy && !L.amoxOv)],
        ['Interaksi', lines.some((x) => x.warn === 'glim') ? (L.ackGlim ? 'ditanggapi' : '1 peringatan') : 'tidak ada', lines.some((x) => x.warn === 'glim' && !L.ackGlim)],
        ['Duplikasi', lines.some((x) => x.warn === 'gds') ? (L.ackGds ? 'dikonfirmasi' : '1 duplikasi') : 'tidak ada', lines.some((x) => x.warn === 'gds' && !L.ackGds)],
        ['Batas dosis', lines.some((x) => x.daily > 2550) ? (L.doseOv ? 'override beralasan' : 'melebihi batas') : 'sesuai', lines.some((x) => x.daily > 2550 && !L.doseOv)],
      ].map(([k, v, bad]) => kv(k, ui.chip(v, bad ? 'danger' : 'success'))).join('');
      const right = ui.card({
        title: `Daftar order · ${P.short}`, sub: sent ? `Terkirim ${L.sentAt}` : `${lines.length} item`, actions: sent ? ui.chip(`Order terkirim · ${L.sentAt}`, 'success') : '',
        body: `<div class="stack">${lines.length ? group('lab', 'Laboratorium', 'Lab PK · sampel hari ini') + group('rad', 'Radiologi', 'Jadwal hari ini') + group('obat', 'Resep', 'Farmasi rawat jalan · 30 hari') : ui.empty('Belum ada order. Pilih dari katalog atau terapkan order set.')}
          <hr class="sep"><div class="grid g2"><div><span class="label">Pemeriksaan sebelum kirim</span>${checks}</div><div class="stack" style="gap:4px"><span class="label">Estimasi nilai order</span><span class="num" style="font-size:20px;font-weight:600">${ui.rupiah(total)}</span><span class="small muted">${ratna ? 'BPJS Kelas 2' : 'Masuk paket INA-CBG rawat jalan (BPJS)'} · biaya tercatat otomatis</span></div></div>
          ${sent ? ui.next('lab', `${lines.filter((x) => x.kind !== 'obat').length} order penunjang dan ${lines.filter((x) => x.kind === 'obat').length} resep terkirim ${L.sentAt}`) : `<div class="row between"><span class="small muted">Ditandatangani ${E(STAFF.dokter.name)} dengan TTE saat dikirim.</span>${btnIf(`Tanda tangani dan kirim ${lines.length} order`, { act: 'kirim', variant: 'primary' }, why)}</div>`}</div>`,
      });
      return `${ui.banner(P, extra)}${switcher}<div class="split">${left}${right}</div>`;
    },
    actions: {
      tambah(L, J, el) {
        const id = el.dataset.arg;
        if (!CAT[id] || (L.pt !== 'ratna' && L.sentAt)) return false;
        const list = L.pt === 'ratna' ? L.lr : L.ls;
        if (list.includes(id)) { L.note = `${CAT[id].name} sudah ada di daftar (duplikasi dicegah).`; return; }
        list.push(id);
        L.note = `Ditambahkan: ${CAT[id].name}.`;
      },
      hapus(L, J, el) {
        const id = el.dataset.arg;
        if (!CAT[id] || (L.pt !== 'ratna' && L.sentAt)) return false;
        if (L.pt === 'ratna') L.lr = L.lr.filter((x) => x !== id); else L.ls = L.ls.filter((x) => x !== id);
        L.note = `Dihapus: ${CAT[id].name}.`;
      },
      orderSet(L) {
        if (L.sentAt) return false;
        const add = SET_DM.filter((id) => !L.ls.includes(id));
        L.ls = L.ls.concat(add);
        L.pt = 'suryo';
        L.note = `Order set diterapkan: ${add.length} item ditambahkan${SET_DM.length - add.length ? `, ${SET_DM.length - add.length} sudah ada (duplikasi dicegah)` : ''}.`;
      },
      ack(L, J, el) {
        const t = SIM.now(1);
        if (el.dataset.arg === 'gds') L.ackGds = t; else L.ackGlim = t;
      },
      ikutDosis(L) { L.metfDose = '500x2'; L.doseOv = ''; L.doseReason = ''; SIM.toast('Dosis metformin kembali ke 500 mg 2 × 1', 'success'); },
      overrideDosis(L) {
        const r = String(L.doseReason || '').trim();
        if (r.length < 10) { SIM.toast('Tulis alasan klinis minimal 10 huruf.', 'warning'); return; }
        L.doseOv = r;
        SIM.note(`Override batas dosis metformin oleh DPJP · alasan tercatat`, 'warning');
      },
      gantiAlergi(L) { L.lr = L.lr.map((x) => (x === 'amox' ? 'klin' : x)).filter((x, i, a) => a.indexOf(x) === i); L.amoxOv = ''; L.note = 'Amoksisilin diganti klindamisin 300 mg.'; },
      overrideAlergi(L) {
        const r = String(L.allergyReason || '').trim();
        if (r.length < 10) { SIM.toast('Tulis alasan klinis minimal 10 huruf.', 'warning'); return; }
        L.amoxOv = r;
        SIM.note('Override alergi amoksisilin (Ny. Ratna) tercatat untuk ditinjau', 'warning');
      },
      kirim(L, J) {
        if (L.pt === 'ratna' || L.sentAt) return false;
        const lines = L.ls.map((id) => cpoeLine(id, L));
        const blocked = lines.some((x) => (x.id === 'metf' && x.daily > 2550 && !L.doseOv) || (x.warn === 'glim' && !L.ackGlim) || (x.warn === 'gds' && !L.ackGds));
        if (!lines.length || blocked) { SIM.toast('Masih ada peringatan klinis yang belum ditanggapi.', 'warning'); return; }
        L.sentAt = SIM.now(3);
        L.note = '';
        J.orders = lines.filter((x) => x.kind !== 'obat').map((x) => ({ kind: x.kind, code: x.code, name: x.name, price: x.price }));
        J.rx = lines.filter((x) => x.kind === 'obat').map((x) => ({ name: x.name.replace(/ (tablet|kapsul)$/, ''), sig: x.sig, qty: x.qty, price: x.price }));
        SIM.note(`CPOE Tn. Suryo: ${J.orders.length} order penunjang + ${J.rx.length} resep dikirim ke lab, radiologi, dan farmasi`, 'success');
        SIM.done();
      },
    },
  });

  /* ---------- IGD: papan pelacakan + triase (K03) ---------- */
  const IGD_BASE = [
    { id: 'sulastri', bed: 'B3', name: 'Ny. Sulastri', meta: 'P · 72 th · BPJS', lv: 2, cc: 'Sesak napas, SpO2 89%', doc: 'dr. Maya K.', lama: '01.35', status: 'Tunggu lab' },
    { id: 'endang', bed: 'B8', name: 'Ny. Endang', meta: 'P · 61 th · BPJS', lv: 3, cc: 'Gula darah 412 mg/dL', doc: 'dr. Maya K.', lama: '02.15', status: 'Tunggu lab' },
    { id: 'rafa', bed: 'B4', name: 'An. Rafa', meta: 'L · 4 th · BPJS', lv: 3, cc: 'Demam 3 hari, muntah', doc: 'dr. Rudi', lama: '00.55', status: 'Observasi' },
    { id: 'wahyu', bed: 'B5', name: 'Tn. Wahyu', meta: 'L · 45 th · Umum', lv: 3, cc: 'Nyeri perut kanan bawah', doc: 'dr. Rudi', lama: '04.40', status: 'Tunggu bed ranap' },
    { id: 'putri', bed: 'B6', name: 'Nn. Putri', meta: 'P · 22 th · Asuransi', lv: 4, cc: 'Luka robek telapak tangan', doc: 'dr. Rudi', lama: '00.40', status: 'Pemeriksaan' },
    { id: 'gilang', bed: 'K1', name: 'Tn. Gilang', meta: 'L · 30 th · Umum', lv: 5, cc: 'Batuk pilek 5 hari', doc: 'dr. Rudi', lama: '01.10', status: 'Siap pulang' },
  ];
  const IGD_ASES = ['Oksigen nasal 3 lpm, target SpO2 ≥ 94%', 'Kultur darah 2 set diambil sebelum antibiotik', 'Ceftriaxone 2 g IV dosis pertama diberikan', 'Foto toraks portabel: infiltrat lobus kanan bawah'];

  SIM.register({
    id: 'igd',
    phase: 3,
    title: 'Instalasi Gawat Darurat',
    nav: 'IGD',
    codes: 'K03 · K05',
    role: 'dokterigd',
    desc: 'Papan pelacakan IGD per level triase, triase dengan saran sistem, asesmen cepat, dan keputusan rawat inap.',
    hint: 'Triase Tn. Hartono (saran sistem level 2), centang asesmen cepat, putuskan rawat inap, lalu minta tempat tidur.',
    init: { sel: 'hartono', lv: '', lvReason: '', lvSaved: 0, triT: '', a0: false, a1: false, a2: false, a3: false, asT: '', disp: 'ranap', bedReq: '', tnx: '' },
    render(L, J) {
      const H = PEOPLE.hartono;
      const hStatus = L.bedReq ? 'Tunggu bed ranap' : L.asT ? 'Keputusan' : L.triT ? 'Pemeriksaan' : 'Baru tiba · triase';
      const rows = [{ id: 'hartono', bed: 'R2', name: H.name, meta: `L · ${H.age} th · BPJS`, lv: L.lvSaved, cc: 'Demam 4 hari, batuk berdahak, sesak', doc: 'dr. Maya K.', lama: L.triT ? '00.18' : '00.04', status: hStatus }];
      if (L.tnx) rows.unshift({ id: 'tnx', bed: 'R1', name: 'Tn. X (tanpa identitas)', meta: 'L · ±40 th · KLL', lv: 1, cc: 'Penurunan kesadaran, GCS 8', doc: 'dr. Maya K. + tim', lama: '00.02', status: 'Resusitasi aktif' });
      const all = rows.concat(IGD_BASE);
      const lvCount = [1, 2, 3, 4, 5].map((n) => all.filter((r) => r.lv === n).length);
      const kpis = `<div class="grid g4">${ui.kpi('Pasien di IGD', `${all.length}`, `${all.length} / 14 bed terpakai`)}${ui.kpi('Triase 1–2', `${lvCount[0] + lvCount[1]}`, 'dokter ≤ 10 menit', lvCount[0] ? 'down' : '')}${ui.kpi('Menunggu bed ranap', `${all.filter((r) => r.status === 'Tunggu bed ranap').length}`, 'boarding > 4 jam: 1', 'down')}${ui.kpi('Ambulans menuju', '2', 'SISRUTE')}</div>`;
      const legend = `<div class="row">${[1, 2, 3, 4, 5].map((n) => `${triChip(n)}<span class="small muted" style="margin-right:6px">${lvCount[n - 1]}</span>`).join('')}</div>`;
      const sortRows = all.slice().sort((a, b) => (a.lv || 0.5) - (b.lv || 0.5));
      const table = ui.table(['Bed', 'Pasien', 'Triase', 'Keluhan utama', 'Dokter', { label: 'Lama', r: true }, 'Status'],
        sortRows.map((r) => [`<b class="mono">${E(r.bed)}</b>`, `<b>${E(r.name)}</b><div class="small muted">${E(r.meta)}</div>`, triChip(r.lv), E(r.cc), E(r.doc), E(r.lama), ui.chip(r.status, /Resusitasi/.test(r.status) ? 'danger' : /Tunggu/.test(r.status) ? 'warning' : /Siap/.test(r.status) ? 'success' : '')]),
        { act: 'pilih', rowArgs: sortRows.map((r) => r.id), sel: sortRows.findIndex((r) => r.id === L.sel) });
      const board = ui.card({ title: 'Papan pelacakan', sub: 'urut level triase · klik baris untuk detail', actions: L.tnx ? ui.chip(`Tn. X terdaftar ${L.tnx}`, 'info') : ui.btn('Daftarkan pasien tanpa identitas', { act: 'tnx', size: 'sm' }), flush: true, body: `<div class="cb">${legend}</div>${table}` });

      let detail;
      if (L.sel === 'hartono') {
        const vit = `<div class="grid g3">${tile('TD', '158/94', 'mmHg', 'warning')}${tile('Nadi', '112', 'x/mnt', 'warning')}${tile('Napas', '28', 'x/mnt', 'danger')}${tile('SpO2', '90%', 'udara bebas', 'danger')}${tile('Suhu', '38,9', '°C', 'warning')}${tile('GCS', '15', 'kompos mentis')}</div>`;
        const idx = L.bedReq ? 4 : L.asT ? 2 : L.triT ? 1 : 0;
        let body;
        if (!L.triT) {
          const lv = Number(L.lv) || 0;
          const under = lv > 2;
          body = `${vit}<div style="margin-top:12px">${ui.alert('danger', 'Saran sistem: triase 2 · Emergensi', 'SpO2 &lt; 92% dan napas &gt; 24/mnt pada usia 61 th dengan CKD: dokter ≤ 10 menit, monitor tanda vital kontinu.')}</div>
            <div class="field" style="margin-top:12px"><label>Level triase (ESI/ATS)</label>${ui.seg('lv', L.lv, [1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: `${n} · ${TRI[n][0]}` })))}</div>
            ${under ? `<div style="margin-top:10px">${ui.field('Alasan memilih level lebih rendah dari saran (wajib, tercatat)', ui.input('lvReason', L.lvReason, { area: true, placeholder: 'Minimal 10 huruf' }), '', 'f-lvReason')}</div>` : ''}
            <div class="row" style="margin-top:12px">${btnIf(lv ? `Simpan triase ${lv} dan tempatkan di R2` : 'Simpan triase', { act: 'triase', variant: 'primary', needs: under ? 'lvReason:10' : undefined }, lv ? '' : 'Pilih level triase dulu.')}</div>`;
        } else if (!L.asT) {
          const missing = IGD_ASES.filter((t, i) => !L[`a${i}`]).length;
          body = `${ui.alert('success', `Triase ${L.lvSaved} · ${TRI[L.lvSaved][0]} tersimpan ${L.triT}`, `Bed R2 · ${E(STAFF.dokterigd.name)}`)}
            <div class="stack" style="margin-top:12px"><span class="label">Asesmen cepat · alur pneumonia komunitas</span>${IGD_ASES.map((t, i) => ui.check(`a${i}`, !!L[`a${i}`], t)).join('')}
            ${kv('CURB-65', '<b>2</b> · ureum 58 mg/dL, napas 28/mnt mendekati batas')}${kv('Lab cito', 'Leukosit 16.200 · kreatinin 1,8 · kalium 4,6')}
            <div class="row">${btnIf('Simpan asesmen cepat', { act: 'asesmen', variant: 'primary' }, missing ? `Centang ${missing} tindakan lagi.` : '')}</div></div>`;
        } else if (!L.bedReq) {
          body = `${ui.alert('success', `Asesmen cepat tersimpan ${L.asT}`, 'Dx kerja: J18.9 Pneumonia · I10 · N18.3')}
            <div class="field" style="margin-top:12px"><label>Keputusan disposisi</label>${ui.seg('disp', L.disp, [{ value: 'ranap', label: 'Rawat inap' }, { value: 'obs', label: 'Observasi IGD' }, { value: 'pulang', label: 'Pulang' }])}</div>
            <div class="stack" style="margin-top:10px">${kv('Ruang tujuan', 'Melati · Penyakit dalam')}${kv('Hak kelas', `${E(H.payer)} ${E(H.kelas)}`)}${kv('DPJP rawat inap', E(H.dokter))}</div>
            <div class="row" style="margin-top:12px">${btnIf('Putuskan rawat inap dan minta tempat tidur', { act: 'mintaBed', variant: 'primary' }, L.disp !== 'ranap' ? 'Pasien skenario dirawat inap; pilih "Rawat inap" untuk melanjutkan.' : '')}</div>`;
        } else {
          body = `${ui.alert('success', `Permintaan tempat tidur terkirim ${L.bedReq}`, 'Melati · Kelas 1 · BPJS. Bagian tempat tidur menerima notifikasi.')}
            ${ui.timeline([{ t: L.triT, text: `Triase ${L.lvSaved} · ${TRI[L.lvSaved][0]}`, tone: 'danger' }, { t: L.asT, text: 'Asesmen cepat + antibiotik pertama', tone: 'success' }, { t: L.bedReq, text: 'Keputusan rawat inap · permintaan bed', tone: 'success' }])}
            ${ui.next('bed', `Tn. Hartono triase ${L.lvSaved}, diputuskan rawat inap, permintaan bed ${L.bedReq}`)}`;
        }
        detail = ui.card({ title: `${H.name} · L · ${H.age} th`, sub: 'Tiba 08.48 · diantar keluarga · BPJS', actions: triChip(L.lvSaved), body: `${ui.steps(['Triase', 'Asesmen cepat', 'Keputusan', 'Permintaan bed'], idx)}<div style="margin-top:12px">${body}</div>` });
      } else if (L.sel === 'tnx' && L.tnx) {
        detail = ui.card({ title: 'Tn. X (tanpa identitas)', sub: `Didaftarkan ${L.tnx} · ambulans 118`, actions: triChip(1), tone: 'danger', body: `<div class="stack">${kv('No. RM sementara', '<b class="mono">X-261005-01</b>')}${kv('Ciri', 'Laki-laki ±40 th, kaus biru, tato lengan kiri')}${kv('Penjamin', 'Belum diketahui · ditangani dulu')}${ui.alert('info', 'Identitas menyusul', 'Data digabung ke MPI saat identitas diketahui; seluruh catatan tetap tertaut.')}</div>` });
      } else {
        const r = IGD_BASE.find((x) => x.id === L.sel) || IGD_BASE[0];
        detail = ui.card({ title: r.name, sub: `${r.bed} · ${r.meta}`, actions: triChip(r.lv), body: `<div class="stack">${kv('Keluhan utama', E(r.cc))}${kv('Dokter', E(r.doc))}${kv('Status', E(r.status))}${ui.btn('Kembali ke Tn. Hartono', { act: 'pilih', arg: 'hartono', variant: 'primary' })}</div>` });
      }
      return `${kpis}<div class="grid" style="grid-template-columns:minmax(0,1.4fr) minmax(0,1fr);align-items:start">${board}${detail}</div>`;
    },
    actions: {
      pilih(L, J, el) { L.sel = el.dataset.arg || 'hartono'; },
      tnx(L) {
        if (L.tnx) return false;
        L.tnx = SIM.now(1);
        L.sel = 'tnx';
        SIM.note('Pasien tanpa identitas "Tn. X" didaftarkan dengan RM sementara', 'warning');
      },
      triase(L, J) {
        const lv = Number(L.lv) || 0;
        if (L.triT || lv < 1 || lv > 5) { if (!L.triT) SIM.toast('Pilih level triase dulu.', 'warning'); return; }
        if (lv > 2 && String(L.lvReason || '').trim().length < 10) { SIM.toast('Level di bawah saran sistem wajib diberi alasan.', 'warning'); return; }
        L.lvSaved = lv;
        L.triT = SIM.now(3);
        J.igd = { patient: 'hartono', triage: lv, t: L.triT };
        SIM.note(`Tn. Hartono triase ${lv} (${TRI[lv][0]})${lv > 2 ? ' · di bawah saran sistem, alasan tercatat' : ''}`, lv <= 2 ? 'danger' : 'warning');
      },
      asesmen(L) {
        if (!L.triT || L.asT) return false;
        if (IGD_ASES.some((t, i) => !L[`a${i}`])) { SIM.toast('Lengkapi asesmen cepat dulu.', 'warning'); return; }
        L.asT = SIM.now(12);
      },
      mintaBed(L, J) {
        if (!L.asT || L.bedReq) return false;
        if (L.disp !== 'ranap') { SIM.toast('Pilih "Rawat inap" untuk melanjutkan alur.', 'warning'); return; }
        L.bedReq = SIM.now(3);
        J.igd = Object.assign({ patient: 'hartono', triage: L.lvSaved, t: L.triT }, J.igd || {}, { bedReq: L.bedReq });
        SIM.note('Tn. Hartono diputuskan rawat inap · permintaan bed Melati kelas 1', 'brand');
        SIM.done();
      },
    },
  });

  /* ---------- Tempat tidur: papan bed + Aplicare (K05) ---------- */
  const BEDS = [
    ['Melati', 'Kelas 1', '3-01', 'isi', 'Tn. Joko S.', 'H3 · J44.1'],
    ['Melati', 'Kelas 1', '3-02', 'kosong', '', 'siap sejak 07.40'],
    ['Melati', 'Kelas 1', '3-03', 'bersih', '', 'dibersihkan · estimasi 09.40'],
    ['Melati', 'Kelas 1', '3-04', 'isi', 'Tn. Darmawan', 'H2 · N18.4'],
    ['Melati', 'Kelas 2', '3-05', 'pesan', 'Ny. Sulastri', 'dari IGD B3'],
    ['Melati', 'Kelas 2', '3-06', 'isi', 'Ny. Yati', 'H4'],
    ['Melati', 'Kelas 2', '3-07', 'isi', 'Ny. Murni', 'H2'],
    ['Melati', 'Kelas 2', '3-08', 'kosong', '', 'siap'],
    ['Anggrek', 'Kelas 1', 'A-101', 'isi', 'Tn. Agus', 'pasca-op H1'],
    ['Anggrek', 'Kelas 1', 'A-102', 'kosong', '', 'siap'],
    ['Anggrek', 'Kelas 2', 'A-201', 'isi', 'Tn. Rudi', 'H2'],
    ['Anggrek', 'Kelas 2', 'A-202', 'bersih', '', 'dibersihkan'],
    ['Isolasi', 'Khusus', 'I-01', 'isi', 'Tn. Fajar', 'TB paru · H6'],
    ['Isolasi', 'Khusus', 'I-02', 'kosong', '', 'tekanan negatif · siap'],
  ].map(([ward, cls, id, k, pt, note]) => ({ ward, cls, id, k, pt, note }));
  const WARDS = { Melati: 'Melati · Penyakit dalam', Anggrek: 'Anggrek · Bedah', Isolasi: 'Isolasi · Airborne' };
  const BK = { kosong: ['Kosong · siap', 'success'], isi: ['Terisi', ''], bersih: ['Dibersihkan', 'warning'], pesan: ['Dipesan', 'info'] };
  const bedsOf = (L) => BEDS.map((b) => Object.assign({}, b, L.ov[b.id] || {}));

  SIM.register({
    id: 'bed',
    phase: 3,
    title: 'Manajemen tempat tidur',
    nav: 'Tempat tidur',
    codes: 'K04 · K05',
    role: 'perawat',
    desc: 'Peta tempat tidur per ruang dan kelas dengan status kosong, terisi, dibersihkan, dan dipesan; ketersediaan dikirim ke Aplicare BPJS.',
    hint: 'Pilih bed Melati 3-02 (kelas 1), alokasikan untuk Tn. Hartono, lalu tandai pasien tiba dari IGD.',
    init: { ward: 'semua', sel: '', ov: {}, alloc: '', trT: '', apl: '' },
    render(L, J) {
      const beds = bedsOf(L);
      const shown = beds.filter((b) => L.ward === 'semua' || b.ward === L.ward);
      const tileOf = (b) => {
        const st = BK[b.k];
        const bg = { kosong: 'var(--success-bg)', isi: 'var(--card)', bersih: 'var(--warning-bg)', pesan: 'var(--info-bg)' }[b.k];
        const bd = b.id === L.sel ? 'var(--brand-600)' : { kosong: 'var(--success-border)', isi: 'var(--line)', bersih: 'var(--warning-border)', pesan: 'var(--info-border)' }[b.k];
        return `<button type="button" data-act="pilih" data-arg="${E(b.id)}" style="text-align:left;padding:10px;border-radius:10px;border:${b.id === L.sel ? 2 : 1}px solid ${bd};background:${bg};cursor:pointer;min-height:86px;display:flex;flex-direction:column;gap:4px"><span class="row between"><b class="mono">${E(b.id)}</b><span class="small muted">${E(b.cls)}</span></span>${ui.chip(st[0], st[1])}<span class="small">${E(b.pt || '—')}</span><span class="small muted">${E(b.note)}</span></button>`;
      };
      const wardCards = Object.keys(WARDS).map((w) => {
        const list = shown.filter((b) => b.ward === w);
        if (!list.length) return '';
        const all = beds.filter((b) => b.ward === w);
        return ui.card({ title: WARDS[w], sub: `${all.length} bed · ${all.filter((b) => b.k === 'isi' || b.k === 'pesan').length} terisi/dipesan · ${all.filter((b) => b.k === 'kosong').length} siap`, body: `<div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:10px">${list.map(tileOf).join('')}</div>` });
      }).join('');

      const H = PEOPLE.hartono;
      const fromIgd = J.igd ? `IGD R2 · triase ${J.igd.triage}` : 'IGD R2';
      const sel = beds.find((b) => b.id === L.sel);
      let detail = ui.empty('Pilih satu bed di peta untuk melihat detail dan aksinya.');
      if (sel) {
        let act = '';
        if (sel.k === 'kosong') {
          const why = L.alloc ? `Tn. Hartono sudah dialokasikan ke ${L.alloc}.` : sel.cls !== 'Kelas 1' ? `Hak kelas Tn. Hartono: Kelas 1 (bed ini ${sel.cls}).` : sel.ward !== 'Melati' ? 'Pasien penyakit dalam diarahkan ke Ruang Melati.' : '';
          act = btnIf(`Alokasikan ${sel.id} untuk Tn. Hartono`, { act: 'alokasi', variant: 'primary' }, why);
        } else if (sel.k === 'bersih') act = ui.btn('Selesai dibersihkan · siap pakai', { act: 'siap', variant: 'primary' });
        else if (sel.k === 'pesan' && sel.id === L.alloc) act = ui.btn('Pasien tiba · transfer dari IGD', { act: 'transfer', variant: 'primary' });
        else if (sel.k === 'pesan') act = `<span class="small muted">Dipesan untuk ${E(sel.pt)}. Ditandai terisi oleh ruang saat pasien tiba.</span>`;
        else act = sel.id === L.alloc ? ui.btn('Buka rawat inap', { go: 'ranap', variant: 'primary' }) : '<span class="small muted">Bed terisi. CPPT dan eMAR dibuka di layar rawat inap.</span>';
        detail = `<div class="stack">${kv('Bed', `<b class="mono">${E(sel.id)}</b>`)}${kv('Ruang', E(WARDS[sel.ward]))}${kv('Kelas', E(sel.cls))}${kv('Status', ui.chip(BK[sel.k][0], BK[sel.k][1]))}${kv('Pasien', E(sel.pt || '—'))}${kv('Catatan', E(sel.note))}<div>${act}</div></div>`;
      }
      const reqs = `<div class="stack">
        <div style="padding:10px 12px;border:1px solid ${L.alloc ? 'var(--success-border)' : 'var(--brand-200)'};border-radius:10px;background:${L.alloc ? 'var(--success-bg)' : 'var(--selected)'}"><div class="row between"><b>${E(H.name)} · L ${H.age}</b>${J.igd ? ui.chip(L.alloc ? `Dialokasikan ${L.alloc}` : 'Menunggu', L.alloc ? 'success' : 'warning') : contoh()}</div><div class="small muted">${E(fromIgd)} · Penyakit dalam · Kelas 1 · BPJS · pneumonia, O2 nasal</div></div>
        <div style="padding:10px 12px;border:1px solid var(--line);border-radius:10px"><div class="row between"><b>Tn. Wahyu · L 45</b>${ui.chip('4 j 40 m', 'danger')}</div><div class="small muted">IGD B5 · Bedah · Kelas 2 · Umum · cocok: A-202 setelah dibersihkan</div></div></div>`;
      const cls = ['Kelas 1', 'Kelas 2', 'Khusus'];
      const apl = ui.table(['Kelas', { label: 'Kapasitas', r: true }, { label: 'Terisi', r: true }, { label: 'Tersedia', r: true }], cls.map((c) => {
        const list = beds.filter((b) => b.cls === c);
        const free = list.filter((b) => b.k === 'kosong').length;
        return [E(c), `${list.length}`, `${list.length - free}`, `<b>${free}</b>`];
      }));
      const right = `<div class="stack">${ui.card({ title: 'Bed terpilih', sub: sel ? sel.id : 'belum dipilih', body: detail })}${ui.card({ title: 'Permintaan bed', sub: `${L.alloc ? 1 : 2} menunggu`, body: reqs })}${ui.card({ title: 'Ketersediaan Aplicare BPJS', sub: `Terkirim ke Aplicare & SIRANAP · ${L.apl || '09.00'}`, actions: L.apl ? ui.chip(`Diperbarui ${L.apl}`, 'success') : '', flush: true, body: apl })}</div>`;
      const done = L.trT ? ui.next('ranap', `Tn. Hartono pindah dari IGD ke Melati ${L.alloc} pukul ${L.trT}; Aplicare diperbarui`) : '';
      return `${done}<div class="row between">${ui.seg('ward', L.ward, [{ value: 'semua', label: 'Semua ruang' }, { value: 'Melati', label: 'Melati' }, { value: 'Anggrek', label: 'Anggrek' }, { value: 'Isolasi', label: 'Isolasi' }])}<div class="row">${Object.keys(BK).map((k) => ui.chip(`${BK[k][0]} ${beds.filter((b) => b.k === k).length}`, BK[k][1])).join('')}</div></div>
        <div class="grid" style="grid-template-columns:minmax(0,1.5fr) minmax(0,1fr);align-items:start"><div class="stack">${wardCards}</div>${right}</div>`;
    },
    actions: {
      pilih(L, J, el) { if (BEDS.some((b) => b.id === el.dataset.arg)) L.sel = el.dataset.arg; },
      alokasi(L, J) {
        const b = bedsOf(L).find((x) => x.id === L.sel);
        if (!b || b.k !== 'kosong' || L.alloc) { SIM.toast('Pilih bed berstatus kosong dulu.', 'warning'); return; }
        if (b.cls !== 'Kelas 1' || b.ward !== 'Melati') { SIM.toast('Tn. Hartono: Ruang Melati, hak Kelas 1.', 'warning'); return; }
        const t = SIM.now(2);
        L.ov[b.id] = { k: 'pesan', pt: 'Tn. Hartono', note: `dari IGD · dipesan ${t}` };
        L.alloc = b.id;
        L.apl = t;
        J.bed = { ward: 'Melati', room: b.id, cls: 'Kelas 1' };
        SIM.note(`Bed Melati ${b.id} kelas 1 dialokasikan untuk Tn. Hartono · Aplicare diperbarui`, 'brand');
      },
      siap(L) {
        const b = bedsOf(L).find((x) => x.id === L.sel);
        if (!b || b.k !== 'bersih') return false;
        L.apl = SIM.now(1);
        L.ov[b.id] = { k: 'kosong', pt: '', note: `siap ${L.apl}` };
      },
      transfer(L, J) {
        if (!L.alloc || L.trT) return false;
        L.trT = SIM.now(15);
        L.ov[L.alloc] = { k: 'isi', pt: 'Tn. Hartono', note: `H1 · masuk ${L.trT}` };
        L.apl = L.trT;
        J.bed = { ward: 'Melati', room: L.alloc, cls: 'Kelas 1' };
        SIM.note(`Tn. Hartono tiba di Melati ${L.alloc} (transfer dari IGD)`, 'success');
        SIM.done();
      },
    },
  });

  /* ---------- Rawat inap: CPPT, TTV/EWS, eMAR + gelang, askep, SBAR (K04, K07, K12) ---------- */
  const HOURS = ['06.00', '08.00', '12.00', '18.00', '22.00'];
  const MEDS = [
    { name: 'Ceftriaxone 2 g', sig: 'IV drip · 1×24 jam · H2/7', s: ['', 'due', '', '', ''] },
    { name: 'Omeprazol 40 mg', sig: 'IV · 1×24 jam pagi', s: ['late', '', '', '', ''] },
    { name: 'Amlodipin 5 mg', sig: 'PO · 1×1 pagi · obat rutin', s: ['', 'due', '', '', ''] },
    { name: 'Enoksaparin 40 mg', sig: 'SC · 1×24 jam · profilaksis', ha: true, s: ['', 'due', '', '', ''] },
    { name: 'N-asetilsistein 200 mg', sig: 'PO · 3×1 (06, 12, 18)', s: ['g:06.05', '', 'plan', 'plan', ''] },
    { name: 'Parasetamol 1 g', sig: 'IV · bila suhu ≥ 38,5 °C', s: ['g:06.20', '', '', '', ''] },
  ];
  const OBS = [
    { t: '06.00', s: '38,4', n: 108, rr: 26, td: '150/90', spo2: 92, ews: 6 },
    { t: '10.00', s: '37,9', n: 100, rr: 24, td: '146/88', spo2: 94, ews: 4 },
    { t: '14.00', s: '37,5', n: 94, rr: 22, td: '140/86', spo2: 95, ews: 3 },
  ];
  const ASKEP = [
    { dx: 'Bersihan jalan napas tidak efektif', items: ['Posisi semi-Fowler', 'Latih batuk efektif', 'Pantau SpO2 tiap 4 jam'] },
    { dx: 'Hipertermia', items: ['Kompres hangat', 'Pantau suhu tiap 4 jam', 'Asupan cairan ≥ 2 L/hari'] },
    { dx: 'Risiko jatuh (Morse 45)', items: ['Gelang kuning terpasang', 'Pagar tempat tidur terpasang', 'Edukasi keluarga'] },
  ];
  const CPPT0 = [
    { tag: 'DPJP', who: 'dr. Yusuf Hakim, Sp.P', t: '07.30', text: 'S: sesak berkurang, batuk berdahak. O: S 38,1 °C, RR 24, SpO2 94% O2 3 lpm, ronki basah kanan. A: Pneumonia komunitas (J18.9), CKD st. 3. P: lanjut ceftriaxone H2, cek kreatinin besok, target SpO2 ≥ 94%.', v: 'Final · TTE' },
    { tag: 'Farmasi', who: 'apt. Rina Kusuma', t: '07.50', text: 'Telaah: dosis ceftriaxone tidak perlu penyesuaian ginjal. Enoksaparin 40 mg aman pada eGFR 42, pantau trombosit.', v: 'Terbaca DPJP' },
    { tag: 'Residen', who: 'dr. Arif · PPDS Paru', t: '06.40', text: 'S: demam malam. O: S 38,4 °C. A: respon terapi belum optimal H1. P: parasetamol 1 g IV, kultur sputum.', v: 'Menunggu co-sign DPJP' },
  ];

  SIM.register({
    id: 'ranap',
    phase: 3,
    title: 'Rawat inap',
    nav: 'Rawat inap',
    codes: 'K04 · K07 · K12',
    role: 'perawat',
    desc: 'Ruang Melati: CPPT terintegrasi, observasi dengan EWS, eMAR dengan pindai gelang dan label obat, asuhan keperawatan, serah terima SBAR.',
    hint: 'Di tab eMAR: pindai gelang (atau coba "gelang tidak terbaca"), pilih slot ceftriaxone 08.00, pindai label, catat pemberian.',
    init: {
      tab: 'emar', scan: '', scanAt: '', unread: false, id1: false, id2: false, ovReason: '', slot: '', lbl: false, lateReason: '', cek2: '', given: {}, log: [],
      notes: [], cs: '', co: '', ca: '', cp: '', obs: [], askepT: '', sbarT: '', sbarTo: 'Ns. Dedi Kurniawan (shift siang)',
      sbar: 'S: Tn. Hartono, 61 th, pneumonia H2, sesak berkurang.\nB: CKD st. 3, hipertensi. Ceftriaxone H2, O2 nasal 3 lpm.\nA: EWS 3 (rendah), SpO2 95%, suhu turun 37,5 °C.\nR: lanjut observasi tiap 4 jam, kultur sputum belum keluar, kreatinin besok pagi.',
      k00: true, k01: false, k02: true, k10: true, k11: true, k12: false, k20: true, k21: true, k22: false,
    },
    render(L, J) {
      const H = PEOPLE.hartono;
      const bed = J.bed || { ward: 'Melati', room: '3-02', cls: 'Kelas 1' };
      const extra = `${ui.chip(`${bed.ward} ${bed.room} · ${bed.cls}`, 'brand')}${J.bed ? '' : contoh()}${ui.chip('H2 rawat', '')}${ui.chip('Risiko jatuh · Morse 45', 'warning')}`;
      const lastEws = (L.obs.length ? L.obs[L.obs.length - 1] : OBS[OBS.length - 1]).ews;
      const tabs = ui.tabs('tab', L.tab, [{ value: 'cppt', label: 'CPPT' }, { value: 'ttv', label: 'Observasi & EWS' }, { value: 'emar', label: 'eMAR' }, { value: 'askep', label: 'Asuhan keperawatan' }, { value: 'sbar', label: 'Serah terima SBAR' }]);
      let body = '';

      if (L.tab === 'cppt') {
        const notes = L.notes.concat(CPPT0);
        body = `<div class="grid" style="grid-template-columns:minmax(0,1.3fr) minmax(0,1fr);align-items:start">${ui.card({ title: 'CPPT terintegrasi · 5 Okt', sub: 'semua PPA', flush: true, body: notes.map((n) => `<div style="padding:12px 16px;border-bottom:1px solid var(--line-soft)"><div class="row between"><span>${ui.chip(n.tag, n.tag === 'DPJP' ? 'brand' : n.tag === 'Residen' ? 'info' : n.tag === 'Perawat' ? 'success' : 'warning')} <b>${E(n.who)}</b></span><span class="mono small muted">${E(n.t)}</span></div><div class="small" style="margin-top:6px;white-space:pre-line">${E(n.text)}</div><div class="small" style="margin-top:4px;color:${/Menunggu/.test(n.v) ? 'var(--warning)' : 'var(--success)'}">${E(n.v)}</div></div>`).join('') })}
          ${ui.card({ title: 'Tulis CPPT perawat (SOAP)', sub: STAFF.perawat.name, body: `<div class="stack">${ui.field('S', ui.input('cs', L.cs, { area: true, placeholder: 'Keluhan pasien' }), '', 'f-cs')}${ui.field('O', ui.input('co', L.co, { placeholder: 'Tanda vital, temuan' }), '', 'f-co')}${ui.field('A', ui.input('ca', L.ca, { placeholder: 'Masalah keperawatan' }), '', 'f-ca')}${ui.field('P', ui.input('cp', L.cp, { placeholder: 'Intervensi, tindak lanjut' }), '', 'f-cp')}${ui.btn('Simpan dan tanda tangani', { act: 'cppt', variant: 'primary', needs: 'cs:5' })}<span class="small muted">Catatan residen difinalkan setelah co-sign DPJP.</span></div>` })}</div>`;
      } else if (L.tab === 'ttv') {
        const obs = OBS.concat(L.obs);
        const bar = (v, max, tone) => `<div style="height:8px;border-radius:99px;background:var(--line-soft)"><i style="display:block;height:100%;width:${Math.min(100, Math.round((v / max) * 100))}%;border-radius:99px;background:var(--${tone})"></i></div>`;
        body = `${ui.card({ title: 'Observasi tanda vital · 5 Okt', sub: 'EWS dewasa · ulang tiap 4 jam bila skor 1–4', actions: L.obs.length ? ui.chip(`TTV ${L.obs[L.obs.length - 1].t} tersimpan`, 'success') : ui.btn('Catat TTV 18.00', { act: 'ttv', size: 'sm', variant: 'primary' }), flush: true,
          body: ui.table(['Jam', { label: 'Suhu °C', r: true }, { label: 'Nadi', r: true }, { label: 'Napas', r: true }, 'TD', { label: 'SpO2', r: true }, 'EWS', 'Tren EWS'], obs.map((o) => [`<span class="mono">${E(o.t)}</span>`, E(o.s), `${o.n}`, `${o.rr}`, E(o.td), `${o.spo2}%`, ui.chip(`${o.ews} · ${o.ews >= 5 ? 'sedang' : 'rendah'}`, o.ews >= 5 ? 'danger' : o.ews >= 1 ? 'warning' : 'success'), `<div style="min-width:120px">${bar(o.ews, 10, o.ews >= 5 ? 'danger' : 'warning')}</div>`])) })}
          <div class="grid g3">${tile('EWS terakhir', `${lastEws}`, lastEws >= 5 ? 'sedang · lapor DPJP' : 'rendah · ulang 4 jam', lastEws >= 5 ? 'danger' : 'warning')}${tile('SpO2', `${obs[obs.length - 1].spo2}%`, 'O2 nasal 3 lpm')}${tile('Balans cairan 24 jam', '+420 ml', 'masuk 2.300 · keluar 1.880')}</div>
          <div class="card cb"><span class="label">Grafik suhu</span><div class="stack" style="gap:6px;margin-top:8px">${obs.map((o) => `<div class="row" style="flex-wrap:nowrap"><span class="mono small" style="width:44px">${E(o.t)}</span><div style="flex:1">${bar(num(o.s) - 35, 5, num(o.s) >= 38 ? 'danger' : 'brand-600')}</div><span class="mono small" style="width:44px;text-align:right">${E(o.s)}</span></div>`).join('')}</div></div>`;
      } else if (L.tab === 'emar') {
        let gate;
        if (L.scan) {
          gate = ui.alert(L.scan === 'cocok' ? 'success' : 'warning', L.scan === 'cocok' ? `Pasien benar · gelang terpindai ${L.scanAt} · RM ${H.rm}` : `Override tercatat ${L.scanAt} · verifikasi manual dua identitas`, `${L.scan === 'override' ? `Alasan: ${E(L.ovReason)}. ` : ''}Pilih satu slot jadwal, pindai label obatnya, lalu catat pemberian.`);
        } else {
          gate = `<div class="alert warning" role="alert"><span class="ai">!</span><div style="flex:1"><b>Pemberian obat terkunci sampai gelang pasien cocok</b><span class="ab">Pindai gelang di pergelangan ${E(H.name)}. Jadwal 08.00: ceftriaxone, amlodipin, enoksaparin; omeprazol 06.00 terlambat.</span></div><div class="row">${ui.btn('Pindai gelang', { act: 'pindai', variant: 'primary' })}${L.unread ? '' : ui.btn('Gelang tidak terbaca', { act: 'takTerbaca' })}</div></div>
            ${L.unread ? `${ui.gate({ title: 'Gelang tidak terbaca: identitas belum terverifikasi', body: `Cocokkan dua identitas dengan pasien, lalu tulis alasan. Override tercatat dan ditinjau komite keselamatan pasien.<div class="stack" style="margin-top:8px">${ui.check('id1', L.id1, `Nama cocok: ${E(H.name)}`, { html: true })}${ui.check('id2', L.id2, `Tanggal lahir / RM cocok: ${E(H.dob)} · ${E(H.rm)}`, { html: true })}</div>`, follow: { label: 'Pindai ulang gelang', act: 'pindai' }, override: { label: 'Verifikasi manual dua identitas', act: 'verifManual' }, reasonKey: 'ovReason', reasonValue: L.ovReason })}` : ''}`;
        }
        const grid = ui.table(['Obat · dosis · rute'].concat(HOURS), MEDS.map((m, mi) => [`<b>${E(m.name)}</b>${m.ha ? ` ${ui.chip('high alert', 'danger')}` : ''}<div class="small muted">${E(m.sig)}</div>`].concat(m.s.map((raw, si) => {
          const key = `${mi}-${si}`;
          if (L.given[key]) return ui.chip(`✓ ${L.given[key]}`, 'success');
          if (raw.startsWith('g:')) return ui.chip(`✓ ${raw.slice(2)}`, 'success');
          if (raw === 'plan') return '<span class="small muted">Rencana</span>';
          if (raw === 'due' || raw === 'late') {
            if (!L.scan) return ui.chip(raw === 'late' ? 'Terlambat · terkunci' : 'Jadwal · terkunci', raw === 'late' ? 'danger' : '');
            return ui.btn(raw === 'late' ? 'Terlambat' : L.slot === key ? 'Dipilih' : 'Beri', { act: 'slot', arg: key, size: 'sm', variant: raw === 'late' ? 'danger' : L.slot === key ? 'primary' : '' });
          }
          return '<span class="muted">·</span>';
        }))));
        let dose = '';
        if (L.slot && L.scan) {
          const [mi, si] = L.slot.split('-').map(Number);
          const m = MEDS[mi];
          const late = m.s[si] === 'late';
          const needs = [late ? 'lateReason:10' : '', m.ha ? 'cek2:3' : ''].filter(Boolean).join(',');
          dose = ui.card({ title: `${m.name} · jadwal ${HOURS[si]}${late ? ' terlambat' : ''}`, sub: m.sig, tone: late ? 'danger' : '', actions: m.ha ? ui.chip('Kewaspadaan tinggi · cek ganda', 'danger') : '', body: `<div class="stack">
            <div class="row">${L.lbl ? `<b class="small" style="color:var(--success)">✓ Obat benar · label terpindai (${E(m.name)})</b>` : `<span class="small">○ Label obat belum dipindai</span>${ui.btn('Pindai label obat', { act: 'label' })}`}</div>
            ${late ? ui.field('Alasan keterlambatan (wajib, tercatat)', ui.input('lateReason', L.lateReason, { placeholder: 'Contoh: pasien sedang foto toraks' }), '', 'f-lateReason') : ''}
            ${m.ha ? ui.field('Cek ganda: nama perawat kedua (bukan pemberi obat)', ui.input('cek2', L.cek2, { placeholder: 'Mis. Ns. Dedi Kurniawan' }), '', 'f-cek2') : ''}
            <div class="row">${btnIf(late ? 'Catat pemberian terlambat' : 'Catat pemberian', { act: 'beri', variant: late ? 'danger' : 'primary', needs: needs || undefined }, L.lbl ? '' : 'Pindai label obat dulu.')}${ui.btn('Batal', { act: 'batalDosis' })}</div></div>` });
        }
        const log = L.log.length ? ui.card({ title: 'Pemberian tercatat shift ini', body: ui.timeline(L.log.map((g) => ({ t: g.t, text: g.what, sub: g.note, tone: g.late ? 'warning' : 'success' }))) }) : '';
        const nGiven = Object.keys(L.given).length;
        body = `<div class="stack">${gate}${ui.card({ title: 'eMAR · jadwal pemberian obat', sub: 'Sumber: resep terverifikasi apoteker', flush: true, body: grid })}${dose}${log}
          ${nGiven ? ui.next('consent', `${nGiven} dosis tercatat dengan gelang ${L.scan === 'override' ? 'diverifikasi manual (override)' : 'terpindai'} dan label obat cocok`) : ''}</div>`;
      } else if (L.tab === 'askep') {
        let done = 0, total = 0;
        const cards = ASKEP.map((a, ai) => {
          const items = a.items.map((t, ii) => { const k = `k${ai}${ii}`; total++; if (L[k]) done++; return ui.check(k, !!L[k], t); }).join('');
          return ui.card({ title: a.dx, sub: `${a.items.filter((t, ii) => L[`k${ai}${ii}`]).length} dari ${a.items.length} intervensi`, body: `<div class="stack">${items}</div>` });
        }).join('');
        body = `<div class="grid g3">${cards}</div><div class="row between"><span class="small muted">${done}/${total} intervensi shift pagi${L.askepT ? ` · evaluasi disimpan ${E(L.askepT)}` : ''}</span>${ui.btn('Simpan evaluasi askep', { act: 'askep', variant: 'primary' })}</div>`;
      } else {
        body = ui.card({ title: 'Serah terima SBAR', sub: 'shift pagi → shift siang', actions: L.sbarT ? ui.chip(`Diserahkan ${L.sbarT}`, 'success') : '', body: `<div class="stack">${ui.field('Isi SBAR', ui.input('sbar', L.sbar, { area: true, rows: 6 }), 'Dihimpun dari CPPT, observasi, dan eMAR; boleh disunting.', 'f-sbar')}${ui.field('Penerima', ui.select('sbarTo', L.sbarTo, ['Ns. Dedi Kurniawan (shift siang)', 'Ns. Lina Marlina (kepala ruang)']), '', 'f-sbarTo')}<div class="row">${btnIf('Serahkan dan tanda tangani', { act: 'sbar', variant: 'primary' }, L.sbarT ? `Sudah diserahkan ${L.sbarT}.` : '')}</div></div>` });
      }
      return `${ui.banner(H, extra)}<div class="row between">${tabs}<div class="row">${ui.chip(`EWS ${lastEws}`, lastEws >= 5 ? 'danger' : 'warning')}${ui.btn('Persetujuan tindakan', { go: 'consent', size: 'sm' })}${ui.btn('Resume medis', { go: 'resume', size: 'sm' })}</div></div>${body}`;
    },
    actions: {
      takTerbaca(L) { if (!L.scan) L.unread = true; },
      verifManual(L, J) {
        if (L.scan) return false;
        if (!L.id1 || !L.id2) { SIM.toast('Centang kedua identitas yang sudah dicocokkan.', 'warning'); return; }
        if (String(L.ovReason || '').trim().length < 10) { SIM.toast('Tulis alasan minimal 10 huruf.', 'warning'); return; }
        L.scan = 'override';
        L.scanAt = SIM.now(1);
        J.emar = { given: Object.keys(L.given).length, override: true };
        SIM.note('eMAR: gelang tidak terbaca, identitas diverifikasi manual (override beralasan)', 'warning');
      },
      pindai(L) {
        if (L.scan) return false;
        L.scan = 'cocok';
        L.unread = false;
        L.scanAt = SIM.now(1);
      },
      slot(L, J, el) {
        const key = el.dataset.arg || '';
        const [mi, si] = key.split('-').map(Number);
        if (!L.scan) { SIM.toast('Pindai gelang pasien dulu.', 'warning'); return; }
        if (!MEDS[mi] || !['due', 'late'].includes(MEDS[mi].s[si]) || L.given[key]) return false;
        L.slot = key; L.lbl = false; L.lateReason = ''; L.cek2 = '';
      },
      label(L) { if (L.slot) L.lbl = true; },
      beri(L, J) {
        if (!L.scan || !L.slot || !L.lbl) { SIM.toast('Gelang dan label obat wajib terpindai.', 'warning'); return; }
        const [mi, si] = L.slot.split('-').map(Number);
        const m = MEDS[mi];
        const late = m.s[si] === 'late';
        if (late && String(L.lateReason || '').trim().length < 10) { SIM.toast('Isi alasan keterlambatan.', 'warning'); return; }
        if (m.ha && String(L.cek2 || '').trim().length < 3) { SIM.toast('Isi nama perawat kedua untuk cek ganda.', 'warning'); return; }
        if (m.ha && /fitri/i.test(L.cek2)) { SIM.toast('Cek ganda harus oleh petugas lain, bukan pemberi obat.', 'warning'); return; }
        const t = SIM.now(2);
        L.given[L.slot] = `${t}${late ? ' · telat' : ''}`;
        L.log.push({ t, what: `${m.name} ${m.sig.split(' · ')[0]}`, note: `jadwal ${HOURS[si]}${late ? ` · terlambat · ${L.lateReason.trim()}` : ''}${m.ha ? ` · cek ganda ${L.cek2.trim()}` : ''}`, late });
        const first = !J.emar || !J.emar.given;
        J.emar = { given: Object.keys(L.given).length, override: L.scan === 'override' };
        if (first) SIM.note(`eMAR: ${m.name} diberikan ${t} setelah gelang dan label obat cocok`, 'success');
        L.slot = ''; L.lbl = false; L.lateReason = ''; L.cek2 = '';
        SIM.done();
      },
      batalDosis(L) { L.slot = ''; L.lbl = false; },
      cppt(L) {
        if (String(L.cs || '').trim().length < 5) { SIM.toast('Isi S minimal 5 huruf.', 'warning'); return; }
        const t = SIM.now(3);
        L.notes.unshift({ tag: 'Perawat', who: STAFF.perawat.name, t, text: ['S: ' + L.cs.trim(), L.co ? 'O: ' + L.co.trim() : '', L.ca ? 'A: ' + L.ca.trim() : '', L.cp ? 'P: ' + L.cp.trim() : ''].filter(Boolean).join('\n'), v: `Final · TTE ${t}` });
        L.cs = ''; L.co = ''; L.ca = ''; L.cp = '';
        SIM.toast(`CPPT tersimpan ${t}`, 'success');
      },
      ttv(L) {
        if (L.obs.length) return false;
        L.obs.push({ t: '18.00', s: '37,2', n: 88, rr: 20, td: '138/84', spo2: 96, ews: 1 });
        SIM.toast('TTV 18.00 tersimpan · EWS 1', 'success');
      },
      askep(L) { L.askepT = SIM.now(2); SIM.toast(`Evaluasi askep tersimpan ${L.askepT}`, 'success'); },
      sbar(L) {
        if (L.sbarT) return false;
        L.sbarT = SIM.now(5);
        SIM.note(`Serah terima SBAR Tn. Hartono ke ${L.sbarTo}`, 'brand');
      },
    },
  });

  /* ---------- Persetujuan tindakan di tablet (K11) ---------- */
  const CONSENT_INFO = [
    ['Diagnosis', 'Batu kandung empedu yang menimbulkan nyeri berulang (K80.2).'],
    ['Tindakan dan tujuan', 'Kolesistektomi laparoskopik: mengangkat kandung empedu lewat 3–4 sayatan kecil agar nyeri tidak kambuh.'],
    ['Cara pelaksanaan', 'Bius umum, sekitar 60–90 menit, di kamar operasi. Bila sulit, dapat diubah menjadi operasi terbuka.'],
    ['Risiko', 'Nyeri, perdarahan, infeksi luka, cedera saluran empedu (jarang, < 0,5%), kebocoran empedu.'],
    ['Alternatif', 'Operasi terbuka, atau menunda operasi dengan diet rendah lemak dan obat (keluhan dapat kambuh).'],
    ['Prognosis', 'Baik; umumnya pulang 1–2 hari setelah operasi.'],
  ];

  SIM.register({
    id: 'consent',
    phase: 3,
    title: 'Persetujuan tindakan',
    nav: 'Persetujuan tindakan',
    codes: 'K11',
    role: 'dokter',
    device: 'tablet',
    desc: 'Tablet di samping pasien: penjelasan risiko dan alternatif, pertanyaan pasien, tanda tangan pasien, saksi, dan dokter.',
    hint: 'Centang penjelasan, catat pertanyaan pasien, lalu kumpulkan tiga tanda tangan sebelum menekan Selesai.',
    init: { step: 0, r0: false, r1: false, r2: false, q: '', qs: [], noQ: false, sigP: '', sigW: '', sigD: '', doneAt: '' },
    render(L, J) {
      const R = PEOPLE.ratna;
      const steps = ui.steps(['Penjelasan', 'Pertanyaan pasien', 'Tanda tangan', 'Selesai'], L.doneAt ? 4 : L.step);
      let inner;
      if (L.step === 0) {
        const why = !(L.r0 && L.r1 && L.r2) ? 'Centang ketiga konfirmasi penjelasan.' : '';
        inner = `<div class="stack">${CONSENT_INFO.map(([t, d]) => `<div style="padding:10px 12px;border:1px solid var(--line-soft);border-radius:10px;background:${t === 'Risiko' || t === 'Alternatif' ? 'var(--warning-bg)' : 'var(--subtle)'}"><b>${E(t)}</b><div>${E(d)}</div></div>`).join('')}
          ${ui.check('r0', L.r0, 'Risiko dan komplikasi sudah dijelaskan dengan bahasa yang dipahami pasien')}${ui.check('r1', L.r1, 'Alternatif tindakan dan akibat bila menolak sudah dijelaskan')}${ui.check('r2', L.r2, 'Pasien kompeten dan memberi persetujuan sendiri')}
          <div class="row between"><span class="small muted">Pasien berhak menolak atau menarik persetujuan kapan saja.</span>${btnIf('Lanjut ke pertanyaan', { act: 'lanjut', variant: 'primary', size: 'lg' }, why)}</div></div>`;
      } else if (L.step === 1) {
        const qs = [{ q: 'Berapa lama saya dirawat setelah operasi?', a: 'Umumnya 1–2 hari, bila tidak ada komplikasi.' }].concat(L.qs);
        const why = !L.qs.length && !L.noQ ? 'Catat pertanyaan pasien, atau centang bahwa tidak ada pertanyaan lagi.' : '';
        inner = `<div class="stack">${qs.map((x) => `<div style="padding:10px 12px;border:1px solid var(--line);border-radius:10px"><b>“${E(x.q)}”</b><div class="small muted">Jawaban dokter: ${E(x.a)}</div></div>`).join('')}
          ${ui.field('Pertanyaan pasien', ui.input('q', L.q, { placeholder: 'Mis. Apakah bekas luka terlihat?' }), '', 'f-q')}
          <div class="row">${ui.btn('Catat pertanyaan', { act: 'tanya', needs: 'q:5' })}</div>
          ${ui.check('noQ', L.noQ, 'Pasien menyatakan tidak ada pertanyaan lagi')}
          <div class="row between">${ui.btn('Kembali', { act: 'kembali', size: 'lg' })}${btnIf('Lanjut ke tanda tangan', { act: 'lanjut', variant: 'primary', size: 'lg' }, why)}</div></div>`;
      } else if (!L.doneAt) {
        const miss = [!L.sigP && 'tanda tangan pasien', !L.sigW && 'tanda tangan saksi', !L.sigD && 'tanda tangan dokter'].filter(Boolean);
        inner = `<div class="stack"><div class="grid g3">
          <div class="stack" style="gap:6px"><span class="label">Pasien</span>${ui.sig('sigP', !!L.sigP, R.name)}<span class="small muted">${E(R.name)}</span></div>
          <div class="stack" style="gap:6px"><span class="label">Saksi keluarga</span>${ui.sig('sigW', !!L.sigW, 'Tn. Dimas (suami)')}<span class="small muted">Tn. Dimas Prakoso · suami</span></div>
          <div class="stack" style="gap:6px"><span class="label">Dokter pelaksana</span>${ui.sig('sigD', !!L.sigD, R.dokter)}<span class="small muted">${E(R.dokter)} · TTE</span></div></div>
          <div class="row between">${ui.btn('Kembali', { act: 'kembali', size: 'lg' })}${btnIf('Selesai · simpan persetujuan', { act: 'selesai', variant: 'primary', size: 'lg' }, miss.length ? `Belum lengkap: ${miss.join(', ')}.` : '')}</div></div>`;
      } else {
        inner = ui.alert('success', `Dokumen final · ${L.doneAt}`, `Persetujuan ${E(R.name)} untuk kolesistektomi laparoskopik ditandatangani pasien, saksi, dan ${E(R.dokter)} (TTE). Salinan masuk rekam medis dan aplikasi pasien.`);
      }
      const screen = `<div style="padding:20px;display:flex;flex-direction:column;gap:14px">
        <div class="row between"><div><div class="label">Persetujuan tindakan kedokteran · K11</div><div style="font-size:20px;font-weight:600">Kolesistektomi laparoskopik</div></div>${ui.chip(`Alergi: ${R.allergy.join(', ')}`, 'solid-danger')}</div>
        <div class="small muted">${E(R.name)} · RM ${E(R.rm)} · ${R.age} th · pemberi informasi ${E(R.dokter)}</div>${steps}${inner}</div>`;
      return `${ui.device('tablet', screen, 'Tablet persetujuan di samping tempat tidur pasien · Poli Bedah')}${L.doneAt ? ui.next('ok', `Persetujuan tindakan Ny. Ratna ditandatangani lengkap ${L.doneAt}`) : ''}`;
    },
    actions: {
      lanjut(L) {
        if (L.step === 0 && L.r0 && L.r1 && L.r2) L.step = 1;
        else if (L.step === 1 && (L.qs.length || L.noQ)) L.step = 2;
        else { SIM.toast('Langkah ini belum lengkap.', 'warning'); return; }
      },
      kembali(L) { if (!L.doneAt && L.step > 0) L.step -= 1; },
      tanya(L) {
        const q = String(L.q || '').trim();
        if (q.length < 5) { SIM.toast('Tulis pertanyaan pasien dulu.', 'warning'); return; }
        L.qs.push({ q, a: 'Dijawab langsung oleh dokter; tercatat di formulir edukasi.' });
        L.q = '';
      },
      selesai(L, J) {
        if (L.doneAt || L.step !== 2) return false;
        if (!L.sigP || !L.sigW || !L.sigD) { SIM.toast('Tiga tanda tangan wajib lengkap.', 'warning'); return; }
        L.doneAt = SIM.now(4);
        J.consent = { patient: 'ratna', procedure: 'Kolesistektomi laparoskopik', signedAt: L.doneAt };
        SIM.note('Persetujuan kolesistektomi laparoskopik Ny. Ratna ditandatangani pasien, saksi, dan dokter', 'success');
        SIM.done();
      },
    },
  });

  /* ---------- Resume medis pulang + gerbang tutup kunjungan (K13) ---------- */
  const RECON = [
    ['Amlodipin 5 mg', '1×1 pagi', 'Sebelum masuk', 'Lanjut'],
    ['Omeprazol 20 mg', '1×1 sebelum makan', 'Sebelum masuk (IV 40 mg saat rawat)', 'Lanjut, kembali oral'],
    ['Sefiksim 200 mg', '2×1 · 5 hari', 'Baru (ganti ceftriaxone IV)', 'Baru'],
    ['N-asetilsistein 200 mg', '3×1 · 5 hari', 'Selama rawat', 'Lanjut'],
    ['Enoksaparin 40 mg', 'SC 1×1', 'Selama rawat', 'Dihentikan'],
  ];

  SIM.register({
    id: 'resume',
    phase: 3,
    title: 'Resume medis pulang',
    nav: 'Resume medis',
    codes: 'K13',
    role: 'dokter',
    desc: 'Resume dihimpun otomatis dari asesmen IGD, CPPT, hasil penunjang, dan eMAR; rekonsiliasi obat pulang; gerbang tutup kunjungan.',
    hint: 'Konfirmasi rekonsiliasi obat, buat surat kontrol, bereskan daftar yang belum lengkap, lalu tanda tangani untuk menutup kunjungan.',
    init: { recon: '', surat: '', edu: false, orderOk: '', cosign: '', cara: 'Atas persetujuan dokter', sig: '', closedAt: '', instr: 'Minum obat sesuai jadwal sampai habis. Latihan napas dalam 3×/hari. Kembali ke IGD bila demam ≥ 38,5 °C, sesak memberat, atau dahak berdarah.' },
    render(L, J) {
      const H = PEOPLE.hartono;
      const bed = J.bed ? `${J.bed.ward} ${J.bed.room}` : 'Melati 3-02';
      const tri = J.igd ? `triase ${J.igd.triage} pukul ${J.igd.t}` : 'triase 2';
      const emar = J.emar ? `${J.emar.given} dosis tercatat hari ini${J.emar.override ? ' (1 verifikasi manual gelang)' : ''}` : 'riwayat pemberian H1–H5';
      const sample = !(J.igd && J.bed && J.emar);
      const secs = [
        ['Alasan masuk dan anamnesis', `Demam 4 hari, batuk berdahak, sesak. Masuk via IGD (${tri}).`, 'dari asesmen IGD'],
        ['Pemeriksaan fisik', 'Masuk: S 38,9 °C, RR 28, SpO2 90%, ronki basah kanan. Pulang: S 36,8 °C, RR 18, SpO2 97% udara bebas.', 'dari observasi + CPPT'],
        ['Pemeriksaan penunjang', 'Foto toraks: infiltrat lobus kanan bawah. Leukosit 16.200 → 8.900. Kreatinin 1,8 → 1,5 mg/dL. Kultur sputum: S. pneumoniae, sensitif seftriakson.', 'dari hasil lab dan radiologi'],
        ['Terapi selama dirawat', `Ceftriaxone 2 g IV 1×24 jam (H1–H5), enoksaparin 40 mg SC, N-asetilsistein, O2 nasal 3 lpm (H1–H3). eMAR: ${emar}.`, 'dari eMAR'],
        ['Perjalanan penyakit', 'Demam turun H3, sesak berkurang, O2 dilepas H4. Edukasi napas dalam oleh perawat.', 'dari CPPT'],
      ];
      const checks = [
        ['Diagnosis utama dan sekunder berkode', true, ''],
        ['Rekonsiliasi obat pulang dikonfirmasi DPJP', !!L.recon, 'rekon'],
        ['Edukasi dan instruksi pulang disampaikan', !!L.edu, ''],
        ['Surat kontrol BPJS dibuat', !!L.surat, 'surat'],
        ['Order terbuka: kultur darah 2 set (hasil akhir H+3) diserahkan ke kontrol', !!L.orderOk, 'tutupOrder'],
        ['CPPT residen 5 Okt 06.40 sudah co-sign DPJP', !!L.cosign, 'cosign'],
      ];
      const missing = checks.filter((c) => !c[1]);
      const closed = !!L.closedAt;
      const gateList = checks.map(([t, ok, act]) => `<div class="row between" style="padding:6px 0;border-bottom:1px solid var(--line-soft)"><span class="small" style="color:${ok ? 'var(--ink-700)' : 'var(--warning)'};font-weight:${ok ? 400 : 600}">${ok ? '✓' : '!'} ${E(t)}</span>${!ok && act && !closed ? ui.btn(act === 'rekon' ? 'Konfirmasi' : act === 'surat' ? 'Buat surat' : act === 'cosign' ? 'Co-sign' : 'Serahkan', { act, size: 'sm' }) : ''}</div>`).join('');

      const main = `<div class="stack">${secs.map(([t, b, src]) => ui.card({ title: t, actions: ui.chip(src, 'info'), body: `<div class="small">${E(b)}</div>` })).join('')}
        ${ui.card({ title: 'Diagnosis dan prosedur', actions: ui.chip('dari CPPT DPJP', 'info'), body: `${kv('Utama', '<b class="mono">J18.9</b> Pneumonia, tidak spesifik')}${kv('Sekunder', '<span class="mono">I10</span> Hipertensi esensial · <span class="mono">N18.3</span> PGK stadium 3')}${kv('Prosedur', '<span class="mono">87.44</span> Foto toraks rutin')}` })}
        ${ui.card({ title: 'Rekonsiliasi obat pulang', actions: L.recon ? ui.chip(`Dikonfirmasi DPJP · ${L.recon}`, 'success') : btnIf('Konfirmasi rekonsiliasi', { act: 'rekon', size: 'sm', variant: 'primary' }, closed ? 'Resume sudah final.' : ''), flush: true,
          body: ui.table(['Obat', 'Aturan pakai', 'Asal', 'Keputusan'], RECON.map((r) => [`<b>${E(r[0])}</b>`, E(r[1]), `<span class="small muted">${E(r[2])}</span>`, ui.chip(r[3], r[3] === 'Baru' ? 'info' : r[3] === 'Dihentikan' ? 'warning' : 'success')])) })}
        ${ui.card({ title: 'Instruksi pulang dan tindak lanjut', body: `<div class="stack">${closed ? `<div class="small">${E(L.instr)}</div>` : ui.input('instr', L.instr, { area: true })}${ui.check('edu', L.edu, 'Edukasi dan tanda bahaya sudah dibacakan ke pasien dan keluarga')}
          ${kv('Kontrol', 'Poli Paru · 14 Okt 2026 · ' + E(H.dokter))}${kv('Surat kontrol', L.surat ? `<b class="mono">${E(L.surat)}</b> · terkirim ke Mobile JKN` : btnIf('Buat surat kontrol', { act: 'surat', size: 'sm' }, closed ? 'Resume sudah final.' : ''))}
          ${ui.field('Cara pulang', ui.select('cara', L.cara, ['Atas persetujuan dokter', 'Pulang atas permintaan sendiri', 'Dirujuk']), '', 'f-cara')}</div>` })}</div>`;

      const side = ui.card({
        title: 'Gerbang tutup kunjungan', sub: `${checks.length - missing.length}/${checks.length} lengkap`, tone: missing.length ? 'warning' : 'success',
        body: `<div class="stack">${gateList}
          ${closed ? ui.alert('success', `Kunjungan ditutup · ${L.closedAt}`, `Resume final ber-TTE. Terkirim ke antrean koder (INA-CBG) dan SATUSEHAT; bed ${E(bed)} masuk antrean dibersihkan.`)
            : `${missing.length ? ui.alert('warning', 'Kunjungan belum bisa ditutup', E(`Lengkapi: ${missing.map((m) => m[0].toLowerCase()).join('; ')}.`)) : ui.alert('success', 'Semua butir lengkap', 'Tanda tangani untuk mengunci resume.')}
            <span class="label">Tanda tangan DPJP</span>${ui.sig('sig', !!L.sig, H.dokter)}
            ${btnIf('Tanda tangani dan tutup kunjungan', { act: 'tutup', variant: 'primary' }, missing.length ? `${missing.length} butir belum lengkap.` : !L.sig ? 'Ketuk kotak tanda tangan DPJP dulu.' : '')}`}
          <span class="small muted">Setelah final, perubahan hanya lewat addendum berversi.</span></div>`,
      });
      return `${ui.banner(H, `${ui.chip(`${bed} · pulang 5 Okt`, 'brand')}${ui.chip('LOS 5 hari', '')}${sample ? contoh() : ''}`)}
        ${closed ? ui.next('pembiayaan', `Resume Tn. Hartono ditandatangani dan kunjungan ditutup ${L.closedAt}`) : ''}
        <div class="grid" style="grid-template-columns:minmax(0,1.5fr) minmax(0,1fr);align-items:start">${main}${side}</div>`;
    },
    actions: {
      rekon(L) { if (!L.closedAt && !L.recon) L.recon = SIM.now(2); },
      surat(L) { if (!L.closedAt && !L.surat) { SIM.now(1); L.surat = '0901R0011025K000045'; SIM.toast('Surat kontrol BPJS terbit', 'success'); } },
      tutupOrder(L) { if (!L.closedAt) L.orderOk = SIM.now(1); },
      cosign(L) { if (!L.closedAt) L.cosign = SIM.now(1); },
      tutup(L, J) {
        if (L.closedAt) return false;
        if (!L.recon || !L.edu || !L.surat || !L.orderOk || !L.cosign || !L.sig) { SIM.toast('Masih ada butir gerbang yang belum lengkap.', 'warning'); return; }
        L.closedAt = SIM.now(4);
        J.discharge = { patient: 'hartono', t: L.closedAt };
        SIM.note('Resume Tn. Hartono ber-TTE, kunjungan rawat inap ditutup', 'success');
        SIM.done();
      },
    },
  });

  /* =====================================================================
   * FASE 4 · Penunjang
   * ===================================================================== */

  /* ---------- Laboratorium: worklist, analyzer, nilai kritis, validasi (S01, S09) ---------- */
  const LAB_DEF = [
    { kind: 'lab', code: 'HBA1C', name: 'HbA1c', price: 95000 },
    { kind: 'lab', code: 'GDP', name: 'Glukosa darah puasa', price: 25000 },
    { kind: 'lab', code: 'LIPID', name: 'Profil lipid', price: 120000 },
    { kind: 'lab', code: 'KREAT', name: 'Kreatinin serum', price: 45000 },
  ];
  const r = (name, value, unit, ref, flag, trend) => ({ name, value, unit, ref, flag, trend });
  const LAB_RES = {
    HBA1C: [r('HbA1c', '8,6', '%', '< 5,7', 'H', '7,9 → 8,6')],
    GDP: [r('Glukosa darah puasa', '182', 'mg/dL', '70–99', 'H', '168 → 182')],
    LIPID: [r('Kolesterol total', '228', 'mg/dL', '< 200', 'H', '—'), r('LDL', '152', 'mg/dL', '< 100', 'H', '—'), r('HDL', '38', 'mg/dL', '> 40', 'L', '—'), r('Trigliserida', '190', 'mg/dL', '< 150', 'H', '—')],
    KREAT: [r('Kreatinin', '1,0', 'mg/dL', '0,7–1,3', 'N', '1,0 → 1,0')],
    GDS: [r('Glukosa sewaktu (vena)', '274', 'mg/dL', '70–140', 'H', '—')],
  };
  const LAB_CRIT = [r('Natrium', '134', 'mmol/L', '135–145', 'L', '138 → 134'), r('Kalium', '6,4', 'mmol/L', '3,5–5,1', 'Kritis', '5,2 → 6,4'), r('Ureum', '96', 'mg/dL', '15–40', 'H', '82 → 96'), r('Kreatinin', '3,4', 'mg/dL', '0,7–1,3', 'H', '3,1 → 3,4')];
  const LAB_STAGES = ['Sampel diambil', 'Diterima lab', 'Dikerjakan analyzer', 'Validasi', 'Dirilis'];
  const LAB_OTHER = [
    { id: 'lestari', name: 'Ny. Lestari', meta: 'VK · DL, golongan darah', status: 'Validasi', tone: 'info' },
    { id: 'raka', name: 'An. Raka P.', meta: 'Anak · DL · cito', status: 'Di analyzer', tone: '' },
    { id: 'bambang', name: 'Tn. Bambang H.', meta: 'ICU · analisa gas darah', status: 'Dirilis', tone: 'success' },
  ];
  const labOrders = (J) => (Array.isArray(J.orders) ? J.orders.filter((o) => o.kind === 'lab') : []);
  function labItems(J) {
    const ord = labOrders(J);
    const list = ord.length ? ord : LAB_DEF;
    return [].concat(...list.map((o) => LAB_RES[o.code] || [r(o.name || o.code || 'Pemeriksaan', 'normal', '', '—', 'N', '—')]));
  }

  SIM.register({
    id: 'lab',
    phase: 4,
    title: 'Laboratorium',
    nav: 'Laboratorium',
    codes: 'S01 · S09',
    role: 'lab',
    desc: 'Worklist sampel dari CPOE: pengambilan, penerimaan, hasil analyzer, validasi. Nilai kritis wajib dilaporkan ke DPJP dengan baca ulang sebelum rilis.',
    hint: 'Majukan sampel Tn. Suryo sampai hasil analyzer keluar, lalu validasi. Coba juga Tn. Darmawan: kalium 6,4 harus dilaporkan dulu.',
    init: { sel: 'suryo', st: { suryo: 0, darmawan: 3 }, tt: { suryo: [], darmawan: ['08.52', '08.58', '09.10'] }, critName: '', critRb: false, critDone: '', critTo: '', valAt: {} },
    render(L, J) {
      const ord = labOrders(J);
      const items = labItems(J);
      const critOpen = L.st.darmawan >= 3 && !L.critDone;
      const stLabel = (n) => ['Menunggu sampel', 'Sampel diambil', 'Diterima', 'Hasil analyzer', 'Dirilis'][n] || 'Dirilis';
      const work = [
        { id: 'darmawan', title: 'Tn. Darmawan S.', sub: 'Melati 3-04 · elektrolit, ureum, kreatinin · cito', right: critOpen ? ui.chip('Kritis', 'solid-danger') : ui.chip(stLabel(L.st.darmawan), L.st.darmawan >= 4 ? 'success' : 'warning') },
        { id: 'suryo', title: 'Tn. Suryo A. Nugroho', sub: `Poli PD · ${(ord.length ? ord : LAB_DEF).map((o) => o.name).join(', ')}`, right: `${ui.chip(stLabel(L.st.suryo), L.st.suryo >= 4 ? 'success' : L.st.suryo === 3 ? 'info' : '')}${ord.length ? '' : contoh()}` },
      ].concat(LAB_OTHER.map((o) => ({ id: o.id, title: o.name, sub: o.meta, right: ui.chip(o.status, o.tone) })));
      const kpis = `<div class="grid g4">${ui.kpi('Sampel hari ini', '412', '38 menunggu validasi')}${ui.kpi('TAT rutin', '58 mnt', 'target ≤ 60 mnt', 'up')}${ui.kpi('Nilai kritis terbuka', critOpen ? '1' : '0', critOpen ? 'belum dilaporkan' : 'semua sudah dilaporkan', critOpen ? 'down' : 'up')}${ui.kpi('Analyzer', '2 terhubung', 'Sysmex XN · Cobas c311')}</div>`;
      const left = ui.card({ title: 'Worklist sampel', sub: 'urut prioritas, lalu waktu', flush: true, body: ui.list(work.map((w) => Object.assign(w, { arg: w.id, sel: L.sel === w.id, htmlTitle: false })), 'pilih') });

      let right;
      if (L.sel === 'suryo' || L.sel === 'darmawan') {
        const crit = L.sel === 'darmawan';
        const st = L.st[L.sel];
        const tt = L.tt[L.sel];
        const res = crit ? LAB_CRIT : items;
        const P = crit ? null : PEOPLE.suryo;
        const head = crit ? '<b>Tn. Darmawan S.</b> · L · 66 th · RM 00-33-18-02 · Melati 3-04 · pengirim dr. Andi Wiratama, Sp.PD · cito'
          : `<b>${E(P.name)}</b> · RM ${E(P.rm)} · Poli PD · pengirim ${E(P.dokter)} · no. lab <span class="mono">L2610050151</span>`;
        const next = ['Ambil sampel · cetak label barcode', 'Terima sampel di lab', 'Kerjakan · kirim ke analyzer'][st];
        const table = st >= 3 ? ui.table(['Pemeriksaan', { label: 'Hasil', r: true }, 'Satuan', 'Rujukan', 'Flag', 'Tren'], res.map((x) => [E(x.name), `<b style="color:${x.flag === 'Kritis' ? 'var(--danger)' : x.flag !== 'N' ? 'var(--warning)' : 'var(--ink-900)'}">${E(x.value)}</b>`, E(x.unit), E(x.ref), ui.chip(x.flag === 'N' ? 'Normal' : x.flag, x.flag === 'Kritis' ? 'solid-danger' : x.flag === 'N' ? '' : 'warning'), `<span class="small muted">${E(x.trend)}</span>`]))
          : ui.empty(st === 0 ? 'Order masuk dari CPOE. Ambil sampel dan tempel label barcode.' : 'Hasil tampil setelah analyzer mengirim data.');
        let gate = '';
        if (crit && st >= 3) {
          gate = L.critDone ? ui.alert('success', `Nilai kritis dilaporkan ${L.critDone}`, `Diterima ${E(L.critTo)} · baca ulang terkonfirmasi · durasi lapor 9 menit (target ≤ 30 menit).`)
            : ui.gate({ title: 'Nilai kritis: Kalium 6,4 mmol/L · Tn. Darmawan S. (Melati 3-04)', body: `Wajib dilaporkan ke DPJP/dokter jaga ≤ 30 menit dengan baca ulang. Terdeteksi 09.10 · sampel tidak hemolisis · QC lolos.<div class="stack" style="margin-top:8px">${ui.field('Nama penerima laporan (DPJP / dokter jaga)', ui.input('critName', L.critName, { placeholder: 'Mis. dr. Andi Wiratama, Sp.PD' }), '', 'f-critName')}${ui.check('critRb', L.critRb, 'Penerima mengulang nilai "Kalium 6,4 mmol/L" dengan benar (baca ulang)')}</div>`, follow: { label: 'Simpan pelaporan', act: 'lapor' } });
        }
        let action = '';
        if (st < 3) action = ui.btn(next, { act: 'maju', arg: L.sel, variant: 'primary' });
        else if (st === 3) action = btnIf('Validasi dan rilis hasil', { act: 'validasi', variant: 'primary' }, crit && !L.critDone ? 'Laporkan nilai kritis ke dokter (dengan baca ulang) sebelum validasi.' : '');
        const tl = ui.timeline(LAB_STAGES.slice(0, 4).map((s, i) => ({ t: (i < 3 ? tt[i] : L.valAt[L.sel]) || '', text: s, tone: i < st || (i === 3 && st >= 4) ? 'success' : '' })));
        right = `<div class="stack">${ui.card({ title: crit ? 'Elektrolit dan fungsi ginjal' : 'Monitoring DM + lipid', sub: head, html: true, actions: st >= 4 ? ui.chip(`Tervalidasi · ${L.valAt[L.sel] || ''}`, 'success') : '', body: `<div class="stack">${ui.steps(LAB_STAGES, st >= 4 ? 5 : st)}${gate}${table}
          ${st >= 3 ? `<span class="small muted">${crit ? 'Delta check: kalium naik 1,2 dalam 24 jam' : 'Delta check: HbA1c naik 0,7 dari Juli'} · QC harian lolos (Westgard 1-2s) · hasil dari analyzer, belum diubah manual</span>` : ''}
          <div class="row">${action}</div>
          ${st >= 4 && !crit ? ui.next('farmasi', `Hasil lab Tn. Suryo tervalidasi ${L.valAt.suryo}: HbA1c 8,6 % (H)`) : ''}</div>` })}
          ${ui.card({ title: 'Alur sampel', body: `${tl}<div class="small muted">Setelah validasi: hasil tampil di CPPT, notifikasi ke DPJP, tarif masuk tagihan otomatis.</div>` })}</div>`;
      } else {
        const o = LAB_OTHER.find((x) => x.id === L.sel) || LAB_OTHER[0];
        right = ui.card({ title: o.name, sub: o.meta, body: `${ui.alert('info', `Status: ${o.status}`, 'Pasien contoh di luar tur. Tur mengikuti Tn. Suryo dan contoh nilai kritis Tn. Darmawan.')}<div style="margin-top:10px">${ui.btn('Buka Tn. Suryo', { act: 'pilih', arg: 'suryo', variant: 'primary' })}</div>` });
      }
      return `${kpis}${critOpen ? ui.alert('danger', 'Ada 1 nilai kritis belum dilaporkan', 'Kalium 6,4 mmol/L · Tn. Darmawan S. · timer 30 menit berjalan.') : ''}${ui.split(left, right)}`;
    },
    actions: {
      pilih(L, J, el) { if (el.dataset.arg) L.sel = el.dataset.arg; },
      maju(L, J, el) {
        const id = el.dataset.arg || L.sel;
        if (!(id in L.st) || L.st[id] >= 3) return false;
        L.tt[id][L.st[id]] = SIM.now(L.st[id] === 2 ? 20 : 4);
        L.st[id] += 1;
        if (id === 'suryo' && L.st.suryo === 1) SIM.note('Sampel darah Tn. Suryo diambil · label barcode L2610050151', 'brand');
      },
      lapor(L) {
        if (L.critDone || L.st.darmawan < 3) return false;
        if (String(L.critName || '').trim().length < 3) { SIM.toast('Nama penerima laporan wajib diisi.', 'warning'); return; }
        if (!L.critRb) { SIM.toast('Baca ulang wajib dikonfirmasi.', 'warning'); return; }
        L.critDone = SIM.now(2);
        L.critTo = String(L.critName).trim();
        SIM.note(`Nilai kritis kalium 6,4 (Tn. Darmawan) dilaporkan ke ${L.critTo} dengan baca ulang`, 'danger');
      },
      validasi(L, J) {
        const id = L.sel;
        if (!(id in L.st) || L.st[id] !== 3) return false;
        if (id === 'darmawan' && !L.critDone) { SIM.toast('Laporkan nilai kritis dulu.', 'warning'); return; }
        L.valAt[id] = SIM.now(3);
        L.st[id] = 4;
        if (id === 'suryo') {
          J.labResult = { items: labItems(J).map((x) => ({ name: x.name, value: x.value, unit: x.unit, ref: x.ref, flag: x.flag })), validatedAt: L.valAt.suryo, critical: false };
          SIM.note('Hasil lab Tn. Suryo tervalidasi: HbA1c 8,6 % (H), dirilis ke CPPT dan DPJP', 'success');
          SIM.done();
        } else SIM.note('Hasil kritis Tn. Darmawan dirilis setelah dilaporkan', 'success');
      },
    },
  });

  /* ---------- Radiologi: worklist → jadwal → akuisisi → ekspertise (S03) ---------- */
  const RAD_FD = {
    hartono: 'Cor: ukuran normal (CTR < 0,5). Pulmo: tampak infiltrat di lapangan bawah paru kanan, corakan bronkovaskular meningkat. Sinus kostofrenikus kanan tumpul minimal. Diafragma licin. Tulang intak.',
    suryo: 'Cor: ukuran dan bentuk normal (CTR < 0,5). Pulmo: corakan bronkovaskular normal, tidak tampak infiltrat atau nodul. Sinus kostofrenikus tajam. Diafragma licin. Tulang intak.',
  };
  const RAD_IM = { hartono: 'Pneumonia lobus kanan bawah dengan efusi pleura minimal kanan.', suryo: 'Cor dan pulmo dalam batas normal.' };
  const RAD_STAGES = ['Order masuk', 'Dijadwalkan', 'Foto diambil', 'Ekspertise', 'Terkirim'];

  SIM.register({
    id: 'radiologi',
    phase: 4,
    title: 'Radiologi',
    nav: 'Radiologi',
    codes: 'S03',
    role: 'rad',
    desc: 'Worklist pemeriksaan: jadwal modalitas, akuisisi citra dengan cek identitas, ekspertise radiolog ber-TTE, kirim ke pengirim.',
    hint: 'Pilih foto toraks Tn. Hartono, jadwalkan, cek identitas, ambil foto, lalu tanda tangani ekspertise dan kirim.',
    init: { sel: 'hartono', ex: { hartono: 0, suryo: 0 }, at: { hartono: [], suryo: [] }, slot: '09.30', idok: false, fd_hartono: RAD_FD.hartono, im_hartono: RAD_IM.hartono, fd_suryo: RAD_FD.suryo, im_suryo: RAD_IM.suryo },
    render(L, J) {
      const suryoRad = Array.isArray(J.orders) && J.orders.some((o) => o.kind === 'rad');
      const exams = [
        { id: 'hartono', name: 'Tn. Hartono Wibisono', proc: 'Foto toraks AP portabel', from: J.bed ? `${J.bed.ward} ${J.bed.room}` : 'IGD R2', prio: 'Cito', ind: 'Pneumonia, SpO2 90%, sesak', sample: !J.igd },
        suryoRad ? { id: 'suryo', name: 'Tn. Suryo Adi Nugroho', proc: 'Foto toraks PA', from: 'Poli PD', prio: 'Rutin', ind: 'Skrining DM + hipertensi', sample: false } : null,
      ].filter(Boolean);
      const statics = [['Ny. Ratna Sari', 'Foto toraks PA · pra-operasi', 'Terkirim'], ['Tn. Agus S.', 'CT kepala tanpa kontras · 11.00', 'Dijadwalkan'], ['Ny. Lestari', 'USG obstetri · VK', 'Ekspertise']];
      const stName = (n) => ['Order masuk', 'Dijadwalkan', 'Menunggu ekspertise', 'Terkirim'][n];
      const list = ui.list(exams.map((e) => ({ arg: e.id, sel: L.sel === e.id, title: `${e.name}`, sub: `${e.proc} · ${e.from}`, right: `${ui.chip(e.prio, e.prio === 'Cito' ? 'danger' : '')}${ui.chip(stName(L.ex[e.id]), L.ex[e.id] === 3 ? 'success' : L.ex[e.id] ? 'info' : '')}${e.sample ? contoh() : ''}` }))
        .concat(statics.map((s) => ({ arg: 'lain', title: s[0], sub: s[1], right: ui.chip(s[2], s[2] === 'Terkirim' ? 'success' : '') }))), 'pilih');
      const kpis = `<div class="grid g4">${ui.kpi('Pemeriksaan hari ini', `${46 + exams.length}`, 'semua modalitas')}${ui.kpi('Menunggu ekspertise', `${3 + exams.filter((e) => L.ex[e.id] === 2).length}`, 'perlu dibaca radiolog')}${ui.kpi('Cito terbuka', `${exams.filter((e) => e.prio === 'Cito' && L.ex[e.id] < 3).length}`, 'prioritaskan')}${ui.kpi('TAT ekspertise', '42 mnt', 'target ≤ 60 mnt', 'up')}</div>`;
      const e = exams.find((x) => x.id === L.sel);
      let right;
      if (!e) right = ui.card({ title: 'Pemeriksaan contoh', body: ui.alert('info', 'Di luar tur', 'Pilih pemeriksaan Tn. Hartono untuk mencoba alurnya.') });
      else {
        const st = L.ex[e.id];
        const at = L.at[e.id];
        const img = st >= 2 ? `<div style="aspect-ratio:4/3;max-width:440px;border-radius:12px;background:var(--device);color:var(--device-ink);display:grid;place-items:center;text-align:center"><div><div class="mono small">DICOM · CR · 2 citra</div><b style="font-size:18px">${E(e.proc)}</b><div class="small">diambil ${E(at[1] || '')} · ${E(STAFF.rad.name)}</div></div></div>`
          : `<div style="aspect-ratio:4/3;max-width:440px;border-radius:12px;border:2px dashed var(--line-strong);display:grid;place-items:center" class="muted small">Belum ada citra</div>`;
        let act;
        if (st === 0) act = `<div class="field"><label>Slot modalitas DR-1 (portabel)</label>${ui.seg('slot', L.slot, ['09.30', '10.00', '10.30'])}</div><div>${ui.btn(`Jadwalkan ${L.slot}`, { act: 'jadwal', variant: 'primary' })}</div>`;
        else if (st === 1) act = `${ui.check('idok', L.idok, 'Identitas dicek dengan 2 penanda (nama + tanggal lahir) dan gelang')}<div class="small muted">Skrining kehamilan dan kontras: tidak relevan untuk foto toraks tanpa kontras.</div><div>${btnIf('Ambil foto · kirim ke PACS', { act: 'foto', variant: 'primary' }, L.idok ? '' : 'Cek identitas pasien dengan 2 penanda dulu.')}</div>`;
        else if (st === 2) act = `${ui.field('Temuan', ui.input(`fd_${e.id}`, L[`fd_${e.id}`], { area: true, rows: 4 }), 'Templat foto toraks · minimal 20 huruf', `f-fd_${e.id}`)}${ui.field('Kesan', ui.input(`im_${e.id}`, L[`im_${e.id}`], { area: true }), 'Minimal 10 huruf', `f-im_${e.id}`)}<div>${ui.btn('Tanda tangani ekspertise (TTE) dan kirim', { act: 'kirim', variant: 'primary', needs: `fd_${e.id}:20,im_${e.id}:10` })}</div>`;
        else act = `${ui.alert('success', `Ekspertise terkirim ${at[2] || ''}`, `dr. Sari Dewi, Sp.Rad (TTE). Kesan: ${E(L[`im_${e.id}`])} Hasil tampil di CPPT dan notifikasi ke pengirim.`)}${ui.next('farmasi', `Ekspertise ${e.proc} ${e.name} terkirim ${at[2] || ''}`)}`;
        right = ui.card({ title: `${e.proc} · ${e.name}`, sub: `${e.from} · indikasi: ${e.ind}`, actions: ui.chip(e.prio, e.prio === 'Cito' ? 'danger' : ''), body: `<div class="stack">${ui.steps(RAD_STAGES, st >= 3 ? 5 : st + 1)}${img}${act}${st >= 1 ? `<span class="small muted">Dijadwalkan ${E(at[0] || '')} · DR-1 slot ${E(L.slot)}</span>` : ''}</div>` });
      }
      return `${kpis}<div class="row">${ui.chip('● PACS terhubung (DICOM)', 'success')}${ui.chip('● Worklist modalitas aktif', 'success')}</div>${ui.split(ui.card({ title: 'Worklist pemeriksaan', flush: true, body: list }), right)}`;
    },
    actions: {
      pilih(L, J, el) { L.sel = el.dataset.arg || 'hartono'; },
      jadwal(L) { const id = L.sel; if (!(id in L.ex) || L.ex[id] !== 0) return false; L.at[id][0] = SIM.now(2); L.ex[id] = 1; L.idok = false; },
      foto(L) {
        const id = L.sel;
        if (!(id in L.ex) || L.ex[id] !== 1) return false;
        if (!L.idok) { SIM.toast('Cek identitas 2 penanda dulu.', 'warning'); return; }
        L.at[id][1] = SIM.now(8);
        L.ex[id] = 2;
      },
      kirim(L) {
        const id = L.sel;
        if (!(id in L.ex) || L.ex[id] !== 2) return false;
        if (String(L[`fd_${id}`] || '').trim().length < 20 || String(L[`im_${id}`] || '').trim().length < 10) { SIM.toast('Lengkapi temuan dan kesan.', 'warning'); return; }
        L.at[id][2] = SIM.now(15);
        L.ex[id] = 3;
        SIM.note(`Ekspertise foto toraks ${id === 'hartono' ? 'Tn. Hartono' : 'Tn. Suryo'} ditandatangani radiolog dan dikirim`, 'success');
        SIM.done();
      },
    },
  });

  /* ---------- Farmasi: telaah, penyiapan (stok depo, FEFO), serah + edukasi (S04, S05) ---------- */
  const RX_DEF = [
    { name: 'Metformin 500 mg', sig: '500 mg 2 × 1 sesudah makan', qty: 60, price: 18000 },
    { name: 'Glimepirid 2 mg', sig: '1 × 1 sebelum makan pagi', qty: 30, price: 21000 },
    { name: 'Amlodipin 10 mg', sig: '1 × 1 pagi', qty: 30, price: 15000 },
  ];
  const STOCK = {
    metformin: [['MF24-091', '03-2027', 540], ['MF25-022', '11-2027', 900]],
    glimepirid: [['GL24-118', '01-2027', 120], ['GL25-007', '08-2027', 300]],
    amlodipin: [['AM25-031', '06-2027', 400], ['AM25-090', '12-2027', 600]],
    klindamisin: [['KL25-014', '04-2027', 200]],
  };
  const HIGH_ALERT = /glimepirid|insulin|glibenklamid/i;
  const stockOf = (name) => { const k = Object.keys(STOCK).find((s) => name.toLowerCase().includes(s)); return k ? STOCK[k] : [['UM25-001', '12-2027', 500]]; };
  /** Batch FEFO: kedaluwarsa terdekat yang stoknya cukup. */
  const fefo = (name, qty) => { const b = stockOf(name); return b.find((x) => x[2] >= qty) || b[0]; };
  const TELAAH = ['Benar pasien (nama + tanggal lahir)', 'Benar obat (Fornas, sediaan)', 'Benar dosis (sesuai eGFR 78)', 'Benar rute (oral)', 'Benar waktu (aturan pakai jelas)', 'Benar informasi (edukasi disiapkan)', 'Benar dokumentasi (resep ber-TTE)'];
  const SERAH = ['Identitas dicek dengan 2 penanda', 'Obat dicocokkan dengan resep dan etiket', 'Edukasi aturan pakai dan penyimpanan', 'Edukasi tanda hipoglikemia dan cara mengatasinya'];

  SIM.register({
    id: 'farmasi',
    phase: 4,
    title: 'Farmasi rawat jalan',
    nav: 'Farmasi',
    codes: 'S04 · S05',
    role: 'apoteker',
    desc: 'Resep elektronik dari CPOE: telaah 7 benar dan interaksi, penyiapan dengan batch FEFO dan stok depo, serah terima dengan edukasi.',
    hint: 'Telaah resep Tn. Suryo, lakukan verifikasi ganda untuk glimepirid (high alert), siapkan, lalu serahkan dengan edukasi.',
    init: { sel: 'suryo', stage: 0, t0: false, t1: false, t2: false, t3: false, t4: false, t5: false, t6: false, ackInt: false, telaahT: '', dcName: '', dc: '', prepT: '', s0: false, s1: false, s2: false, s3: false, doneT: '' },
    render(L, J) {
      const sample = !(Array.isArray(J.rx) && J.rx.length);
      const rx = sample ? RX_DEF : J.rx;
      const ha = rx.filter((x) => HIGH_ALERT.test(x.name || ''));
      const hasGlim = rx.some((x) => /glimepirid/i.test(x.name || '')) && rx.some((x) => /metformin/i.test(x.name || ''));
      const stName = ['Telaah', 'Penyiapan', 'Serah terima', 'Diserahkan'][L.stage];
      const queue = ui.list([
        { arg: 'suryo', sel: L.sel === 'suryo', title: 'Tn. Suryo Adi Nugroho', sub: `Poli PD · ${rx.length} item · resep R-2610-0912`, right: `${ui.chip(stName, L.stage === 3 ? 'success' : 'info')}${sample ? contoh() : ''}` },
        { arg: 'hartono', sel: L.sel === 'hartono', title: 'Tn. Hartono Wibisono', sub: 'Melati 3-02 · ceftriaxone, enoksaparin', right: ui.chip('Telaah', 'warning') },
        { arg: 'ratna', sel: L.sel === 'ratna', title: 'Ny. Ratna Sari', sub: 'OK 2 · profilaksis sefazolin 2 g', right: ui.chip('Penyiapan', 'info') },
        { arg: 'joko', sel: L.sel === 'joko', title: 'Tn. Joko S.', sub: 'Poli Jantung · 5 item', right: ui.chip('Siap diserahkan', 'success') },
      ], 'pilih');
      const left = ui.card({ title: 'Antrean resep', sub: 'Depo farmasi rawat jalan', flush: true, body: queue });
      if (L.sel !== 'suryo') return `${ui.split(left, ui.card({ title: 'Resep contoh', body: `${ui.alert('info', 'Di luar tur', 'Tur mengikuti resep Tn. Suryo dari CPOE.')}<div style="margin-top:10px">${ui.btn('Buka resep Tn. Suryo', { act: 'pilih', arg: 'suryo', variant: 'primary' })}</div>` }))}`;

      const P = PEOPLE.suryo;
      const rxTable = ui.table(['Obat', 'Aturan pakai', { label: 'Jumlah', r: true }, 'CDS'], rx.map((x) => [`<b>${E(x.name)}</b>${HIGH_ALERT.test(x.name || '') ? ` ${ui.chip('high alert', 'danger')}` : ''}`, E(x.sig || ''), `${Number(x.qty) || 0}`, HIGH_ALERT.test(x.name || '') || (hasGlim && /metformin/i.test(x.name || '')) ? ui.chip('Interaksi', 'warning') : ui.chip('Aman', 'success')]));
      let body;
      if (L.stage === 0) {
        const left7 = TELAAH.filter((t, i) => !L[`t${i}`]).length;
        const why = left7 ? `Lengkapi ${left7} butir telaah.` : hasGlim && !L.ackInt ? 'Tindak lanjuti peringatan interaksi.' : '';
        body = `<div class="stack">${hasGlim ? ui.alert('warning', 'Interaksi: glimepirid + metformin', 'Efek hipoglikemia bertambah; riwayat hipoglikemia berat 2025. Dokter sudah menanggapi di CPOE. Edukasi tanda hipoglikemia wajib saat serah.') : ''}
          ${hasGlim ? ui.check('ackInt', L.ackInt, 'Ditindaklanjuti: edukasi hipoglikemia masuk catatan serah terima') : ''}
          <div class="row between"><span class="label">Telaah resep · 7 benar</span>${ui.btn('Tandai semua sesuai', { act: 'cekSemua', size: 'sm', variant: 'ghost' })}</div>
          <div class="grid g2">${TELAAH.map((t, i) => ui.check(`t${i}`, !!L[`t${i}`], t)).join('')}</div>
          <div class="row">${btnIf('Telaah selesai · lanjut penyiapan', { act: 'telaah', variant: 'primary' }, why)}</div></div>`;
      } else if (L.stage === 1) {
        const prep = ui.table(['Obat', { label: 'Jumlah', r: true }, 'Batch (FEFO)', 'Kedaluwarsa', { label: 'Stok depo', r: true }], rx.map((x) => {
          const b = fefo(x.name || '', Number(x.qty) || 0);
          return [E(x.name), `${Number(x.qty) || 0}`, `<span class="mono">${E(b[0])}</span>`, E(b[1]), `${fmt(b[2])}`];
        }));
        const gate = ha.length && !L.dc ? ui.gate({ title: `Obat high alert: ${ha.map((x) => x.name).join(', ')} · wajib verifikasi ganda`, body: `Apoteker kedua memeriksa ulang obat, kekuatan, dan jumlah sebelum diberi etiket.<div style="margin-top:8px">${ui.field('Nama apoteker kedua (bukan penyiap)', ui.input('dcName', L.dcName, { placeholder: 'Mis. apt. Yusuf Saputra' }), '', 'f-dcName')}</div>`, follow: { label: 'Konfirmasi verifikasi ganda', act: 'cekGanda' } })
          : ha.length ? ui.alert('success', `Verifikasi ganda oleh ${L.dc}`, 'Tercatat bersama jam dan batch.') : '';
        body = `<div class="stack">${ui.alert('success', `Telaah selesai ${L.telaahT}`, `${E(STAFF.apoteker.name)} · tidak ada masalah terbuka.`)}${prep}<span class="small muted">Batch dengan kedaluwarsa terdekat keluar lebih dulu (FEFO). Stok berkurang saat obat selesai disiapkan.</span>${gate}
          <div class="row">${btnIf('Selesai disiapkan · cetak etiket', { act: 'siapkan', variant: 'primary' }, ha.length && !L.dc ? 'Verifikasi ganda obat high alert belum dilakukan.' : '')}</div></div>`;
      } else {
        const moved = ui.table(['Obat', 'Batch', { label: 'Stok sebelum', r: true }, { label: 'Keluar', r: true }, { label: 'Stok sesudah', r: true }], rx.map((x) => {
          const q = Number(x.qty) || 0; const b = fefo(x.name || '', q);
          return [E(x.name), `<span class="mono">${E(b[0])}</span> · ED ${E(b[1])}`, fmt(b[2]), `−${q}`, `<b>${fmt(b[2] - q)}</b>`];
        }));
        if (L.stage === 2) {
          const left4 = SERAH.filter((t, i) => !L[`s${i}`]).length;
          body = `<div class="stack">${ui.alert('success', `Disiapkan ${L.prepT}`, 'Etiket tercetak dengan barcode untuk pindai eMAR/ulang resep.')}${moved}<span class="label">Serah terima dan edukasi</span>${SERAH.map((t, i) => ui.check(`s${i}`, !!L[`s${i}`], t)).join('')}
            <div class="row">${btnIf('Serahkan obat ke pasien', { act: 'serah', variant: 'primary' }, left4 ? `Lengkapi ${left4} centang lagi.` : '')}</div></div>`;
        } else {
          body = `<div class="stack">${ui.alert('success', `Obat diserahkan ${L.doneT}`, `${E(STAFF.apoteker.name)} · edukasi tercatat · stok depo diperbarui.`)}${moved}${ui.next('kasir', `Obat Tn. Suryo diserahkan ${L.doneT}, stok depo berkurang sesuai batch FEFO`)}</div>`;
        }
      }
      return `${ui.banner(P, `${ui.chip('Resep R-2610-0912', 'brand')}${sample ? contoh() : ''}`)}${ui.split(left, `<div class="stack">${ui.steps(['Telaah', 'Penyiapan', 'Serah + edukasi'], L.stage)}${ui.card({ title: 'Resep elektronik', sub: `${P.dokter} · BPJS · PRB 30 hari`, flush: true, body: rxTable })}${ui.card({ title: stName, body })}</div>`)}`;
    },
    actions: {
      pilih(L, J, el) { L.sel = el.dataset.arg || 'suryo'; },
      cekSemua(L) { if (L.stage === 0) TELAAH.forEach((t, i) => { L[`t${i}`] = true; }); },
      telaah(L, J) {
        if (L.stage !== 0) return false;
        const rx = Array.isArray(J.rx) && J.rx.length ? J.rx : RX_DEF;
        const inter = rx.some((x) => /glimepirid/i.test(x.name || '')) && rx.some((x) => /metformin/i.test(x.name || ''));
        if (TELAAH.some((t, i) => !L[`t${i}`]) || (inter && !L.ackInt)) { SIM.toast('Telaah belum lengkap.', 'warning'); return; }
        L.telaahT = SIM.now(4);
        L.stage = 1;
      },
      cekGanda(L) {
        if (L.stage !== 1 || L.dc) return false;
        const n = String(L.dcName || '').trim();
        if (n.length < 3) { SIM.toast('Isi nama apoteker kedua.', 'warning'); return; }
        if (/rina/i.test(n)) { SIM.toast('Verifikasi ganda harus oleh apoteker lain.', 'warning'); return; }
        L.dc = `${n} · ${SIM.now(2)}`;
      },
      siapkan(L, J) {
        if (L.stage !== 1) return false;
        const rx = Array.isArray(J.rx) && J.rx.length ? J.rx : RX_DEF;
        if (rx.some((x) => HIGH_ALERT.test(x.name || '')) && !L.dc) { SIM.toast('Verifikasi ganda obat high alert dulu.', 'warning'); return; }
        L.prepT = SIM.now(6);
        L.stage = 2;
        SIM.note('Resep Tn. Suryo disiapkan · stok depo berkurang (batch FEFO), high alert diverifikasi ganda', 'brand');
      },
      serah(L, J) {
        if (L.stage !== 2) return false;
        if (SERAH.some((t, i) => !L[`s${i}`])) { SIM.toast('Lengkapi serah terima dan edukasi.', 'warning'); return; }
        L.doneT = SIM.now(5);
        L.stage = 3;
        J.dispensed = { t: L.doneT, by: STAFF.apoteker.name };
        SIM.note('Obat Tn. Suryo diserahkan dengan edukasi hipoglikemia', 'success');
        SIM.done();
      },
    },
  });

  /* ---------- Kamar operasi: jadwal, ceklis WHO, hitung kasa, laporan (S06) ---------- */
  const WHO = [
    ['Identitas, lokasi, dan prosedur dikonfirmasi pasien', 'Lokasi operasi ditandai', 'Mesin dan obat anestesi dicek · pulse oksimetri berfungsi', 'Alergi diketahui: amoksisilin (ruam) · sefazolin dikonfirmasi', 'Risiko jalan napas sulit / perdarahan > 500 mL dinilai'],
    ['Semua anggota tim memperkenalkan diri', 'Nama pasien, prosedur, dan lokasi insisi dikonfirmasi', 'Antibiotik profilaksis ≤ 60 menit: sefazolin 2 g IV', 'Antisipasi kejadian kritis (bedah, anestesi, perawat)', 'Pencitraan penting ditampilkan (USG abdomen)'],
    ['Nama prosedur yang dikerjakan dicatat', 'Spesimen diberi label (kandung empedu → PA)', 'Masalah alat dicatat', 'Rencana pemulihan disampaikan ke tim'],
  ];
  const WHO_NAME = ['Sign in', 'Time out', 'Sign out'];
  const WHO_WHEN = ['Sebelum induksi', 'Sebelum insisi', 'Sebelum pasien keluar kamar'];
  const COUNT = [['kb', 'Kasa besar', 20], ['kk', 'Kasa kecil', 30], ['jr', 'Jarum', 6], ['ins', 'Set laparoskopi', 1]];

  SIM.register({
    id: 'ok',
    phase: 4,
    title: 'Kamar operasi',
    nav: 'Kamar operasi',
    codes: 'S06',
    role: 'ok',
    desc: 'Jadwal kamar hari ini dan ceklis keselamatan WHO yang terkunci berurutan; time out memeriksa persetujuan tindakan; hitung kasa dan laporan operasi.',
    hint: 'Centang sign in, konfirmasi; time out memeriksa persetujuan; catat insisi, laporan, hitung kasa, lalu sign out.',
    init: { conf: ['', '', ''], insT: '', consOv: '', consReason: '', kb: '', kk: '', jr: '', ins: '', op1: 'Kandung empedu distensi, dinding menebal ringan, batu multipel ukuran 5–12 mm. Tidak tampak kebocoran empedu.', op2: 'Kolesistektomi laparoskopik 4 port, critical view of safety tercapai, duktus sistikus dan arteri sistika diklip.', op3: '20', repT: '' },
    render(L, J) {
      const R = PEOPLE.ratna;
      const cur = L.conf[0] ? (L.conf[1] ? (L.conf[2] ? 3 : 2) : 1) : 0;
      const ratnaSt = cur === 3 ? ['Selesai', 'success'] : L.insT ? ['Berlangsung', 'brand'] : cur ? [`${WHO_NAME[cur]}`, 'info'] : ['Persiapan', 'warning'];
      const sched = ui.table(['Kamar', 'Jam', 'Prosedur', 'Operator', 'Status'], [
        ['OK 1', '07.00', 'Herniorafi', 'dr. Fajar, Sp.B', ui.chip('Selesai', 'success')],
        ['OK 1', '09.00', 'Laparotomi eksplorasi', 'dr. Fajar, Sp.B', ui.chip('Berlangsung', 'brand')],
        ['<b>OK 2</b>', '<b>10.30</b>', `<b>Kolesistektomi laparoskopik</b><div class="small muted">${E(R.name)} · RM ${E(R.rm)}</div>`, E(R.dokter), ui.chip(ratnaSt[0], ratnaSt[1])],
        ['OK 2', '14.00', 'Laparoskopi hernia', 'dr. Dian, Sp.B', ui.chip('Terjadwal', '')],
        ['OK 3', '11.00', 'Seksio sesarea · gawat janin', 'dr. Wulan, Sp.OG', ui.chip('Cito', 'danger')],
      ], { sel: 2 });
      const counts = COUNT.map(([k, n, v]) => ({ k, n, v, b: String(L[k] ?? '').trim() }));
      const filled = counts.filter((c) => c.b !== '').length;
      const mism = counts.filter((c) => c.b !== '' && Number(c.b) !== c.v);
      const countsOk = filled === counts.length && !mism.length;
      const consentOk = !!J.consent || !!L.consOv;

      const phases = WHO.map((items, pi) => {
        const done = !!L.conf[pi];
        const isCur = pi === cur;
        const list = items.map((t, ii) => (isCur ? ui.check(`c${pi}${ii}`, !!L[`c${pi}${ii}`], t) : `<div class="small" style="color:${done ? 'var(--success)' : 'var(--ink-500)'}">${done ? '✓' : '○'} ${E(t)}</div>`)).join('');
        let extra = '';
        let why = '';
        const left = items.filter((t, ii) => !L[`c${pi}${ii}`]).length;
        if (pi === 1) {
          extra = J.consent ? ui.alert('success', `Persetujuan tindakan tertandatangani ${J.consent.signedAt || ''}`, `${E(J.consent.procedure || 'Kolesistektomi laparoskopik')} · pasien, saksi, dokter`)
            : L.consOv ? ui.alert('warning', 'Override persetujuan tercatat', `Alasan: ${E(L.consOv)}`)
            : isCur ? ui.gate({ title: 'Persetujuan tindakan belum ada di sistem', body: 'Time out tidak bisa dikonfirmasi tanpa persetujuan tindakan yang ditandatangani untuk prosedur ini.', follow: { label: 'Buka persetujuan tindakan', act: 'keConsent' }, override: { label: 'Override: persetujuan kertas terlampir', act: 'overrideConsent' }, reasonKey: 'consReason', reasonValue: L.consReason })
            : `<div class="small muted">○ Persetujuan tindakan diperiksa otomatis saat time out ${J.consent ? '' : '(belum ada)'}</div>`;
          if (isCur && !consentOk) why = 'Persetujuan tindakan belum ada.';
        }
        if (pi === 2) {
          extra = `<div class="small" style="color:${done || countsOk ? 'var(--success)' : 'var(--ink-500)'}">${done || countsOk ? '✓' : '○'} Hitung kasa, jarum, dan instrumen lengkap (otomatis dari hitung akhir)</div>`;
          if (isCur) why = !L.insT ? 'Insisi belum dicatat.' : !L.repT ? 'Simpan laporan operasi dulu.' : !countsOk ? 'Hitung akhir kasa, jarum, dan instrumen belum cocok.' : '';
        }
        if (isCur && !why && left) why = `${left} butir tersisa.`;
        const btn = isCur ? btnIf(`Konfirmasi ${WHO_NAME[pi].toLowerCase()}`, { act: 'konfirmasi', arg: String(pi), variant: 'primary' }, why) : '';
        return ui.card({ title: `${pi + 1}. ${WHO_NAME[pi]}`, sub: `${WHO_WHEN[pi]}${done ? ` · dikonfirmasi ${L.conf[pi]} · ${STAFF.ok.name}` : ''}`, tone: done ? 'success' : isCur ? '' : '', actions: ui.chip(done ? 'Lengkap' : isCur ? 'Berjalan' : 'Terkunci', done ? 'success' : isCur ? 'info' : ''), body: `<div class="stack" style="gap:8px">${list}${extra}${btn}</div>` });
      }).join('');

      const insisi = L.insT ? ui.alert('success', `Insisi dicatat ${L.insT}`, 'Waktu operasi berjalan.') : btnIf('Catat insisi', { act: 'insisi', variant: 'primary' }, cur < 2 ? 'Insisi terkunci sampai time out dikonfirmasi.' : '');
      const report = ui.card({ title: 'Laporan operasi', sub: L.repT ? `Disimpan ${L.repT} · ${R.dokter}` : 'diisi operator', actions: L.repT ? ui.chip('Tersimpan', 'success') : '', body: L.insT ? `<div class="stack">${ui.field('Temuan', ui.input('op1', L.op1, { area: true }), '', 'f-op1')}${ui.field('Tindakan', ui.input('op2', L.op2, { area: true }), 'ICD-9-CM 51.23', 'f-op2')}<div class="grid g2">${ui.field('Perdarahan (mL)', ui.input('op3', L.op3, { mono: true }), '', 'f-op3')}${ui.field('Komplikasi', '<div class="inp">Tidak ada</div>')}</div>${btnIf('Simpan laporan operasi', { act: 'laporan' }, L.repT ? `Sudah disimpan ${L.repT}.` : '')}</div>` : ui.empty('Laporan dibuka setelah insisi dicatat.') });
      const countCard = ui.card({ title: 'Hitung kasa dan instrumen', sub: 'hitung awal · hitung akhir', body: `<div class="stack">${counts.map((c) => `<div class="row between"><span>${E(c.n)} <span class="muted small">awal ${c.v}</span></span><div style="width:110px">${L.insT && !L.conf[2] ? ui.input(c.k, L[c.k], { mono: true, rerender: true, placeholder: 'akhir' }) : `<span class="mono">${E(c.b || '—')}</span>`}</div></div>`).join('')}
        ${L.insT && !L.conf[2] ? `<div>${ui.btn('Isi hasil hitung akhir bersama', { act: 'hitung', size: 'sm' })}</div>` : ''}
        <span class="small" style="color:${mism.length ? 'var(--danger)' : countsOk ? 'var(--success)' : 'var(--ink-500)'};font-weight:${mism.length || countsOk ? 600 : 400}">${mism.length ? `Tidak cocok: ${mism.map((m) => `${m.n.toLowerCase()} ${m.b} dari ${m.v}`).join(', ')}. Hitung ulang sebelum sign out.` : countsOk ? 'Semua hitungan cocok dengan hitung awal.' : `Isi hitung akhir (${filled}/${counts.length}).`}</span></div>` });

      return `${ui.banner(R, `${ui.chip('OK 2 · 10.30 · GA', 'brand')}${J.consent ? '' : contoh()}`)}
        ${ui.card({ title: 'Jadwal kamar operasi · 5 Okt 2026', sub: 'Utilisasi 78% · on-time start 67%', flush: true, body: sched })}
        ${cur === 3 ? ui.next('resume', `Operasi Ny. Ratna selesai · sign out ${L.conf[2]}, hitung kasa cocok`) : ''}
        <div class="grid" style="grid-template-columns:minmax(0,1.3fr) minmax(0,1fr);align-items:start"><div class="stack">${phases}</div><div class="stack">${ui.card({ title: 'Insisi', sub: `${R.dokter} · anestesi dr. Hendro Wibowo, Sp.An`, body: insisi })}${report}${countCard}</div></div>`;
    },
    actions: {
      keConsent() { SIM.go('consent'); return false; },
      overrideConsent(L) {
        if (L.consOv) return false;
        const rsn = String(L.consReason || '').trim();
        if (rsn.length < 10) { SIM.toast('Tulis alasan minimal 10 huruf.', 'warning'); return; }
        L.consOv = rsn;
        SIM.note('Time out: persetujuan tindakan di-override (kertas), ditinjau komite mutu', 'warning');
      },
      konfirmasi(L, J, el) {
        const cur = L.conf[0] ? (L.conf[1] ? (L.conf[2] ? 3 : 2) : 1) : 0;
        const pi = el.dataset.arg === undefined ? cur : Number(el.dataset.arg);
        if (pi !== cur || cur > 2) return false;
        if (WHO[pi].some((t, ii) => !L[`c${pi}${ii}`])) { SIM.toast(`${WHO_NAME[pi]} belum lengkap.`, 'warning'); return; }
        if (pi === 1 && !J.consent && !L.consOv) { SIM.toast('Persetujuan tindakan belum ada.', 'warning'); return; }
        if (pi === 2) {
          const ok = COUNT.every(([k, , v]) => Number(String(L[k] ?? '').trim()) === v && String(L[k] ?? '').trim() !== '');
          if (!L.insT || !L.repT || !ok) { SIM.toast('Insisi, laporan, dan hitung akhir wajib lengkap.', 'warning'); return; }
        }
        L.conf[pi] = SIM.now(pi === 2 ? 5 : 3);
        if (pi === 0) SIM.note('Sign in Ny. Ratna dikonfirmasi · induksi boleh dimulai', 'brand');
        if (pi === 1) SIM.note(`Time out Ny. Ratna dikonfirmasi${J.consent ? ' · persetujuan tindakan terverifikasi' : ' · persetujuan via override'}`, 'brand');
        if (pi === 2) {
          J.surgery = { patient: 'ratna', signIn: L.conf[0], timeOut: L.conf[1], signOut: L.conf[2], done: true };
          SIM.note('Sign out Ny. Ratna · hitung kasa cocok, laporan operasi tersimpan', 'success');
          SIM.done();
        }
      },
      insisi(L) { if (L.conf[1] && !L.insT) L.insT = SIM.now(2); else if (!L.conf[1]) SIM.toast('Insisi terkunci sampai time out.', 'warning'); },
      laporan(L) { if (L.insT && !L.repT) L.repT = SIM.now(70); },
      hitung(L) { if (L.insT && !L.conf[2]) COUNT.forEach(([k, , v]) => { L[k] = String(v); }); },
    },
  });
})();
