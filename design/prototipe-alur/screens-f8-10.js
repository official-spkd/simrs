/* =====================================================================
 * Layar fase 8–10 (agen D): back office, kanal (dasbor + aplikasi), simulasi & pilot.
 * Isi berkas ini hanya SIM.register(...). Semua data fiktif, tanpa backend.
 * Sumber: design/mockups/{Logistik,Dasbor,AppPasien,AppDokter,Simulasi}.dc.html,
 * docs/09-rencana-fase.md (fase 8–10), docs/rencana/fase-{8,9,10}-*.md.
 * ===================================================================== */
(function () {
  'use strict';
  const { ui, PEOPLE, STAFF } = SIM;
  const esc = ui.esc;

  /* ---------------- helper bersama ---------------- */
  const SAMPLE = () => ui.chip('data contoh', 'warning');
  const fmt = (n) => Math.round(Number(n) || 0).toLocaleString('id-ID');
  const fmt1 = (n) => (Number(n) || 0).toLocaleString('id-ID', { maximumFractionDigits: 1 });
  /** Angka dari isian teks ("1.500", "6,8"); kosong/tak valid → d. */
  const num = (v, d = 0) => {
    const s = String(v ?? '').trim().replace(/\s/g, '');
    if (!s) return d;
    const n = Number(s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/\.(?=\d{3}(\D|$))/g, ''));
    return Number.isFinite(n) ? n : d;
  };
  const argOf = (el) => (el && el.dataset && el.dataset.arg !== undefined ? String(el.dataset.arg) : '');
  const TONE = { brand: 'var(--brand-600)', success: 'var(--success)', warning: 'var(--warning)', danger: 'var(--danger)', info: 'var(--info)', muted: 'var(--line-strong)' };
  /** Batang progres dari div; target = garis tegak penanda. */
  const bar = (pct, tone = 'brand', target = null, h = 8) => {
    const w = Math.max(0, Math.min(100, Number(pct) || 0));
    const mark = target === null ? '' : `<span title="Target" style="position:absolute;left:calc(${Math.max(0, Math.min(100, target))}% - 1px);top:-3px;bottom:-3px;width:2px;border-radius:2px;background:var(--ink-900)"></span>`;
    return `<div style="position:relative;height:${h}px;border-radius:99px;background:var(--line-soft)"><div style="height:100%;width:${w}%;border-radius:99px;background:${TONE[tone] || TONE.brand}"></div>${mark}</div>`;
  };
  /** Daftar kunci–nilai; nilai berupa HTML (pemanggil yang meng-escape). */
  const kv = (rows) => `<div class="stack" style="gap:6px">${rows.map(([k, v]) => `<div class="row between small" style="flex-wrap:nowrap;align-items:flex-start"><span class="muted">${esc(k)}</span><span style="text-align:right;font-weight:600">${v}</span></div>`).join('')}</div>`;
  const wide = (html) => `<div style="display:grid;gap:8px">${html}</div>`;
  const stamp = (text, t) => `<span class="small" style="color:var(--success);font-weight:600">✓ ${esc(text)} · ${esc(t)}</span>`;
  /** Pilihan berbentuk baris daftar; nonaktif wajib membawa alasan. */
  const opt = (title, sub, o = {}) => `<button type="button" class="li ${o.sel ? 'sel' : ''}" ${o.disabled ? 'disabled style="opacity:.6;cursor:not-allowed"' : `data-act="${esc(o.act)}" data-arg="${esc(o.arg)}"`}><div style="min-width:0"><div class="lt">${esc(title)}</div>${sub ? `<div class="ls">${esc(sub)}</div>` : ''}${o.disabled && o.reason ? `<div class="ls" style="color:var(--warning)">${esc(o.reason)}</div>` : ''}</div>${o.right ? `<div class="lr">${o.right}</div>` : ''}</button>`;
  const signed = (v) => `${v < 0 ? '−' : v > 0 ? '+' : ''}${fmt(Math.abs(v))}`;

  /* ---- perangkat ponsel ---- */
  const phoneBar = (dark) => `<div class="row between small" style="padding:10px 22px 2px;font-family:var(--font-mono);color:${dark ? 'var(--device-ink)' : 'var(--ink-700)'}"><span>${SIM.time()}</span><span>5G · 82%</span></div>`;
  const phone = (head, body, nav = '') => `<div style="display:flex;flex-direction:column;height:720px">${phoneBar(false)}
    <div style="padding:6px 16px 10px;border-bottom:1px solid var(--line-soft)">${head}</div>
    <div style="flex:1;overflow-y:auto;padding:14px 16px;display:flex;flex-direction:column;gap:12px">${body}</div>${nav}</div>`;
  const phoneNav = (key, cur, tabs) => `<nav style="display:grid;grid-template-columns:repeat(${tabs.length},minmax(0,1fr));border-top:1px solid var(--line);background:var(--subtle)">${tabs.map(([v, l, badge]) => {
    const on = v === cur;
    return `<button type="button" data-set="${esc(key)}=${esc(v)}" aria-current="${on ? 'page' : 'false'}" style="border:0;border-top:2px solid ${on ? 'var(--brand-600)' : 'transparent'};background:none;padding:10px 2px 14px;font-size:11.5px;font-weight:600;cursor:pointer;color:${on ? 'var(--brand-700)' : 'var(--ink-500)'}">${esc(l)}${badge ? ` <span class="chip danger" style="height:16px;padding:0 5px;font-size:10px">${esc(badge)}</span>` : ''}</button>`;
  }).join('')}</nav>`;
  const tile = (label, sub, set) => `<button type="button" class="card" data-set="${esc(set)}" style="padding:12px;text-align:left;cursor:pointer;display:flex;flex-direction:column;gap:2px;min-width:0"><b style="font-size:13.5px">${esc(label)}</b><span class="small muted">${esc(sub)}</span></button>`;
  const pcard = (title, body, tone) => `<div style="border:1px solid ${tone === 'danger' ? 'var(--danger-border)' : tone === 'success' ? 'var(--success-border)' : 'var(--line)'};background:${tone === 'danger' ? 'var(--danger-bg)' : tone === 'success' ? 'var(--success-bg)' : 'var(--card)'};border-radius:14px;padding:12px 14px;display:flex;flex-direction:column;gap:8px">${title ? `<b style="font-size:14px">${esc(title)}</b>` : ''}${body}</div>`;

  /* =====================================================================
   * F8 · LOGISTIK (B01)
   * ===================================================================== */
  const DEPO = [
    { value: 'gudang', label: 'Gudang farmasi' }, { value: 'rj', label: 'Depo rawat jalan' },
    { value: 'igd', label: 'Depo IGD' }, { value: 'ri', label: 'Depo rawat inap' },
  ];
  const ITEMS = [
    { id: 'enox', name: 'Enoksaparin 60 mg/0,6 mL', meta: 'High alert · Fornas', abc: 'A', ven: 'V', price: 138000, stok: { gudang: 46, rj: 0, igd: 12, ri: 18 }, rop: 120, daily: 15, sug: 300, sup: 'PT Sanofi Indonesia (PO darurat)' },
    { id: 'seft', name: 'Seftriakson 1 g injeksi', meta: 'Fornas', abc: 'A', ven: 'V', price: 9800, stok: { gudang: 310, rj: 0, igd: 60, ri: 140 }, rop: 400, daily: 52, sug: 1500, sup: 'e-katalog · PT Kimia Farma' },
    { id: 'rl', name: 'Infus Ringer laktat 500 mL', meta: 'Cairan', abc: 'A', ven: 'V', price: 11500, stok: { gudang: 820, rj: 40, igd: 180, ri: 320 }, rop: 900, daily: 110, sug: 3000, sup: 'e-katalog · PT Widatra Bhakti' },
    { id: 'ins', name: 'Insulin glargine pen', meta: 'Rantai dingin 2–8 °C', abc: 'A', ven: 'V', price: 182000, stok: { gudang: 38, rj: 14, igd: 2, ri: 9 }, rop: 40, daily: 4, sug: 120, sup: 'e-katalog · PT Sanofi Indonesia', cold: true },
    { id: 'kat', name: 'Kateter IV 20G', meta: 'BHP', abc: 'B', ven: 'E', price: 7200, stok: { gudang: 540, rj: 30, igd: 90, ri: 160 }, rop: 600, daily: 62, sug: 2000, sup: 'PT Terumo Indonesia' },
    { id: 'kasa', name: 'Kasa steril 16×16', meta: 'BHP kamar operasi', abc: 'C', ven: 'E', price: 900, stok: { gudang: 1900, rj: 200, igd: 400, ri: 600 }, rop: 2000, daily: 190, sug: 6000, sup: 'PT Onemed Health' },
    { id: 'met', name: 'Metformin 500 mg', meta: 'Fornas · PRB', abc: 'B', ven: 'E', price: 180, stok: { gudang: 24800, rj: 3100, igd: 200, ri: 900 }, rop: 9000, daily: 700, sug: 20000, sup: 'e-katalog · PT Indofarma' },
    { id: 'aml', name: 'Amlodipin 10 mg', meta: 'Fornas · PRB', abc: 'B', ven: 'E', price: 210, stok: { gudang: 18200, rj: 1450, igd: 120, ri: 600 }, rop: 6000, daily: 420, sug: 12000, sup: 'e-katalog · PT Hexpharm' },
    { id: 'para', name: 'Parasetamol 500 mg', meta: 'Fornas', abc: 'C', ven: 'E', price: 95, stok: { gudang: 31000, rj: 2200, igd: 600, ri: 1400 }, rop: 8000, daily: 650, sug: 20000, sup: 'e-katalog · PT Kimia Farma' },
  ];
  const itemById = (id) => ITEMS.find((i) => i.id === id);
  const PO_BASE = [
    { no: 'PO-2610-028', label: 'Cairan infus campuran', value: 96000000, stage: 4, sup: 'PT Widatra Bhakti', note: 'Dalam pengiriman · tiba sore ini' },
    { no: 'PO-2610-024', label: 'BHP kamar operasi', value: 22700000, stage: 3, sup: 'PT Onemed Health', note: 'PO terkirim · konfirmasi pemasok 4 Okt' },
    { no: 'PO-2609-117', label: 'Reagen kimia klinik', value: 63200000, stage: 5, sup: 'PT Roche Indonesia', note: 'Diterima 30 Sep · cek suhu dan batch lolos' },
  ];
  const PO_STAGES = ['Usulan', 'Disetujui', 'Terkirim', 'Tiba', 'Diterima'];
  const PO_STATUS = ['', 'Menunggu persetujuan direktur', 'Disetujui direktur', 'PO terkirim ke pemasok', 'Barang tiba · menunggu pemeriksaan', 'Diterima · stok dan hutang tercatat'];
  const ED_LIST = [
    { id: 'e1', n: 'Albumin 20% 100 mL · 14 vial', d: 28, s: 'Usul pindah ke depo ICU (pemakaian tertinggi)', to: 'depo ICU' },
    { id: 'e2', n: 'Meropenem 1 g · 60 vial', d: 45, s: 'Retur ke distributor sesuai kontrak', to: 'depo rawat inap' },
    { id: 'e3', n: 'Vaksin hepatitis B · 30 vial', d: 62, s: 'Prioritaskan untuk skrining karyawan', to: 'klinik karyawan' },
    { id: 'e4', n: 'Reagen troponin · 1 kit', d: 81, s: 'Pemakaian cukup sebelum kedaluwarsa', to: 'depo IGD' },
  ];
  const OPNAME = [{ id: 'met', fis: '3080' }, { id: 'aml', fis: '1450' }, { id: 'para', fis: '2210' }, { id: 'ins', fis: '14' }, { id: 'kat', fis: '28' }];
  const OPNAME_REASON = [{ value: '', label: 'Pilih alasan selisih…' }, 'Rusak / pecah', 'Kedaluwarsa', 'Salah catat dispensing', 'Hilang', 'Kelebihan terima'];

  /** Bulan tersisa dari Okt 2026 untuk "BB/TTTT"; null bila format salah. */
  const edMonths = (s) => {
    const m = String(s || '').trim().match(/^(\d{1,2})\/(\d{4})$/);
    if (!m) return null;
    const mm = Number(m[1]);
    if (mm < 1 || mm > 12) return null;
    return (Number(m[2]) - 2026) * 12 + (mm - 10);
  };
  const stock = (L, id, depo) => (itemById(id).stok[depo] || 0) + ((L.adj || {})[`${depo}:${id}`] || 0);
  const poOf = (L, id) => { const p = L.po.find((x) => x.stage < 5 && x.lines.some((l) => l.id === id)); return p ? p.no : ''; };
  const underRop = (L) => ITEMS.filter((it) => stock(L, it.id, 'gudang') < it.rop);
  const pickedItems = (L) => underRop(L).filter((it) => !poOf(L, it.id) && L[`x_${it.id}`] !== false);
  const needsEdReason = (L, p) => p.lines.some((ln) => { const m = edMonths(L[`e_${ln.id}`]); return L[`d_${ln.id}`] === 'terima' && m !== null && m < 12; });
  function rcvIssues(L, p) {
    const out = [];
    p.lines.forEach((ln) => {
      const it = itemById(ln.id);
      if (L[`d_${ln.id}`] === 'tolak') return;
      if (!String(L[`b_${ln.id}`] || '').trim()) out.push(`${it.name}: nomor batch kosong`);
      const m = edMonths(L[`e_${ln.id}`]);
      if (m === null) out.push(`${it.name}: tanggal kedaluwarsa belum benar (BB/TTTT)`);
      else if (m < 12 && L[`d_${ln.id}`] !== 'terima') out.push(`${it.name}: kedaluwarsa ${m} bulan lagi, pilih terima atau tolak batch`);
      if (num(L[`q_${ln.id}`]) <= 0) out.push(`${it.name}: jumlah diterima belum diisi`);
      if (it.cold && !L[`s_${ln.id}`]) out.push(`${it.name}: suhu rantai dingin belum dicek`);
    });
    return out;
  }
  function poStep(L, el, from, to, after) {
    const arg = argOf(el);
    const p = L.po.find((x) => x.no === arg && x.stage === from) || L.po.find((x) => x.stage === from);
    if (!p) { SIM.toast('Tidak ada PO pada tahap ini', 'warning'); return false; }
    const t = SIM.now(from === 3 ? 30 : 4);
    p.stage = to; p.t[to] = t;
    if (after) after(p, t);
    return undefined;
  }

  function logStok(L) {
    const isG = L.depo === 'gudang';
    const vis = ITEMS.filter((it) => (L.cls === 'A' ? it.abc === 'A' : L.cls === 'V' ? it.ven === 'V' : true));
    const rows = vis.map((it) => {
      const s = stock(L, it.id, L.depo);
      const lim = isG ? it.rop : Math.round(it.rop * 0.2);
      const low = s < lim;
      let aksi;
      if (isG) {
        const po = poOf(L, it.id);
        aksi = po ? ui.chip(`Dalam ${po}`, 'info') : low ? ui.check(`x_${it.id}`, L[`x_${it.id}`] !== false, `Usulkan ${fmt(it.sug)}`) : ui.chip('Aman', 'success');
      } else {
        aksi = low ? ui.btn('Minta dari gudang', { act: 'mutasi', arg: it.id, size: 'sm' }) : ui.chip('Aman', 'success');
      }
      return [
        `<b>${esc(it.name)}</b><div class="small muted">${esc(it.meta)}${isG && low ? ` · ${esc(it.sup)}` : ''}</div>`,
        ui.chip(`${it.abc} · ${it.ven}`, it.ven === 'V' ? 'danger' : it.abc === 'A' ? 'warning' : ''),
        `<span style="${low ? 'color:var(--danger);font-weight:600' : ''}">${fmt(s)}</span>`,
        fmt(lim),
        isG ? `${fmt(Math.floor(s / it.daily))} hari` : '–',
        aksi,
      ];
    });
    const picked = pickedItems(L);
    const value = picked.reduce((a, it) => a + it.sug * it.price, 0);
    const btn = isG ? ui.btn(`Buat usulan PO (${picked.length} item)`, { act: 'makePO', variant: 'primary', disabled: !picked.length, reason: 'Centang minimal satu item di bawah ROP yang belum masuk PO' }) : '';
    return `${ui.card({
      title: isG ? 'Item di bawah titik pesan ulang' : `Stok ${DEPO.find((d) => d.value === L.depo).label}`,
      sub: isG ? 'ROP = pemakaian harian rata-rata 90 hari × lead time + stok pengaman' : 'Minimum depo = 20% ROP gudang · permintaan dikirim ke gudang (mutasi)',
      actions: btn,
      body: `<div class="stack"><div class="row between">${ui.seg('depo', L.depo, DEPO)}${ui.seg('cls', L.cls, [{ value: 'all', label: 'Semua kelas' }, { value: 'A', label: 'ABC-A' }, { value: 'V', label: 'VEN-V' }])}</div>
        ${L.flash ? ui.alert('success', 'Tercatat', esc(L.flash)) : ''}
        ${ui.table(['Item', 'Kelas', { label: 'Stok', r: true }, { label: isG ? 'ROP' : 'Minimum', r: true }, { label: 'Cukup untuk', r: true }, 'Tindakan'], rows, { empty: 'Tidak ada item untuk filter ini' })}
        ${isG && picked.length ? `<div class="small muted">Perkiraan nilai usulan ${esc(ui.rupiah(value))}. Item VEN-V diprioritaskan; persetujuan direktur wajib sebelum PO dikirim.</div>` : ''}</div>`,
    })}`;
  }
  function logPO(L) {
    const mine = L.po.map((p) => {
      const lines = ui.table(['Item', { label: 'Jumlah', r: true }, { label: 'Harga', r: true }, { label: 'Subtotal', r: true }], p.lines.map((ln) => {
        const it = itemById(ln.id);
        return [esc(it.name), fmt(ln.qty), esc(ui.rupiah(it.price)), esc(ui.rupiah(ln.qty * it.price))];
      }));
      const act = p.stage === 1 ? ui.btn('Setujui (direktur)', { act: 'approve', arg: p.no, variant: 'primary' })
        : p.stage === 2 ? ui.btn('Kirim PO ke pemasok', { act: 'send', arg: p.no, variant: 'primary' })
          : p.stage === 3 ? ui.btn('Tandai barang tiba', { act: 'arrive', arg: p.no, variant: 'primary' })
            : p.stage === 4 ? ui.btn('Periksa & terima barang →', { set: 'tab=terima', variant: 'primary' })
              : stamp('Diterima, stok naik', p.t[5] || '');
      const tl = ui.timeline([1, 2, 3, 4, 5].filter((s) => p.t[s]).map((s) => ({ t: p.t[s], text: PO_STATUS[s], tone: s === 5 ? 'success' : '' })));
      return ui.card({
        title: `${p.no} · ${p.lines.length} item`, sub: `${PO_STATUS[p.stage]} · ${ui.rupiah(p.value)}`, actions: act,
        body: `<div class="stack">${ui.steps(PO_STAGES, p.stage)}${lines}
          <div class="small muted">Dibuat: ${esc(STAFF.logistik.name)} (logistik) · Penyetuju: ${esc(STAFF.direktur.name)} (direktur). Pembuat dan penyetuju berbeda orang.</div>${tl}</div>`,
      });
    }).join('');
    const base = ui.table(['PO', 'Pemasok', { label: 'Nilai', r: true }, 'Status'], PO_BASE.map((p) => [`<b class="mono">${esc(p.no)}</b><div class="small muted">${esc(p.label)}</div>`, esc(p.sup), esc(ui.rupiah(p.value)), `${ui.chip(PO_STAGES[p.stage - 1], p.stage === 5 ? 'success' : 'info')}<div class="small muted">${esc(p.note)}</div>`]));
    return `${mine || ui.alert('info', 'Belum ada usulan baru hari ini', 'Buka tab Stok & ROP, centang item di bawah ROP, lalu buat usulan PO.')}
      ${ui.card({ title: 'Pengadaan berjalan', sub: 'Tahap: usulan · persetujuan · PO / e-katalog · kirim · terima dan cek mutu', body: base, flush: true })}`;
  }
  function logTerima(L) {
    const p = L.po.find((x) => x.no === L.rcv && x.stage >= 4) || L.po.find((x) => x.stage === 4);
    if (!p) {
      return ui.card({ title: 'Penerimaan barang', body: `${ui.empty('Belum ada barang tiba. Di tab Pengadaan: setujui PO, kirim ke pemasok, lalu tandai barang tiba.')}<div class="row" style="justify-content:center">${ui.btn('Buka pengadaan', { set: 'tab=po' })}</div>` });
    }
    if (p.stage === 5) {
      const rows = p.lines.map((ln) => {
        const it = itemById(ln.id);
        return [esc(it.name), ln.rejected ? ui.chip('Batch ditolak · retur', 'danger') : `<span class="mono">${esc(ln.batch)}</span>`, esc(ln.ed || '–'), fmt(ln.got || 0), fmt(stock(L, ln.id, 'gudang'))];
      });
      return `${ui.alert('success', `${p.gr} · diterima ${p.t[5]}`, `Stok gudang bertambah, hutang dagang ${esc(ui.rupiah(p.amount))} tercatat. Jurnal: Persediaan farmasi (debit) / Hutang dagang (kredit).`)}
        ${ui.card({ title: `Bukti penerimaan ${p.gr}`, sub: `${p.no} · diperiksa ${STAFF.logistik.name}`, flush: true, body: ui.table(['Item', 'Batch', 'Kedaluwarsa', { label: 'Diterima', r: true }, { label: 'Stok gudang kini', r: true }], rows) })}
        ${ui.next('mutu', `Penerimaan ${p.gr} menaikkan stok dan mencatat hutang ${ui.rupiah(p.amount)}.`)}`;
    }
    const lines = p.lines.map((ln) => {
      const it = itemById(ln.id);
      const m = edMonths(L[`e_${ln.id}`]);
      const dec = L[`d_${ln.id}`] || '';
      let edInfo;
      if (m === null) edInfo = ui.chip('Format BB/TTTT', 'warning');
      else if (m < 12) edInfo = `${ui.alert('warning', `Kedaluwarsa ${m} bulan lagi`, 'Kontrak e-katalog mensyaratkan sisa umur minimal 12 bulan.')}<div class="row">${ui.seg(`d_${ln.id}`, dec, [{ value: 'terima', label: 'Terima dengan catatan' }, { value: 'tolak', label: 'Tolak batch, minta ganti' }])}</div>`;
      else edInfo = ui.chip(`Sisa ${m} bulan · lolos`, 'success');
      return `<div class="card" style="padding:12px 14px;display:flex;flex-direction:column;gap:10px">
        <div class="row between"><b>${esc(it.name)}</b><span class="row">${it.cold ? ui.chip('Rantai dingin', 'info') : ''}${ui.chip(`Dipesan ${fmt(ln.qty)}`, '')}</span></div>
        <div class="grid g3">${ui.field('Nomor batch', ui.input(`b_${ln.id}`, L[`b_${ln.id}`], { mono: true, rerender: true }), '', `f-b_${ln.id}`)}${ui.field('Kedaluwarsa (BB/TTTT)', ui.input(`e_${ln.id}`, L[`e_${ln.id}`], { mono: true, rerender: true }), '', `f-e_${ln.id}`)}${ui.field('Jumlah diterima', ui.input(`q_${ln.id}`, L[`q_${ln.id}`], { mono: true, rerender: true, inputmode: 'numeric' }), '', `f-q_${ln.id}`)}</div>
        ${edInfo}${it.cold ? ui.check(`s_${ln.id}`, !!L[`s_${ln.id}`], 'Suhu saat tiba 2–8 °C sesuai pencatat suhu pengiriman') : ''}</div>`;
    }).join('');
    const iss = rcvIssues(L, p);
    const needR = needsEdReason(L, p);
    return ui.card({
      title: `Penerimaan ${p.no}`, sub: `Tiba ${p.t[4] || ''} · cek fisik, batch, kedaluwarsa, dan suhu sebelum stok bertambah`,
      body: `<div class="stack">${lines}
        ${needR ? ui.field('Alasan menerima batch berumur pendek', ui.input('edReason', L.edReason, { area: true, placeholder: 'mis. stok VEN-V kritis, pemakaian habis dalam 2 bulan' }), 'Minimal 10 huruf · tercatat di bukti penerimaan', 'f-edReason') : ''}
        <div class="row">${ui.btn('Terima & tambah stok', { act: 'receive', variant: 'primary', disabled: iss.length > 0, reason: iss[0] || '', needs: needR ? 'edReason:10' : undefined })}<span class="small muted">Stok naik di gudang, hutang dagang dibuat otomatis.</span></div></div>`,
    });
  }
  function logED(L) {
    const rows = ED_LIST.map((e) => [
      `<b>${esc(e.n)}</b>`,
      ui.chip(`${e.d} hari`, e.d <= 30 ? 'danger' : 'warning'),
      L.ed[e.id] ? stamp(L.ed[e.id], L.edT[e.id]) : `<span class="small muted">${esc(e.s)}</span>`,
      L.ed[e.id] ? '' : `<div class="row">${ui.btn(`Pindah ke ${e.to}`, { act: 'edMove', arg: e.id, size: 'sm' })}${ui.btn('Retur', { act: 'edRet', arg: e.id, size: 'sm', variant: 'ghost' })}</div>`,
    ]);
    return ui.card({ title: 'Kedaluwarsa ≤ 90 hari', sub: 'Nilai berisiko Rp38,2 jt · dispensing memakai FEFO: batch dengan kedaluwarsa terdekat keluar lebih dulu', flush: true, body: ui.table(['Item', 'Sisa', 'Rencana', 'Tindakan'], rows) });
  }
  function logOpname(L) {
    if (L.opname) {
      const o = L.opname;
      return `${ui.alert('success', `Opname depo rawat jalan diposting · ${o.t}`, `Akurasi ${esc(fmt1(o.akurasi))}% · ${o.n} item berselisih, semua beralasan · selisih nilai ${esc(signed(o.val))} rupiah dijurnal ke selisih persediaan.`)}
        ${ui.card({ title: 'Hasil opname', flush: true, body: ui.table(['Item', { label: 'Sistem', r: true }, { label: 'Fisik', r: true }, { label: 'Selisih', r: true }, 'Alasan'], o.rows.map((r) => [esc(itemById(r.id).name), fmt(r.sys), fmt(r.fis), signed(r.diff), esc(r.reason || '–')])) })}`;
    }
    const rows = OPNAME.map((r) => {
      const it = itemById(r.id);
      const sys = stock(L, r.id, 'rj');
      const fis = num(L[`f_${r.id}`] ?? r.fis, sys);
      const diff = fis - sys;
      return [
        `<b>${esc(it.name)}</b>`, fmt(sys),
        `<div style="max-width:110px;margin-left:auto">${ui.input(`f_${r.id}`, L[`f_${r.id}`] ?? r.fis, { mono: true, rerender: true, inputmode: 'numeric' })}</div>`,
        `<span style="${diff ? 'color:var(--danger);font-weight:600' : ''}">${signed(diff)}</span>`,
        diff ? ui.select(`r_${r.id}`, L[`r_${r.id}`] || '', OPNAME_REASON) : ui.chip('Cocok', 'success'),
      ];
    });
    const miss = OPNAME.filter((r) => { const sys = stock(L, r.id, 'rj'); return num(L[`f_${r.id}`] ?? r.fis, sys) !== sys && !L[`r_${r.id}`]; }).length;
    return ui.card({
      title: 'Stok opname · Depo rawat jalan', sub: 'Hitung fisik dibandingkan stok sistem · setiap selisih wajib beralasan',
      body: `<div class="stack">${ui.table(['Item', { label: 'Sistem', r: true }, { label: 'Fisik', r: true }, { label: 'Selisih', r: true }, 'Alasan'], rows)}
        <div class="row">${ui.btn('Posting hasil opname', { act: 'postOpname', variant: 'primary', disabled: miss > 0, reason: `${miss} item berselisih belum diberi alasan` })}<span class="small muted">Selisih dijurnal ke akun selisih persediaan.</span></div></div>`,
    });
  }

  SIM.register({
    id: 'logistik', phase: 8, title: 'Logistik & pengadaan', nav: 'Logistik', codes: 'B01', role: 'logistik',
    desc: 'Stok per gudang dan depo dengan ABC-VEN. Item di bawah titik pesan ulang (ROP) menjadi usulan PO, lalu disetujui, dikirim, diterima dengan cek batch dan kedaluwarsa.',
    hint: 'Buat usulan PO dari item di bawah ROP, setujui, kirim, tandai barang tiba, lalu periksa batch dan kedaluwarsa di tab Penerimaan.',
    init: { tab: 'stok', depo: 'gudang', cls: 'all', po: [], nextNo: 32, adj: {}, ed: {}, edT: {}, rcv: '', ap: [], opname: null, edReason: '', flash: '' },
    render(L) {
      const under = underRop(L);
      const hutang = L.ap.reduce((s, a) => s + a.amount, 0);
      const edOpen = ED_LIST.filter((e) => !L.ed[e.id]).length;
      const kpis = `<div class="grid g4">${ui.kpi('Nilai persediaan', 'Rp4,82 M', '3.416 SKU aktif · 4 lokasi')}${ui.kpi('Item di bawah ROP', String(under.length), under.length ? `${under.filter((i) => i.ven === 'V').length} item VEN-V` : 'semua di atas ROP', under.length ? 'down' : 'up')}${ui.kpi('Hampir kedaluwarsa', `${edOpen} item`, '≤ 90 hari')}${ui.kpi('Hutang dagang baru', ui.rupiah(hutang), hutang ? `${L.ap.length} penerimaan hari ini` : 'belum ada penerimaan hari ini')}</div>`;
      const openPO = L.po.filter((p) => p.stage < 5).length;
      const tabs = ui.tabs('tab', L.tab, [
        { value: 'stok', label: `Stok & ROP (${under.length})` }, { value: 'po', label: `Pengadaan (${openPO})` },
        { value: 'terima', label: 'Penerimaan' }, { value: 'ed', label: `Kedaluwarsa (${edOpen})` }, { value: 'opname', label: 'Stok opname' },
      ]);
      const body = { stok: logStok, po: logPO, terima: logTerima, ed: logED, opname: logOpname }[L.tab] || logStok;
      return kpis + tabs + body(L);
    },
    actions: {
      makePO(L) {
        const picked = pickedItems(L);
        if (!picked.length) { SIM.toast('Centang minimal satu item di bawah ROP', 'warning'); return false; }
        const t = SIM.now(3);
        const no = `PO-2610-0${L.nextNo}`;
        const lines = picked.map((it) => ({ id: it.id, qty: it.sug }));
        const value = lines.reduce((s, l) => s + l.qty * itemById(l.id).price, 0);
        L.po.unshift({ no, lines, value, stage: 1, t: { 1: t } });
        L.nextNo += 1; L.tab = 'po'; L.flash = '';
        SIM.note(`Usulan ${no} dibuat dari ROP · ${lines.length} item · ${ui.rupiah(value)}`);
        SIM.toast(`Usulan ${no} dibuat · ${t}`, 'success');
        return undefined;
      },
      approve(L, J, el) { return poStep(L, el, 1, 2, (p, t) => { SIM.note(`${p.no} disetujui direktur · ${t}`); SIM.toast(`${p.no} disetujui · ${t}`, 'success'); }); },
      send(L, J, el) { return poStep(L, el, 2, 3, (p, t) => SIM.toast(`${p.no} terkirim ke pemasok · ${t}`, 'success')); },
      arrive(L, J, el) {
        return poStep(L, el, 3, 4, (p, t) => {
          L.rcv = p.no; L.tab = 'terima';
          p.lines.forEach((ln, i) => {
            L[`b_${ln.id}`] = `${ln.id.toUpperCase()}${261003 + i * 7}`;
            L[`e_${ln.id}`] = ln.id === 'seft' ? '03/2027' : ['08/2028', '11/2028', '05/2028'][i % 3];
            L[`q_${ln.id}`] = String(ln.qty);
          });
          SIM.toast(`Barang ${p.no} tiba · ${t}`, 'success');
        });
      },
      receive(L) {
        const p = L.po.find((x) => x.no === L.rcv && x.stage === 4) || L.po.find((x) => x.stage === 4);
        if (!p) { SIM.toast('Belum ada barang yang tiba', 'warning'); return false; }
        const iss = rcvIssues(L, p);
        if (iss.length) { SIM.toast(iss[0], 'warning'); return false; }
        if (needsEdReason(L, p) && String(L.edReason || '').trim().length < 10) { SIM.toast('Tulis alasan menerima batch berumur pendek', 'warning'); return false; }
        const t = SIM.now(6);
        let amount = 0; let n = 0;
        p.lines.forEach((ln) => {
          if (L[`d_${ln.id}`] === 'tolak') { ln.rejected = true; ln.got = 0; return; }
          const q = num(L[`q_${ln.id}`]);
          ln.got = q; ln.batch = String(L[`b_${ln.id}`]).trim(); ln.ed = String(L[`e_${ln.id}`]).trim();
          L.adj[`gudang:${ln.id}`] = (L.adj[`gudang:${ln.id}`] || 0) + q;
          amount += q * itemById(ln.id).price; n += 1;
        });
        p.stage = 5; p.t[5] = t; p.gr = `GR-2610-0${41 + L.ap.length}`; p.amount = amount;
        L.ap.push({ no: p.gr, po: p.no, amount, t });
        SIM.note(`Penerimaan ${p.gr} (${p.no}) · stok gudang naik ${n} item · hutang ${ui.rupiah(amount)}`, 'success');
        SIM.toast(`Diterima · ${t}`, 'success');
        SIM.done();
        return undefined;
      },
      mutasi(L, J, el) {
        const it = itemById(argOf(el));
        if (!it || L.depo === 'gudang') { SIM.toast('Pilih depo dulu untuk meminta dari gudang', 'warning'); return false; }
        const lim = Math.round(it.rop * 0.2);
        const q = Math.max(0, lim * 2 - stock(L, it.id, L.depo));
        L.adj[`${L.depo}:${it.id}`] = (L.adj[`${L.depo}:${it.id}`] || 0) + q;
        L.adj[`gudang:${it.id}`] = (L.adj[`gudang:${it.id}`] || 0) - q;
        const t = SIM.now(2);
        L.flash = `Mutasi ${fmt(q)} ${it.name} dari gudang ke ${DEPO.find((d) => d.value === L.depo).label} · ${t} (batch FEFO)`;
        return undefined;
      },
      edMove(L, J, el) {
        const e = ED_LIST.find((x) => x.id === argOf(el));
        if (!e) return false;
        L.ed[e.id] = `Dipindahkan ke ${e.to}, stok depo diperbarui`; L.edT[e.id] = SIM.now(2);
        return undefined;
      },
      edRet(L, J, el) {
        const e = ED_LIST.find((x) => x.id === argOf(el));
        if (!e) return false;
        L.ed[e.id] = 'Diretur ke distributor, menunggu nota kredit'; L.edT[e.id] = SIM.now(2);
        return undefined;
      },
      postOpname(L) {
        const rows = OPNAME.map((r) => { const sys = stock(L, r.id, 'rj'); const fis = num(L[`f_${r.id}`] ?? r.fis, sys); return { id: r.id, sys, fis, diff: fis - sys, reason: L[`r_${r.id}`] || '' }; });
        if (rows.some((r) => r.diff && !r.reason)) { SIM.toast('Beri alasan untuk setiap selisih', 'warning'); return false; }
        rows.forEach((r) => { if (r.diff) L.adj[`rj:${r.id}`] = (L.adj[`rj:${r.id}`] || 0) + r.diff; });
        const sysTotal = rows.reduce((s, r) => s + r.sys, 0) || 1;
        const t = SIM.now(5);
        L.opname = { t, rows, n: rows.filter((r) => r.diff).length, akurasi: Math.round((1 - rows.reduce((s, r) => s + Math.abs(r.diff), 0) / sysTotal) * 1000) / 10, val: rows.reduce((s, r) => s + r.diff * itemById(r.id).price, 0) };
        SIM.note(`Stok opname depo rawat jalan diposting · akurasi ${fmt1(L.opname.akurasi)}%`);
        return undefined;
      },
    },
  });

  /* =====================================================================
   * F8 · MUTU & KESELAMATAN (B06)
   * ===================================================================== */
  const INM = [
    { code: 'INM-01', name: 'Kepatuhan kebersihan tangan', v: 88, sep: 86, t: 85, src: 'PPI · audit observasi', n: '528/600' },
    { code: 'INM-02', name: 'Kepatuhan penggunaan APD', v: 96, sep: 95, t: 100, src: 'PPI · audit observasi', n: '211/220' },
    { code: 'INM-03', name: 'Kepatuhan identifikasi pasien', v: 97, sep: 96, t: 100, src: 'eMAR · pindai gelang', n: '1.164/1.200', emar: true },
    { code: 'INM-04', name: 'Waktu tanggap SC emergensi ≤ 30 menit', v: 91, sep: 88, t: 80, src: 'Kamar operasi', n: '10/11' },
    { code: 'INM-05', name: 'Waktu tunggu rawat jalan ≤ 60 menit', v: 84, sep: 79, t: 80, src: 'Antrean · task 3→4', n: '9.412/11.204' },
    { code: 'INM-06', name: 'Penundaan operasi elektif', v: 4, sep: 6, t: 5, lower: true, src: 'Kamar operasi', n: '9/226' },
    { code: 'INM-07', name: 'Kepatuhan waktu visite dokter', v: 82, sep: 78, t: 80, src: 'CPPT DPJP berjam', n: '1.402/1.710' },
    { code: 'INM-08', name: 'Pelaporan hasil kritis laboratorium ≤ 30 menit', v: 100, sep: 98, t: 100, src: 'Laboratorium · nilai kritis', n: '37/37' },
    { code: 'INM-09', name: 'Kepatuhan penggunaan formularium nasional', v: 86, sep: 84, t: 80, src: 'Farmasi · resep Fornas', n: '6.902/8.025' },
    { code: 'INM-10', name: 'Kepatuhan terhadap clinical pathway', v: 76, sep: 74, t: 80, src: 'Isian manual komite medik', n: '38/50', manual: true },
    { code: 'INM-11', name: 'Kepatuhan upaya pencegahan risiko jatuh', v: 93, sep: 91, t: 100, src: 'Asesmen Morse + intervensi', n: '412/443' },
    { code: 'INM-12', name: 'Kecepatan waktu tanggap komplain', v: 87, sep: 90, t: 80, src: 'Pengaduan', n: '26/30' },
    { code: 'INM-13', name: 'Kepuasan pasien', v: 86, sep: 84, t: 76, src: 'Survei kepuasan', n: '1.288/1.498' },
  ];
  const inmOk = (i, v) => (i.lower ? v <= i.t : v >= i.t);
  const IKP_TPL = {
    emar: { label: 'Override eMAR', jenis: 'KNC', unit: 'Ruang Melati (rawat inap)', rm: PEOPLE.hartono.rm, kron: 'Pemberian obat di eMAR dilakukan dengan override karena gelang pasien tidak terbaca pemindai. Identitas dicek ulang manual dengan dua penanda sebelum obat diberikan. Tidak ada cedera.', tindak: 'Gelang dicetak ulang, pemindai diperiksa petugas IT ruangan.' },
    kritis: { label: 'Nilai kritis terlambat', jenis: 'KTC', unit: 'Laboratorium', rm: PEOPLE.hartono.rm, kron: 'Nilai kritis kalium 6,8 mmol/L dilaporkan ke dokter 42 menit setelah validasi (batas 30 menit). Telepon ke ruangan dua kali tidak terangkat.', tindak: 'Dokter jaga dihubungi langsung, tata laksana hiperkalemia diberikan.' },
  };
  const IKP_JENIS = [{ value: 'KNC', label: 'KNC · kejadian nyaris cedera' }, { value: 'KTC', label: 'KTC · kejadian tidak cedera' }, { value: 'KTD', label: 'KTD · kejadian tidak diharapkan' }, { value: 'KPC', label: 'KPC · kondisi potensial cedera' }, { value: 'Sentinel', label: 'Sentinel · kematian/cedera berat' }];
  const UNITS = ['Ruang Melati (rawat inap)', 'IGD', 'Laboratorium', 'Farmasi', 'Poli Penyakit Dalam', 'Kamar operasi'];
  const IMPACT = ['Tidak signifikan', 'Minor', 'Moderat', 'Mayor', 'Katastropik'];
  const LIKELY = ['Sangat jarang', 'Jarang', 'Mungkin', 'Sering', 'Sangat sering'];
  const band = (l, d) => {
    const s = l * d;
    if (s >= 15) return { k: 'merah', label: 'Merah · ekstrem', tone: 'danger', bg: 'var(--danger-bg)' };
    if (s >= 8) return { k: 'kuning', label: 'Kuning · tinggi', tone: 'warning', bg: 'var(--warning-bg)' };
    if (s >= 4) return { k: 'hijau', label: 'Hijau · moderat', tone: 'success', bg: 'var(--success-bg)' };
    return { k: 'biru', label: 'Biru · rendah', tone: 'info', bg: 'var(--info-bg)' };
  };
  const IKP_BASE = [
    { no: 'IKP-2610-012', jenis: 'KTD', unit: 'Ruang Melati (rawat inap)', t: '3 Okt · 22.40', rm: '00-41-77-30', anon: true, kron: 'Pasien lansia jatuh di kamar mandi, memar lengan kiri. Skor Morse 55, pita kuning terpasang.', status: 'RCA berjalan', l: 3, d: 3, method: 'RCA · batas 45 hari', base: true },
    { no: 'IKP-2610-011', jenis: 'KNC', unit: 'Laboratorium', t: '2 Okt · 09.12', rm: '00-33-12-08', anon: false, kron: 'Label sampel tertukar antar dua pasien, terdeteksi saat verifikasi sebelum analisis.', status: 'Selesai', l: 2, d: 2, method: 'Investigasi sederhana · 7 hari', base: true },
  ];
  const ACT_PRESET = [
    { what: 'Cetak ulang gelang otomatis bila gagal pindai dua kali', pic: 'Kepala IT', due: '12 Okt 2026' },
    { what: 'Sosialisasi ulang SOP identifikasi dua penanda', pic: 'Kabid keperawatan', due: '19 Okt 2026' },
    { what: 'Audit kepatuhan pindai gelang mingguan selama 1 bulan', pic: 'Komite mutu', due: '2 Nov 2026' },
    { what: 'Eskalasi otomatis nilai kritis ke DPJP cadangan setelah 15 menit', pic: 'Kepala laboratorium', due: '16 Okt 2026' },
  ];
  const FACTORS = [['fk_kom', 'Komunikasi'], ['fk_sop', 'SOP / kebijakan'], ['fk_beban', 'Beban kerja'], ['fk_alat', 'Alat / sistem'], ['fk_pasien', 'Faktor pasien']];
  const curInc = (L) => L.inc.find((x) => x.no === L.sel) || null;

  function riskMatrix(sel) {
    let h = '<div style="display:grid;grid-template-columns:96px repeat(5,minmax(0,1fr));gap:4px;font-size:11px;min-width:420px">';
    h += `<div class="muted">Dampak ↓ / Kemungkinan →</div>${LIKELY.map((x) => `<div class="muted" style="text-align:center">${esc(x)}</div>`).join('')}`;
    for (let d = 5; d >= 1; d -= 1) {
      h += `<div class="muted" style="align-self:center">${d} · ${esc(IMPACT[d - 1])}</div>`;
      for (let l = 1; l <= 5; l += 1) {
        const b = band(l, d);
        const on = sel && sel.l === l && sel.d === d;
        h += `<button type="button" data-act="cell" data-arg="${l}-${d}" aria-pressed="${on ? 'true' : 'false'}" title="${esc(b.label)}" style="min-height:36px;border-radius:8px;cursor:pointer;font-family:var(--font-mono);font-weight:600;background:${b.bg};border:${on ? '2px solid var(--ink-900)' : '1px solid var(--line)'};color:var(--ink-700)">${l * d}</button>`;
      }
    }
    return `<div class="tbl-wrap">${h}</div></div>`;
  }
  function mutuINM(L, J) {
    const emarOv = J.emar && J.emar.override;
    const rows = INM.map((i) => {
      let v = L.per === 'sep' ? i.sep : i.v;
      if (i.emar && emarOv && L.per === 'okt') v = 96.9;
      const ok = inmOk(i, v);
      return `<div style="display:grid;grid-template-columns:minmax(0,1.6fr) minmax(120px,1fr) 64px;gap:12px;align-items:center;padding:9px 0;border-bottom:1px solid var(--line-soft)">
        <div style="min-width:0"><div style="font-weight:600;font-size:13.5px"><span class="mono small muted">${esc(i.code)}</span> ${esc(i.name)}</div>
          <div class="small muted">${i.manual ? ui.chip('manual', '') : ui.chip('otomatis', 'brand')} ${esc(i.src)} · ${esc(i.n)}${i.emar && emarOv ? ' · termasuk 1 override eMAR hari ini' : ''}</div></div>
        <div>${bar(i.lower ? v * 5 : v, ok ? 'success' : 'warning', i.lower ? i.t * 5 : i.t, 10)}<div class="small muted" style="margin-top:3px">target ${i.lower ? '≤' : '≥'} ${i.t}%${i.lower ? ' (skala 0–20%)' : ''}</div></div>
        <div class="num" style="text-align:right;font-weight:600;color:${ok ? 'var(--success)' : 'var(--warning)'}">${esc(fmt1(v))}%</div></div>`;
    }).join('');
    const met = INM.filter((i) => inmOk(i, L.per === 'sep' ? i.sep : i.v)).length;
    return `<div class="grid g4">${ui.kpi('INM mencapai target', `${met}/13`, L.per === 'sep' ? 'September 2026' : 'Oktober berjalan')}${ui.kpi('Dihitung otomatis', '12/13', '1 isian manual komite medik')}${ui.kpi('IKP bulan ini', String(2 + L.inc.length), `${L.inc.length} dilaporkan hari ini`)}${ui.kpi('Lapor IKP ≤ 2×24 jam', '100%', 'IMP-RS')}</div>
      ${ui.card({
        title: 'Indikator nasional mutu (INM)', sub: L.recalc ? `Dihitung ulang dari data transaksi · ${L.recalc}` : 'Dihitung otomatis tiap 01.30 WIB dari data transaksi',
        actions: `${ui.seg('per', L.per, [{ value: 'okt', label: 'Okt berjalan' }, { value: 'sep', label: 'Sep 2026' }])}${ui.btn('Hitung ulang', { act: 'recalc', size: 'sm' })}`,
        body: `${rows}<div class="small muted" style="margin-top:8px">Batang = capaian, garis tegak = target. Hijau mencapai target, jingga di bawah target.</div>`,
      })}`;
  }
  function mutuIKP(L, J) {
    const emarOv = J.emar && J.emar.override;
    return ui.card({
      title: 'Lapor insiden keselamatan pasien', sub: 'Semua staf bisa melapor. Laporan beku setelah dikirim; koreksi lewat addendum.',
      body: `<div class="stack">
        ${emarOv ? ui.alert('warning', 'Ada override eMAR tercatat hari ini', `Ruang ${esc((J.bed && J.bed.ward) || 'Melati')} · ${esc(PEOPLE.hartono.name)}. Override wajib dilaporkan sebagai IKP.`) : `<div class="row"><span class="small muted">Contoh laporan dari alur klinis:</span>${SAMPLE()}</div>`}
        <div class="row"><span class="small muted">Isi cepat dari templat:</span>${ui.btn(IKP_TPL.emar.label, { act: 'tpl', arg: 'emar', size: 'sm' })}${ui.btn(IKP_TPL.kritis.label, { act: 'tpl', arg: 'kritis', size: 'sm' })}</div>
        <div class="grid g2">${ui.field('Jenis insiden', ui.select('ik_jenis', L.ik_jenis, IKP_JENIS))}${ui.field('Unit kejadian', ui.select('ik_unit', L.ik_unit, UNITS))}
          ${ui.field('Waktu kejadian', ui.input('ik_waktu', L.ik_waktu, { mono: true, placeholder: 'mis. 5 Okt 09.40' }))}${ui.field('No. RM pasien', ui.input('ik_rm', L.ik_rm, { mono: true, placeholder: '00-00-00-00' }), 'Hanya RM yang tampil di daftar; nama pasien tidak ditampilkan')}</div>
        ${ui.field('Kronologi singkat', ui.input('ik_kron', L.ik_kron, { area: true, placeholder: 'Apa yang terjadi, kapan, dan bagaimana ketahuan. Tanpa menyalahkan orang.' }), 'Minimal 20 huruf')}
        ${ui.field('Tindakan segera yang sudah dilakukan', ui.input('ik_tindak', L.ik_tindak, { area: true }))}
        ${ui.check('ik_anon', !!L.ik_anon, 'Laporkan secara anonim (identitas pelapor hanya terlihat oleh tim investigasi bila diperlukan)')}
        <div>${ui.btn('Kirim laporan IKP', { act: 'report', variant: 'primary', needs: 'ik_kron:20' })}</div></div>`,
    });
  }
  function mutuInv(L) {
    const all = L.inc.concat(IKP_BASE);
    const list = ui.list(all.map((x) => ({
      title: `${x.no} · ${x.jenis}`, sub: `${x.unit} · ${x.t} · RM ${x.rm} · ${x.anon ? 'pelapor anonim' : 'pelapor tercatat'}`, arg: x.no, sel: x.no === L.sel,
      right: `${x.l ? ui.chip(band(x.l, x.d).label.split(' · ')[0], band(x.l, x.d).tone) : ui.chip('Belum digrading', 'warning')}<span class="small muted">${esc(x.status)}</span>`,
    })), 'pickInc');
    const x = all.find((i) => i.no === L.sel);
    let detail;
    if (!x) detail = ui.card({ title: 'Investigasi', body: ui.empty('Pilih laporan di kiri, atau kirim laporan baru dari tab Lapor IKP.') });
    else if (x.base) detail = ui.card({ title: `${x.no} · ${x.status}`, sub: x.method, body: kv([['Grading', esc(band(x.l, x.d).label)], ['Unit', esc(x.unit)], ['Kronologi', esc(x.kron)]]) });
    else detail = mutuIncDetail(L, x);
    return `<div class="split"><div class="card"><div class="ch"><h3>Register IKP</h3><span class="sub">${all.length} laporan</span></div><div class="cb flush">${list}</div></div>${detail}</div>`;
  }
  function mutuIncDetail(L, x) {
    const stepIdx = { Dilaporkan: 0, Investigasi: 1, 'Rencana tindak': 2, 'Tindak lanjut berjalan': 4 }[x.status] ?? 0;
    const head = `${ui.steps(['Grading risiko', 'Investigasi / RCA', 'Rencana tindak', 'Pantau'], stepIdx)}
      ${kv([['Jenis · unit', `${esc(x.jenis)} · ${esc(x.unit)}`], ['Pelapor', x.anon ? `Anonim ${ui.chip('identitas disembunyikan', 'info')}` : esc(x.reporter)], ['Dilaporkan', esc(x.t)], ['Kronologi', esc(x.kron)]])}<hr class="sep">`;
    let body = '';
    if (x.status === 'Dilaporkan') {
      const pick = L.ml ? band(Number(L.ml), Number(L.md)) : null;
      body = `<div class="label">Matriks grading risiko (kemungkinan × dampak)</div>${riskMatrix(L.ml ? { l: Number(L.ml), d: Number(L.md) } : null)}
        <div class="row">${pick ? `${ui.chip(pick.label, pick.tone)}<span class="small muted">${pick.k === 'kuning' || pick.k === 'merah' ? 'Wajib RCA · batas 45 hari' : 'Investigasi sederhana · batas 7 hari'}</span>` : '<span class="small muted">Klik satu sel matriks.</span>'}</div>
        <div>${ui.btn('Tetapkan grading', { act: 'setGrade', variant: 'primary', disabled: !pick, reason: 'Pilih sel kemungkinan × dampak dulu' })}</div>`;
    } else if (x.status === 'Investigasi') {
      const rca = x.method.startsWith('RCA');
      body = `${ui.chip(band(x.l, x.d).label, band(x.l, x.d).tone)} <span class="small muted">${esc(x.method)} · ditetapkan ${esc(x.gradedAt)}</span>
        ${ui.field(rca ? 'Akar masalah (hasil 5 mengapa / tulang ikan)' : 'Hasil investigasi sederhana', ui.input('rca', L.rca, { area: true, placeholder: 'mis. pemindai di ruang obat sering gagal membaca gelang yang terlipat; tidak ada prosedur cetak ulang' }), 'Minimal 15 huruf')}
        <div class="label">Faktor kontributor</div><div class="grid g2">${FACTORS.map(([k, l]) => ui.check(k, !!L[k], l)).join('')}</div>
        <div>${ui.btn(rca ? 'Simpan hasil RCA' : 'Simpan hasil investigasi', { act: 'saveRca', variant: 'primary', needs: 'rca:15' })}</div>`;
    } else if (x.status === 'Rencana tindak') {
      body = `<div class="label">Rencana tindak (apa · penanggung jawab · tenggat)</div>
        ${x.acts.length ? ui.table(['Tindakan', 'PJ', 'Tenggat'], x.acts.map((a) => [esc(a.what), esc(a.pic), esc(a.due)])) : ui.empty('Belum ada tindakan. Tambahkan dari usulan di bawah.')}
        <div class="stack" style="gap:6px">${ACT_PRESET.map((a, i) => (x.acts.some((y) => y.what === a.what) ? '' : `<div class="row between"><span class="small">${esc(a.what)} <span class="muted">· ${esc(a.pic)}</span></span>${ui.btn('Tambah', { act: 'addAct', arg: String(i), size: 'sm' })}</div>`)).join('')}</div>
        <div>${ui.btn('Kunci rencana tindak', { act: 'lockPlan', variant: 'primary', disabled: !x.acts.length, reason: 'Tambahkan minimal satu tindakan' })}</div>`;
    } else {
      body = `${ui.alert('success', `Rencana tindak dikunci · ${x.lockedAt}`, `${x.acts.length} tindakan dipantau komite mutu sampai tenggat. Faktor: ${esc((x.factors || []).join(', ') || 'belum dipilih')}.`)}
        ${ui.table(['Tindakan', 'PJ', 'Tenggat', 'Status'], x.acts.map((a) => [esc(a.what), esc(a.pic), esc(a.due), ui.chip('Berjalan', 'info')]))}
        ${ui.next('dasbor', `${x.no} digrading, diinvestigasi, dan punya rencana tindak.`)}`;
    }
    return ui.card({ title: `${x.no} · ${x.status}`, sub: 'Pembacaan laporan tercatat di audit', body: `<div class="stack">${head}${body}</div>` });
  }

  SIM.register({
    id: 'mutu', phase: 8, title: 'Mutu & keselamatan', nav: 'Mutu & keselamatan', codes: 'B06', role: 'mutu',
    desc: 'Indikator nasional mutu dihitung dari data transaksi. Insiden keselamatan pasien dilaporkan (boleh anonim), digrading dengan matriks risiko, diinvestigasi, lalu diberi rencana tindak.',
    hint: 'Laporkan IKP (mis. override eMAR), pilih sel matriks risiko, isi hasil RCA, lalu kunci rencana tindak.',
    init: { tab: 'inm', per: 'okt', recalc: '', ik_jenis: 'KNC', ik_unit: 'Ruang Melati (rawat inap)', ik_waktu: '', ik_rm: '', ik_kron: '', ik_tindak: '', ik_anon: false, inc: [], sel: '', ml: '', md: '', rca: '', nextNo: 14 },
    render(L, J) {
      const open = L.inc.filter((x) => x.status !== 'Tindak lanjut berjalan').length;
      const tabs = ui.tabs('tab', L.tab, [{ value: 'inm', label: 'Indikator mutu' }, { value: 'ikp', label: 'Lapor IKP' }, { value: 'inv', label: `Grading & investigasi${open ? ` (${open})` : ''}` }]);
      return tabs + (L.tab === 'ikp' ? mutuIKP(L, J) : L.tab === 'inv' ? mutuInv(L) : mutuINM(L, J));
    },
    actions: {
      recalc(L) { L.recalc = SIM.now(1); SIM.toast(`13 indikator dihitung ulang · ${L.recalc}`, 'success'); },
      tpl(L, J, el) {
        const t = IKP_TPL[argOf(el)] || IKP_TPL.emar;
        Object.assign(L, { ik_jenis: t.jenis, ik_unit: t.unit, ik_rm: t.rm, ik_kron: t.kron, ik_tindak: t.tindak, ik_waktu: `5 Okt ${SIM.time()}` });
      },
      report(L) {
        const kron = String(L.ik_kron || '').trim();
        if (kron.length < 20) { SIM.toast('Kronologi minimal 20 huruf', 'warning'); return false; }
        const t = SIM.now(3);
        const no = `IKP-2610-0${L.nextNo}`;
        L.nextNo += 1;
        L.inc.unshift({ no, jenis: L.ik_jenis, unit: L.ik_unit, t: `5 Okt · ${t}`, rm: String(L.ik_rm || '').trim() || 'tidak dicantumkan', anon: !!L.ik_anon, reporter: STAFF.mutu.name, kron, status: 'Dilaporkan', acts: [] });
        Object.assign(L, { sel: no, tab: 'inv', ik_kron: '', ik_tindak: '', ik_rm: '', ik_waktu: '', ml: '', md: '' });
        SIM.note(`${no} (${L.inc[0].jenis}) dilaporkan${L.inc[0].anon ? ' secara anonim' : ''} · ${L.inc[0].unit}`, 'warning');
        SIM.toast(`${no} terkirim · ${t}`, 'success');
        return undefined;
      },
      pickInc(L, J, el) { const a = argOf(el); if (a) { L.sel = a; L.ml = ''; L.md = ''; } },
      cell(L, J, el) {
        const x = curInc(L);
        const m = argOf(el).match(/^([1-5])-([1-5])$/);
        if (!x || x.status !== 'Dilaporkan' || !m) { SIM.toast('Pilih laporan baru yang belum digrading', 'warning'); return false; }
        L.ml = m[1]; L.md = m[2];
        return undefined;
      },
      setGrade(L) {
        const x = curInc(L);
        if (!x || x.status !== 'Dilaporkan' || !L.ml) { SIM.toast('Pilih sel matriks dulu', 'warning'); return false; }
        x.l = Number(L.ml); x.d = Number(L.md);
        const b = band(x.l, x.d);
        x.method = b.k === 'kuning' || b.k === 'merah' ? 'RCA · batas 45 hari' : 'Investigasi sederhana · batas 7 hari';
        x.status = 'Investigasi'; x.gradedAt = SIM.now(4);
        SIM.note(`${x.no} digrading ${b.label} · ${x.method}`);
        return undefined;
      },
      saveRca(L) {
        const x = curInc(L);
        if (!x || x.status !== 'Investigasi') { SIM.toast('Tetapkan grading dulu', 'warning'); return false; }
        if (String(L.rca || '').trim().length < 15) { SIM.toast('Akar masalah minimal 15 huruf', 'warning'); return false; }
        x.rca = String(L.rca).trim(); x.factors = FACTORS.filter(([k]) => L[k]).map(([, l]) => l);
        x.status = 'Rencana tindak'; x.rcaAt = SIM.now(20);
        x.acts = ACT_PRESET.slice(0, 1).concat(x.no && x.kron.includes('kalium') ? [ACT_PRESET[3]] : []);
        L.rca = '';
        SIM.toast(`Hasil investigasi tersimpan · ${x.rcaAt}`, 'success');
        return undefined;
      },
      addAct(L, J, el) {
        const x = curInc(L);
        const a = ACT_PRESET[Number(argOf(el))];
        if (!x || x.status !== 'Rencana tindak' || !a) return false;
        if (!x.acts.some((y) => y.what === a.what)) x.acts.push(a);
        return undefined;
      },
      lockPlan(L) {
        const x = curInc(L);
        if (!x || x.status !== 'Rencana tindak' || !x.acts.length) { SIM.toast('Rencana tindak belum lengkap', 'warning'); return false; }
        x.status = 'Tindak lanjut berjalan'; x.lockedAt = SIM.now(3);
        SIM.note(`${x.no}: rencana tindak dikunci · ${x.acts.length} tindakan dipantau`, 'success');
        SIM.done();
        return undefined;
      },
    },
  });

  /* =====================================================================
   * F8 · REKAM MEDIS ADMINISTRATIF (B09)
   * ===================================================================== */
  function rmVisits(J) {
    return [
      { id: 'v1', no: J.encounter ? J.encounter.no : 'RJ-261005-0042', pt: `${PEOPLE.suryo.name} · ${PEOPLE.suryo.rm}`, set: 'Rawat jalan · Poli Penyakit Dalam', sample: !J.encounter, dpjp: PEOPLE.suryo.dokter,
        docs: [['Identitas & persetujuan umum', true], ['Asesmen awal keperawatan', !!J.soap], ['SOAP DPJP ber-TTE', !!J.soap], ['Hasil penunjang tervalidasi', !!J.labResult], ['Resep elektronik', !!J.rx], ['Obat diserahkan + edukasi', !!J.dispensed]] },
      { id: 'v2', no: 'RI-261005-0007', pt: `${PEOPLE.hartono.name} · ${PEOPLE.hartono.rm}`, set: `Rawat inap · ${J.bed ? `${J.bed.ward} ${J.bed.room}` : 'Melati 3-02'}`, sample: !J.discharge, dpjp: PEOPLE.hartono.dokter,
        docs: [['Asesmen awal medis & keperawatan', true], ['CPPT terverifikasi DPJP', true], ['eMAR lengkap', !!J.emar], ['Resume medis ≤ 1×24 jam ber-TTE', !!J.discharge], ['Rekonsiliasi obat pulang', !!J.discharge]] },
      { id: 'v3', no: 'RI-261005-0009', pt: `${PEOPLE.ratna.name} · ${PEOPLE.ratna.rm}`, set: 'Rawat inap bedah · elektif', sample: !J.surgery, dpjp: PEOPLE.ratna.dokter,
        docs: [['Persetujuan tindakan', !!J.consent], ['Asesmen pra-anestesi', true], ['Ceklis keselamatan operasi', !!(J.surgery && J.surgery.signOut)], ['Laporan operasi', !!J.surgery], ['Resume medis', false]] },
      { id: 'v4', no: 'RJ-261002-0118', pt: 'An. Kirana P. · 00-19-55-02', set: 'Rawat jalan · Poli Anak', sample: false, dpjp: 'dr. Laila Fitri, Sp.A',
        docs: [['Identitas & persetujuan umum', true], ['Asesmen awal', true], ['SOAP DPJP ber-TTE', true], ['Resep elektronik', true]] },
      { id: 'v5', no: 'RI-260928-0031', pt: 'Tn. Bambang H. · 00-08-21-44', set: 'Rawat inap · ICU', sample: false, dpjp: 'dr. Yusuf Hakim, Sp.P',
        docs: [['Asesmen awal', true], ['CPPT terverifikasi DPJP', false], ['Resume medis ≤ 1×24 jam ber-TTE', false], ['Rekonsiliasi obat', true]] },
    ];
  }
  const ROI = [
    { id: 'roi1', no: 'ROI-2610-007', from: 'PT Asuransi Sehat Sentosa', kind: 'Asuransi', who: `${PEOPLE.ratna.name} · RM ${PEOPLE.ratna.rm}`, pkey: 'ratna', basis: 'Persetujuan tertulis pasien (formulir RM-ROI-01, ditandatangani 2 Okt 2026)', scope: ['Resume medis', 'Laporan operasi', 'Hasil laboratorium'], due: '3×24 jam · tenggat 6 Okt 14.00' },
    { id: 'roi2', no: 'ROI-2610-005', from: 'Pengadilan Negeri Jakarta Pusat', kind: 'Penegak hukum', who: 'Tn. B. S. · RM 00-17-88-02', pkey: '', basis: 'Penetapan hakim No. 412/Pid.B/2026/PN Jkt.Pst (asli diperlihatkan)', scope: ['Visum et repertum', 'Resume IGD'], due: '7 hari · tenggat 9 Okt' },
  ];
  const ROI_STEPS = ['Diajukan', 'Verifikasi identitas & dasar hukum', 'Disetujui', 'Berkas bertanda air dikirim', 'Tercatat'];
  const ROI_APPROVER = 'Hj. Sri Rahayu, S.KM (Kepala Instalasi RM)';
  const RET_STEPS = ['Kandidat dihitung sistem', 'Diusulkan komite RM', 'Disetujui direktur', 'Berita acara ber-TTE', 'Dimusnahkan (berkas fisik)'];
  const RET_BTN = ['Usulkan ke komite RM', 'Setujui (direktur)', 'Terbitkan berita acara (TTE)', 'Catat pemusnahan selesai'];
  const roiState = (L, id) => (L.roi[id] ??= { stage: 0, t: {} });

  function accessRows(L, J, key) {
    let rows = [];
    let sample = false;
    if (key === 'suryo') {
      if (J.encounter) rows.push([J.encounter.t || '07.55', STAFF.daftar.name, 'Petugas pendaftaran', 'Pendaftaran', `Membuat kunjungan ${J.encounter.no}`]);
      if (J.soap) rows.push(['08.40', STAFF.dokter.name, 'Dokter spesialis', 'Poli Penyakit Dalam', 'Membaca & menulis SOAP']);
      if (J.labResult) rows.push([J.labResult.validatedAt || '09.30', STAFF.lab.name, 'Analis laboratorium', 'Laboratorium', 'Validasi hasil']);
      if (J.dispensed) rows.push([J.dispensed.t || '10.05', J.dispensed.by || STAFF.apoteker.name, 'Apoteker', 'Farmasi rawat jalan', 'Telaah resep & serah obat']);
      if (!rows.length) {
        sample = true;
        rows = [['07.55', STAFF.daftar.name, 'Petugas pendaftaran', 'Pendaftaran', 'Membuat kunjungan'], ['08.40', STAFF.dokter.name, 'Dokter spesialis', 'Poli Penyakit Dalam', 'Membaca & menulis SOAP'], ['09.30', STAFF.lab.name, 'Analis laboratorium', 'Laboratorium', 'Validasi hasil']];
      }
    } else if (key === 'hartono') {
      sample = !J.igd;
      rows = [['10.05', STAFF.dokterigd.name, 'Dokter IGD', 'IGD', 'Membuka ringkasan pasien'], ['11.20', STAFF.perawat.name, 'Perawat', 'Ruang Melati', 'Mencatat eMAR'], ['13.02', 'Rahmat Hidayat', 'Ahli gizi', 'Instalasi gizi', 'Membuka hasil laboratorium', 'h3']];
    } else {
      sample = !J.consent;
      rows = [['09.10', PEOPLE.ratna.dokter, 'Dokter spesialis', 'Poli Bedah', 'Membuka rekam medis'], ['10.30', STAFF.ok.name, 'Perawat kamar operasi', 'Kamar operasi', 'Ceklis keselamatan operasi']];
    }
    L.extra.filter((e) => e.pkey === key).forEach((e) => rows.push([e.t, e.who, e.role, e.unit, e.act]));
    return { rows, sample };
  }
  function rmKelengkapan(L, J) {
    const vs = rmVisits(J);
    const score = (v) => Math.round((v.docs.filter((d) => d[1]).length / v.docs.length) * 100);
    const avg = Math.round(vs.reduce((s, v) => s + score(v), 0) / vs.length);
    const table = ui.table(['Kunjungan', 'Pasien', { label: 'Skor', r: true }, 'Status'], vs.map((v) => {
      const s = score(v);
      return [`<b class="mono">${esc(v.no)}</b><div class="small muted">${esc(v.set)}</div>`, `${esc(v.pt)} ${v.sample ? SAMPLE() : ''}`, `<div style="min-width:90px">${bar(s, s === 100 ? 'success' : s >= 70 ? 'warning' : 'danger')}<span class="small">${s}%</span></div>`, s === 100 ? ui.chip('Lengkap', 'success') : L.remind[v.id] ? ui.chip(`Diingatkan ${L.remind[v.id]}`, 'info') : ui.chip(`${v.docs.filter((d) => !d[1]).length} kurang`, 'warning')];
    }), { act: 'pickVis', rowArgs: vs.map((v) => v.id), sel: vs.findIndex((v) => v.id === L.vis) });
    const v = vs.find((x) => x.id === L.vis);
    const detail = v ? ui.card({
      title: `Berkas ${v.no}`, sub: `${v.pt} · DPJP ${v.dpjp}`,
      body: `<div class="stack">${v.docs.map(([n, ok]) => `<div class="row between small"><span>${esc(n)}</span>${ok ? ui.chip('Ada', 'success') : ui.chip('Belum ada', 'danger')}</div>`).join('')}
        <div>${v.docs.every((d) => d[1]) ? ui.chip('Berkas lengkap, siap koding', 'success') : L.remind[v.id] ? stamp('Pengingat terkirim ke DPJP', L.remind[v.id]) : ui.btn('Kirim pengingat ke DPJP', { act: 'remind', arg: v.id, variant: 'primary' })}</div></div>`,
    }) : ui.card({ title: 'Detail berkas', body: ui.empty('Klik satu kunjungan untuk melihat dokumen yang belum ada.') });
    return `<div class="grid g4">${ui.kpi('Rata-rata kelengkapan', `${avg}%`, 'pulang + 24 jam · target 100%')}${ui.kpi('Resume ≤ 1×24 jam', '91%', 'IMP-RS · target 100%', 'down')}${ui.kpi('Entri susulan bulan ini', '14', 'tercatat waktu klinis & alasan')}${ui.kpi('Berkas dipinjam', '6', '1 terlambat kembali', 'down')}</div>
      <div class="grid g2" style="align-items:start">${ui.card({ title: 'Kelengkapan rekam medis per kunjungan', sub: 'Dokumen wajib per jenis layanan', flush: true, body: table })}${detail}</div>`;
  }
  function rmROI(L) {
    const list = ui.list(ROI.map((r) => {
      const s = roiState(L, r.id);
      return { title: `${r.no} · ${r.from}`, sub: `${r.kind} · ${r.who}`, arg: r.id, sel: r.id === L.roiSel, right: s.rej ? ui.chip('Ditolak', 'danger') : ui.chip(ROI_STEPS[Math.min(s.stage, 4)], s.stage >= 4 ? 'success' : 'info') };
    }), 'pickRoi');
    const r = ROI.find((x) => x.id === L.roiSel) || ROI[0];
    const s = roiState(L, r.id);
    let act = '';
    if (s.rej) act = ui.alert('danger', `Permintaan ditolak · ${s.t.rej}`, esc(s.rej));
    else if (s.stage === 0) {
      const ok = L[`v1_${r.id}`] && L[`v2_${r.id}`] && L[`v3_${r.id}`];
      act = `<div class="label">Verifikasi oleh penerima permintaan (${esc(STAFF.rm.name)})</div>
        ${ui.check(`v1_${r.id}`, !!L[`v1_${r.id}`], 'Identitas pemohon cocok dengan surat kuasa / surat tugas')}
        ${ui.check(`v2_${r.id}`, !!L[`v2_${r.id}`], 'Dasar hukum sah dan masih berlaku')}
        ${ui.check(`v3_${r.id}`, !!L[`v3_${r.id}`], 'Lingkup dokumen sesuai permintaan, tidak lebih (data minimal)')}
        <div class="row">${ui.btn('Verifikasi selesai', { act: 'roiVerify', arg: r.id, variant: 'primary', disabled: !ok, reason: 'Centang ketiga pemeriksaan dulu' })}</div>
        ${ui.field('Atau tolak permintaan (alasan)', ui.input('tolak', L.tolak, { area: true, placeholder: 'mis. dasar hukum tidak melampirkan penetapan asli' }))}
        <div>${ui.btn('Tolak permintaan', { act: 'roiReject', arg: r.id, variant: 'danger', needs: 'tolak:10' })}</div>`;
    } else if (s.stage === 1) {
      act = `${stamp('Identitas & dasar hukum diverifikasi', s.t[1])}
        ${ui.alert('info', 'Penyetuju harus berbeda dari penerima permintaan', `Penerima: ${esc(STAFF.rm.name)} · Penyetuju: ${esc(ROI_APPROVER)}`)}
        <div>${ui.btn('Setujui pelepasan', { act: 'roiApprove', arg: r.id, variant: 'primary' })}</div>`;
    } else if (s.stage === 2) {
      act = `${stamp('Disetujui Kepala Instalasi RM', s.t[2])}
        <div style="position:relative;overflow:hidden;border:1px solid var(--line);border-radius:10px;padding:14px;background:var(--subtle);min-height:120px">
          <div class="small"><b>${esc(r.scope[0])}</b> · ${esc(r.who)}<br><span class="muted">Halaman 1 dari ${r.scope.length + 2} · paket PDF</span></div>
          <div aria-hidden="true" style="position:absolute;left:-10%;right:-10%;top:44%;text-align:center;transform:rotate(-12deg);font-weight:700;color:var(--danger-border);font-size:15px;letter-spacing:.04em">DIRILIS UNTUK ${esc(r.from.toUpperCase())} · ${esc(STAFF.rm.name.toUpperCase())} · 5 OKT 2026 ${SIM.time()}</div></div>
        <div class="small muted">Tanda air nama pengakses + waktu di setiap halaman · tautan unduh sekali pakai, berlaku 24 jam.</div>
        <div>${ui.btn('Kirim berkas bertanda air', { act: 'roiRelease', arg: r.id, variant: 'primary' })}</div>`;
    } else {
      act = `${ui.alert('success', `Berkas dirilis · ${s.t[3]}`, `Tautan sekali pakai terkirim ke ${esc(r.from)}, berlaku sampai 6 Okt ${esc(s.t[3])}. Pelepasan tercatat di log akses pasien.`)}
        ${ui.next('dasbor', `${r.no} diverifikasi, disetujui, dan dirilis bertanda air.`)}`;
    }
    const detail = ui.card({
      title: r.no, sub: `${r.kind} · ${r.due}`,
      body: `<div class="stack">${ui.steps(ROI_STEPS, s.stage >= 4 ? 5 : s.stage)}
        ${kv([['Pemohon', esc(r.from)], ['Pasien', esc(r.who)], ['Dasar', esc(r.basis)], ['Lingkup', esc(r.scope.join(', '))]])}<hr class="sep">${act}</div>`,
    });
    return `<div class="split"><div class="card"><div class="ch"><h3>Permintaan informasi</h3><span class="sub">UU PDP · data minimal</span></div><div class="cb flush">${list}</div></div>${detail}</div>`;
  }
  function rmAkses(L, J) {
    const { rows, sample } = accessRows(L, J, L.pt);
    const p = PEOPLE[L.pt] || PEOPLE.suryo;
    const t = ui.table(['Jam', 'Nama', 'Peran', 'Unit', 'Aksi', 'Tinjauan'], rows.map((r) => [
      `<span class="mono">${esc(r[0])}</span>`, esc(r[1]), esc(r[2]), esc(r[3]), esc(r[4]),
      r[5] ? (L.rev[r[5]] ? stamp('Akses sah: konsul gizi diminta DPJP', L.rev[r[5]]) : `${ui.chip('Tanpa penugasan aktif', 'danger')} ${ui.btn('Tinjau', { act: 'review', arg: r[5], size: 'sm' })}`) : ui.chip('Sesuai penugasan', 'success'),
    ]));
    return ui.card({
      title: `Log akses rekam medis · ${p.name}`, sub: `RM ${p.rm} · setiap pembacaan, perubahan, dan ekspor tercatat`,
      actions: ui.seg('pt', L.pt, [{ value: 'suryo', label: 'Suryo' }, { value: 'hartono', label: 'Hartono' }, { value: 'ratna', label: 'Ratna' }]),
      body: `<div class="stack">${sample ? `<div class="row">${SAMPLE()}<span class="small muted">Belum ada jejak dari tur untuk pasien ini.</span></div>` : ''}${t}
        <div class="small muted">Versi untuk pasien di aplikasi menampilkan peran dan unit tanpa nama staf.</div></div>`,
    });
  }
  function rmRetensi(L) {
    const k = L.ret;
    const btn = k < 4 ? ui.btn(RET_BTN[k], { act: 'retNext', variant: 'primary' }) : stamp('Pemusnahan berkas fisik selesai', L.retT[4] || '');
    return `<div class="grid g2" style="align-items:start">${ui.card({
      title: 'Retensi & pemusnahan', sub: 'Berkas fisik rawat jalan inaktif > 5 tahun',
      body: `<div class="stack">${ui.steps(RET_STEPS, k >= 4 ? 5 : k + 1)}
        ${ui.table(['Kandidat', { label: 'Berkas', r: true }, 'Status'], [['Rak R-12 · rawat jalan 2014–2015', '1.240', ui.chip(k >= 4 ? 'Dimusnahkan' : 'Kandidat', k >= 4 ? 'success' : 'warning')], ['Rak R-13 · rawat jalan 2016', '980', ui.chip(k >= 4 ? 'Dimusnahkan' : 'Kandidat', k >= 4 ? 'success' : 'warning')]])}
        ${ui.alert('info', 'Dikecualikan otomatis', 'Resume, persetujuan tindakan, identitas, dan laporan operasi disimpan permanen (312 lembar dipisahkan). 3 berkas berstatus legal hold perkara PN.')}
        <div class="row">${btn}</div>
        ${ui.btn('Musnahkan data elektronik', { disabled: true, reason: 'Masa simpan rekam medis elektronik 25 tahun; pemusnahan elektronik belum diizinkan kebijakan RS.' })}</div>`,
    })}${ui.card({
      title: 'Jejak persetujuan', sub: 'Urutan tidak bisa dilompati',
      body: `${ui.timeline(RET_STEPS.map((s, i) => ({ t: i === 0 ? '01.30' : L.retT[i] || '', text: s, tone: i <= k ? 'success' : '' })))}
        ${k >= 3 ? ui.alert('success', 'Berita acara BA-RM/2026/10/003', `Metode: pencacahan oleh vendor bersertifikat · saksi komite RM dan SPI · ditandatangani elektronik ${esc(STAFF.direktur.name)}. Metadata pemusnahan disimpan permanen.`) : ''}`,
    })}</div>`;
  }

  SIM.register({
    id: 'rekam-medis', phase: 8, title: 'Rekam medis', nav: 'Rekam medis', codes: 'B09', role: 'rm',
    desc: 'Kelengkapan berkas per kunjungan, pelepasan informasi berdasar hukum dengan tanda air, log akses pasien, serta retensi dan pemusnahan berberita acara.',
    hint: 'Verifikasi permintaan asuransi, setujui, lalu kirim berkas bertanda air; cek log akses dan kelengkapan berkas.',
    init: { tab: 'roi', vis: '', roiSel: 'roi1', roi: {}, pt: 'ratna', rev: {}, ret: 0, retT: {}, remind: {}, tolak: '', extra: [] },
    render(L, J) {
      const pend = ROI.filter((r) => { const s = L.roi[r.id]; return !s || (s.stage < 4 && !s.rej); }).length;
      const tabs = ui.tabs('tab', L.tab, [{ value: 'roi', label: `Pelepasan informasi (${pend})` }, { value: 'kel', label: 'Kelengkapan berkas' }, { value: 'akses', label: 'Log akses' }, { value: 'ret', label: 'Retensi & pemusnahan' }]);
      const body = L.tab === 'kel' ? rmKelengkapan(L, J) : L.tab === 'akses' ? rmAkses(L, J) : L.tab === 'ret' ? rmRetensi(L) : rmROI(L);
      return tabs + body;
    },
    actions: {
      pickVis(L, J, el) { L.vis = argOf(el); },
      remind(L, J, el) {
        const v = rmVisits(J).find((x) => x.id === argOf(el));
        if (!v) return false;
        L.remind[v.id] = SIM.now(1);
        SIM.note(`Pengingat kelengkapan berkas ${v.no} dikirim ke ${v.dpjp}`);
        return undefined;
      },
      pickRoi(L, J, el) { if (ROI.some((r) => r.id === argOf(el))) L.roiSel = argOf(el); },
      roiVerify(L, J, el) {
        const r = ROI.find((x) => x.id === argOf(el)) || ROI[0];
        const s = roiState(L, r.id);
        if (s.stage !== 0 || s.rej || !(L[`v1_${r.id}`] && L[`v2_${r.id}`] && L[`v3_${r.id}`])) { SIM.toast('Lengkapi tiga pemeriksaan verifikasi', 'warning'); return false; }
        s.stage = 1; s.t[1] = SIM.now(4);
        return undefined;
      },
      roiApprove(L, J, el) {
        const r = ROI.find((x) => x.id === argOf(el)) || ROI[0];
        const s = roiState(L, r.id);
        if (s.stage !== 1) { SIM.toast('Verifikasi dulu sebelum disetujui', 'warning'); return false; }
        s.stage = 2; s.t[2] = SIM.now(6);
        SIM.note(`${r.no} disetujui Kepala Instalasi RM (berbeda dari penerima permintaan)`);
        return undefined;
      },
      roiRelease(L, J, el) {
        const r = ROI.find((x) => x.id === argOf(el)) || ROI[0];
        const s = roiState(L, r.id);
        if (s.stage !== 2) { SIM.toast('Permintaan belum disetujui', 'warning'); return false; }
        const t = SIM.now(3);
        s.stage = 4; s.t[3] = t; s.t[4] = t;
        if (r.pkey) L.extra.push({ pkey: r.pkey, t, who: STAFF.rm.name, role: 'Rekam medis', unit: 'Instalasi RM', act: `Rilis ${r.no} ke ${r.from} (bertanda air)` });
        SIM.note(`${r.no}: berkas bertanda air dirilis ke ${r.from} · tercatat di log akses`, 'success');
        SIM.done();
        return undefined;
      },
      roiReject(L, J, el) {
        const r = ROI.find((x) => x.id === argOf(el)) || ROI[0];
        const s = roiState(L, r.id);
        const why = String(L.tolak || '').trim();
        if (s.stage !== 0 || why.length < 10) { SIM.toast('Tulis alasan penolakan minimal 10 huruf', 'warning'); return false; }
        s.rej = why; s.t.rej = SIM.now(2); L.tolak = '';
        SIM.note(`${r.no} ditolak: ${why}`, 'warning');
        return undefined;
      },
      review(L, J, el) { const k = argOf(el) || 'h3'; L.rev[k] = SIM.now(2); SIM.note('Akses tanpa penugasan ditinjau petugas privasi: sah (konsul gizi)'); },
      retNext(L) {
        if (L.ret >= 4) return false;
        L.ret += 1; L.retT[L.ret] = SIM.now(L.ret === 4 ? 30 : 5);
        if (L.ret === 4) SIM.note('Pemusnahan 2.220 berkas fisik rawat jalan tercatat dengan berita acara BA-RM/2026/10/003', 'success');
        return undefined;
      },
    },
  });

  /* =====================================================================
   * F9 · DASBOR EKSEKUTIF (I09)
   * ===================================================================== */
  const DB_UNITS = [{ value: 'semua', label: 'Semua unit' }, { value: 'rj', label: 'Rawat jalan' }, { value: 'igd', label: 'IGD' }, { value: 'ri', label: 'Rawat inap' }];
  const DB_DAYS = ['Sel 29/9', 'Rab 30/9', 'Kam 1/10', 'Jum 2/10', 'Sab 3/10', 'Min 4/10', 'Sen 5/10'];
  const DB_SERIES = {
    kunjungan: { label: 'Kunjungan', unit: 'pasien', data: { semua: [900, 876, 845, 865, 491, 262, 864], rj: [842, 815, 790, 802, 420, 188, 800], igd: [58, 61, 55, 63, 71, 74, 64] } },
    bor: { label: 'BOR', unit: '%', th: 85, data: { semua: [81, 83, 84, 82, 85, 88, 87], ri: [81, 83, 84, 82, 85, 88, 87] } },
    pendapatan: { label: 'Pendapatan', unit: 'Rp juta', data: { semua: [468, 452, 439, 447, 301, 212, 413], rj: [196, 188, 181, 186, 92, 41, 168], igd: [38, 41, 36, 42, 47, 49, 42], ri: [234, 223, 222, 219, 162, 122, 203] } },
  };
  const DB_KPI = [
    { k: 'Kunjungan rawat jalan', v: { semua: '800', rj: '800' }, f: 'data s.d. jam ini · ▲ 3% vs Senin lalu', tr: 'up' },
    { k: 'Kunjungan IGD', v: { semua: '64', igd: '64' }, f: '9 pasien triase 1–2 · ▼ 10% vs kemarin' },
    { k: 'BOR', v: { semua: '87%', ri: '87%' }, f: 'ambang 85% · 226/260 tempat tidur', tr: 'down' },
    { k: 'ALOS', v: { semua: '4,8 hari', ri: '4,8 hari' }, f: 'target ≤ 4,3 hari', tr: 'down' },
    { k: 'Antrean aktif', v: { semua: '58', rj: '49', igd: '9' }, f: { semua: 'RJ 49 · IGD 9', rj: 'tunggu rata-rata 47 mnt · target ≤ 60', igd: 'tunggu dokter rata-rata 6 mnt' } },
    { k: 'Pendapatan hari ini', v: { semua: 'Rp413 jt', rj: 'Rp168 jt', igd: 'Rp42 jt', ri: 'Rp203 jt' }, f: '104% dari anggaran berjalan', tr: 'up' },
    { k: 'Piutang BPJS', v: { semua: 'Rp18,4 M', rj: 'Rp5,2 M', igd: 'Rp1,1 M', ri: 'Rp12,1 M' }, f: 'Rp184 jt berumur > 30 hari', tr: 'down' },
    { k: 'Klaim pending', v: { semua: '126 berkas', rj: '31 berkas', igd: '7 berkas', ri: '88 berkas' }, f: 'Rp2,3 M · 19 menunggu resume final' },
  ];
  const DB_WARDS = [['ICU', 11, 12], ['Melati · Kelas 1', 46, 50], ['Anggrek · Kelas 2', 62, 70], ['Mawar · Kelas 3', 78, 92], ['HCU', 26, 30], ['Isolasi', 3, 6]];
  const DB_ALERTS = [
    { id: 'bor', units: ['semua', 'ri'], tone: 'danger', t: 'BOR rawat inap 87% melewati ambang 85%', d: 'ICU dan Melati 92%; 3 pasien IGD menunggu kamar.', rule: 'BOR > 85%', go: 'bed', goL: 'Buka manajemen tempat tidur' },
    { id: 'klaim', units: ['semua', 'ri', 'rj'], tone: 'warning', t: 'Klaim pending Rp184 jt berumur > 30 hari', d: 'Mayoritas kasus ICU sepsis; resume belum final.', rule: 'Pending > 30 hari di atas Rp100 jt', go: 'klaim', goL: 'Lihat klaim pending' },
    { id: 'alos', units: ['semua', 'ri'], tone: 'warning', t: 'ALOS pneumonia 6,2 hari vs clinical pathway 5', d: 'Rapat komite medik dijadwalkan 8 Okt.', rule: 'ALOS diagnosis > pathway + 1 hari' },
    { id: 'stok', units: ['semua'], tone: 'warning', t: 'Stok enoksaparin cukup < 7 hari', d: 'PO darurat menunggu persetujuan direktur.', rule: 'Stok VEN-V < 7 hari', go: 'logistik', goL: 'Tinjau stok dan PO' },
  ];
  const hm = (m) => { const x = ((Math.round(m) % 1440) + 1440) % 1440; return `${String(Math.floor(x / 60)).padStart(2, '0')}.${String(x % 60).padStart(2, '0')}`; };

  /** Grafik garis SVG: skala sumbu-y "bulat", warna dari token lewat style. */
  function lineChart(vals, labels, o = {}) {
    const W = 640; const H = 230; const pl = 48; const pr = 18; const pt = 16; const pb = 30;
    const pool = o.th != null ? vals.concat([o.th]) : vals.slice();
    const vmin = Math.min(...pool); const vmax = Math.max(...pool);
    const span = vmax - vmin || Math.abs(vmax) || 1;
    let lo = vmin - span * 0.15; let hi = vmax + span * 0.15;
    if (vmin >= 0 && lo < 0) lo = 0;
    const raw = (hi - lo) / 4;
    const mag = 10 ** Math.floor(Math.log10(raw));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) || raw;
    lo = Math.floor(lo / step) * step; hi = Math.ceil(hi / step) * step;
    const n = Math.round((hi - lo) / step);
    const x = (i) => pl + (i * (W - pl - pr)) / (vals.length - 1);
    const y = (v) => pt + (H - pt - pb) * (1 - (v - lo) / (hi - lo));
    let grid = '';
    for (let k = 0; k <= n; k += 1) {
      const v = lo + k * step; const yy = y(v).toFixed(1);
      grid += `<line x1="${pl}" x2="${W - pr}" y1="${yy}" y2="${yy}" style="stroke:var(--line-soft);stroke-width:1"/><text x="${pl - 8}" y="${(y(v) + 4).toFixed(1)}" text-anchor="end" style="fill:var(--ink-500);font-size:11px;font-family:var(--font-mono)">${esc(fmt1(v))}</text>`;
    }
    const xl = labels.map((l, i) => `<text x="${x(i).toFixed(1)}" y="${H - 8}" text-anchor="middle" style="fill:var(--ink-500);font-size:11px">${esc(l)}</text>`).join('');
    const pts = vals.map((v, i) => `${x(i).toFixed(1)} ${y(v).toFixed(1)}`);
    const line = `M${pts.join(' L')}`;
    const area = `${line} L${x(vals.length - 1).toFixed(1)} ${y(lo).toFixed(1)} L${x(0).toFixed(1)} ${y(lo).toFixed(1)} Z`;
    const th = o.th != null ? `<line x1="${pl}" x2="${W - pr}" y1="${y(o.th).toFixed(1)}" y2="${y(o.th).toFixed(1)}" style="stroke:var(--danger);stroke-width:1.5;stroke-dasharray:5 4"/><text x="${W - pr}" y="${(y(o.th) - 6).toFixed(1)}" text-anchor="end" style="fill:var(--danger);font-size:11px;font-weight:600">ambang ${esc(fmt1(o.th))}${esc(o.suffix || '')}</text>` : '';
    const dots = vals.map((v, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="${i === vals.length - 1 ? 5 : 3.5}" style="fill:${o.th != null && v > o.th ? 'var(--danger)' : 'var(--brand-600)'};stroke:var(--card);stroke-width:2"><title>${esc(labels[i])}: ${esc(fmt1(v))}</title></circle>`).join('');
    const last = vals.length - 1;
    const lastLbl = `<text x="${(x(last) - 8).toFixed(1)}" y="${(y(vals[last]) - 10).toFixed(1)}" text-anchor="end" style="fill:var(--ink-900);font-size:12px;font-weight:600;font-family:var(--font-mono)">${esc(fmt1(vals[last]))}</text>`;
    return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(o.aria || '')}" style="display:block;width:100%;height:auto">${grid}<path d="${area}" style="fill:var(--brand-50)"/>${th}<path d="${line}" style="fill:none;stroke:var(--brand-600);stroke-width:2.5;stroke-linejoin:round"/>${dots}${lastLbl}${xl}</svg>`;
  }

  SIM.register({
    id: 'dasbor', phase: 9, title: 'Dasbor eksekutif', nav: 'Dasbor eksekutif', codes: 'I09', role: 'direktur',
    desc: 'KPI hari ini dari data operasional, tren 7 hari, dan alert ambang yang perlu keputusan direksi. Bisa disaring per unit.',
    hint: 'Buka detail alert BOR > 85%, putuskan tindak lanjutnya, lalu tandai ditindaklanjuti. Coba juga saring per unit.',
    init: { unit: 'semua', metric: 'kunjungan', open: 'bor', ack: {}, dec: {}, upd: '' },
    render(L, J) {
      const u = L.unit;
      const kpis = DB_KPI.filter((k) => k.v[u]).map((k) => {
        let foot = typeof k.f === 'object' ? (k.f[u] || '') : k.f;
        if (k.k === 'Klaim pending' && J.claim) foot += ` · klaim ${J.claim.cbg} ${J.claim.status === 'paid' ? 'terbayar' : 'diproses'}`;
        if (k.k === 'Pendapatan hari ini' && J.payment && J.payment.status === 'paid') foot += ` · termasuk ${ui.rupiah(J.payment.amount || 0)} ${J.payment.method}`;
        return ui.kpi(k.k, k.v[u], foot, k.tr || '');
      }).join('');
      const metrics = Object.keys(DB_SERIES).filter((m) => DB_SERIES[m].data[u]);
      const m = metrics.includes(L.metric) ? L.metric : metrics[0];
      const s = DB_SERIES[m];
      const vals = s.data[u];
      const avg = vals.slice(0, 6).reduce((a, b) => a + b, 0) / 6;
      const chart = ui.card({
        title: `Tren 7 hari · ${s.label}`, sub: `${DB_UNITS.find((x) => x.value === u).label} · ${s.unit} · Sen 5/10 data s.d. jam ini`,
        actions: ui.seg('metric', m, metrics.map((k) => ({ value: k, label: DB_SERIES[k].label }))),
        body: `${lineChart(vals, DB_DAYS, { th: s.th, suffix: s.unit === '%' ? '%' : '', aria: `${s.label} 7 hari: ${vals.join(', ')}` })}
          <div class="row small muted" style="margin-top:6px"><span>Rata-rata 6 hari sebelumnya <b class="num">${esc(fmt1(avg))}</b></span><span>· hari ini <b class="num">${esc(fmt1(vals[6]))}</b></span>${s.th ? `<span>· ${vals.filter((v) => v > s.th).length} hari di atas ambang</span>` : ''}</div>`,
      });
      const logDone = SIM.isDone('logistik');
      const alerts = DB_ALERTS.filter((a) => a.units.includes(u));
      const openN = alerts.filter((a) => !L.ack[a.id] && !(a.id === 'stok' && logDone)).length;
      const alertList = alerts.map((a) => {
        const solved = a.id === 'stok' && logDone;
        const ack = L.ack[a.id];
        const col = ack || solved ? 'var(--success)' : a.tone === 'danger' ? 'var(--danger)' : 'var(--warning)';
        return `<div style="border-left:3px solid ${col};padding:8px 12px;background:${L.open === a.id ? 'var(--selected)' : 'transparent'};border-radius:0 8px 8px 0">
          <div class="row between"><b style="font-size:13.5px">${esc(a.t)}</b>${ui.chip(a.rule, '')}</div>
          <div class="small muted">${esc(solved ? 'Penerimaan barang sudah tercatat di Logistik; stok kembali di atas ROP.' : a.d)}</div>
          <div class="row" style="margin-top:6px">${ack ? stamp(`Ditindaklanjuti${L.dec[a.id] ? ` · ${L.dec[a.id]}` : ''}`, ack) : solved ? ui.chip('Teratasi otomatis', 'success') : `${ui.btn('Detail', { set: `open=${a.id}`, size: 'sm' })}${ui.btn('Tandai ditindaklanjuti', { act: 'ack', arg: a.id, size: 'sm', variant: 'primary' })}`}${a.go ? ui.btn(a.goL, { go: a.go, size: 'sm', variant: 'ghost' }) : ''}</div></div>`;
      }).join('') || ui.empty('Tidak ada alert untuk unit ini.');
      const openA = alerts.find((a) => a.id === L.open);
      let detail = '';
      if (openA && openA.id === 'bor') {
        detail = ui.card({
          title: 'Detail · keterisian tempat tidur per ruang', sub: 'Sumber: okupansi real-time ADT', tone: L.ack.bor ? 'success' : 'danger',
          body: `<div class="stack">${DB_WARDS.map(([n, a, b]) => { const p = Math.round((a / b) * 100); return `<div style="display:grid;grid-template-columns:minmax(0,150px) minmax(0,1fr) 92px;gap:10px;align-items:center"><span class="small">${esc(n)}</span>${bar(p, p > 85 ? 'danger' : 'brand', 85)}<span class="num small" style="text-align:right">${a}/${b} · ${p}%</span></div>`; }).join('')}
            <div class="label">Pilihan tindak lanjut</div>
            <div class="row">${[['hcu', 'Aktifkan HCU step-down 4 TT'], ['pulang', 'Percepat 6 pasien rencana pulang sebelum 11.00'], ['rujuk', 'Koordinasi rujukan SISRUTE']].map(([k, l]) => ui.btn(l, { act: 'decide', arg: k, size: 'sm', variant: L.dec.bor === l ? 'primary' : '' })).join('')}</div>
            ${L.ack.bor ? '' : `<div>${ui.btn('Tandai ditindaklanjuti', { act: 'ack', arg: 'bor', variant: 'primary', disabled: !L.dec.bor, reason: 'Pilih satu tindak lanjut dulu' })}</div>`}</div>`,
        });
      } else if (openA) {
        detail = ui.card({ title: `Detail · ${openA.t}`, body: `${kv([['Ambang', esc(openA.rule)], ['Keterangan', esc(openA.d)], ['Status', L.ack[openA.id] ? `Ditindaklanjuti ${esc(L.ack[openA.id])}` : 'Terbuka']])}${openA.go ? `<div style="margin-top:10px">${ui.btn(openA.goL, { go: openA.go })}</div>` : ''}` });
      }
      const doneAny = Object.keys(L.ack).length > 0;
      return `<div class="row between"><div class="row">${ui.field('Saring unit', ui.select('unit', u, DB_UNITS), '', 'f-unit')}</div><div class="row"><span class="small muted">Data operasional · diperbarui ${esc(L.upd || '07.30')}</span>${ui.btn('Perbarui', { act: 'refresh', size: 'sm' })}</div></div>
        <div class="grid g4">${kpis}</div>
        <div class="grid g2" style="align-items:start">${chart}${ui.card({ title: 'Perlu keputusan direksi', sub: openN ? `${openN} terbuka` : 'semua ditindaklanjuti', html: true, body: `<div class="stack">${alertList}</div>` })}</div>
        ${detail}
        ${doneAny ? ui.next('app-dokter', 'Alert ditindaklanjuti dan tercatat di log direksi.') : ''}`;
    },
    actions: {
      refresh(L) { L.upd = SIM.now(1); SIM.toast(`Dasbor diperbarui · ${L.upd}`, 'success'); },
      decide(L, J, el) {
        const map = { hcu: 'Aktifkan HCU step-down 4 TT', pulang: 'Percepat 6 pasien rencana pulang sebelum 11.00', rujuk: 'Koordinasi rujukan SISRUTE' };
        const l = map[argOf(el)];
        if (!l) return false;
        L.dec.bor = l; L.open = 'bor';
        return undefined;
      },
      ack(L, J, el) {
        const a = DB_ALERTS.find((x) => x.id === argOf(el));
        if (!a) { SIM.toast('Pilih alert dulu', 'warning'); return false; }
        if (a.id === 'bor' && !L.dec.bor) { L.open = 'bor'; SIM.toast('Pilih tindak lanjut BOR dulu', 'warning'); return undefined; }
        L.ack[a.id] = SIM.now(2);
        SIM.note(`Direktur menindaklanjuti alert: ${a.t}${L.dec[a.id] ? ` → ${L.dec[a.id]}` : ''}`);
        SIM.done();
        return undefined;
      },
    },
  });

  /* =====================================================================
   * F9 · APLIKASI PASIEN (I07)
   * ===================================================================== */
  const AP_POLI = [
    { id: 'pd', name: 'Poli Penyakit Dalam', sub: 'Rujukan FKTP aktif s.d. 2 Jan 2027' },
    { id: 'jt', name: 'Poli Jantung', sub: 'Butuh rujukan BPJS', off: 'Rujukan aktif Anda hanya untuk Poli Penyakit Dalam' },
    { id: 'mt', name: 'Poli Mata', sub: 'Butuh rujukan BPJS', off: 'Rujukan aktif Anda hanya untuk Poli Penyakit Dalam' },
    { id: 'gz', name: 'Klinik Gizi', sub: 'Layanan umum', off: 'Belum dibuka untuk booking lewat aplikasi' },
  ];
  const AP_DOK = [
    { id: 'andi', name: 'dr. Andi Wiratama, Sp.PD', sub: 'Senin–Jumat · 08.00–12.00' },
    { id: 'sari', name: 'dr. Sari Dewanti, Sp.PD', sub: 'Selasa & Kamis · 13.00–16.00', off: 'Tidak praktik hari ini' },
  ];
  const AP_SLOT = [
    { id: 'pagi', label: 'Hari ini, Senin 5 Okt · 08.00–12.00', left: 9, quota: 30 },
    { id: 'siang', label: 'Hari ini, Senin 5 Okt · 13.00–16.00', left: 0, quota: 20, off: 'Kuota JKN sesi ini habis' },
    { id: 'sel', label: 'Selasa 6 Okt · 08.00–12.00', left: 0, quota: 30, off: 'Dokter terjadwal operasi, poli ditutup' },
    { id: 'rab', label: 'Rabu 7 Okt · 08.00–12.00', left: 0, quota: 30, off: 'Kuota JKN habis' },
  ];
  const AP_BOOKING = { code: '2610050042', date: 'Senin, 5 Okt 2026', poli: 'Poli Penyakit Dalam', dokter: 'dr. Andi Wiratama, Sp.PD', sesi: '08.00–12.00', no: 'PD-007', patient: 'suryo' };
  const AP_OTP = '246810';
  const AP_LAB_SAMPLE = { items: [{ name: 'Glukosa darah puasa', value: '186', unit: 'mg/dL', ref: '70–100', flag: 'H' }, { name: 'HbA1c', value: '8,9', unit: '%', ref: '< 6,5', flag: 'H' }, { name: 'Kreatinin', value: '1,0', unit: 'mg/dL', ref: '0,7–1,3', flag: '' }, { name: 'Kolesterol LDL', value: '142', unit: 'mg/dL', ref: '< 100', flag: 'H' }], validatedAt: '09.42', critical: false };
  const AP_INV = { no: 'INV-2609-3318', name: 'Vaksin influenza (layanan non-JKN)', date: '28 Sep 2026', amount: 245000 };
  const AP_FAM = [
    { id: 'wulan', name: 'Ny. Wulan Nugroho', rel: 'Istri · 51 th', akses: 'Melihat jadwal dan antrean Anda', since: 'sejak 12 Mar 2025' },
    { id: 'dimas', name: 'Dimas A. Nugroho', rel: 'Anak · 16 th', akses: 'Anda wali: booking dan hasil anak · berakhir otomatis saat 18 th', since: 'sejak 3 Jan 2024' },
  ];
  const flagText = (f) => (/^H/i.test(String(f)) ? 'Tinggi' : /^L/i.test(String(f)) ? 'Rendah' : String(f || ''));

  function apNotifs(L, J) {
    const n = L.qNotes.slice();
    if (J.called) n.push({ t: J.called.t || '', title: 'Giliran Anda dipanggil', d: `${J.called.ticket} · ${J.called.room}` });
    if (J.labResult) n.push({ t: J.labResult.validatedAt || '', title: 'Hasil laboratorium tersedia', d: 'Sudah divalidasi analis' });
    if (J.checkin) n.push({ t: J.checkin.t || '', title: 'Check-in berhasil', d: `Tiket ${J.checkin.ticket}` });
    if (J.booking) n.push({ t: L.bookedAt || '', title: 'Booking terkonfirmasi', d: `${J.booking.poli} · ${J.booking.no}` });
    if (L.paid) n.push({ t: L.paid.t, title: 'Pembayaran diterima', d: `${AP_INV.no} · ${L.paid.method}` });
    n.push({ t: '4 Okt', title: 'Pengingat obat', d: 'Metformin 500 mg sesudah makan siang' });
    return n;
  }
  const apLine = (t, d, right = '') => `<div class="row between" style="flex-wrap:nowrap;align-items:flex-start;padding:8px 0;border-bottom:1px solid var(--line-soft)"><div style="min-width:0"><div style="font-weight:600;font-size:13.5px">${esc(t)}</div>${d ? `<div class="small muted">${esc(d)}</div>` : ''}</div><div style="text-align:right;flex:none">${right}</div></div>`;

  function apLogin(L) {
    const head = `<b>Aplikasi pasien</b><div class="small muted">${esc(PEOPLE.rs.name)}</div>`;
    let body;
    if (L.locked) body = ui.alert('danger', 'Masuk dikunci 15 menit', 'Lima kali kode salah. Coba lagi nanti atau hubungi loket pendaftaran.');
    else if (!L.otpSent) {
      body = `<div style="font-size:20px;font-weight:600">Masuk</div><div class="small muted">Gunakan nomor HP yang tercatat di rekam medis rumah sakit.</div>
        ${ui.field('Nomor HP', ui.input('phone', L.phone, { mono: true, inputmode: 'tel' }), 'Ganti nomor hanya bisa di loket pendaftaran')}
        ${wide(ui.btn('Kirim kode OTP lewat WhatsApp', { act: 'sendOtp', variant: 'primary', size: 'lg' }))}
        <div class="small muted">Akun pasien terpisah dari akun petugas. Belum punya akun? Aktivasi di loket dengan KTP.</div>`;
    } else {
      body = `${pcard('', `<div class="small muted">WhatsApp · ${esc(L.otpAt)}</div><div style="font-size:13.5px">Kode masuk ${esc(PEOPLE.rs.code)}: <b class="mono">${AP_OTP}</b>. Berlaku 5 menit. Jangan berikan kode ini ke siapa pun, termasuk petugas RS.</div>`)}
        <div style="font-size:20px;font-weight:600">Masukkan kode</div><div class="small muted">Dikirim ke ${esc(L.phone)}</div>
        ${ui.field('Kode OTP 6 angka', ui.input('otp', L.otp, { mono: true, inputmode: 'numeric', placeholder: '••••••' }), `Sisa percobaan ${L.tries}`)}
        ${L.err ? ui.alert('danger', L.err) : ''}
        ${wide(`${ui.btn('Masuk', { act: 'verifyOtp', variant: 'primary', size: 'lg', needs: 'otp:6' })}${ui.btn('Isi otomatis dari WhatsApp', { act: 'autofill' })}`)}`;
    }
    return phone(head, body);
  }
  function apHome(L, J) {
    const b = J.booking;
    const next = b ? pcard('Kunjungan berikutnya', `${kv([['Poli', esc(b.poli)], ['Dokter', esc(b.dokter)], ['Jadwal', `${esc(b.date)} · ${esc(b.sesi)}`], ['Nomor antrean', `<span class="mono">${esc(b.no)}</span>`]])}${wide(ui.btn('Lihat antrean berjalan', { set: 'tab=antrean' }))}`)
      : pcard('Belum ada booking', `<div class="small muted">Kontrol DM Anda jatuh tempo bulan ini. Rujukan Poli Penyakit Dalam masih aktif.</div>${wide(ui.btn('Booking sekarang', { set: 'tab=booking', variant: 'primary' }))}`);
    return `<div><div class="small muted">Selamat pagi,</div><div style="font-size:19px;font-weight:600">${esc(PEOPLE.suryo.name)}</div><div class="small muted mono">RM ${esc(PEOPLE.suryo.rm)} · BPJS ${esc(PEOPLE.suryo.kelas)}</div></div>
      ${next}
      <div class="grid" style="grid-template-columns:repeat(2,minmax(0,1fr));gap:8px">${tile('Booking', 'Poli, dokter, jadwal', 'tab=booking')}${tile('Antrean', b ? b.no : 'belum ada', 'tab=antrean')}${tile('Hasil lab', J.labResult ? 'hasil baru' : 'riwayat', 'tab=hasil')}${tile('Tagihan', L.paid ? 'lunas' : '1 belum dibayar', 'tab=tagihan')}${tile('Keluarga', `${AP_FAM.filter((f) => !L.fam[f.id]).length} terhubung`, 'tab=keluarga')}${tile('Notifikasi', `${apNotifs(L, J).length} pesan`, 'tab=notif')}</div>`;
  }
  function apBooking(L, J) {
    if (J.booking && (L.bk === 4 || !L.poli)) {
      const b = J.booking;
      return `${pcard('Booking terkonfirmasi', `<div style="text-align:center;padding:6px 0"><div class="small muted">Kode booking</div><div class="mono" style="font-size:26px;font-weight:600;letter-spacing:.06em">${esc(b.code)}</div>
          <div style="margin:10px auto;width:150px;height:150px;border-radius:10px;border:6px solid var(--ink-900);background:repeating-linear-gradient(90deg,var(--ink-900) 0 6px,var(--card) 6px 12px),var(--card);background-blend-mode:multiply" aria-label="Kode QR booking"></div>
          <div class="small muted">Nomor antrean</div><div class="mono" style="font-size:30px;font-weight:700;color:var(--brand-700)">${esc(b.no)}</div></div>
        ${kv([['Poli', esc(b.poli)], ['Dokter', esc(b.dokter)], ['Tanggal', esc(b.date)], ['Sesi', esc(b.sesi)], ['Penjamin', 'BPJS · rujukan aktif']])}`, 'success')}
        <div class="small muted">Datang paling lambat 30 menit sebelum sesi berakhir, lalu pindai kode ini di anjungan mandiri.</div>
        ${wide(ui.btn('Lihat antrean berjalan', { set: 'tab=antrean', variant: 'primary' }))}`;
    }
    const steps = ui.steps(['Poli', 'Dokter', 'Jadwal', 'Konfirmasi'], L.bk);
    let inner = '';
    if (L.bk === 0) inner = `<b>Pilih poli</b><div class="card" style="overflow:hidden">${AP_POLI.map((p) => opt(p.name, p.sub, { act: 'pickPoli', arg: p.id, sel: L.poli === p.id, disabled: !!p.off, reason: p.off })).join('')}</div>`;
    else if (L.bk === 1) inner = `<b>Pilih dokter</b><div class="card" style="overflow:hidden">${AP_DOK.map((d) => opt(d.name, d.sub, { act: 'pickDok', arg: d.id, sel: L.dokter === d.id, disabled: !!d.off, reason: d.off })).join('')}</div>`;
    else if (L.bk === 2) inner = `<b>Pilih tanggal & sesi</b><div class="card" style="overflow:hidden">${AP_SLOT.map((s) => opt(s.label, s.left ? `Sisa kuota JKN ${s.left} dari ${s.quota}` : 'Sisa kuota 0', { act: 'pickSlot', arg: s.id, sel: L.slot === s.id, disabled: !!s.off, reason: s.off, right: s.left ? ui.chip(`sisa ${s.left}`, 'success') : ui.chip('penuh', 'danger') })).join('')}</div>`;
    else {
      inner = `<b>Periksa lagi</b>${pcard('', kv([['Pasien', esc(PEOPLE.suryo.name)], ['Penjamin', `BPJS ${esc(PEOPLE.suryo.kelas)}`], ['Poli', esc(AP_BOOKING.poli)], ['Dokter', esc(AP_BOOKING.dokter)], ['Tanggal', esc(AP_BOOKING.date)], ['Sesi', esc(AP_BOOKING.sesi)], ['Perkiraan nomor', `<span class="mono">${esc(AP_BOOKING.no)}</span>`]]))}
        <div class="small muted">Booking terhubung ke antrean online BPJS. Pembatalan paling lambat H-1 pukul 20.00.</div>
        ${wide(ui.btn('Konfirmasi booking', { act: 'confirmBooking', variant: 'primary', size: 'lg' }))}`;
    }
    return `${steps}${inner}${L.bk > 0 ? `<div>${ui.btn('← Kembali', { act: 'bkBack', variant: 'ghost', size: 'sm' })}</div>` : ''}`;
  }
  function apAntrean(L, J) {
    const b = J.booking;
    if (!b) return `${ui.empty('Belum ada booking aktif.')}${wide(ui.btn('Booking sekarang', { set: 'tab=booking', variant: 'primary' }))}`;
    const ahead = J.called ? 0 : L.ahead;
    const serving = `PD-${String(7 - ahead).padStart(3, '0')}`;
    let status;
    if (J.called) status = pcard('Giliran Anda', `<div class="small">Silakan masuk ke <b>${esc(J.called.room)}</b> · dipanggil ${esc(J.called.t || '')}</div>`, 'danger');
    else if (ahead === 0) status = pcard('Giliran Anda', '<div class="small">Silakan masuk ke ruang Poli Penyakit Dalam.</div>', 'danger');
    else if (J.checkin) status = pcard('', `<div class="small">${stamp(`Sudah check-in · tiket ${J.checkin.ticket}`, J.checkin.t || '')}</div>`, 'success');
    else status = pcard('', `<div class="small">Belum check-in. Pindai kode booking <b class="mono">${esc(b.code)}</b> di anjungan mandiri saat tiba.</div>`);
    return `<div style="text-align:center"><div class="small muted">Nomor antrean Anda · ${esc(b.poli)}</div><div class="mono" style="font-size:44px;font-weight:700;color:var(--brand-700)">${esc(b.no)}</div></div>
      ${status}
      ${kv([['Sedang dilayani', `<span class="mono">${esc(serving)}</span>`], ['Di depan Anda', `${ahead} pasien`], ['Perkiraan dipanggil', ahead ? `pukul ${hm(SIM.clock + ahead * 7)}` : 'sekarang']])}
      ${bar(((7 - ahead) / 7) * 100, ahead <= 3 ? 'warning' : 'brand')}
      <div class="small muted">Posisi diperbarui langsung dari antrean poli. Kami kirim notifikasi saat tersisa 3 pasien.</div>
      ${ahead ? wide(ui.btn('Perbarui posisi', { act: 'tick' })) : ''}`;
  }
  function apHasil(J) {
    const lab = J.labResult || AP_LAB_SAMPLE;
    const items = (lab.items || []).map((i) => apLine(i.name, `Rujukan ${i.ref || '–'}`, `<b class="num">${esc(i.value)} ${esc(i.unit || '')}</b><div>${i.flag ? ui.chip(flagText(i.flag), 'danger') : ui.chip('Normal', 'success')}</div>`)).join('');
    return `<div class="row between"><b>Hasil laboratorium</b>${J.labResult ? '' : SAMPLE()}</div>
      <div class="small muted">Divalidasi analis ${esc(lab.validatedAt || '')} · ${esc(PEOPLE.suryo.poli)}</div>
      ${lab.critical ? ui.alert('danger', 'Dokter Anda sudah dihubungi', 'Ada nilai yang perlu penanganan segera. Ikuti arahan petugas.') : ''}
      <div>${items}</div>
      <div class="small muted">Nilai di luar rujukan dibahas dokter saat kontrol. Jangan ubah dosis obat sendiri.</div>`;
  }
  function apTagihan(L, J) {
    let visit;
    if (J.bill) {
      const bpjs = J.bill.payer === 'BPJS';
      const paid = J.payment && J.payment.status === 'paid';
      visit = apLine('Kunjungan Poli Penyakit Dalam · 5 Okt', `${(J.bill.items || []).length} item layanan · ${bpjs ? 'dijamin BPJS' : 'umum'}`, bpjs ? ui.chip('Dijamin BPJS', 'success') : `<b class="num">${esc(ui.rupiah(J.bill.total || 0))}</b><div>${ui.chip(paid ? 'Lunas' : 'Bayar di kasir', paid ? 'success' : 'warning')}</div>`);
    } else visit = `${apLine('Kunjungan Poli Penyakit Dalam · 5 Okt', 'Paket INA-CBG · rawat jalan', ui.chip('Dijamin BPJS', 'success'))}<div class="row">${SAMPLE()}</div>`;
    let inv;
    if (L.paid) inv = apLine(AP_INV.name, `${AP_INV.no} · ${AP_INV.date}`, `<b class="num">${esc(ui.rupiah(AP_INV.amount))}</b><div>${ui.chip(`Lunas ${L.paid.t}`, 'success')}</div>`) + `<div class="small muted">Ref ${esc(L.paid.ref)} · ${esc(L.paid.method)} · bukti bayar dikirim ke WhatsApp.</div>`;
    else {
      inv = apLine(AP_INV.name, `${AP_INV.no} · ${AP_INV.date}`, `<b class="num">${esc(ui.rupiah(AP_INV.amount))}</b><div>${ui.chip('Belum dibayar', 'warning')}</div>`);
      if (!L.pay) inv += wide(ui.btn(`Bayar ${ui.rupiah(AP_INV.amount)}`, { act: 'payStart', variant: 'primary' }));
      else if (L.pay === 'pilih') inv += `<b>Pilih cara bayar</b><div class="card" style="overflow:hidden">${opt('QRIS', 'Semua e-wallet & mobile banking', { act: 'payMethod', arg: 'qris' })}${opt('Virtual account BTN', 'Transfer dari bank mana pun', { act: 'payMethod', arg: 'va' })}${opt('Cicilan', 'Hanya untuk tagihan di atas Rp1 juta', { disabled: true, reason: 'Tagihan di bawah batas cicilan' })}</div>`;
      else {
        inv += pcard(L.pay === 'qris' ? 'Pindai QRIS' : 'Virtual account BTN', `${L.pay === 'qris' ? '<div style="margin:0 auto;width:140px;height:140px;border:6px solid var(--ink-900);border-radius:8px;background:repeating-linear-gradient(45deg,var(--ink-900) 0 5px,var(--card) 5px 10px)" aria-label="Kode QRIS"></div>' : `<div class="mono" style="font-size:20px;font-weight:600;text-align:center">9887 0812 0000 2844</div>`}
          <div class="small muted" style="text-align:center">${esc(ui.rupiah(AP_INV.amount))} · berlaku 30 menit · lewat TPDI × BTN</div>
          ${wide(`${ui.btn('Simulasikan bayar (mock TPDI)', { act: 'payDone', variant: 'primary' })}${ui.btn('Ganti cara bayar', { act: 'payStart', variant: 'ghost', size: 'sm' })}`)}`);
      }
    }
    return `<b>Tagihan</b>${visit}${inv}`;
  }
  function apKeluarga(L) {
    return `<b>Anggota keluarga</b>${AP_FAM.map((f) => pcard(f.name, `<div class="small muted">${esc(f.rel)} · ${esc(f.since)}</div><div class="small">${esc(f.akses)}</div>${L.fam[f.id] ? stamp('Akses dicabut', L.fam[f.id]) : `<div>${ui.btn('Cabut akses', { act: 'revoke', arg: f.id, size: 'sm', variant: 'danger' })}</div>`}`)).join('')}
      ${wide(ui.btn('Tambah anggota keluarga', { disabled: true, reason: 'Hanya di loket pendaftaran dengan KK atau surat kuasa dan persetujuan yang bersangkutan.' }))}`;
  }
  function apNotif(L, J) {
    const list = apNotifs(L, J);
    return `<b>Di layar kunci ponsel</b>
      <div style="background:var(--device);color:var(--device-ink);border-radius:14px;padding:10px;display:flex;flex-direction:column;gap:6px">${list.slice(0, 3).map(() => `<div style="background:var(--ink-700);border-radius:10px;padding:8px 10px;font-size:12.5px"><div style="opacity:.75">${esc(PEOPLE.rs.code)} · sekarang</div>Ada pembaruan untuk Anda. Buka aplikasi untuk melihat.</div>`).join('')}</div>
      <div class="small muted">Isi push tidak memuat nama, RM, diagnosis, atau hasil. Detail hanya tampil setelah masuk.</div>
      <b>Di dalam aplikasi</b><div>${list.map((n) => apLine(n.title, n.d, `<span class="small muted mono">${esc(n.t)}</span>`)).join('')}</div>`;
  }

  SIM.register({
    id: 'app-pasien', phase: 9, title: 'Aplikasi pasien', nav: 'Aplikasi pasien', codes: 'I07', role: 'pasien', device: 'ponsel',
    desc: 'Pasien masuk dengan OTP, booking poli dengan sisa kuota, memantau antrean, melihat hasil lab, membayar tagihan, dan mengatur akses keluarga.',
    hint: 'Masuk dengan OTP, lalu booking: Poli Penyakit Dalam → dr. Andi Wiratama → sesi pagi hari ini → konfirmasi.',
    init: { view: 'login', phone: '0812-0000-2844', otpSent: false, otpAt: '', otp: '', tries: 5, locked: false, err: '', tab: 'beranda', bk: 0, poli: '', dokter: '', slot: '', bookedAt: '', ahead: 6, qNotes: [], pay: '', paid: null, fam: {}, loginAt: '' },
    render(L, J) {
      let inner;
      if (L.view !== 'app') inner = apLogin(L);
      else {
        const nNotif = apNotifs(L, J).length;
        const head = `<div class="row between" style="flex-wrap:nowrap"><div style="min-width:0"><b>${esc(PEOPLE.rs.name)}</b><div class="small muted">Aplikasi pasien</div></div><div class="row" style="flex-wrap:nowrap">${ui.btn(`Notifikasi ${nNotif}`, { set: 'tab=notif', size: 'sm', variant: 'ghost' })}${ui.btn('Keluar', { act: 'logout', size: 'sm' })}</div></div>`;
        const body = { beranda: () => apHome(L, J), booking: () => apBooking(L, J), antrean: () => apAntrean(L, J), hasil: () => apHasil(J), tagihan: () => apTagihan(L, J), keluarga: () => apKeluarga(L), notif: () => apNotif(L, J) }[L.tab] || (() => apHome(L, J));
        inner = phone(head, body(), phoneNav('tab', L.tab, [['beranda', 'Beranda'], ['booking', 'Booking'], ['antrean', 'Antrean'], ['hasil', 'Hasil'], ['tagihan', 'Tagihan', L.paid ? '' : '1']]));
      }
      const side = ui.card({
        title: 'Yang tercatat di sistem', sub: 'Realm pasien terpisah dari akun petugas',
        body: `<div class="stack">${ui.timeline([
          { t: L.otpAt, text: L.otpAt ? 'OTP dikirim lewat WhatsApp ke nomor di MPI' : 'Menunggu pasien meminta OTP', tone: L.otpAt ? 'success' : '' },
          { t: L.loginAt, text: L.loginAt ? 'Masuk berhasil · perangkat dicatat' : 'Belum masuk', tone: L.loginAt ? 'success' : '' },
          { t: L.bookedAt || (J.booking ? '–' : ''), text: J.booking ? `Booking ${J.booking.code} · ${J.booking.no} · terkirim ke antrean online BPJS` : 'Belum ada booking', tone: J.booking ? 'success' : '' },
          { t: J.checkin ? J.checkin.t : '', text: J.checkin ? `Check-in anjungan · tiket ${J.checkin.ticket}` : 'Check-in di anjungan (langkah berikutnya)' },
          { t: L.paid ? L.paid.t : '', text: L.paid ? `Bayar ${AP_INV.no} lewat ${L.paid.method} (mock TPDI)` : 'Tagihan non-JKN belum dibayar', tone: L.paid ? 'success' : '' },
        ])}
          <div class="small muted">Data minimal: aplikasi hanya memuat data pasien sendiri dan anggota keluarga yang memberi persetujuan. Notifikasi push tanpa data kesehatan.</div></div>`,
      });
      const done = J.booking && SIM.isDone('app-pasien');
      return `<div class="grid g2" style="align-items:start">${ui.device('phone', inner, 'Aplikasi pasien · Android/iOS')}<div class="stack">${side}${done ? ui.next('anjungan', `Booking ${J.booking.code} dibuat · nomor antrean ${J.booking.no}.`) : ''}</div></div>`;
    },
    actions: {
      sendOtp(L) {
        if (L.locked) return false;
        if (String(L.phone || '').replace(/\D/g, '').length < 10) { L.err = 'Nomor HP belum lengkap'; return undefined; }
        L.otpSent = true; L.otpAt = SIM.now(1); L.err = '';
        return undefined;
      },
      autofill(L) { if (L.otpSent) L.otp = AP_OTP; },
      verifyOtp(L) {
        if (!L.otpSent || L.locked) return false;
        if (String(L.otp || '').trim() === AP_OTP) {
          Object.assign(L, { view: 'app', tab: 'beranda', err: '', loginAt: SIM.now(1) });
          SIM.note(`${PEOPLE.suryo.short} masuk aplikasi pasien dengan OTP WhatsApp`);
          return undefined;
        }
        L.tries -= 1; L.otp = '';
        if (L.tries <= 0) L.locked = true;
        L.err = 'Kode salah atau kedaluwarsa.';
        return undefined;
      },
      logout(L) { Object.assign(L, { view: 'login', otpSent: false, otp: '', tab: 'beranda' }); },
      pickPoli(L, J, el) { const p = AP_POLI.find((x) => x.id === argOf(el) && !x.off); if (!p) return false; L.poli = p.id; L.bk = 1; return undefined; },
      pickDok(L, J, el) { const d = AP_DOK.find((x) => x.id === argOf(el) && !x.off); if (!d || !L.poli) return false; L.dokter = d.id; L.bk = 2; return undefined; },
      pickSlot(L, J, el) { const s = AP_SLOT.find((x) => x.id === argOf(el) && !x.off); if (!s || !L.dokter) return false; L.slot = s.id; L.bk = 3; return undefined; },
      bkBack(L) { L.bk = Math.max(0, (Number(L.bk) || 0) - 1); },
      confirmBooking(L, J) {
        if (L.poli !== 'pd' || L.dokter !== 'andi' || L.slot !== 'pagi') { SIM.toast('Pilih poli, dokter, dan sesi dulu', 'warning'); return false; }
        J.booking = { ...AP_BOOKING };
        L.bk = 4; L.bookedAt = SIM.now(1); L.ahead = 6;
        SIM.note(`Booking ${J.booking.code} · ${J.booking.poli} · ${J.booking.dokter} · nomor ${J.booking.no}`, 'success');
        SIM.toast(`Booking terkonfirmasi · ${L.bookedAt}`, 'success');
        SIM.done();
        return undefined;
      },
      tick(L, J) {
        if (!J.booking || L.ahead <= 0) return false;
        L.ahead -= 1;
        const t = SIM.now(4);
        if (L.ahead === 3) L.qNotes.unshift({ t, title: 'Antrean tersisa 3 pasien', d: `${J.booking.no} · silakan menuju ruang tunggu poli` });
        if (L.ahead === 0) L.qNotes.unshift({ t, title: 'Giliran Anda', d: `${J.booking.no} · ${J.booking.poli}` });
        return undefined;
      },
      payStart(L) { if (L.paid) return false; L.pay = 'pilih'; return undefined; },
      payMethod(L, J, el) { const m = argOf(el); if (m !== 'qris' && m !== 'va') return false; L.pay = m; return undefined; },
      payDone(L) {
        if (L.paid || (L.pay !== 'qris' && L.pay !== 'va')) return false;
        const method = L.pay === 'qris' ? 'QRIS' : 'VA BTN';
        L.paid = { t: SIM.now(2), method, ref: 'TPDI-2610-88412' }; L.pay = '';
        SIM.note(`Pasien membayar ${AP_INV.no} ${ui.rupiah(AP_INV.amount)} lewat ${method} di aplikasi (mock TPDI)`, 'success');
        return undefined;
      },
      revoke(L, J, el) {
        const f = AP_FAM.find((x) => x.id === argOf(el));
        if (!f || L.fam[f.id]) return false;
        L.fam[f.id] = SIM.now(1);
        SIM.note(`Pasien mencabut akses keluarga: ${f.name}`);
        return undefined;
      },
    },
  });

  /* =====================================================================
   * F9 · APLIKASI DOKTER (I08)
   * ===================================================================== */
  const AD_COS = [
    { res: 'dr. Andika (PPDS PD)', pt: 'Ny. Endang Wijaya', loc: 'Melati M-203', t: '07.40', soap: 'A: pneumonia membaik, GDS terkontrol. P: rencana pulang besok, ganti sefiksim oral.' },
    { res: 'dr. Andika (PPDS PD)', pt: 'Tn. Agus Santoso', loc: 'Anggrek A-12', t: '08.15', soap: 'A: dispepsia, hemodinamik stabil. P: ikuti usulan apoteker, ganti omeprazol ke pantoprazol (interaksi klopidogrel).' },
    { res: 'dr. Rina (PPDS PD)', pt: 'Tn. Bambang H.', loc: 'ICU 3', t: '09.05', soap: 'A: sepsis membaik, laktat turun, MAP di atas 65 tanpa vasopresor. P: lanjut antibiotik, lengkapi resume.' },
  ];
  const AD_ORDERS = ['Kalsium glukonat 10% 10 mL IV pelan', 'Insulin reguler 10 IU + D40% 50 mL IV', 'EKG ulang 1 jam lagi', 'Periksa kalium ulang 2 jam lagi'];
  const AD_JADWAL = [['Visite rawat inap', 'Anggrek, Melati, ICU', '07.30'], ['Poli Penyakit Dalam', 'Rawat jalan · kuota JKN 30 + umum 10', '08.00–12.00'], ['Jaga konsulen IGD', 'Konsultasi lewat aplikasi dan telepon', '12.00–21.00'], ['Rapat komite medik', 'Ruang rapat lantai 3', 'Kamis 14.00']];
  function adCrit(J) {
    const it = J.labResult && J.labResult.critical ? (J.labResult.items || []).find((i) => /kritis|HH|LL|!/i.test(String(i.flag))) : null;
    if (it) return { p: PEOPLE.suryo, loc: 'Poli Penyakit Dalam', param: it.name, value: String(it.value), unit: it.unit || '', ref: it.ref || '', at: J.labResult.validatedAt || '', sample: false, k: false };
    return { p: PEOPLE.hartono, loc: J.bed ? `${J.bed.ward} ${J.bed.room}` : 'IGD bed 4', param: 'Kalium', value: '6,8', unit: 'mmol/L', ref: '3,5–5,0', at: '10.39', sample: !J.igd, k: true };
  }
  function adLock(L) {
    const csLeft = AD_COS.length - L.cs;
    const notes = [];
    if (!L.acc) notes.push(['sekarang', 'Ada nilai kritis yang perlu Anda konfirmasi. Buka aplikasi untuk melihat.', 'kritis']);
    if (csLeft) notes.push(['09.12', `${csLeft} catatan menunggu tanda tangan Anda.`, 'cppt']);
    notes.push(['07.00', 'Jadwal hari ini sudah diperbarui.', 'jadwal']);
    return `<div style="height:720px;background:var(--device);color:var(--device-ink);display:flex;flex-direction:column">${phoneBar(true)}
      <div style="text-align:center;padding:30px 0 20px"><div style="font-size:56px;font-weight:300;font-family:var(--font-mono)">${SIM.time()}</div><div class="small">Senin, 5 Oktober</div></div>
      <div style="padding:0 14px;display:flex;flex-direction:column;gap:8px">${notes.map(([h, b, tab]) => `<button type="button" data-act="unlock" data-arg="${tab}" style="text-align:left;border:0;border-radius:16px;padding:10px 12px;background:var(--ink-700);color:var(--device-ink);cursor:pointer"><div class="small">SIM RS · ${esc(h)}</div><div style="font-size:13.5px">${esc(b)}</div></button>`).join('')}</div>
      <div style="margin-top:auto;padding:18px;text-align:center"><div class="small">Notifikasi layar kunci tidak memuat nama pasien, RM, atau nilai hasil.</div><div style="margin-top:10px">${ui.btn('Buka dengan Face ID', { act: 'unlock', arg: 'pasien' })}</div></div></div>`;
  }
  function adKritis(L, J) {
    const c = adCrit(J);
    if (!L.acc) {
      return `${c.sample ? `<div class="row">${SAMPLE()}</div>` : ''}${pcard(`Nilai kritis · ${c.param} ${c.value} ${c.unit}`, `${kv([['Pasien', `${esc(c.p.name)}<div class="small muted mono">RM ${esc(c.p.rm)}</div>`], ['Lokasi', esc(c.loc)], ['Rujukan', esc(c.ref)], ['Dilaporkan lab', esc(c.at)]])}
        <div class="small">Belum dikonfirmasi: eskalasi otomatis ke DPJP cadangan 15 menit setelah dilaporkan.</div>`, 'danger')}
        ${ui.field('Bacakan ulang nilai (read-back)', ui.input('rb', L.rb, { mono: true, inputmode: 'decimal', placeholder: `ketik nilai ${c.param}` }), 'Ketik nilai yang Anda baca di atas')}
        ${L.rbErr ? ui.alert('danger', L.rbErr) : ''}
        ${wide(ui.btn('Konfirmasi baca', { act: 'ack', variant: 'primary', size: 'lg', needs: 'rb:1' }))}`;
    }
    const orders = c.k ? AD_ORDERS : [`Periksa ulang ${c.param} 2 jam lagi`];
    return `${pcard(`Diterima ${L.acc}`, `<div class="small">${esc(c.param)} ${esc(c.value)} ${esc(c.unit)} · ${esc(c.p.name)} · read-back tercatat, timer eskalasi berhenti.</div>`, 'success')}
      <b>Order cepat</b><div class="small muted">Diperiksa peringatan klinis (alergi, interaksi, dosis) sebelum terkirim ke perawat.</div>
      <div class="card" style="overflow:hidden">${orders.map((o, i) => opt(o, L.orders.includes(o) ? 'Terkirim ke perawat ruangan' : 'Ketuk untuk mengirim', { act: 'order', arg: String(i), right: L.orders.includes(o) ? ui.chip('Terkirim', 'success') : '' })).join('')}</div>`;
  }
  function adPasien(L, J) {
    const c = adCrit(J);
    const st = J.soap ? 'Sudah diperiksa' : J.called ? 'Dipanggil' : J.checkin ? 'Sudah check-in' : J.booking ? 'Booking aplikasi' : 'Terjadwal';
    if (L.sel) {
      const det = {
        suryo: [['Poli', 'Penyakit Dalam · PD-007'], ['Status', st], ['Riwayat', PEOPLE.suryo.history], ['GDS terakhir', J.soap && J.soap.ttv ? `${J.soap.ttv.gds} mg/dL` : '286 mg/dL']],
        hartono: [['Lokasi', c.loc], ['Diagnosis', PEOPLE.hartono.dx], ['Riwayat', PEOPLE.hartono.history], ['Nilai kritis', L.acc ? `Diterima ${L.acc}` : 'Belum dikonfirmasi']],
        agus: [['Lokasi', 'Anggrek A-12 · hari ke-3'], ['Catatan', 'Usulan apoteker: ganti omeprazol'], ['EWS', '2']],
        endang: [['Poli', 'Penyakit Dalam · PD-005'], ['Status', 'Selesai diperiksa 08.32'], ['Rencana', 'Kontrol 2 minggu, edukasi insulin']],
      }[L.sel] || [];
      const nm = { suryo: PEOPLE.suryo.name, hartono: PEOPLE.hartono.name, agus: 'Tn. Agus Santoso', endang: 'Ny. Endang Wijaya' }[L.sel] || '';
      return `${ui.btn('← Daftar pasien', { set: 'sel=', variant: 'ghost', size: 'sm' })}${pcard(nm, kv(det.map(([k, v]) => [k, esc(v)])))}`;
    }
    return `<b>Poli hari ini · 3 pasien</b><div class="card" style="overflow:hidden">${opt(`${PEOPLE.suryo.name}`, `PD-007 · ${st}`, { act: 'pickPt', arg: 'suryo', right: J.booking ? '' : SAMPLE() })}${opt('Ny. Endang Wijaya', 'PD-005 · selesai diperiksa', { act: 'pickPt', arg: 'endang' })}</div>
      <b>Rawat inap & konsul IGD</b><div class="card" style="overflow:hidden">${opt(PEOPLE.hartono.name, `${c.loc} · EWS 6`, { act: 'pickPt', arg: 'hartono', right: L.acc ? ui.chip('kritis diterima', 'success') : ui.chip('nilai kritis', 'danger') })}${opt('Tn. Agus Santoso', 'Anggrek A-12 · EWS 2', { act: 'pickPt', arg: 'agus' })}</div>`;
  }
  function adCppt(L) {
    const cs = AD_COS[L.cs];
    const signedList = L.signed.map((s) => `<div class="small">${stamp(`TTE · CPPT ${s.pt}`, s.t)}</div>`).join('');
    if (!cs) return `${pcard('Semua CPPT residen sudah ditandatangani', signedList, 'success')}`;
    return `<b>Co-sign CPPT residen · ${AD_COS.length - L.cs} menunggu</b>
      ${pcard(`${cs.pt} · ${cs.loc}`, `<div class="small muted">${esc(cs.res)} · SOAP ${esc(cs.t)}</div><div style="font-size:13.5px">${esc(cs.soap)}</div>`)}
      ${L.sent ? ui.alert('info', L.sent) : ''}
      ${L.noteOpen ? `${ui.field('Catatan untuk residen', ui.input('note', L.note, { area: true, placeholder: 'mis. tambahkan rencana edukasi insulin' }), 'Minimal 5 huruf · masuk CPPT sebagai umpan balik')}${wide(`${ui.btn('Kirim catatan', { act: 'sendNote', variant: 'primary', needs: 'note:5' })}${ui.btn('Batal', { set: 'noteOpen=', variant: 'ghost', size: 'sm' })}`)}`
        : wide(`${ui.btn('Setujui (TTE)', { act: 'cosign', variant: 'primary', size: 'lg' })}${ui.btn('Beri catatan', { set: 'noteOpen=1' })}`)}
      ${signedList}`;
  }
  function adJadwal() {
    return `<b>Jadwal praktik & jaga · hari ini</b><div>${AD_JADWAL.map(([t, d, w]) => apLine(t, d, `<span class="mono small">${esc(w)}</span>`)).join('')}</div>
      <b>Pengaturan notifikasi</b>
      ${apLine('Nilai kritis', 'Push + telepon bila tidak dibaca 5 menit', ui.chip('Aktif', 'success'))}
      ${apLine('Pratinjau di layar kunci', 'Generik, tanpa nama pasien atau nilai', ui.chip('Dikunci kebijakan RS', 'info'))}
      ${wide(ui.btn('Tampilkan detail di layar kunci', { disabled: true, reason: 'Kebijakan RS melarang data pasien di layar kunci (notifikasi tanpa PHI).' }))}`;
  }

  SIM.register({
    id: 'app-dokter', phase: 9, title: 'Aplikasi dokter', nav: 'Aplikasi dokter', codes: 'I08', role: 'dokter', device: 'ponsel',
    desc: 'Dokter menerima notifikasi nilai kritis tanpa data pasien di layar kunci, membuka dan mengonfirmasi dengan read-back, menandatangani CPPT residen, dan melihat jadwal praktik.',
    hint: 'Ketuk notifikasi nilai kritis di layar kunci, ketik ulang nilainya, konfirmasi baca, lalu setujui CPPT residen.',
    init: { view: 'lock', tab: 'kritis', rb: '', rbErr: '', acc: '', cs: 0, signed: [], noteOpen: '', note: '', sent: '', sel: '', orders: [] },
    render(L, J) {
      const csLeft = AD_COS.length - L.cs;
      let inner;
      if (L.view === 'lock') inner = adLock(L);
      else {
        const head = `<div class="row between" style="flex-wrap:nowrap"><div style="min-width:0"><b>${esc(STAFF.dokter.name)}</b><div class="small muted">Konsulen penyakit dalam · jaga</div></div>${ui.btn('Kunci', { act: 'lock', size: 'sm' })}</div>`;
        const body = L.tab === 'pasien' ? adPasien(L, J) : L.tab === 'cppt' ? adCppt(L) : L.tab === 'jadwal' ? adJadwal() : adKritis(L, J);
        inner = phone(head, body, phoneNav('tab', L.tab, [['kritis', 'Kritis', L.acc ? '' : '1'], ['pasien', 'Pasien'], ['cppt', 'CPPT', csLeft ? String(csLeft) : ''], ['jadwal', 'Jadwal']]));
      }
      const c = adCrit(J);
      const side = ui.card({
        title: 'Jejak nilai kritis', sub: `${c.param} ${c.value} ${c.unit} · ${c.p.short}`,
        body: `${ui.timeline([
          { t: c.at, text: 'Lab memvalidasi dan melaporkan nilai kritis', tone: 'danger' },
          { t: c.at, text: 'Push generik terkirim ke ponsel DPJP (tanpa data pasien)' },
          { t: L.acc, text: L.acc ? `Dokter konfirmasi baca dari aplikasi · read-back ${c.value}` : 'Menunggu konfirmasi baca dokter', tone: L.acc ? 'success' : 'warning' },
          ...L.signed.map((s) => ({ t: s.t, text: `CPPT ${s.pt} ditandatangani (TTE)`, tone: 'success' })),
        ])}<div class="small muted">Waktu lapor → konfirmasi masuk indikator INM-08.</div>`,
      });
      return `<div class="grid g2" style="align-items:start">${ui.device('phone', inner, 'Aplikasi dokter · mode klinisi')}<div class="stack">${side}${L.acc ? ui.next('simulasi', `Nilai kritis diterima ${L.acc} dengan read-back dari aplikasi.`) : ''}</div></div>`;
    },
    actions: {
      unlock(L, J, el) { const a = argOf(el); L.view = 'app'; L.tab = ['kritis', 'cppt', 'jadwal', 'pasien'].includes(a) ? a : 'pasien'; SIM.now(1); },
      lock(L) { L.view = 'lock'; L.sel = ''; },
      ack(L, J) {
        if (L.acc) return false;
        const c = adCrit(J);
        const v = num(L.rb, NaN);
        if (!Number.isFinite(v) || v !== num(c.value)) { L.rbErr = 'Nilai tidak sama dengan hasil lab. Baca ulang dengan teliti.'; L.rb = ''; return undefined; }
        L.acc = SIM.now(2); L.rbErr = '';
        SIM.note(`${STAFF.dokter.name} konfirmasi baca nilai kritis ${c.param} ${c.value} (${c.p.short}) dari aplikasi · read-back cocok`, 'success');
        SIM.done();
        return undefined;
      },
      order(L, J, el) {
        if (!L.acc) return false;
        const c = adCrit(J);
        const list = c.k ? AD_ORDERS : [`Periksa ulang ${c.param} 2 jam lagi`];
        const o = list[Number(argOf(el))];
        if (!o || L.orders.includes(o)) return false;
        L.orders.push(o); SIM.now(1);
        SIM.toast(`Order terkirim: ${o}`, 'success');
        return undefined;
      },
      pickPt(L, J, el) { const a = argOf(el); if (['suryo', 'hartono', 'agus', 'endang'].includes(a)) L.sel = a; },
      cosign(L) {
        const cs = AD_COS[L.cs];
        if (!cs) return false;
        const t = SIM.now(1);
        L.signed.push({ pt: cs.pt, t }); L.cs += 1; L.sent = ''; L.noteOpen = '';
        if (L.cs === AD_COS.length) SIM.note(`${STAFF.dokter.name} menandatangani ${AD_COS.length} CPPT residen lewat aplikasi (TTE)`);
        return undefined;
      },
      sendNote(L) {
        const cs = AD_COS[L.cs];
        if (!cs || String(L.note || '').trim().length < 5) { SIM.toast('Catatan minimal 5 huruf', 'warning'); return false; }
        L.sent = `Catatan dikirim ke ${cs.res} · ${SIM.now(1)}. CPPT tetap menunggu tanda tangan Anda.`;
        L.note = ''; L.noteOpen = '';
        return undefined;
      },
    },
  });

  /* =====================================================================
   * F10 · SIMULASI END-TO-END
   * ===================================================================== */
  const mkSteps = (rows) => rows.map(([s, actor, go, chk, dur, flaky]) => ({ s, actor, go, chk, dur, flaky: !!flaky }));
  const SCN = [
    { id: 'rj', label: 'Rawat jalan BPJS', who: 'suryo', steps: mkSteps([
      ['Booking lewat aplikasi', 'Pasien', 'app-pasien', 'Kode booking dan nomor antrean PD terbit, kuota berkurang', 0.8],
      ['Check-in anjungan', 'Pasien · anjungan', 'anjungan', 'Tiket tercetak, task 1 antrean BPJS terkirim', 0.6],
      ['Pendaftaran + SEP', 'Petugas pendaftaran', 'pendaftaran', 'SEP rawat jalan terbit, kunjungan dibuat', 1.4],
      ['Panggil antrean poli', 'Perawat poli', 'kendali', 'Display memanggil PD-007, task 4 terkirim', 0.5],
      ['Pemeriksaan poli', 'DPJP Poli PD', 'poli', 'Tanda vital + SOAP tersimpan dan ditandatangani', 1.1],
      ['Order lab + resep', 'DPJP Poli PD', 'cpoe', 'Order dan resep lolos peringatan klinis', 0.9],
      ['Validasi hasil lab', 'Analis lab', 'lab', 'Hasil tervalidasi, tampil di aplikasi pasien', 1.2],
      ['Telaah & serah obat', 'Apoteker', 'farmasi', 'Obat diserahkan, stok depo berkurang (FEFO)', 0.9],
      ['Kasir tutup kunjungan', 'Kasir', 'kasir', 'Tagihan final, dijamin BPJS', 0.7],
      ['Grouping & klaim', 'Koder', 'klaim', 'Grouping INA-CBG, klaim terkirim', 1.6],
      ['Kirim SATUSEHAT', 'Sistem', 'integrasi', 'Kunjungan, observasi, dan obat diterima SATUSEHAT', 1.0],
    ]) },
    { id: 'igd', label: 'IGD → rawat inap', who: 'hartono', steps: mkSteps([
      ['Kedatangan & triase', 'Perawat triase', 'igd', 'Triase 2 tercatat dalam 5 menit', 0.7],
      ['Order nyeri dada + lab', 'Dokter jaga IGD', 'cpoe', 'Order set terkirim ke lab dan radiologi', 0.8],
      ['Nilai kritis kalium', 'Analis lab', 'lab', 'Nilai kritis dilaporkan ≤ 30 menit', 1.0],
      ['Read-back dari aplikasi', 'DPJP', 'app-dokter', 'Konfirmasi baca tercatat, eskalasi berhenti', 0.6],
      ['Alokasi tempat tidur', 'Admisi rawat inap', 'bed', 'Tempat tidur dipesan sesuai hak kelas', 0.9],
      ['SEP rawat inap', 'Admisi', 'pendaftaran', 'SEP rawat inap terbit', 1.3, true],
      ['Perawatan & eMAR', 'Perawat ruangan', 'ranap', 'Pemberian obat dipindai gelang, CPPT terverifikasi', 1.4],
      ['Resume & pulang', 'DPJP', 'resume', 'Resume ber-TTE ≤ 1×24 jam, rekonsiliasi obat', 1.0],
      ['Kasir rawat inap', 'Kasir', 'kasir', 'Tagihan final, tanpa selisih kelas', 0.8],
      ['Koding & klaim', 'Koder', 'klaim', 'Klaim rawat inap terkirim', 1.5],
    ]) },
    { id: 'btn', label: 'Elektif + BTN', who: 'ratna', steps: mkSteps([
      ['Admisi elektif', 'Admisi', 'bed', 'Kamar naik kelas dipesan', 0.8],
      ['Persetujuan tindakan', 'DPJP bedah', 'consent', 'Persetujuan ditandatangani pasien + saksi', 0.9],
      ['Deposit lewat VA BTN', 'Kasir', 'pembayaran', 'Deposit selisih kelas lunas lewat TPDI', 1.2],
      ['Operasi & ceklis', 'Tim kamar operasi', 'ok', 'Sign in, time out, sign out lengkap; alergi amoksisilin dicek', 1.6],
      ['Pasca operasi', 'Perawat ruangan', 'ranap', 'Antibiotik non-penisilin diberikan sesuai eMAR', 1.1],
      ['Resume pulang', 'DPJP bedah', 'resume', 'Resume ber-TTE, kontrol dijadwalkan', 0.9],
      ['Pelunasan + cicilan', 'Kasir', 'kasir', 'Sisa selisih kelas dicicil lewat BTN', 1.0],
      ['Rekonsiliasi tiga arah', 'Keuangan', 'pembayaran', 'Mutasi bank = TPDI = SIM RS', 1.3],
      ['Klaim BPJS', 'Koder', 'klaim', 'Klaim kolelitiasis digrouping dan terkirim', 1.4],
      ['Pembiayaan piutang BTN', 'Kepala akuntansi', 'pembiayaan', 'Piutang klaim dibiayai BTN, dana cair', 1.2],
    ]) },
  ];
  const scById = (id) => SCN.find((s) => s.id === id);
  const scPass = (L, sc) => sc.steps.filter((_, i) => L.res[sc.id][i] && L.res[sc.id][i].st === 'lulus').length;
  const scNext = (L, sc) => sc.steps.findIndex((_, i) => !L.res[sc.id][i] || L.res[sc.id][i].st !== 'lulus');
  function scRunOne(L, sc) {
    const i = scNext(L, sc);
    if (i < 0) return 'selesai';
    const step = sc.steps[i];
    const key = `${sc.id}-${i}`;
    const t = SIM.now(1);
    if (step.flaky && !L.tries[key]) {
      L.tries[key] = 1;
      L.res[sc.id][i] = { st: 'gagal', t, d: '10,0', msg: 'Layanan BPJS (tiruan) tidak menjawab dalam 10 detik. Ulangi langkah.' };
      SIM.note(`Simulasi ${sc.label}: langkah "${step.s}" gagal (BPJS tidak menjawab)`, 'danger');
      return 'gagal';
    }
    L.res[sc.id][i] = { st: 'lulus', t, d: fmt1(step.dur), msg: L.tries[key] ? 'Lulus setelah diulang (kirim ulang otomatis)' : '' };
    if (scNext(L, sc) < 0) SIM.note(`Simulasi ${sc.label} lulus ${sc.steps.length}/${sc.steps.length}`, 'success');
    if (SCN.every((s) => scNext(L, s) < 0) && !L.allAt) { L.allAt = SIM.time(); SIM.note('Ketiga skenario end-to-end lulus', 'success'); SIM.done(); }
    return 'lulus';
  }

  SIM.register({
    id: 'simulasi', phase: 10, title: 'Simulasi end-to-end', nav: 'Simulasi end-to-end', codes: 'F10 · E2E', role: 'admin',
    desc: 'Tiga skenario dari kedatangan sampai klaim atau pembiayaan dijalankan langkah demi langkah di tenant latihan, dengan status lulus/gagal dan waktunya.',
    hint: 'Pilih skenario, klik "Jalankan langkah" satu per satu (atau semua). Bila ada yang gagal, ulangi langkahnya.',
    init: { sc: 'rj', res: { rj: [], igd: [], btn: [] }, tries: {}, allAt: '' },
    render(L) {
      const sc = scById(L.sc) || SCN[0];
      const tot = SCN.reduce((s, x) => s + x.steps.length, 0);
      const pass = SCN.reduce((s, x) => s + scPass(L, x), 0);
      const kpis = SCN.map((x) => { const p = scPass(L, x); const fail = L.res[x.id].some((r) => r && r.st === 'gagal'); return ui.kpi(x.label, `${p}/${x.steps.length}`, p === x.steps.length ? 'lulus semua' : fail ? 'ada langkah gagal' : `${PEOPLE[x.who].short} · belum selesai`, p === x.steps.length ? 'up' : fail ? 'down' : ''); }).join('');
      const nxt = scNext(L, sc);
      const failed = nxt >= 0 && L.res[sc.id][nxt] && L.res[sc.id][nxt].st === 'gagal';
      const rows = sc.steps.map((st, i) => {
        const r = L.res[sc.id][i];
        const status = r ? `${ui.chip(r.st === 'lulus' ? 'Lulus' : 'Gagal', r.st === 'lulus' ? 'success' : 'danger')} <span class="mono small muted">${esc(r.t)}</span>${r.msg ? `<div class="small" style="color:${r.st === 'lulus' ? 'var(--ink-500)' : 'var(--danger)'}">${esc(r.msg)}</div>` : ''}` : i === nxt ? ui.chip('Berikutnya', 'brand') : ui.chip('Menunggu', '');
        return [`<span class="mono">${i + 1}</span>`, `<b>${esc(st.s)}</b><div class="small muted">${esc(st.actor)}</div>`, `<span class="small">${esc(st.chk)}</span>`, status, r ? `${esc(r.d)} dtk` : '–',
          `${ui.btn('Buka layarnya', { go: st.go, size: 'sm', variant: 'ghost' })}${SIM.isDone(st.go) ? `<div>${ui.chip('dicoba di tur', 'success')}</div>` : ''}`];
      });
      const controls = nxt < 0 ? ui.chip(`Lulus ${sc.steps.length}/${sc.steps.length}`, 'success')
        : `${ui.btn(failed ? `Ulangi langkah ${nxt + 1}` : `Jalankan langkah ${nxt + 1}`, { act: 'run', arg: sc.id, variant: 'primary' })}${ui.btn('Jalankan semua', { act: 'runAll', arg: sc.id })}`;
      return `${ui.alert(pass === tot ? 'success' : 'info', `Ringkasan: lulus ${pass}/${tot} langkah`, pass === tot ? `Semua skenario lulus · ${esc(L.allAt)}.` : 'Dijalankan di tenant latihan dengan data skenario; tidak menyentuh data produksi.')}
        <div class="grid g3">${kpis}</div>
        ${ui.tabs('sc', sc.id, SCN.map((x) => ({ value: x.id, label: `${x.label} (${scPass(L, x)}/${x.steps.length})` })))}
        ${ui.banner(PEOPLE[sc.who], ui.chip(PEOPLE[sc.who].scenario, 'brand'))}
        ${ui.card({ title: `Skenario ${sc.label}`, sub: `${sc.steps.length} langkah · urut dari kedatangan sampai ${sc.id === 'btn' ? 'pembiayaan' : 'klaim'}`, actions: `${controls}${ui.btn('Ulang skenario', { act: 'resetSc', arg: sc.id, variant: 'ghost', size: 'sm' })}`, flush: true,
          body: ui.table(['#', 'Langkah', 'Yang diperiksa', 'Status', { label: 'Durasi', r: true }, 'Layar'], rows) })}
        ${pass === tot ? ui.next('downtime', 'Ketiga skenario lulus dari kedatangan sampai klaim dan pembiayaan.') : ''}`;
    },
    actions: {
      run(L, J, el) { const sc = scById(argOf(el)) || scById(L.sc); scRunOne(L, sc); },
      runAll(L, J, el) {
        const sc = scById(argOf(el)) || scById(L.sc);
        for (let k = 0; k < sc.steps.length + 1; k += 1) { const r = scRunOne(L, sc); if (r !== 'lulus') break; }
      },
      resetSc(L, J, el) {
        const sc = scById(argOf(el)) || scById(L.sc);
        L.res[sc.id] = []; Object.keys(L.tries).filter((k) => k.startsWith(`${sc.id}-`)).forEach((k) => delete L.tries[k]);
        L.allAt = '';
      },
    },
  });

  /* =====================================================================
   * F10 · MODE DOWNTIME (P13)
   * ===================================================================== */
  const DT_PAPER = [
    { id: 'p1', form: 'Pendaftaran darurat', who: 'Tn. Joko Susilo (pasien baru)', off: 6, by: STAFF.daftar.name },
    { id: 'p2', form: 'Surat jaminan sementara (pengganti SEP)', who: PEOPLE.suryo.name, off: 12, by: STAFF.daftar.name },
    { id: 'p3', form: 'eMAR kertas · Ruang Melati', who: PEOPLE.hartono.name, off: 18, by: STAFF.perawat.name },
    { id: 'p4', form: 'CPPT kertas', who: PEOPLE.hartono.name, off: 27, by: STAFF.dokterigd.name },
  ];
  const DT_FORMS = ['Daftar pasien per ruang + alergi', 'Obat aktif + jadwal eMAR 8 jam', 'CPPT terakhir', 'Formulir pendaftaran darurat', 'Surat jaminan sementara BPJS'];
  const DT_STAGES = ['Normal', 'Downtime aktif', 'Pulih · entri susulan', 'Sinkronisasi', 'Selesai'];
  const blTotal = (L) => L.bl.sep + L.bl.task + L.bl.ss;
  const dtSync = (L, J) => { J.downtime = { active: L.stage === 1, backlog: blTotal(L) }; L.peak = Math.max(L.peak, blTotal(L)); };

  SIM.register({
    id: 'downtime', phase: 10, title: 'Mode downtime', nav: 'Mode downtime', codes: 'P13', role: 'admin',
    desc: 'Saat BPJS atau jaringan mati, layanan jalan dengan server edge dan formulir kertas darurat. Setelah pulih, entri susulan dicatat dan antrean kirim disinkronkan.',
    hint: 'Aktifkan downtime dengan alasan, cetak paket darurat, nyatakan pulih, masukkan entri susulan, lalu sinkronkan sampai antrean nol.',
    init: { stage: 0, cause: 'bpjs', dreason: '', startT: '', endT: '', startC: 0, endC: 0, clin: {}, printed: '', offline: 0, bl: { sep: 0, task: 0, ss: 0 }, peak: 0, susReason: 'Downtime layanan, dicatat di formulir kertas darurat', sus: {}, syncLog: [] },
    render(L, J) {
      const st = L.stage;
      const total = blTotal(L);
      const svc = [
        ['BPJS VClaim & Antrean', st === 1 && L.cause === 'bpjs' ? ui.chip('Tidak menjawab', 'danger') : ui.chip('Normal', 'success')],
        ['Koneksi ke server pusat', st === 1 && L.cause === 'net' ? ui.chip('Putus · edge mengambil alih', 'danger') : ui.chip('Normal', 'success')],
        ['Server edge lokal', st === 1 ? ui.chip('Melayani baca + pendaftaran', 'warning') : ui.chip('Siaga · sinkron', 'success')],
        ['SATUSEHAT', st === 1 ? ui.chip('Kiriman ditahan di antrean', 'warning') : ui.chip('Normal', 'success')],
      ];
      const backlog = ui.card({
        title: 'Antrean kirim tertunda', sub: total ? `${total} pesan · disimpan di server edge, dikirim ulang setelah pulih` : 'Kosong',
        body: `<div class="stack">${bar(L.peak ? (total / L.peak) * 100 : 0, total ? 'warning' : 'success')}
          ${kv([['SEP / jaminan BPJS', String(L.bl.sep)], ['Task ID antrean BPJS', String(L.bl.task)], ['SATUSEHAT', String(L.bl.ss)]])}
          ${L.syncLog.length ? ui.timeline(L.syncLog.map((s) => ({ t: s.t, text: `Batch terkirim · ${s.n} pesan, sisa ${s.left}`, tone: s.left ? '' : 'success' }))) : ''}</div>`,
      });
      let main = '';
      if (st === 0) {
        main = ui.card({
          title: 'Aktifkan mode downtime', sub: 'Dipakai saat layanan luar atau jaringan mati; juga untuk latihan di tenant latihan',
          body: `<div class="stack">${ui.seg('cause', L.cause, [{ value: 'bpjs', label: 'BPJS tidak menjawab' }, { value: 'net', label: 'Jaringan ke server pusat putus' }])}
            ${ui.field('Alasan & dampak (tercatat di log insiden)', ui.input('dreason', L.dreason, { area: true, placeholder: 'mis. VClaim timeout sejak 08.10, SEP tidak bisa terbit' }), 'Minimal 10 huruf')}
            <div>${ui.btn('Aktifkan mode downtime', { act: 'activate', variant: 'danger', needs: 'dreason:10' })}</div></div>`,
        });
      } else if (st === 1) {
        main = `${ui.alert('danger', `Mode downtime aktif sejak ${L.startT}`, esc(L.cause === 'bpjs' ? 'Pendaftaran tetap jalan; SEP diganti surat jaminan sementara dan dikirim ulang setelah BPJS pulih.' : 'Server edge melayani baca dan pendaftaran; tulis klinis memakai formulir kertas darurat.'))}
          <div class="grid g2" style="align-items:start">${ui.card({
            title: 'Paket cetak darurat · Ruang Melati', sub: 'Disiapkan otomatis tiap 4 jam di server edge',
            body: `<div class="stack">${DT_FORMS.map((f) => `<div class="small">• ${esc(f)}</div>`).join('')}
              ${L.printed ? `<div style="border:1px dashed var(--line-strong);border-radius:10px;padding:10px;background:var(--subtle)"><div class="small"><b>RUANG MELATI · 12 pasien</b> · ${esc(PEOPLE.hartono.name)} (${esc(PEOPLE.hartono.rm)}) · tanpa alergi · amlodipin, omeprazol …</div><div class="small" style="color:var(--danger);font-weight:600;margin-top:6px">DICETAK ${esc(L.printed)} OLEH ${esc(STAFF.admin.name.toUpperCase())} · RAHASIA · tercatat audit</div></div>` : ''}
              <div>${L.printed ? stamp('Paket dicetak', L.printed) : ui.btn('Cetak paket darurat', { act: 'print', variant: 'primary' })}</div></div>`,
          })}${ui.card({
            title: 'Pendaftaran tetap berjalan', sub: 'Nomor kunjungan dari blok nomor yang disewakan ke edge',
            body: `<div class="stack"><div class="small">${L.offline} pasien didaftarkan selama downtime.</div>
              <div class="row">${ui.btn('Daftarkan pasien (offline)', { act: 'offlineReg', disabled: L.offline >= 3, reason: 'Contoh dibatasi 3 pasien' })}${ui.btn('Waktu berjalan 15 menit', { act: 'tick', variant: 'ghost' })}</div>
              <hr class="sep"><div>${ui.btn('Layanan pulih · akhiri downtime', { act: 'recover', variant: 'primary', disabled: !L.printed, reason: 'Cetak paket darurat dulu (langkah wajib SOP)' })}</div></div>`,
          })}</div>`;
      } else if (st === 2) {
        const left = DT_PAPER.filter((p) => !L.sus[p.id]).length;
        main = ui.card({
          title: 'Entri susulan dari formulir kertas', sub: `Pulih ${L.endT} · ${left} formulir belum dimasukkan`,
          body: `<div class="stack">${ui.field('Alasan entri susulan (berlaku untuk semua baris)', ui.input('susReason', L.susReason, {}), 'Minimal 10 huruf · tercatat sebagai entri susulan dengan waktu klinis asli')}
            ${ui.table(['Formulir', 'Pasien', 'Waktu klinis', 'Pencatat', 'Entri'], DT_PAPER.map((p) => [esc(p.form), esc(p.who), `<span class="mono">${esc(L.clin[p.id] || '')}</span>`, esc(p.by),
              L.sus[p.id] ? `${ui.chip('Entri susulan', 'info')}<div class="small muted">dicatat ${esc(L.sus[p.id])}</div>` : ui.btn('Masukkan', { act: 'susulan', arg: p.id, size: 'sm', needs: 'susReason:10' })]))}
            <div>${ui.btn('Mulai sinkronisasi antrean', { act: 'sync', variant: 'primary', disabled: left > 0, reason: `${left} formulir kertas belum dimasukkan` })}</div></div>`,
        });
      } else if (st === 3) {
        main = ui.card({ title: 'Sinkronisasi antrean kirim', sub: 'Dikirim per batch, berurutan, dengan kunci idempoten', body: `<div class="row">${ui.btn(`Kirim batch berikutnya (sisa ${total})`, { act: 'sync', variant: 'primary' })}</div>` });
      } else {
        const dur = L.endC - L.startC;
        main = `${ui.alert('success', 'Downtime selesai · antrean kirim kosong', `Durasi gangguan ${dur} menit · data hilang 0 (RPO 0) · pemulihan layanan ${Math.max(3, L.syncLog.length * 2)} menit setelah pulih. Log insiden siap dievaluasi.`)}
          ${ui.next('golive', 'Latihan downtime selesai: paket darurat, entri susulan, dan antrean sinkron kembali.')}`;
      }
      return `${ui.steps(DT_STAGES, st >= 4 ? 5 : st)}
        <div class="grid g2" style="align-items:start">${ui.card({ title: 'Status layanan', sub: `Jam ${SIM.time()}`, flush: true, body: ui.table(['Layanan', 'Status'], svc.map(([a, b]) => [esc(a), b])) })}${backlog}</div>
        ${main}`;
    },
    actions: {
      activate(L, J) {
        if (L.stage !== 0) return false;
        if (String(L.dreason || '').trim().length < 10) { SIM.toast('Tulis alasan minimal 10 huruf', 'warning'); return false; }
        L.stage = 1; L.startT = SIM.now(1); L.startC = SIM.clock;
        DT_PAPER.forEach((p) => { L.clin[p.id] = hm(SIM.clock + p.off); });
        L.bl = { sep: 0, task: 0, ss: 0 }; L.peak = 0; L.syncLog = [];
        dtSync(L, J);
        SIM.note(`Mode downtime diaktifkan (${L.cause === 'bpjs' ? 'BPJS tidak menjawab' : 'jaringan ke pusat putus'})`, 'danger');
        return undefined;
      },
      print(L) {
        if (L.stage !== 1 || L.printed) return false;
        L.printed = SIM.now(2);
        SIM.note('Paket cetak darurat Ruang Melati dicetak · tercatat audit');
        return undefined;
      },
      offlineReg(L, J) {
        if (L.stage !== 1 || L.offline >= 3) return false;
        L.offline += 1; L.bl.sep += 1; L.bl.task += 2; L.bl.ss += 1; SIM.now(3);
        dtSync(L, J);
        return undefined;
      },
      tick(L, J) {
        if (L.stage !== 1) return false;
        SIM.now(15); L.bl.task += 6; L.bl.ss += 5;
        dtSync(L, J);
        return undefined;
      },
      recover(L, J) {
        if (L.stage !== 1 || !L.printed) { SIM.toast('Cetak paket darurat dulu', 'warning'); return false; }
        L.stage = 2; L.endT = SIM.now(5); L.endC = SIM.clock; L.bl.task += 4; L.bl.sep += 2;
        dtSync(L, J);
        SIM.note(`Layanan pulih · downtime ${L.endC - L.startC} menit, ${blTotal(L)} pesan menunggu dikirim`, 'success');
        return undefined;
      },
      susulan(L, J, el) {
        const p = DT_PAPER.find((x) => x.id === argOf(el));
        if (L.stage !== 2 || !p || L.sus[p.id]) return false;
        if (String(L.susReason || '').trim().length < 10) { SIM.toast('Alasan entri susulan minimal 10 huruf', 'warning'); return false; }
        L.sus[p.id] = SIM.now(2); L.bl.ss += 1;
        dtSync(L, J);
        return undefined;
      },
      sync(L, J) {
        if (L.stage === 2 && DT_PAPER.some((p) => !L.sus[p.id])) { SIM.toast('Masukkan semua formulir kertas dulu', 'warning'); return false; }
        if (L.stage !== 2 && L.stage !== 3) return false;
        L.stage = 3;
        let n = Math.min(12, blTotal(L)); const sent = n;
        ['sep', 'task', 'ss'].forEach((k) => { const d = Math.min(n, L.bl[k]); L.bl[k] -= d; n -= d; });
        L.syncLog.push({ t: SIM.now(2), n: sent, left: blTotal(L) });
        dtSync(L, J);
        if (!blTotal(L)) {
          L.stage = 4;
          SIM.note('Antrean kirim tersinkron kembali · backlog 0', 'success');
          SIM.done();
        }
        return undefined;
      },
    },
  });

  /* =====================================================================
   * F10 · CADANGAN & PEMULIHAN
   * ===================================================================== */
  const BK_LOC = [
    ['Lokal', 'Disk server edge', 'Per jam + harian 01.00', '2,41 GB'],
    ['MinIO', 'Bucket simrs-backups', 'Per jam', '2,41 GB'],
    ['Offsite', 'Bucket simrs-backups-offsite · region berbeda', 'Mirror tiap 6 jam + harian 01.30', '2,38 GB'],
  ];
  const RS_STEPS = [
    ['Siapkan database bersih', 'Kontainer database baru, tanpa data'],
    ['Dekripsi cadangan', 'Kunci privat dari dua pemegang kunci, tidak pernah disimpan di server'],
    ['Pulihkan data', 'Cadangan 07.00 · 2,41 GB'],
    ['Cek versi skema', 'Semua migrasi terpasang, tidak ada yang tertunda'],
    ['Cocokkan checksum & jumlah baris', 'Dibandingkan dengan manifest cadangan'],
    ['Verifikasi rantai audit', 'Kepala rantai sama dengan jangkar WORM terakhir'],
    ['Layanan siap di atas data hasil pulih', 'Cek kesiapan menjawab dalam 1,2 detik'],
  ];
  const RS_TABLES = [['Pasien (MPI)', 48212], ['Kunjungan', 312904], ['Jejak audit', 1284551], ['Mutasi stok', 905118], ['Tagihan', 201377]];
  const ANCHORS = [['05.00', '1.284.102', 'a3f9 1c7e 55d0'], ['06.00', '1.284.377', '4be0 92d1 0c8a'], ['07.00', '1.284.551', 'c71a 0f3b e926']];

  SIM.register({
    id: 'backup', phase: 10, title: 'Cadangan & pemulihan', nav: 'Cadangan & pemulihan', codes: 'F10 · backup', role: 'admin',
    desc: 'Cadangan terenkripsi di tiga lokasi dengan jadwal, uji restore ke database terpisah sampai checksum cocok, dan verifikasi jangkar hash audit.',
    hint: 'Jalankan uji restore langkah demi langkah sampai lulus, lalu verifikasi rantai audit terhadap jangkar WORM.',
    init: { last: '07.00', runs: [], step: 0, rt: {}, rc0: 0, restoreAt: '', rto: 0, verified: '' },
    render(L) {
      const locRows = BK_LOC.map(([n, w, j, s], i) => [`<b>${esc(n)}</b><div class="small muted">${esc(w)}</div>`, esc(j), `<span class="mono">${esc(i === 2 && !L.runs.length ? '06.00' : L.last)}</span>`, esc(s), ui.chip('Berhasil · terenkripsi', 'success')]);
      const k = L.step;
      const rsRows = RS_STEPS.map(([a, b], i) => [`<span class="mono">${i + 1}</span>`, `<b>${esc(a)}</b><div class="small muted">${esc(b)}</div>`, i < k ? `${ui.chip('Lulus', 'success')} <span class="mono small muted">${esc(L.rt[i] || '')}</span>` : i === k ? ui.chip('Berikutnya', 'brand') : ui.chip('Menunggu', '')]);
      const checks = k >= 5 ? ui.table(['Tabel', { label: 'Manifest', r: true }, { label: 'Hasil pulih', r: true }, 'Cocok'], RS_TABLES.map(([n, c]) => [esc(n), fmt(c), fmt(c), ui.chip('✓ sama', 'success')])) : '';
      return `<div class="grid g4">${ui.kpi('RPO', '≤ 1 jam', `target 1 jam · cadangan terakhir ${L.last}`, 'up')}${ui.kpi('RTO uji terakhir', L.restoreAt ? `${L.rto} menit` : '–', 'target ≤ 4 jam', L.restoreAt ? 'up' : '')}${ui.kpi('Lokasi cadangan', '3/3', 'lokal · MinIO · offsite')}${ui.kpi('Jangkar audit', L.verified ? 'Utuh' : 'Belum dicek', L.verified ? `diverifikasi ${L.verified}` : 'tiap jam ke penyimpanan WORM', L.verified ? 'up' : '')}</div>
        ${ui.card({ title: 'Cadangan terenkripsi · tiga lokasi', sub: 'Dienkripsi sebelum keluar server; kunci privat dipegang Kepala IT dan Direktur', actions: ui.btn('Jalankan cadangan sekarang', { act: 'runBackup', size: 'sm' }), flush: true,
          body: ui.table(['Lokasi', 'Jadwal', 'Terakhir', 'Ukuran', 'Status'], locRows) })}
        ${L.runs.length ? ui.timeline(L.runs.map((r) => ({ t: r.t, text: 'Cadangan manual selesai di 3 lokasi · manifest berisi hash + jumlah baris', tone: 'success' }))) : ''}
        <div class="grid g2" style="align-items:start">${ui.card({
          title: 'Uji restore ke database terpisah', sub: L.restoreAt ? `Lulus ${L.restoreAt} · RTO ${L.rto} menit` : 'Mingguan otomatis; bisa dijalankan manual',
          actions: k < RS_STEPS.length ? ui.btn(`Jalankan langkah ${k + 1}`, { act: 'restoreNext', variant: 'primary', size: 'sm' }) : ui.btn('Ulang uji', { act: 'restoreReset', size: 'sm' }),
          body: `<div class="stack">${ui.table(['#', 'Langkah', 'Status'], rsRows)}${checks}${L.restoreAt ? ui.alert('success', 'Uji restore lulus', `Data pulih utuh di mesin bersih, checksum cocok, layanan siap. RPO ≤ 1 jam, RTO ${L.rto} menit (target 4 jam).`) : ''}</div>`,
        })}${ui.card({
          title: 'Jangkar hash audit (WORM)', sub: 'Kepala rantai per jam + HMAC dengan kunci terpisah, object lock 400 hari',
          actions: ui.btn('Verifikasi rantai audit', { act: 'verifyAudit', size: 'sm' }),
          body: `<div class="stack">${ui.table(['Jam', { label: 'Urutan', r: true }, 'Hash', 'HMAC'], ANCHORS.map(([t, s, h]) => [`<span class="mono">${esc(t)}</span>`, esc(s), `<span class="mono small">${esc(h)}…</span>`, L.verified ? ui.chip('cocok', 'success') : ui.chip('belum dicek', '')]))}
            ${L.verified ? ui.alert('success', `Rantai audit utuh · ${L.verified}`, 'Diverifikasi dari checkpoint terakhir sampai urutan 1.284.551. Tidak ada baris yang hilang atau dipotong.') : ''}</div>`,
        })}</div>
        ${L.restoreAt ? ui.next('golive', `Uji restore lulus dengan RTO ${L.rto} menit; bukti masuk ceklis go-live.`) : ''}`;
    },
    actions: {
      runBackup(L) { const t = SIM.now(4); L.last = t; L.runs.unshift({ t }); SIM.toast(`Cadangan selesai · ${t}`, 'success'); },
      restoreNext(L) {
        if (L.step >= RS_STEPS.length) return false;
        if (L.step === 0) L.rc0 = SIM.clock;
        L.rt[L.step] = SIM.now(L.step === 2 ? 18 : 3);
        L.step += 1;
        if (L.step === RS_STEPS.length) {
          L.restoreAt = SIM.time(); L.rto = SIM.clock - L.rc0;
          SIM.note(`Uji restore cadangan lulus di database terpisah · RTO ${L.rto} menit`, 'success');
          SIM.done();
        }
        return undefined;
      },
      restoreReset(L) { Object.assign(L, { step: 0, rt: {}, restoreAt: '' }); },
      verifyAudit(L) { L.verified = SIM.now(1); SIM.note('Rantai audit diverifikasi terhadap jangkar WORM · utuh'); },
    },
  });

  /* =====================================================================
   * F10 · KESIAPAN GO-LIVE (akhir tur)
   * ===================================================================== */
  const GL_OWNERS = [{ value: '', label: 'Pilih pemilik…' }, 'Kepala IT', 'Petugas keamanan informasi', 'Kepala diklat', 'Kepala instalasi RM', 'Kabid keperawatan', 'Manajer keuangan', 'Komite mutu', 'Direktur'];
  const GL = [
    { area: 'Teknis', items: [
      { id: 't1', text: 'Server produksi dan edge terpasang, pemantauan aktif', crit: true, owner: 'Kepala IT', done: true },
      { id: 't2', text: 'Uji beban 300 pengguna serentak lulus', crit: false, owner: 'Kepala IT', done: true },
      { id: 't3', text: 'Simulasi tiga skenario end-to-end lulus', crit: true, owner: 'Komite mutu', auto: 'simulasi' },
      { id: 't4', text: 'Uji restore cadangan di mesin bersih lulus', crit: true, owner: 'Kepala IT', auto: 'backup' },
    ] },
    { area: 'Keamanan', items: [
      { id: 'k1', text: 'Review keamanan semua modul tanpa temuan tinggi', crit: true, owner: 'Petugas keamanan informasi', done: true },
      { id: 'k2', text: 'MFA wajib untuk semua akun staf', crit: true, owner: 'Petugas keamanan informasi', done: true },
      { id: 'k3', text: 'Kunci cadangan dipegang dua orang terpisah', crit: true, owner: '' },
      { id: 'k4', text: 'Matriks 51 EP MRMIK terisi bukti', crit: false, owner: 'Kepala instalasi RM' },
    ] },
    { area: 'Pelatihan', items: [
      { id: 'p1', text: 'Petugas pendaftaran dan kasir terlatih ≥ 90%', crit: true, owner: 'Kepala diklat', done: true },
      { id: 'p2', text: 'Dokter dan perawat terlatih CPPT & eMAR ≥ 90%', crit: true, owner: 'Kabid keperawatan' },
      { id: 'p3', text: 'Super user per unit ditetapkan', crit: false, owner: 'Kepala diklat', done: true },
    ] },
    { area: 'Data migrasi', items: [
      { id: 'd1', text: 'Data MPI 48.212 pasien termigrasi, duplikat ditinjau', crit: true, owner: 'Kepala instalasi RM', done: true },
      { id: 'd2', text: 'Saldo stok awal dan tarif terverifikasi', crit: true, owner: 'Manajer keuangan', done: true },
      { id: 'd3', text: 'Piutang BPJS berjalan dipindahkan', crit: false, owner: 'Manajer keuangan' },
    ] },
    { area: 'SOP', items: [
      { id: 's1', text: 'SOP downtime disahkan dan latihan downtime dijalankan', crit: true, owner: 'Kepala IT', auto: 'downtime' },
      { id: 's2', text: 'SOP pelepasan informasi & retensi RM disahkan', crit: false, owner: 'Kepala instalasi RM', done: true },
      { id: 's3', text: 'Runbook operasi dan insiden disahkan', crit: true, owner: 'Kepala IT', done: true },
    ] },
    { area: 'Kontak darurat', items: [
      { id: 'c1', text: 'Kontak 24 jam BPJS, TPDI × BTN, SATUSEHAT terverifikasi', crit: true, owner: '' },
      { id: 'c2', text: 'Jadwal jaga TI hypercare 2 minggu', crit: true, owner: 'Kepala IT', done: true },
      { id: 'c3', text: 'Pohon panggilan direksi dan komite', crit: false, owner: 'Direktur', done: true },
    ] },
  ];
  const AUTO_NAME = { simulasi: 'Simulasi end-to-end', backup: 'Cadangan & pemulihan', downtime: 'Mode downtime' };
  const glDone = (L, it) => (L[`c_${it.id}`] !== undefined ? !!L[`c_${it.id}`] : it.auto ? SIM.isDone(it.auto) : !!it.done);
  const glOwner = (L, it) => (L[`o_${it.id}`] !== undefined ? String(L[`o_${it.id}`]) : it.owner || '');
  const glOpenCrit = (L) => GL.flatMap((a) => a.items).filter((it) => it.crit && !(glDone(L, it) && glOwner(L, it)));

  function tourSummary(J) {
    const counts = SIM.PHASES.map((p) => ({ p, n: SIM.log.filter((e) => e.phase === p.n).length }));
    const max = Math.max(1, ...counts.map((c) => c.n));
    const tried = SIM.order.filter((id) => SIM.isDone(id)).length;
    const first = SIM.log[0]; const last = SIM.log[SIM.log.length - 1];
    const rows = counts.map(({ p, n }) => `<div style="display:grid;grid-template-columns:minmax(0,170px) minmax(0,1fr) 40px;gap:10px;align-items:center"><span class="small"><span class="mono muted">F${p.n}</span> ${esc(p.title)}</span>${bar((n / max) * 100, n ? 'brand' : 'muted')}<span class="num small" style="text-align:right">${n}</span></div>`).join('');
    return ui.card({
      title: 'Ringkasan perjalanan', sub: `${SIM.log.length} langkah tercatat${first ? ` · ${first.t}–${last.t}` : ''} · ${tried} dari ${SIM.order.length} layar dicoba · ${Object.keys(J).length} fakta perjalanan`,
      body: `<div class="stack">${rows}
        <div class="row">${['suryo', 'hartono', 'ratna'].map((k) => ui.chip(`${PEOPLE[k].short} · ${PEOPLE[k].scenario}`, 'brand')).join('')}</div>
        <div class="row">${ui.btn('Kembali ke peta fase', { go: 'peta', variant: 'primary', size: 'lg' })}${ui.btn('Lihat jejak alur', { act: '__drawer' })}${ui.btn('Ulang alur dari awal', { act: '__reset', variant: 'ghost' })}</div></div>`,
    });
  }

  SIM.register({
    id: 'golive', phase: 10, title: 'Kesiapan go-live', nav: 'Kesiapan go-live', codes: 'F10 · go-live', role: 'direktur',
    desc: 'Ceklis go-live per area dengan pemilik tiap item. Keputusan go/no-go terkunci sampai semua item kritis selesai dan berpemilik.',
    hint: 'Centang item kritis yang masih terbuka dan beri pemilik, tulis catatan keputusan, lalu putuskan GO. Ringkasan perjalanan muncul sesudahnya.',
    init: { dec: null, note: '' },
    render(L, J) {
      const all = GL.flatMap((a) => a.items);
      const doneN = all.filter((it) => glDone(L, it)).length;
      const open = glOpenCrit(L);
      const areas = GL.map((a) => {
        const ad = a.items.filter((it) => glDone(L, it)).length;
        const body = a.items.map((it) => {
          const d = glDone(L, it); const o = glOwner(L, it);
          const auto = it.auto ? ui.chip(`${AUTO_NAME[it.auto]}: ${SIM.isDone(it.auto) ? 'selesai' : 'belum'}`, SIM.isDone(it.auto) ? 'success' : 'warning') : '';
          return `<div style="display:grid;grid-template-columns:minmax(0,1fr) minmax(150px,200px);gap:10px;align-items:center;padding:6px 0;border-bottom:1px solid var(--line-soft)">
            <div>${ui.check(`c_${it.id}`, d, `${esc(it.text)} ${it.crit ? ui.chip('kritis', 'danger') : ''} ${auto}${d && !o ? ` ${ui.chip('belum ada pemilik', 'warning')}` : ''}`, { html: true })}</div>
            <div>${L.dec ? `<span class="small">${esc(o || '–')}</span>` : ui.select(`o_${it.id}`, o, GL_OWNERS)}</div></div>`;
        }).join('');
        return ui.card({ title: a.area, sub: `${ad}/${a.items.length} selesai`, body });
      }).join('');
      let decision;
      if (L.dec) {
        decision = `${ui.alert(L.dec.kind === 'go' ? 'success' : 'warning', `Keputusan ${L.dec.kind === 'go' ? 'GO' : 'NO-GO'} · ${L.dec.t}`, `${esc(L.dec.note)} — ${esc(STAFF.direktur.name)}`)}
          <div>${ui.btn('Buka kembali keputusan', { act: 'reopen', size: 'sm', variant: 'ghost' })}</div>`;
      } else {
        decision = `${open.length ? ui.alert('warning', `${open.length} item kritis belum selesai atau belum berpemilik`, esc(open.map((it) => it.text).join(' · '))) : ui.alert('success', 'Semua item kritis selesai dan berpemilik', 'Keputusan GO bisa diambil.')}
          ${ui.field('Catatan keputusan (wajib, tercatat)', ui.input('note', L.note, { area: true, placeholder: 'mis. pilot mulai Senin 12 Okt di rawat jalan dan IGD, hypercare 2 minggu' }), 'Minimal 10 huruf')}
          <div class="row">${ui.btn('Putuskan GO', { act: 'decide', arg: 'go', variant: 'primary', size: 'lg', disabled: open.length > 0, reason: `Terkunci: ${open.length} item kritis belum selesai`, needs: 'note:10' })}${ui.btn('Tunda (NO-GO)', { act: 'decide', arg: 'nogo', variant: 'danger', needs: 'note:10' })}</div>`;
      }
      return `<div class="grid g4">${ui.kpi('Item selesai', `${doneN}/${all.length}`, 'semua area')}${ui.kpi('Kritis terbuka', String(open.length), open.length ? 'mengunci keputusan' : 'siap diputuskan', open.length ? 'down' : 'up')}${ui.kpi('Simulasi E2E', SIM.isDone('simulasi') ? 'Lulus' : 'Belum', '3 skenario', SIM.isDone('simulasi') ? 'up' : 'down')}${ui.kpi('Uji restore', SIM.isDone('backup') ? 'Lulus' : 'Belum', 'mesin bersih', SIM.isDone('backup') ? 'up' : 'down')}</div>
        <div class="grid g2" style="align-items:start">${areas}</div>
        ${ui.card({ title: 'Keputusan go / no-go', sub: 'Direktur · disaksikan komite mutu dan Kepala IT', tone: L.dec ? (L.dec.kind === 'go' ? 'success' : 'warning') : '', body: `<div class="stack">${decision}</div>` })}
        ${L.dec ? tourSummary(J) : ''}`;
    },
    actions: {
      decide(L, J, el) {
        const kind = argOf(el) === 'go' ? 'go' : 'nogo';
        const note = String(L.note || '').trim();
        if (note.length < 10) { SIM.toast('Catatan keputusan minimal 10 huruf', 'warning'); return false; }
        if (kind === 'go' && glOpenCrit(L).length) { SIM.toast('Masih ada item kritis terbuka', 'warning'); return false; }
        L.dec = { kind, t: SIM.now(5), note };
        SIM.note(`Direktur memutuskan ${kind === 'go' ? 'GO' : 'NO-GO'} go-live: ${note}`, kind === 'go' ? 'success' : 'warning');
        SIM.done();
        return undefined;
      },
      reopen(L) { L.dec = null; },
    },
  });
})();
