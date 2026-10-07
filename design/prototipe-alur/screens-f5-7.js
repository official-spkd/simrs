/* =====================================================================
 * Layar fase 5–7: Kasir, Klaim & koding, Akuntansi, Pembayaran digital,
 * Pembiayaan BTN, Integrasi. Semua data fiktif; tidak ada backend.
 * Sumber tata letak & data contoh: design/mockups/{Kasir,Klaim,Akuntansi,
 * PembayaranBTN,PembiayaanBTN,Integrasi}.dc.html.
 * ===================================================================== */
(function () {
  'use strict';
  const { ui, PEOPLE, STAFF } = SIM;
  const E = ui.esc;
  const rp = (n) => ui.rupiah(Number(n) || 0);
  const P = PEOPLE.suryo;
  const RATNA = PEOPLE.ratna;
  const HARTONO = PEOPLE.hartono;
  const contoh = () => ui.chip('data contoh', 'info');
  const KASIR = STAFF.kasir.name;
  const SUPERVISOR = 'Rina Oktaviani';
  const MANAJER = 'Dra. Wening Pratiwi';
  const BULAN = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

  /* ---------------- helper bersama ---------------- */
  function kv(k, v, o = {}) {
    const top = o.top ? ';border-top:1px solid var(--line);margin-top:4px;padding-top:8px' : '';
    const tone = o.tone ? `;color:var(--${o.tone})` : '';
    return `<div class="row between" style="padding:3px 0;flex-wrap:nowrap${top}"><span class="small ${o.strong ? '' : 'muted'}">${E(k)}</span><span class="${o.mono === false ? '' : 'num'}" style="text-align:right;font-weight:${o.strong ? 700 : 500}${tone}">${v}</span></div>`;
  }
  function singkat(n) {
    n = Number(n) || 0;
    if (n >= 1e9) return `Rp${(n / 1e9).toFixed(2).replace('.', ',')} M`;
    if (n >= 1e6) return `Rp${(n / 1e6).toFixed(1).replace('.', ',')} jt`;
    return rp(n);
  }
  function plusMenit(t, m) {
    const parts = String(t || '00.00').split('.').map(Number);
    const x = ((((parts[0] || 0) * 60 + (parts[1] || 0) + m) % 1440) + 1440) % 1440;
    return `${String(Math.floor(x / 60)).padStart(2, '0')}.${String(x % 60).padStart(2, '0')}`;
  }
  const angka = (v) => parseInt(String(v ?? '').replace(/\D/g, ''), 10) || 0;
  function ceklis(items) {
    return `<div class="stack" style="gap:8px">${items.map((it) => `<div class="row" style="align-items:flex-start;flex-wrap:nowrap;gap:10px">
      <span class="chip ${it.ok ? 'success' : 'warning'}" style="flex:none;min-width:26px;justify-content:center">${it.ok ? '✓' : '!'}</span>
      <div style="min-width:0;flex:1"><div>${E(it.t)}${it.extra || ''}</div>${it.sub ? `<div class="small muted">${E(it.sub)}</div>` : ''}</div>
      ${it.right ? `<div style="flex:none">${it.right}</div>` : ''}</div>`).join('')}</div>`;
  }
  function stepCaption(t) { return `<div class="small muted">${E(t)}</div>`; }

  /* ---------------- data tagihan ---------------- */
  const SURYO_INV = 'INV-2610-02260';
  const UMUM_INV = 'INV-2610-02261';
  const UMUM = { key: 'lestari', name: 'Ny. Lestari Handayani', short: 'Lestari', rm: '00-52-30-14', jk: 'P', age: 38, dob: '14-03-1988', payer: 'Umum', kelas: '(bayar sendiri)', dokter: 'dr. Sinta Maharani, Sp.KK', allergy: [] };
  const UMUM_LINES = [
    { name: 'Konsultasi dokter spesialis kulit dan kelamin', qty: 1, price: 90000, src: 'Catatan poli (CPPT)' },
    { name: 'Krioterapi kutil, 1 lesi', qty: 1, price: 150000, src: 'Tindakan poli' },
    { name: 'Asam fusidat krim 2% 10 g · oles 2 × sehari', qty: 1, price: 42500, src: 'Resep · farmasi' },
    { name: 'Administrasi rawat jalan', qty: 1, price: 30000, src: 'Pendaftaran' },
  ];
  const UMUM_TOTAL = UMUM_LINES.reduce((a, b) => a + b.price, 0);
  const HARTONO_LINES = [
    { name: 'Paket layanan IGD triase kuning', qty: 1, price: 1580000, src: 'IGD' },
    { name: 'Kamar kelas 1 Ruang Melati · per malam', qty: 1, price: 750000, src: 'Rawat inap (ADT)' },
    { name: 'Seftriakson 1 g injeksi', qty: 2, price: 170000, src: 'eMAR' },
    { name: 'Foto toraks PA', qty: 1, price: 240000, src: 'Order radiologi (CPOE)' },
    { name: 'Darah lengkap, ureum, kreatinin', qty: 1, price: 205000, src: 'Order lab (CPOE)' },
  ];
  const DEF_ORDERS = [
    { kind: 'lab', code: 'HBA1C', name: 'HbA1c', price: 95000 },
    { kind: 'lab', code: 'GDP', name: 'Gula darah puasa', price: 25000 },
  ];
  const DEF_RX = [
    { name: 'Metformin 500 mg', sig: '2 × 1 sesudah makan', qty: 60, price: 18000 },
    { name: 'Glimepirid 2 mg', sig: '1 × 1 pagi', qty: 30, price: 22000 },
  ];
  const CBG = { code: 'Q-5-44-0', name: 'Penyakit kronis kecil lain-lain', tariff: 213800 };

  /** Rincian tagihan Suryo: dari J.bill bila sudah final, bila belum dirakit dari J.orders/J.rx + konsultasi.
   *  `price` = nilai baris (bukan harga satuan); total = jumlah nilai baris. */
  function suryoBill(J) {
    if (J.bill && J.bill.patient === 'suryo' && Array.isArray(J.bill.items)) {
      const items = J.bill.items.map((it) => ({ name: it.name || 'Item', qty: Number(it.qty) || 1, price: Number(it.price) || 0, src: it.src || 'Tagihan final' }));
      return { items, total: items.reduce((a, b) => a + b.price, 0), sample: false, inv: J.bill.inv || SURYO_INV };
    }
    const sampleO = !(Array.isArray(J.orders) && J.orders.length);
    const sampleR = !(Array.isArray(J.rx) && J.rx.length);
    const items = [{ name: 'Konsultasi dokter spesialis penyakit dalam', qty: 1, price: 85000, src: 'Catatan poli (CPPT)', sample: !J.soap }];
    (sampleO ? DEF_ORDERS : J.orders).forEach((o) => items.push({
      name: `${o.kind === 'rad' ? 'Radiologi' : 'Laboratorium'}: ${o.name || o.code || 'pemeriksaan'}`,
      qty: 1, price: Number(o.price) || 0, src: o.kind === 'rad' ? 'Order radiologi (CPOE)' : 'Order lab (CPOE)', sample: sampleO,
    }));
    (sampleR ? DEF_RX : J.rx).forEach((r) => items.push({
      name: `${r.name || 'Obat'}${r.sig ? ` · ${r.sig}` : ''}`, qty: Number(r.qty) || 1, price: Number(r.price) || 0, src: 'Resep (CPOE) · farmasi', sample: sampleR,
    }));
    return { items, total: items.reduce((a, b) => a + b.price, 0), sample: sampleO || sampleR, inv: SURYO_INV };
  }
  function itemTable(items, total, label = 'Total tarif RS') {
    const rows = items.map((it) => [`${E(it.name)}${it.sample ? ` ${contoh()}` : ''}`, `<span class="small muted">${E(it.src || '')}</span>`, `<span class="num">${E(it.qty)}</span>`, rp(it.price)]);
    rows.push([`<b>${E(label)}</b>`, '', '', `<b>${rp(total)}</b>`]);
    return ui.table(['Item', 'Sumber', 'Jml', { label: 'Nilai', r: true }], rows);
  }
  function suryoTotal(J) { return J.bill && J.bill.patient === 'suryo' ? Number(J.bill.total) || suryoBill(J).total : suryoBill(J).total; }

  /* =====================================================================
   * F5 · KASIR
   * ===================================================================== */
  SIM.register({
    id: 'kasir',
    phase: 5,
    title: 'Kasir',
    codes: 'U02 · U03 · U04 · U09',
    role: 'kasir',
    desc: 'Tagihan terbentuk otomatis dari layanan klinis. Kasir memfinalisasi, menerima pembayaran, menerbitkan kuitansi, dan menutup shift.',
    hint: 'Pilih Suryo dan finalisasi tagihan Rp0 (BPJS), lalu layani pasien umum: pilih metode, bayar, kuitansi, dan tutup shift.',
    init: {
      sel: 'suryo', shift: '', shiftAt: '', saldoAwal: 500000, tunai: 0, closing: '', hitung: '', shiftReason: '', shiftErr: '', shiftClosedAt: '', setor: 0,
      sInv: '', sAt: '', sDone: '',
      uInv: '', uAt: '', method: 'Tunai', cash: '', err: '', va: '', vaAt: '', sent: '', pay: null, kwSeq: 418,
      voidSt: '', voidReason: '', voidReqAt: '', lastVoid: null,
    },
    onEnter(L, J) {
      // Sinkron bila tagihan umum dilunasi lewat layar Pembayaran digital.
      if (J.payment && J.payment.inv === UMUM_INV && J.payment.status === 'paid' && !L.pay) {
        L.uInv = L.uInv || UMUM_INV;
        L.uAt = L.uAt || J.payment.t || SIM.time();
        L.pay = { method: J.payment.method, amount: J.payment.amount, ref: J.payment.ref, kw: J.payment.kw || `KW-2610-00${L.kwSeq}`, at: J.payment.t || SIM.time(), hook: true };
        L.sent = '';
      }
    },
    headActions(L) {
      if (L.shift === 'open') return ui.btn('Tutup shift', { act: 'formTutup' });
      if (L.shift === 'closed') return ui.btn('Buka shift baru', { act: 'bukaShift' });
      return ui.btn('Buka shift', { act: 'bukaShift', variant: 'primary' });
    },
    render(L, J) {
      const sb = suryoBill(J);
      const shiftChip = L.shift === 'open' ? ui.chip(`Shift pagi dibuka ${L.shiftAt}`, 'success') : L.shift === 'closed' ? ui.chip(`Shift ditutup ${L.shiftClosedAt}`, '') : ui.chip('Shift belum dibuka', 'warning');
      const shiftBar = `<div class="row between card" style="padding:10px 16px"><div class="row">${shiftChip}<span class="small muted">Loket kasir RJ-01 · ${E(KASIR)} · saldo awal ${rp(L.saldoAwal)}</span></div>
        <span class="small muted">Tunai diterima shift ini: <b class="num">${rp(L.tunai)}</b></span></div>`;

      const sTag = L.sDone ? ui.chip('Selesai · Rp0', 'success') : L.sInv ? ui.chip('Final', 'brand') : ui.chip('Siap tagih', 'warning');
      const uTag = L.pay ? ui.chip('Lunas', 'success') : L.sent ? ui.chip('Menunggu QRIS', 'info') : L.uInv ? ui.chip('Belum bayar', 'warning') : ui.chip('Siap tagih', 'warning');
      const list = ui.list([
        { arg: 'suryo', sel: L.sel === 'suryo', title: P.name, sub: `K-014 · rawat jalan · ${P.poli} · BPJS`, right: sTag },
        { arg: 'lestari', sel: L.sel === 'lestari', title: UMUM.name, sub: 'K-015 · rawat jalan · Poli Kulit dan Kelamin · Umum', right: uTag },
        { arg: 'hartono', sel: L.sel === 'hartono', title: HARTONO.name, sub: 'Rawat inap · Ruang Melati · BPJS', right: ui.chip('Berjalan', '') },
      ], 'pilih');

      let close = '';
      if (L.closing && L.shift === 'open') {
        const expect = L.saldoAwal + L.tunai;
        const counted = angka(L.hitung);
        close = ui.card({
          title: 'Tutup shift kasir', sub: 'setoran wajib cocok dengan catatan sistem', tone: 'warning',
          body: `<div class="stack">${kv('Saldo awal (modal laci)', rp(L.saldoAwal))}${kv('Tunai diterima', rp(L.tunai))}${kv('QRIS / VA (langsung ke BTN ••••4417)', rp(L.pay && L.pay.method !== 'Tunai' ? L.pay.amount : 0))}
            ${kv('Seharusnya di laci', rp(expect), { strong: true, top: true })}
            ${ui.field('Uang fisik dihitung (Rp)', ui.input('hitung', L.hitung, { placeholder: 'contoh 812500', mono: true, inputmode: 'numeric' }), 'Hitung uang di laci, lalu ketik jumlahnya.')}
            <div class="row">${ui.btn('Isi sesuai hitungan fisik', { act: 'isiHitung', size: 'sm' })}${L.hitung ? `<span class="small muted">terisi ${rp(counted)}</span>` : ''}</div>
            ${L.shiftErr ? ui.alert('warning', 'Setoran belum cocok', E(L.shiftErr)) : ''}
            ${L.shiftErr && L.shiftErr.startsWith('Selisih') ? ui.field('Alasan selisih (wajib, dibaca supervisor)', ui.input('shiftReason', L.shiftReason, { area: true, placeholder: 'Minimal 10 huruf' })) : ''}
            <div class="row">${ui.btn('Tutup shift & setor ke BTN', { act: 'tutupShift', variant: 'primary' })}${ui.btn('Batal', { set: 'closing=', variant: 'ghost' })}</div></div>`,
        });
      }
      const closedNote = L.shift === 'closed' ? ui.alert('success', `Shift ditutup ${L.shiftClosedAt} · setoran cocok`, `Setoran tunai ${rp(L.setor)} disetor ke BTN ••••4417 (slip SET-2610-0031). Jurnal kas → bank terbentuk otomatis.`) : '';
      const left = `<div class="stack">${ui.card({ title: 'Antrean tagihan', sub: 'loket K · hari ini', flush: true, body: list })}${close}${closedNote}</div>`;

      let right = '';
      if (L.sel === 'suryo') right = this.suryo(L, J, sb);
      else if (L.sel === 'lestari') right = this.umum(L, J);
      else right = this.hartono();
      return shiftBar + ui.split(left, right);
    },

    suryo(L, J, sb) {
      const idx = L.sDone ? 4 : L.sInv ? 3 : 2;
      const sep = J.sep ? J.sep.no : '0901R0011025V000123';
      const body = `${ui.banner(P, `${ui.chip(`SEP ${sep}`, 'brand')}${J.sep ? '' : contoh()}`)}
        ${ui.steps(['Rincian', 'Penjamin', 'Final', 'Selesai'], idx)}
        ${ui.card({ title: 'Rincian tagihan', sub: `${sb.inv} · charge capture otomatis dari order, resep, dan catatan poli`, flush: true, body: itemTable(sb.items, sb.total) })}
        ${ui.alert('info', 'Kasir tidak menambah item manual', 'Semua baris berasal dari layanan yang tercatat. Koreksi diajukan ke unit asal dengan alasan dan tercatat di audit.')}
        ${ui.card({ title: 'Pembagian penjamin', sub: `BPJS Kesehatan · hak ${E(P.kelas)}`, html: true, body: `${kv('Total tarif RS', rp(sb.total))}${kv('Ditanggung BPJS (dicatat sebagai piutang BPJS)', rp(sb.total), { tone: 'success' })}${kv('Selisih naik kelas', rp(0))}${kv('Dibayar pasien', rp(0), { strong: true, top: true })}
          <div class="small muted" style="margin-top:6px">Selisih antara tarif RS dan tarif INA-CBG diselesaikan di Klaim & koding; tagihan pasien tetap Rp0.</div>` })}
        ${!L.sInv ? `<div class="row">${ui.btn('Finalisasi tagihan', { act: 'finalSuryo', variant: 'primary', size: 'lg' })}<span class="small muted">Baris tagihan dibekukan dan nomor tagihan terbit.</span></div>` : ''}
        ${L.sInv ? ui.alert('success', `Tagihan final ${L.sInv} · ${L.sAt}`, `Pasien membayar ${rp(0)}. ${rp(sb.total)} masuk piutang BPJS dan jurnal pengakuan pendapatan terbentuk otomatis.`) : ''}
        ${L.sInv && !L.sDone ? `<div class="row">${ui.btn('Tutup kunjungan · sisa Rp0', { act: 'tutupSuryo', variant: 'primary' })}${ui.btn('Cetak rincian untuk pasien', { act: 'cetak', arg: 'rincian' })}</div>` : ''}
        ${L.sDone ? ui.next('pembayaran', `Kunjungan Suryo ditutup ${L.sDone}: Rp0 untuk pasien, piutang BPJS tercatat. Berikutnya pembayaran digital pasien umum.`) : ''}`;
      return `<div class="stack">${body}</div>`;
    },

    umum(L) {
      const idx = L.pay ? 4 : L.uInv ? 2 : 0;
      let pay = '';
      if (!L.uInv) {
        pay = `<div class="row">${ui.btn('Finalisasi tagihan', { act: 'finalUmum', variant: 'primary', size: 'lg' })}<span class="small muted">Setelah final, pilih metode pembayaran.</span></div>`;
      } else if (!L.pay) {
        if (L.shift !== 'open') {
          pay = ui.card({ title: 'Pembayaran', tone: 'warning', body: `<div class="stack">${ui.alert('warning', 'Shift kasir belum dibuka', 'Pembayaran hanya bisa diterima dalam shift yang terbuka agar setoran bisa dicocokkan.')}<div>${ui.btn('Buka shift sekarang', { act: 'bukaShift', variant: 'primary' })}</div></div>` });
        } else if (L.sent) {
          pay = ui.card({ title: 'Pembayaran', sub: `QRIS dibuat ${L.sent}`, body: `<div class="stack">${ui.alert('info', 'Menunggu pembayaran QRIS', 'Tagihan sudah diteruskan ke layar Pembayaran digital. Status lunas masuk otomatis lewat webhook TPDI.')}
            <div class="row">${ui.btn('Buka Pembayaran digital →', { go: 'pembayaran', variant: 'primary' })}${ui.btn('Batalkan QRIS, pilih metode lain', { act: 'batalQris', variant: 'ghost' })}</div></div>` });
        } else {
          let inner = '';
          if (L.method === 'Tunai') {
            const got = angka(L.cash);
            const kembali = got >= UMUM_TOTAL ? kv('Kembalian', rp(got - UMUM_TOTAL), { tone: 'success', strong: true }) : got ? kv('Kurang', rp(UMUM_TOTAL - got), { tone: 'danger', strong: true }) : kv('Kembalian', '—');
            inner = `${ui.field('Uang diterima (Rp)', ui.input('cash', L.cash, { placeholder: 'ketik nominal', mono: true, inputmode: 'numeric' }), 'Atau pilih nominal cepat di bawah.')}
              <div class="row">${ui.btn('Uang pas', { act: 'cashSet', arg: 'pas', size: 'sm' })}${ui.btn('Rp350.000', { act: 'cashSet', arg: '350000', size: 'sm' })}${ui.btn('Rp500.000', { act: 'cashSet', arg: '500000', size: 'sm' })}</div>
              ${kembali}${L.err ? ui.alert('warning', 'Belum bisa diterima', E(L.err)) : ''}
              <div>${ui.btn('Terima pembayaran tunai', { act: 'bayarTunai', variant: 'primary' })}</div>`;
          } else if (L.method === 'QRIS') {
            inner = `<p class="small muted" style="margin:0">QRIS dinamis diterbitkan lewat TPDI (acquirer BTN), berlaku 10 menit. Dana langsung masuk rekening operasional RS BTN ••••4417.</p>
              <div>${ui.btn('Buat QRIS lewat TPDI →', { act: 'keQris', variant: 'primary' })}</div>`;
          } else {
            inner = L.va
              ? `${kv('Nomor VA BTN', `<b>${E(L.va)}</b>`)}${kv('Nominal (closed amount)', rp(UMUM_TOTAL))}${kv('Berlaku sampai', `besok ${E(L.vaAt)}`)}
                <div class="small muted">Nomor VA dikirim ke WhatsApp pasien. Lunas otomatis saat webhook TPDI masuk dengan tanda tangan valid.</div>
                <div>${ui.btn('Simulasi: pasien transfer ke VA', { act: 'bayarVa', variant: 'primary' })}</div>`
              : `<p class="small muted" style="margin:0">VA BTN diterbitkan lewat TPDI, berlaku 24 jam, nominal tetap.</p><div>${ui.btn('Terbitkan VA BTN', { act: 'buatVa', variant: 'primary' })}</div>`;
          }
          pay = ui.card({ title: 'Pilih metode pembayaran', sub: `${UMUM_INV} · ${rp(UMUM_TOTAL)}`, body: `<div class="stack">${ui.seg('method', L.method, ['Tunai', 'QRIS', 'VA BTN'])}${inner}</div>` });
        }
      } else {
        const p = L.pay;
        let voidPart = '';
        if (L.voidSt === 'form') {
          voidPart = `<div class="stack">${ui.field('Alasan pembatalan (wajib)', ui.input('voidReason', L.voidReason, { area: true, placeholder: 'Contoh: pasien membayar dua kali di loket berbeda' }))}
            <div class="row">${ui.btn('Ajukan pembatalan ke supervisor', { act: 'ajukanVoid', variant: 'danger', needs: 'voidReason:10' })}${ui.btn('Batal', { set: 'voidSt=', variant: 'ghost' })}</div></div>`;
        } else if (L.voidSt === 'requested') {
          voidPart = ui.gate({
            title: `Pembatalan ${p.kw} menunggu persetujuan supervisor`,
            body: `Diajukan ${E(L.voidReqAt)} oleh ${E(KASIR)}: “${E(L.voidReason)}”. Kasir tidak bisa menyetujui pembatalannya sendiri.`,
          }) + `<div class="row">${ui.btn('Setujui (Anda)', { disabled: true, reason: 'Pengaju tidak boleh menyetujui pembatalan sendiri.' })}${ui.btn(`Simulasi: supervisor ${SUPERVISOR} menyetujui`, { act: 'setujuiVoid', variant: 'primary' })}${ui.btn('Supervisor menolak', { act: 'tolakVoid', variant: 'ghost' })}</div>`;
        } else {
          voidPart = `<div class="row">${ui.btn('Cetak kuitansi', { act: 'cetak', arg: 'kuitansi' })}${ui.btn('Batalkan pembayaran…', { set: 'voidSt=form', variant: 'ghost' })}</div>`;
        }
        pay = ui.card({
          title: `Kuitansi ${p.kw}`, sub: `lunas ${p.at} · ${p.method}`, tone: 'success', html: true,
          body: `<div class="stack">${kv('Pasien', E(UMUM.name), { mono: false })}${kv('Tagihan', E(UMUM_INV))}${kv('Metode', E(p.method), { mono: false })}${kv('Referensi', E(p.ref))}
            ${p.method === 'Tunai' ? `${kv('Uang diterima', rp(p.recv))}${kv('Kembalian', rp(p.change))}` : kv('Bukti', p.hook ? 'webhook TPDI · tanda tangan valid' : '—', { mono: false })}
            ${kv('Jumlah dibayar', rp(p.amount), { strong: true, top: true })}
            <div class="small muted">Diterima oleh ${E(KASIR)} · jurnal ${p.method === 'Tunai' ? 'Kas loket' : 'Bank BTN ••••4417'} (D) / Pendapatan rawat jalan umum (K) terbentuk otomatis.</div>${voidPart}</div>`,
        });
      }
      const lastVoid = L.lastVoid ? ui.alert('warning', `Pembayaran ${L.lastVoid.kw} dibatalkan · ${L.lastVoid.at}`, `Disetujui supervisor ${E(SUPERVISOR)}. Jurnal balik terbentuk dan tagihan terbuka kembali.${L.lastVoid.method !== 'Tunai' ? ' Dana non-tunai dikembalikan lewat refund dua tingkat di Pembayaran digital.' : ''}`) : '';
      return `<div class="stack">${ui.banner(UMUM, ui.chip('K-015', 'brand'))}
        ${ui.steps(['Rincian', 'Final', 'Pilih metode', 'Bayar', 'Kuitansi'], idx)}
        ${ui.card({ title: 'Rincian tagihan', sub: `${UMUM_INV} · charge capture otomatis`, flush: true, body: itemTable(UMUM_LINES, UMUM_TOTAL) })}
        ${L.uInv ? ui.alert('success', `Tagihan final ${L.uInv} · ${L.uAt}`, `Penjamin umum: seluruh ${rp(UMUM_TOTAL)} dibayar pasien.`) : ''}
        ${lastVoid}${pay}
        ${L.pay ? ui.next('pembayaran', `Pembayaran ${L.pay.method} ${rp(L.pay.amount)} diterima, kuitansi ${L.pay.kw} terbit.`) : ''}</div>`;
    },

    hartono() {
      const total = HARTONO_LINES.reduce((a, b) => a + b.price, 0);
      return `<div class="stack">${ui.banner(HARTONO, ui.chip('Melati 3-02', 'brand'))}
        ${ui.alert('info', 'Tagihan rawat inap masih berjalan', 'Baris baru masuk otomatis setiap ada layanan (kamar, eMAR, lab, radiologi). Finalisasi setelah pasien pulang.')}
        ${ui.card({ title: 'Tagihan berjalan', sub: 'diperbarui otomatis', flush: true, body: itemTable(HARTONO_LINES, total, 'Subtotal sementara') })}
        <div>${ui.btn('Finalisasi tagihan', { disabled: true, reason: 'Pasien belum pulang; tagihan difinalisasi setelah resume medis ditandatangani DPJP.' })}</div></div>`;
    },

    actions: {
      pilih(L, J, el) { const a = el.dataset.arg; if (['suryo', 'lestari', 'hartono'].includes(a)) L.sel = a; },
      bukaShift(L) {
        if (L.shift === 'open') return;
        L.shift = 'open'; L.shiftAt = SIM.now(1); L.tunai = 0; L.closing = ''; L.shiftErr = ''; L.hitung = ''; L.shiftReason = '';
        SIM.note(`Shift kasir dibuka dengan saldo awal ${rp(L.saldoAwal)}`);
      },
      finalSuryo(L, J) {
        if (L.sInv) return;
        const sb = suryoBill(J);
        const t = SIM.now();
        L.sInv = SURYO_INV; L.sAt = t;
        J.bill = { patient: 'suryo', inv: SURYO_INV, items: sb.items.map((it) => ({ name: it.name, qty: it.qty, price: it.price, src: it.src })), total: sb.total, payer: 'BPJS', t };
        SIM.note(`Tagihan Suryo final: pasien Rp0, ${rp(sb.total)} dicatat sebagai piutang BPJS`, 'success');
      },
      tutupSuryo(L) {
        if (!L.sInv || L.sDone) { SIM.toast('Finalisasi tagihan dulu.', 'warning'); return; }
        L.sDone = SIM.now(1);
        SIM.done();
        SIM.note('Kunjungan rawat jalan Suryo ditutup di kasir (sisa Rp0)');
      },
      cetak(L, J, el) { SIM.toast(el.dataset.arg === 'rincian' ? 'Rincian tagihan dikirim ke printer kasir.' : 'Kuitansi dicetak (80 mm) dan tercatat di audit.', 'success'); return false; },
      finalUmum(L) {
        if (L.uInv) return;
        L.uInv = UMUM_INV; L.uAt = SIM.now();
        SIM.note(`Tagihan pasien umum ${UMUM_INV} final ${rp(UMUM_TOTAL)}`);
      },
      cashSet(L, J, el) { const a = el.dataset.arg; L.cash = a === 'pas' || !a ? String(UMUM_TOTAL) : String(angka(a)); L.err = ''; },
      bayarTunai(L, J) {
        if (L.shift !== 'open' || !L.uInv || L.pay) return;
        const got = angka(L.cash);
        if (got < UMUM_TOTAL) { L.err = got ? `Uang diterima kurang ${rp(UMUM_TOTAL - got)}.` : 'Isi jumlah uang yang diterima.'; return; }
        const t = SIM.now();
        const kw = `KW-2610-00${L.kwSeq++}`;
        L.pay = { method: 'Tunai', amount: UMUM_TOTAL, recv: got, change: got - UMUM_TOTAL, ref: kw, kw, at: t };
        L.tunai += UMUM_TOTAL; L.err = '';
        J.payment = { method: 'Tunai', amount: UMUM_TOTAL, ref: kw, status: 'paid', inv: UMUM_INV, kw, t };
        SIM.note(`Pembayaran tunai ${rp(UMUM_TOTAL)} diterima, kuitansi ${kw} terbit`, 'success');
      },
      keQris(L, J, el, S) {
        if (!L.uInv || L.pay || L.shift !== 'open') { SIM.toast('Finalisasi tagihan dan buka shift dulu.', 'warning'); return; }
        const PB = S.local('pembayaran');
        if (!PB.handoff || PB.handoff.inv !== UMUM_INV) { PB.inv = null; PB.paidAt = ''; PB.events = []; PB.dup = 0; }
        PB.handoff = { who: UMUM.name, rm: UMUM.rm, inv: UMUM_INV, amount: UMUM_TOTAL, note: 'Rawat jalan Poli Kulit dan Kelamin' };
        PB.ch = 'QRIS'; PB.tab = 'tagihan';
        L.sent = SIM.now(1);
        SIM.note('Tagihan Lestari diteruskan ke pembayaran QRIS lewat TPDI');
        S.go('pembayaran');
        return false;
      },
      batalQris(L, J, el, S) {
        L.sent = '';
        const PB = S.local('pembayaran');
        if (PB.handoff && PB.handoff.inv === UMUM_INV && !PB.paidAt) { PB.handoff = null; PB.inv = null; }
        SIM.toast('QRIS dibatalkan; tagihan TPDI dikedaluwarsakan.', '');
      },
      buatVa(L) {
        if (L.va || !L.uInv) return;
        L.va = '8808 0127 0226 1001'; L.vaAt = SIM.now(1);
        SIM.note('VA BTN untuk tagihan Lestari diterbitkan lewat TPDI');
      },
      bayarVa(L, J) {
        if (!L.va || L.pay) return;
        const t = SIM.now(3);
        const kw = `KW-2610-00${L.kwSeq++}`;
        L.pay = { method: 'VA BTN', amount: UMUM_TOTAL, ref: 'TPDI-TX-2610-004452', kw, at: t, hook: true };
        J.payment = { method: 'VA BTN', amount: UMUM_TOTAL, ref: 'TPDI-TX-2610-004452', status: 'paid', inv: UMUM_INV, kw, t };
        SIM.note('Webhook TPDI masuk (tanda tangan valid): VA BTN Lestari lunas otomatis', 'success');
      },
      ajukanVoid(L) {
        if (!L.pay) return;
        if (String(L.voidReason || '').trim().length < 10) { SIM.toast('Tulis alasan minimal 10 huruf.', 'warning'); return; }
        L.voidSt = 'requested'; L.voidReqAt = SIM.now(1);
        SIM.note(`Pembatalan ${L.pay.kw} diajukan ke supervisor`, 'warning');
      },
      setujuiVoid(L, J) {
        if (L.voidSt !== 'requested' || !L.pay) return;
        const p = L.pay;
        if (p.method === 'Tunai') L.tunai = Math.max(0, L.tunai - p.amount);
        L.lastVoid = { kw: p.kw, at: SIM.now(2), method: p.method };
        if (J.payment && J.payment.inv === UMUM_INV) J.payment = Object.assign({}, J.payment, { status: 'void' });
        L.pay = null; L.voidSt = ''; L.voidReason = ''; L.va = ''; L.cash = ''; L.sent = '';
        SIM.note(`Pembatalan ${p.kw} disetujui supervisor; jurnal balik terbentuk`, 'warning');
      },
      tolakVoid(L) { if (L.voidSt !== 'requested') return; L.voidSt = ''; SIM.toast('Supervisor menolak pembatalan. Kuitansi tetap berlaku.', 'warning'); },
      formTutup(L) { if (L.shift !== 'open') return; L.closing = '1'; L.shiftErr = ''; },
      isiHitung(L) { L.hitung = String(L.saldoAwal + L.tunai); L.shiftErr = ''; },
      tutupShift(L) {
        if (L.shift !== 'open') return;
        const expect = L.saldoAwal + L.tunai;
        if (!String(L.hitung || '').trim()) { L.shiftErr = 'Isi jumlah uang fisik yang dihitung.'; return; }
        const counted = angka(L.hitung);
        const diff = counted - expect;
        if (diff !== 0 && String(L.shiftReason || '').trim().length < 10) {
          L.shiftErr = `Selisih ${diff > 0 ? 'lebih' : 'kurang'} ${rp(Math.abs(diff))} dari catatan sistem. Hitung ulang, atau tulis alasan minimal 10 huruf.`;
          return;
        }
        L.shift = 'closed'; L.shiftClosedAt = SIM.now(3); L.setor = Math.max(0, counted - L.saldoAwal); L.closing = ''; L.shiftErr = '';
        SIM.note(diff === 0 ? `Shift kasir ditutup; setoran ${rp(L.setor)} cocok dan disetor ke BTN` : `Shift kasir ditutup dengan selisih ${rp(diff)} beralasan`, diff === 0 ? 'success' : 'warning');
      },
    },
  });

  /* =====================================================================
   * F5 · KLAIM & KODING
   * ===================================================================== */
  const PENDING_DOCS = [
    { k: 'awal', t: 'Berkas klaim awal (sudah terkirim)', how: 'terkirim 14 Sep' },
    { k: 'ct', t: 'Ekspertise CT kepala', how: 'ditarik dari RIS · ber-TTE dr. Rudi, Sp.Rad' },
    { k: 'jawab', t: 'Jawaban tertulis atas pertanyaan verifikator', how: 'disusun koder' },
    { k: 'koord', t: 'Persetujuan koordinator casemix', how: 'disetujui dr. Irma, koordinator casemix' },
  ];
  SIM.register({
    id: 'klaim',
    phase: 5,
    title: 'Klaim & koding',
    nav: 'Klaim & koding',
    codes: 'U05 · U06',
    role: 'koder',
    desc: 'Worklist berkas klaim JKN: cek kelengkapan, validasi kode ICD-10/ICD-9-CM, grouping INA-CBG, final, kirim ke E-Klaim, dan pantau status.',
    hint: 'Buka berkas Suryo: validasi koding, jalankan grouper, final, lalu kirim ke E-Klaim. Coba juga berkas pending Tn. Darmawan.',
    init: { filter: 'koding', sel: 'suryo', sepFix: false, codesOk: '', grouped: '', finalAt: '', sentAt: '', st: '', stT: {}, pd: { awal: '14 Sep' }, pdSent: '', pdLayak: '' },
    render(L, J) {
      const kpi = `<div class="grid g4">${ui.kpi('Klaim bulan ini', '1.284', 'RJ 1.031 · RI 253')}${ui.kpi('Nilai diajukan', 'Rp6,9 M', 'periode berjalan')}${ui.kpi('Rata-rata koding', '1,8 hari', 'setelah pasien pulang', 'up')}${ui.kpi('Pending verifikator', '12', 'Rp184 jt tertahan', 'down')}</div>`;
      const sTag = L.st === 'paid' ? ui.chip('Dibayar', 'success') : L.st === 'layak' ? ui.chip('Layak bayar', 'success') : L.sentAt ? ui.chip('Terkirim', 'info') : L.grouped ? ui.chip('Ter-grouping', 'brand') : ui.chip('Siap koding', 'success');
      const dTag = L.pdLayak ? ui.chip('Layak bayar', 'success') : L.pdSent ? ui.chip('Tanggapan terkirim', 'info') : ui.chip('Kurang lampiran', 'warning');
      const groups = {
        koding: [
          { arg: 'suryo', title: 'Tn. Suryo A. N.', sub: 'RJ · DM tipe 2 · pulang H-0', right: sTag },
          { arg: 'ratna', title: 'Ny. Ratna Sari', sub: 'RI · kolesistektomi laparoskopik', right: ui.chip('Tunggu resume TTE', '') },
          { arg: 'rahmat', title: 'Tn. Rahmat', sub: 'RJ · hemodialisis', right: ui.chip('Siap koding', 'success') },
        ],
        pending: [
          { arg: 'darmawan', title: 'Tn. Darmawan', sub: 'RI · stroke iskemik · 22 hari', right: dTag },
          { arg: 'siti', title: 'Ny. Siti A.', sub: 'RI · syok sepsis · 31 hari', right: ui.chip('Konfirmasi koding', 'warning') },
        ],
      };
      const items = (groups[L.filter] || groups.koding).map((it) => Object.assign({}, it, { sel: it.arg === L.sel }));
      const left = ui.card({
        title: 'Worklist berkas', sub: 'urut menurut tanggal pulang', flush: true,
        body: `<div style="padding:8px 12px 0">${ui.tabs('filter', L.filter, [{ value: 'koding', label: 'Perlu koding 46' }, { value: 'pending', label: 'Pending BPJS 12' }])}</div>${ui.list(items, 'pilih')}`,
      });
      let right;
      if (L.sel === 'suryo') right = this.suryo(L, J);
      else if (L.sel === 'darmawan') right = this.darmawan(L);
      else right = ui.card({ title: 'Berkas contoh', body: `<div class="stack">${ui.alert('info', 'Berkas ini hanya pajangan worklist', 'Coba alur lengkap di berkas Tn. Suryo (perlu koding) atau Tn. Darmawan (pending BPJS).')}<div class="row">${ui.btn('Buka berkas Suryo', { act: 'pilih', arg: 'suryo' })}${ui.btn('Buka berkas Darmawan', { act: 'pilih', arg: 'darmawan' })}</div></div>` });
      return kpi + ui.split(left, right);
    },

    suryo(L, J) {
      const total = suryoTotal(J);
      const sepPending = J.sep && J.sep.status === 'pending' && !L.sepFix;
      const docs = [
        { ok: !sepPending, t: `SEP ${J.sep ? J.sep.no : '0901R0011025V000123'}`, sub: sepPending ? 'status SEP masih menunggu di VClaim' : 'terbit saat pendaftaran', extra: J.sep ? '' : ` ${contoh()}`, right: sepPending ? ui.btn('Tarik ulang status dari VClaim', { act: 'sepFix', size: 'sm' }) : '' },
        { ok: true, t: 'Catatan poli (SOAP) ber-TTE DPJP', sub: P.dokter, extra: J.soap ? '' : ` ${contoh()}` },
        { ok: true, t: 'Hasil laboratorium (HbA1c, gula darah puasa)', sub: J.labResult && J.labResult.validatedAt ? `tervalidasi ${J.labResult.validatedAt}` : 'tervalidasi analis', extra: J.labResult ? '' : ` ${contoh()}` },
        { ok: true, t: `Billing final ${J.bill ? J.bill.inv || SURYO_INV : SURYO_INV}`, sub: `tarif RS ${rp(total)}`, extra: J.bill ? '' : ` ${contoh()}` },
        { ok: true, t: 'Resep dan penyerahan obat', sub: J.dispensed && J.dispensed.t ? `diserahkan ${J.dispensed.t}` : 'diserahkan farmasi', extra: J.dispensed ? '' : ` ${contoh()}` },
      ];
      const lengkap = docs.every((d) => d.ok);
      const idx = L.sentAt ? 5 : L.finalAt ? 4 : L.grouped ? 3 : L.codesOk ? 2 : 1;
      const locked = !!L.finalAt;
      const dx = ui.table(['Kode', 'Uraian', 'Peran'], [
        ['<b class="mono">E11.9</b>', 'Diabetes melitus tipe 2 tanpa komplikasi', ui.chip('utama', 'brand')],
        ['<b class="mono">R03.0</b>', 'Tekanan darah tinggi tanpa diagnosis hipertensi (TD 148/92)', ui.chip('sekunder', '')],
      ]);
      const px = ui.table(['Kode', 'Prosedur ICD-9-CM'], [
        ['<b class="mono">89.03</b>', 'Wawancara dan evaluasi menyeluruh'],
        ['<b class="mono">90.59</b>', 'Pemeriksaan darah lain (HbA1c, gula darah puasa)'],
      ]);
      const diff = CBG.tariff - total;
      const grouping = L.grouped
        ? `${kv('Kode CBG', `<b>${CBG.code}</b>`)}${kv('Deskripsi', E(CBG.name), { mono: false })}${kv('Tarif INA-CBG rawat jalan', rp(CBG.tariff))}${kv('Tarif RS (billing)', rp(total))}${kv(diff < 0 ? 'Selisih (RS lebih tinggi)' : 'Selisih (margin positif)', rp(Math.abs(diff)), { tone: diff < 0 ? 'warning' : 'success', strong: true, top: true })}
           <div class="small muted">Grouper INA-CBG v5 (simulasi) · ${E(L.grouped)} · special CMG: tidak ada</div>`
        : `<div class="stack"><span class="small muted">Grouper menghitung kode CBG dan tarif dari diagnosis, prosedur, dan jenis rawat.</span><div>${ui.btn('Jalankan grouper INA-CBG', { act: 'group', variant: 'primary', disabled: !L.codesOk, reason: 'Validasi koding dulu.' })}</div></div>`;
      let send = '';
      if (!L.finalAt) {
        const why = !lengkap ? 'Berkas belum lengkap: SEP belum terbit.' : 'Jalankan grouper dulu.';
        send = `<div class="row">${ui.btn('Final klaim', { act: 'final', variant: 'primary', disabled: !(lengkap && L.grouped), reason: why })}<span class="small muted">Final mengunci koding dan berkas.</span></div>`;
      } else if (!L.sentAt) {
        send = `${ui.alert('success', `Klaim final ${L.finalAt}`, 'Koding dan berkas terkunci. Siap dikirim ke E-Klaim.')}<div>${ui.btn('Kirim ke E-Klaim', { act: 'kirim', variant: 'primary' })}</div>`;
      } else {
        const T = L.stT || {};
        const nextBtn = L.st === 'sent' ? ui.btn('Simulasi: verifikator BPJS memeriksa', { act: 'status', arg: 'verifikasi' })
          : L.st === 'verifikasi' ? ui.btn('Simulasi: BPJS menyatakan layak bayar', { act: 'status', arg: 'layak' })
            : L.st === 'layak' ? ui.btn('Simulasi: BPJS membayar (batch ke BTN ••••9021)', { act: 'status', arg: 'paid' }) : '';
        send = `${ui.timeline([
          { t: L.sentAt, text: 'Terkirim ke E-Klaim', sub: 'berkas dikunci untuk verifikasi BPJS', tone: 'success' },
          { t: T.verifikasi || '', text: 'Verifikasi BPJS', sub: T.verifikasi ? 'diperiksa verifikator, tanpa pertanyaan' : 'menunggu', tone: T.verifikasi ? 'success' : '' },
          { t: T.layak || '', text: 'Layak bayar', sub: T.layak ? 'masuk berita acara; bisa dijaminkan ke BTN' : 'menunggu', tone: T.layak ? 'success' : '' },
          { t: T.paid || '', text: 'Dibayar BPJS', sub: T.paid ? `${rp(CBG.tariff)} masuk BTN ••••9021; piutang lunas` : 'menunggu', tone: T.paid ? 'success' : '' },
        ])}<div class="row">${nextBtn}</div>`;
      }
      return `<div class="stack">${ui.banner(P, ui.chip('Rawat jalan', 'brand'))}
        ${ui.steps(['Kelengkapan', 'Koding', 'Grouping', 'Final', 'Kirim E-Klaim', 'Status'], idx)}
        <div class="grid g2">${ui.card({ title: 'Kelengkapan berkas', sub: `${docs.filter((d) => d.ok).length}/${docs.length} lengkap`, body: ceklis(docs) })}
        ${ui.card({ title: 'Hasil grouper', sub: L.grouped ? 'INA-CBG' : 'belum dijalankan', html: true, body: grouping })}</div>
        ${ui.card({ title: 'Diagnosis ICD-10 dan prosedur ICD-9-CM', sub: 'ditarik otomatis dari catatan poli dan order; koder memvalidasi, bukan mengetik ulang', flush: true, body: dx + px })}
        <div class="row">${L.codesOk ? ui.chip(`Koding tervalidasi ${L.codesOk}`, 'success') : ui.btn('Validasi koding', { act: 'validasi', variant: 'primary' })}${locked ? ui.chip('Terkunci setelah final', '') : ''}</div>
        ${ui.card({ title: 'Final dan kirim', html: true, body: `<div class="stack">${send}</div>` })}
        ${L.sentAt ? ui.next('igd', `Klaim Suryo ${CBG.code} ${rp(CBG.tariff)} terkirim ke E-Klaim ${L.sentAt}.`) : ''}</div>`;
    },

    darmawan(L) {
      const pd = L.pd || {};
      const docs = PENDING_DOCS.map((d) => ({ ok: !!pd[d.k], t: d.t, sub: pd[d.k] ? `${d.how} · ${pd[d.k]}` : 'belum ada', right: !pd[d.k] && !L.pdSent ? ui.btn('Lengkapi', { act: 'lampir', arg: d.k, size: 'sm' }) : '' }));
      const kurang = docs.filter((d) => !d.ok).map((d) => d.t);
      return `<div class="stack">${ui.card({ title: 'Tn. Darmawan · rawat inap 5 hari · kelas 2', sub: 'SEP 0901R0011026V003871 · I63.9 Infark serebral · G-4-14-II · Rp8.730.600', body: ui.alert('warning', 'Pending verifikator BPJS (22 hari)', 'Pertanyaan verifikator: ekspertise CT kepala belum terlampir di berkas.') })}
        ${ui.card({ title: 'Dokumen tanggapan', sub: `${docs.length - kurang.length}/${docs.length} lengkap`, body: ceklis(docs) })}
        ${L.pdLayak ? ui.alert('success', `Layak bayar · ${L.pdLayak}`, 'Verifikator menerima tanggapan. Piutang masuk pool yang bisa dijaminkan ke BTN.')
    : L.pdSent ? `${ui.alert('info', `Tanggapan terkirim ${L.pdSent}`, 'Berkas tambahan dikunci dan tercatat di audit.')}<div>${ui.btn('Simulasi: verifikator menyatakan layak', { act: 'pdLayak' })}</div>`
      : `<div>${ui.btn('Kirim tanggapan ke verifikator', { act: 'pdKirim', variant: 'primary', disabled: kurang.length > 0, reason: `Lengkapi ${kurang.length} dokumen: ${kurang.join('; ')}.` })}</div>`}</div>`;
    },

    actions: {
      pilih(L, J, el) {
        const a = el.dataset.arg;
        if (!a) return;
        L.sel = a;
        if (a === 'darmawan' || a === 'siti') L.filter = 'pending';
        else L.filter = 'koding';
      },
      sepFix(L) { L.sepFix = true; SIM.note('Status SEP Suryo ditarik ulang dari VClaim: terbit'); },
      validasi(L) { if (L.codesOk) return; L.codesOk = SIM.now(3); SIM.note('Koding Suryo divalidasi: E11.9 utama, R03.0 sekunder'); },
      group(L, J) {
        if (!L.codesOk || L.grouped) return;
        L.grouped = SIM.now(1);
        J.claim = { cbg: CBG.code, tariff: CBG.tariff, status: 'grouped', patient: 'suryo', t: L.grouped };
        SIM.note(`Grouping INA-CBG Suryo: ${CBG.code}, tarif ${rp(CBG.tariff)}`);
      },
      final(L, J) {
        const sepPending = J.sep && J.sep.status === 'pending' && !L.sepFix;
        if (!L.grouped || L.finalAt || sepPending) return;
        L.finalAt = SIM.now(1);
        J.claim = Object.assign({}, J.claim, { status: 'final' });
        SIM.note('Klaim Suryo difinalkan; koding dan berkas dikunci');
      },
      kirim(L, J) {
        if (!L.finalAt || L.sentAt) return;
        L.sentAt = SIM.now(1); L.st = 'sent';
        J.claim = Object.assign({}, J.claim, { status: 'sent' });
        SIM.done();
        SIM.note('Klaim Suryo terkirim ke E-Klaim', 'success');
      },
      status(L, J, el) {
        const order = ['sent', 'verifikasi', 'layak', 'paid'];
        const want = el.dataset.arg;
        if (!L.sentAt || order.indexOf(want) !== order.indexOf(L.st) + 1) return;
        L.st = want; L.stT = Object.assign({}, L.stT, { [want]: SIM.now(5) });
        J.claim = Object.assign({}, J.claim, { status: want });
        SIM.note({ verifikasi: 'Klaim Suryo sedang diverifikasi BPJS', layak: 'Klaim Suryo dinyatakan layak bayar', paid: `BPJS membayar klaim Suryo ${rp(CBG.tariff)}` }[want], want === 'paid' ? 'success' : 'brand');
      },
      lampir(L, J, el) {
        const k = el.dataset.arg;
        if (!PENDING_DOCS.some((d) => d.k === k) || L.pdSent) return;
        L.pd = Object.assign({}, L.pd, { [k]: SIM.now(2) });
      },
      pdKirim(L) {
        if (L.pdSent || !PENDING_DOCS.every((d) => L.pd && L.pd[d.k])) return;
        L.pdSent = SIM.now(1);
        SIM.note('Tanggapan klaim pending Tn. Darmawan dikirim ke verifikator');
      },
      pdLayak(L) { if (!L.pdSent || L.pdLayak) return; L.pdLayak = SIM.now(10); SIM.note('Klaim Tn. Darmawan dinyatakan layak bayar', 'success'); },
    },
  });

  /* =====================================================================
   * F5 · AKUNTANSI
   * ===================================================================== */
  function jurnalHariIni(J) {
    const tot = suryoTotal(J);
    const out = [];
    out.push({ no: 'JU-26100501', src: 'kasir', sumber: `Kasir · ${J.bill && J.bill.inv ? J.bill.inv : SURYO_INV} · Tn. Suryo (BPJS)`, sample: !J.bill,
      lines: [['Piutang BPJS — rawat jalan', tot, 0], ['Pendapatan rawat jalan — JKN', 0, tot]] });
    const tariff = J.claim ? Number(J.claim.tariff) || CBG.tariff : CBG.tariff;
    const d = tot - tariff;
    if (d !== 0) {
      out.push({ no: 'JU-26100502', src: 'klaim', sumber: `Klaim · grouping ${CBG.code} · Tn. Suryo`, sample: !J.claim,
        lines: d > 0 ? [['Penyesuaian tarif INA-CBG', d, 0], ['Piutang BPJS — rawat jalan', 0, d]] : [['Piutang BPJS — rawat jalan', -d, 0], ['Penyesuaian tarif INA-CBG', 0, -d]] });
    }
    const pay = J.payment ? J.payment : { method: 'QRIS', amount: UMUM_TOTAL, status: 'paid', sample: true };
    if (pay.status === 'paid' || pay.status === 'void') {
      const amt = Number(pay.amount) || 0;
      const acc = pay.method === 'Tunai' ? 'Kas loket kasir' : 'Bank BTN ••••4417 — operasional';
      out.push({ no: 'JU-26100503', src: 'kasir', sumber: `Kasir · ${pay.inv || UMUM_INV} · ${pay.method}${!pay.inv || pay.inv === UMUM_INV ? ' · Ny. Lestari (umum)' : ''}`, sample: !!pay.sample,
        lines: [[acc, amt, 0], ['Pendapatan rawat jalan — umum', 0, amt]] });
      if (pay.status === 'void') out.push({ no: 'JU-26100504', src: 'kasir', sumber: `Kasir · jurnal balik pembatalan ${pay.kw || ''}`, lines: [['Pendapatan rawat jalan — umum', amt, 0], [acc, 0, amt]] });
    }
    if (J.claim && J.claim.status === 'paid') {
      out.push({ no: 'JU-26100506', src: 'klaim', sumber: 'Klaim dibayar BPJS · batch BTN ••••9021', lines: [['Bank BTN ••••9021 — penampungan klaim', tariff, 0], ['Piutang BPJS — rawat jalan', 0, tariff]] });
    }
    const F = J.financing;
    if (F && (F.status === 'cair' || F.status === 'lunas') && Number(F.amount) > 0) {
      out.push({ no: 'JU-26100507', src: 'pembiayaan', sumber: `Pembiayaan BTN · pencairan ${F.id || 'PCR-2610-01'}`, lines: [['Bank BTN ••••4417 — operasional', F.amount, 0], ['Utang pembiayaan BTN', 0, F.amount]] });
      if (F.status === 'lunas' && F.klaim) {
        out.push({ no: 'JU-26100508', src: 'pembiayaan', sumber: 'BPJS membayar klaim yang dibiayai · auto-debit', lines: [
          ['Bank BTN ••••9021 — penampungan klaim', F.klaim, 0], ['Piutang BPJS — rawat jalan', 0, F.klaim],
          ['Utang pembiayaan BTN', F.amount, 0], ['Beban margin pembiayaan', F.margin || 0, 0], ['Bank BTN ••••9021 — penampungan klaim', 0, F.amount + (F.margin || 0)],
          ['Bank BTN ••••4417 — operasional', F.sisa || 0, 0], ['Bank BTN ••••9021 — penampungan klaim', 0, F.sisa || 0]] });
      }
    }
    out.push({ no: 'JU-26100388', src: 'farmasi', sumber: 'Farmasi · retur pemasok', lines: [['Utang usaha — PT Kimia Farma', 4120000, 0], ['Persediaan obat', 0, 4120000]] });
    return out;
  }
  const AGING = [
    { b: '0–30 hari', v: 12418200000 }, { b: '31–60 hari', v: 5781400000 }, { b: '61–90 hari', v: 2355100000 }, { b: '> 90 hari', v: 856300000 },
  ];

  SIM.register({
    id: 'akuntansi',
    phase: 5,
    title: 'Akuntansi',
    codes: 'U07 · U09 · U10',
    role: 'akuntan',
    desc: 'Jurnal otomatis dari kasir, klaim, dan pembiayaan; buku besar; umur piutang BPJS; tutup periode bulanan dengan ceklis.',
    hint: 'Periksa jurnal otomatis dan buku besar, lalu lengkapi ceklis dan tutup periode September.',
    init: { tab: 'jurnal', src: 'semua', mapSel: '', mapAt: '', rekAt: '', akrualAt: '', confirm: '', closedAt: '', tryAt: '' },
    render(L, J) {
      const closed = !!L.closedAt;
      const kpi = `<div class="grid g4">${ui.kpi('Pendapatan Okt (berjalan)', 'Rp7,82 M', '+6,1% vs Sep hari sama', 'up')}${ui.kpi('Piutang BPJS', singkat(AGING.reduce((a, b) => a + b.v, 0)), 'rata-rata cair 34 hari')}${ui.kpi('Kas dan bank', 'Rp9,15 M', 'cukup 41 hari operasional', 'up')}${ui.kpi('Periode September', closed ? 'Terkunci' : 'Terbuka', closed ? `ditutup ${L.closedAt}` : 'tutup paling lambat 7 Okt', closed ? 'up' : 'down')}</div>`;
      const tabs = ui.tabs('tab', L.tab, [{ value: 'jurnal', label: 'Jurnal otomatis' }, { value: 'buku', label: 'Buku besar' }, { value: 'piutang', label: 'Piutang BPJS' }, { value: 'tutup', label: 'Tutup periode' }, { value: 'laporan', label: 'Laporan' }]);
      let body = '';
      const entries = jurnalHariIni(J);
      if (L.tab === 'jurnal') {
        const vis = entries.filter((e) => L.src === 'semua' || e.src === L.src);
        const rows = [];
        vis.forEach((e) => {
          const sd = e.lines.reduce((a, l) => a + l[1], 0); const sk = e.lines.reduce((a, l) => a + l[2], 0);
          e.lines.forEach((l, i) => rows.push([
            i === 0 ? `<b class="mono">${E(e.no)}</b>` : '',
            i === 0 ? `${E(e.sumber)}${e.sample ? ` ${contoh()}` : ''}<div>${sd === sk ? ui.chip('Seimbang', 'success') : ui.chip('Tidak seimbang', 'danger')}</div>` : '',
            `<span style="${l[2] && !l[1] ? 'padding-left:20px;display:inline-block' : ''}">${E(l[0])}</span>`,
            l[1] ? rp(l[1]) : '', l[2] ? rp(l[2]) : '',
          ]));
        });
        body = ui.card({
          title: 'Jurnal otomatis hari ini', sub: 'dibentuk dari event kasir, klaim, pembiayaan, dan farmasi · tidak diketik manual',
          actions: ui.seg('src', L.src, [{ value: 'semua', label: 'Semua' }, { value: 'kasir', label: 'Kasir' }, { value: 'klaim', label: 'Klaim' }, { value: 'pembiayaan', label: 'Pembiayaan' }, { value: 'farmasi', label: 'Farmasi' }]),
          flush: true, body: ui.table(['No.', 'Sumber', 'Akun', { label: 'Debit', r: true }, { label: 'Kredit', r: true }], rows, { empty: 'Belum ada jurnal dari sumber ini' }),
        });
      } else if (L.tab === 'buku') {
        const acc = {};
        entries.forEach((e) => e.lines.forEach((l) => { acc[l[0]] = acc[l[0]] || [0, 0]; acc[l[0]][0] += l[1]; acc[l[0]][1] += l[2]; }));
        const names = Object.keys(acc).sort();
        const td = names.reduce((a, n) => a + acc[n][0], 0); const tk = names.reduce((a, n) => a + acc[n][1], 0);
        const rows = names.map((n) => [E(n), rp(acc[n][0]), rp(acc[n][1]), rp(acc[n][0] - acc[n][1])]);
        rows.push(['<b>Total</b>', `<b>${rp(td)}</b>`, `<b>${rp(tk)}</b>`, '']);
        body = `${ui.card({ title: 'Buku besar ringkas · mutasi hari ini', sub: '5 Okt 2026 · periode Oktober terbuka', actions: td === tk ? ui.chip('Total debit = total kredit', 'success') : ui.chip('Tidak seimbang', 'danger'), flush: true,
          body: ui.table(['Akun', { label: 'Debit', r: true }, { label: 'Kredit', r: true }, { label: 'Saldo mutasi', r: true }], rows) })}
          ${ui.alert('info', 'Buku pembantu = buku besar', 'Saldo piutang BPJS, kas, dan uang muka di buku besar dicocokkan otomatis dengan buku pembantu setiap malam.')}`;
      } else if (L.tab === 'piutang') {
        const suryoOpen = !(J.claim && J.claim.status === 'paid');
        const sv = suryoOpen ? (J.claim ? Number(J.claim.tariff) || CBG.tariff : CBG.tariff) : 0;
        const tot = AGING.reduce((a, b) => a + b.v, 0) + sv;
        const rows = AGING.map((a, i) => {
          const v = a.v + (i === 0 ? sv : 0);
          const pct = Math.round((v / tot) * 100);
          return [E(a.b), rp(v), `<div style="background:var(--line-soft);border-radius:99px;height:8px;min-width:120px"><div style="width:${pct}%;height:8px;border-radius:99px;background:${i < 2 ? 'var(--brand-600)' : i === 2 ? 'var(--warning)' : 'var(--danger)'}"></div></div>`, `${pct}%`];
        });
        rows.push(['<b>Total piutang BPJS</b>', `<b>${rp(tot)}</b>`, '', '']);
        const st = J.claim ? { grouped: 'ter-grouping', final: 'final', sent: 'terkirim', verifikasi: 'verifikasi', layak: 'layak bayar', paid: 'dibayar' }[J.claim.status] || J.claim.status : 'terkirim';
        body = `${ui.card({ title: 'Piutang BPJS per umur', sub: 'dihitung dari tanggal pulang pasien', flush: true, body: ui.table(['Umur', { label: 'Nilai', r: true }, 'Porsi', { label: '%', r: true }], rows) })}
          ${ui.card({ title: 'Piutang yang ditelusuri hari ini', html: true, body: `${kv(`Tn. Suryo · ${CBG.code}`, `${suryoOpen ? rp(sv) : 'lunas'}`)}<div class="small muted">Status klaim: ${E(st)}${J.claim ? '' : ' · data contoh'}. ${J.financing && J.financing.amount ? `Sebagian piutang dijaminkan ke BTN (${singkat(J.financing.amount)}).` : 'Piutang layak bayar bisa dijaminkan ke BTN di Pembiayaan BTN.'}</div>` })}`;
      } else if (L.tab === 'tutup') {
        body = this.tutup(L);
      } else {
        body = this.laporan(L);
      }
      const done = L.closedAt ? ui.next('logistik', `Periode September ditutup ${L.closedAt}; jurnal September terkunci.`) : '';
      return kpi + tabs + body + done;
    },

    tutup(L) {
      const closed = !!L.closedAt;
      const items = [
        { ok: !!L.mapAt, t: L.mapAt ? `JU-26090417 dipetakan ke ${L.mapName || 'akun lawan'}` : 'JU-26090417 (dispute klaim Rp12.400.000) belum dipetakan ke akun lawan', sub: L.mapAt ? `dipetakan ${L.mapAt}` : 'jurnal draf tidak boleh tersisa saat tutup' },
        { ok: true, t: 'Semua shift kasir September tertutup', sub: '93 shift · setoran cocok' },
        { ok: !!L.rekAt, t: L.rekAt ? 'Rekonsiliasi bank cocok di semua rekening' : 'BTN ••••9021 penampungan klaim: 2 selisih', sub: L.rekAt ? `dipadankan ${L.rekAt}` : 'transfer BPJS Rp1,82 M belum dipadankan ke batch klaim' },
        { ok: true, t: 'Charge capture tertinggal = 0 untuk tanggal September', sub: 'diperiksa otomatis' },
        { ok: !!L.akrualAt, t: L.akrualAt ? 'Akrual jasa pelayanan September terposting' : 'Akrual jasa pelayanan September belum terposting', sub: L.akrualAt ? `${rp(1420000000)} · ${L.akrualAt}` : 'rekap jasa dokter dan perawat' },
      ];
      const ready = items.every((i) => i.ok);
      const opts = [{ value: '', label: 'Pilih akun lawan…' }, { value: 'ckpn', label: 'Cadangan kerugian penurunan nilai — piutang BPJS' }, { value: 'koreksi', label: 'Pendapatan rawat inap — JKN (koreksi)' }];
      const tasks = closed ? '' : `<div class="grid g3">
        ${ui.card({ title: 'Petakan jurnal', body: L.mapAt ? ui.chip('Selesai', 'success') : `<div class="stack">${ui.select('mapSel', L.mapSel, opts)}${ui.btn('Simpan pemetaan', { act: 'petakan', variant: 'primary', disabled: !L.mapSel, reason: 'Pilih akun lawan dulu.' })}</div>` })}
        ${ui.card({ title: 'Rekonsiliasi BTN ••••9021', body: L.rekAt ? ui.chip('Cocok 100%', 'success') : `<div class="stack"><span class="small muted">Transfer BPJS Rp1,82 M = 2 batch klaim Agustus.</span>${ui.btn('Padankan ke batch klaim', { act: 'padankan', variant: 'primary' })}</div>` })}
        ${ui.card({ title: 'Akrual jasa pelayanan', body: L.akrualAt ? ui.chip('Terposting', 'success') : `<div class="stack"><span class="small muted">${rp(1420000000)} dari rekap jasa September.</span>${ui.btn('Posting akrual', { act: 'akrual', variant: 'primary' })}</div>` })}</div>`;
      let action = '';
      if (closed) {
        action = `${ui.alert('success', `Periode September 2026 ditutup ${L.closedAt}`, 'Semua jurnal bertanggal September terkunci. Buka ulang hanya oleh manajemen dengan alasan tertulis dan tercatat di audit.')}
          <div class="row">${ui.btn('Coba posting jurnal koreksi bertanggal 30 Sep', { act: 'cobaPosting' })}${ui.btn('Tambah jurnal manual September', { disabled: true, reason: 'Periode September terkunci.' })}</div>
          ${L.tryAt ? ui.alert('danger', `Ditolak · ${L.tryAt}`, 'Periode September 2026 sudah dikunci. Jurnal koreksi dibuat bertanggal Oktober atau periode dibuka ulang oleh manajemen.') : ''}`;
      } else if (L.confirm) {
        action = ui.gate({ title: 'Tutup dan kunci periode September 2026?', body: 'Setelah dikunci, jurnal, pembayaran, dan pembalik bertanggal September tidak bisa diubah.' })
          + `<div class="row">${ui.btn('Ya, tutup dan kunci', { act: 'tutupPeriode', variant: 'danger' })}${ui.btn('Batal', { set: 'confirm=', variant: 'ghost' })}</div>`;
      } else {
        const miss = items.filter((i) => !i.ok).length;
        action = `<div>${ui.btn('Tutup periode September', { set: 'confirm=1', variant: 'primary', disabled: !ready, reason: `Belum bisa ditutup: ${miss} butir ceklis belum beres.` })}</div>`;
      }
      return `${ui.card({ title: 'Ceklis tutup periode · September 2026', sub: `${items.filter((i) => i.ok).length}/${items.length} beres`, body: ceklis(items) })}${tasks}${action}`;
    },

    laporan(L) {
      const st = L.closedAt ? ui.chip('Final · periode terkunci', 'success') : ui.chip('Sementara', 'warning');
      const M = (n) => rp(n * 1e6);
      const neraca = `${kv('Kas dan bank', M(9150))}${kv('Piutang BPJS', M(21410))}${kv('Piutang lain', M(5460))}${kv('Persediaan', M(3870))}${kv('Aset tetap neto', M(68240))}${kv('Total aset', M(108130), { strong: true, top: true })}
        <hr class="sep">${kv('Utang usaha', M(6920))}${kv('Utang pembiayaan BTN', M(7470))}${kv('Liabilitas lain', M(3180))}${kv('Ekuitas', M(90560))}${kv('Total liabilitas + ekuitas', M(108130), { strong: true, top: true })}`;
      const lo = `${kv('Pendapatan JKN', M(18420))}${kv('Pendapatan umum dan asuransi', M(6870))}${kv('Pendapatan lain', M(410))}${kv('Total pendapatan', M(25700), { strong: true, top: true })}
        <hr class="sep">${kv('Beban pegawai', M(11240))}${kv('Obat dan BHP', M(7380))}${kv('Jasa pelayanan', M(1420))}${kv('Umum dan administrasi', M(2960))}${kv('Penyusutan', M(1150))}${kv('Beban margin pembiayaan', M(52))}${kv('Total beban', M(24202), { strong: true, top: true })}
        ${kv('Surplus September', M(1498), { strong: true, tone: 'success' })}`;
      return `<div class="grid g2">${ui.card({ title: 'Neraca ringkas · 30 Sep 2026', actions: st, html: true, body: neraca })}${ui.card({ title: 'Laporan operasional · September 2026', actions: st, html: true, body: lo })}</div>`;
    },

    actions: {
      petakan(L) {
        if (!L.mapSel || L.mapAt || L.closedAt) return;
        L.mapName = L.mapSel === 'ckpn' ? 'Cadangan kerugian penurunan nilai — piutang BPJS' : 'Pendapatan rawat inap — JKN (koreksi)';
        L.mapAt = SIM.now(1);
        SIM.note('Jurnal dispute JU-26090417 dipetakan ke akun lawan');
      },
      padankan(L) { if (L.rekAt || L.closedAt) return; L.rekAt = SIM.now(2); SIM.note('Transfer BPJS Rp1,82 M dipadankan ke 2 batch klaim; rekonsiliasi cocok'); },
      akrual(L) { if (L.akrualAt || L.closedAt) return; L.akrualAt = SIM.now(1); SIM.note('Akrual jasa pelayanan September terposting'); },
      tutupPeriode(L) {
        if (L.closedAt || !(L.mapAt && L.rekAt && L.akrualAt)) { L.confirm = ''; return; }
        L.closedAt = SIM.now(2); L.confirm = '';
        SIM.done();
        SIM.note('Periode September 2026 ditutup dan dikunci', 'success');
      },
      cobaPosting(L) { if (!L.closedAt) return; L.tryAt = SIM.now(1); SIM.note('Jurnal bertanggal 30 Sep ditolak karena periode terkunci', 'warning'); },
    },
  });

  /* =====================================================================
   * F6 · PEMBAYARAN DIGITAL (TPDI × BTN)
   * ===================================================================== */
  function qrGrid(seed, faded) {
    const n = 21; let cells = '';
    const finders = [[0, 0], [14, 0], [0, 14]];
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const f = finders.find(([fx, fy]) => x >= fx && x < fx + 7 && y >= fy && y < fy + 7);
        let on;
        if (f) { const dx = x - f[0]; const dy = y - f[1]; on = dx === 0 || dx === 6 || dy === 0 || dy === 6 || (dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4); }
        else if ((x < 8 && y < 8) || (x > 12 && y < 8) || (x < 8 && y > 12)) on = false;
        else on = ((x * 7 + y * 13 + seed + x * y) % 5) < 2;
        cells += `<i style="background:${on ? 'var(--ink-900)' : 'var(--card)'}"></i>`;
      }
    }
    return `<div role="img" aria-label="Kode QRIS (gambar contoh)" style="display:grid;grid-template-columns:repeat(21,1fr);width:189px;height:189px;padding:10px;background:var(--card);border:1px solid var(--line);border-radius:10px;box-sizing:content-box;opacity:${faded ? '.35' : '1'}">${cells}</div>`;
  }
  const REK = [
    { id: 'r1', who: 'Ny. Ratna Sari', sub: 'VA BTN · INV-2610-02231 · deposit naik kelas', a: 2000000, b: 2000000, c: 2000000, note: 'callback ganda diabaikan (idempoten)' },
    { id: 'r2', who: 'Tn. Bambang H.', sub: 'QRIS · INV-2610-02212', a: 96000, b: 96000, c: 96000, note: '' },
    { id: 'x1', who: 'Tn. Joko S.', sub: 'VA BTN · INV-2610-02198', a: 0, b: 640000, c: 640000, ex: true,
      why: 'Dana sudah masuk BTN dan tercatat di laporan TPDI, tetapi webhook gagal sampai ke SIM RS sehingga tagihan belum lunas di kasir.',
      opts: [{ value: 'lunas', label: 'Tandai lunas di kasir (TPDI + BTN cocok)' }, { value: 'ulang', label: 'Minta TPDI kirim ulang webhook' }] },
    { id: 'x2', who: 'Ny. Dewi K.', sub: 'QRIS · INV-2610-02228', a: 2000000, b: 2000000, c: 1986000, ex: true,
      why: 'Mutasi BTN Rp14.000 lebih kecil: MDR QRIS 0,7% (simulasi) terpotong saat settlement.',
      opts: [{ value: 'mdr', label: 'Catat Rp14.000 sebagai beban MDR QRIS' }, { value: 'koreksi', label: 'Ajukan koreksi ke BTN' }] },
    { id: 'x3', who: 'Tanpa referensi', sub: 'transfer masuk · berita "WULAN 02225"', a: 0, b: 0, c: 142500, ex: true,
      why: 'Transfer masuk tanpa nomor VA. QRIS tagihan INV-2610-02225 (Ny. Wulan) kedaluwarsa.',
      opts: [{ value: 'padan', label: 'Padankan ke Ny. Wulan · INV-2610-02225' }, { value: 'titip', label: 'Catat sebagai titipan tak teridentifikasi' }, { value: 'kembali', label: 'Kembalikan ke pengirim lewat refund' }] },
  ];
  const RF_STEPS = ['Diajukan', 'Supervisor kasir', 'Manajer keuangan', 'Transfer BTN', 'Dana kembali'];

  SIM.register({
    id: 'pembayaran',
    phase: 6,
    title: 'Pembayaran digital',
    nav: 'Pembayaran digital',
    codes: 'I05 · U03 · U09',
    role: 'kasir',
    desc: 'Tagihan QRIS dan VA BTN lewat TPDI, pelunasan otomatis dari webhook, rekonsiliasi tiga arah, dan refund dua tingkat. Dana tidak transit di TPDI.',
    hint: 'Buat QRIS lewat TPDI, klik "Pasien membayar", coba webhook ganda, lalu lihat rekonsiliasi dan refund.',
    init: { tab: 'tagihan', handoff: null, ch: 'QRIS', inv: null, paidAt: '', events: [], dup: 0, kwSeq: 431,
      rekRun: '', act_x1: '', act_x2: '', act_x3: '', rekDone: {},
      rfStage: 0, rfLog: [], rfNom: '3000000', rfKat: '', rfKet: '', rfErr: '' },
    render(L, J) {
      const tabs = ui.tabs('tab', L.tab, [{ value: 'tagihan', label: 'Buat tagihan' }, { value: 'trx', label: 'Transaksi' }, { value: 'rekon', label: 'Rekonsiliasi 3 arah' }, { value: 'refund', label: 'Refund' }]);
      const body = L.tab === 'trx' ? this.trx(L, J) : L.tab === 'rekon' ? this.rekon(L, J) : L.tab === 'refund' ? this.refund(L) : this.tagihan(L, J);
      return `<div class="row">${ui.chip('TPDI terhubung', 'success')}${ui.chip('Dana langsung ke BTN ••••4417', 'brand')}<span class="small muted">TPDI hanya agregator teknologi; tidak menampung dana.</span></div>${tabs}${body}`;
    },
    bill(L, J) {
      if (L.handoff) return L.handoff;
      if (J.payment && J.payment.inv === UMUM_INV && J.payment.status === 'paid' && !L.paidAt) {
        return { who: 'Tn. Bambang Hermawan', rm: '00-29-77-41', inv: 'INV-2610-02262', amount: 96000, note: 'Laboratorium rawat jalan', sample: true };
      }
      return { who: UMUM.name, rm: UMUM.rm, inv: UMUM_INV, amount: UMUM_TOTAL, note: 'Rawat jalan Poli Kulit dan Kelamin', sample: true };
    },
    tagihan(L, J) {
      const b = this.bill(L, J);
      const inv = L.inv;
      const idx = L.paidAt ? 4 : inv ? 1 : 0;
      const head = ui.card({ title: `Tagihan ${b.inv}`, sub: b.sample ? 'contoh; dari kasir bila diteruskan' : 'diteruskan dari kasir', actions: b.sample ? contoh() : ui.chip('dari kasir', 'brand'), html: true,
        body: `${kv('Pasien', `${E(b.who)} · RM ${E(b.rm)}`, { mono: false })}${kv('Keterangan', E(b.note), { mono: false })}${kv('Nominal', rp(b.amount), { strong: true })}` });
      const already = J.payment && J.payment.inv === b.inv && J.payment.status === 'paid' && !L.paidAt;
      let main = '';
      if (already) {
        main = ui.alert('success', 'Tagihan ini sudah lunas di kasir', `Dibayar ${E(J.payment.method)} · ${E(J.payment.ref)}. Tidak perlu tagihan digital baru.`);
      } else if (!inv) {
        main = ui.card({ title: 'Pilih kanal', body: `<div class="stack">${ui.seg('ch', L.ch, ['QRIS', 'VA BTN'])}
          <span class="small muted">${L.ch === 'QRIS' ? 'QRIS dinamis, acquirer BTN, berlaku 10 menit, satu QR per tagihan.' : 'VA BTN closed amount, berlaku 24 jam, dikirim ke WhatsApp pasien.'}</span>
          <div>${ui.btn('Buat tagihan lewat TPDI', { act: 'buat', variant: 'primary', size: 'lg' })}</div></div>` });
      } else {
        const isQ = inv.ch === 'QRIS';
        const show = isQ
          ? `<div class="stack" style="align-items:center">${qrGrid(7, !!L.paidAt)}<div class="small muted">${E(inv.ref)} · ${rp(b.amount)}</div></div>`
          : `<div class="stack" style="align-items:center;padding:20px 0"><span class="label">Nomor VA BTN</span><div class="mono" style="font-size:24px;font-weight:600;letter-spacing:.04em">${E(inv.va)}</div><div class="small muted">${rp(b.amount)} · closed amount</div></div>`;
        const ev = L.events.length ? ui.timeline(L.events.map((e) => ({ t: e.t, text: e.text, sub: e.sub, tone: e.tone }))) : '';
        let ctl;
        if (!L.paidAt) {
          ctl = `${ui.alert('info', `Menunggu pembayaran · berlaku s.d. ${inv.exp}`, 'Status diperbarui otomatis saat webhook TPDI masuk. Kasir tidak perlu menandai lunas manual.')}
            <div class="row">${ui.btn('Simulasi: pasien membayar', { act: 'bayar', variant: 'primary' })}${ui.btn('Simulasi: webhook bertanda tangan salah', { act: 'hookPalsu' })}${ui.btn('Simulasi: webhook nominal berbeda', { act: 'hookNominal' })}${ui.btn('Batalkan, ganti kanal', { act: 'ganti', variant: 'ghost' })}</div>`;
        } else {
          const payload = [
            'POST /api/v1/webhooks/tpdi  ← 200 OK · 84 ms',
            `X-TPDI-Event-Id: evt_${inv.tx.slice(-6)}`,
            `X-TPDI-Timestamp: 2026-10-05T${L.paidAt.replace('.', ':')}:12+07:00`,
            'X-TPDI-Signature: sha256=9f3a…e1c2 (valid)',
            JSON.stringify({ event: 'payment.paid', merchant_id: 'TPDI-RS-00127', invoice_id: b.inv, channel: isQ ? 'QRIS_BTN' : 'VA_BTN', amount: b.amount, bank_ref: inv.ref, settled_to: 'BTN ••••4417' }, null, 2),
          ].join('\n');
          ctl = `${ui.alert('success', `Lunas otomatis ${L.paidAt} · kuitansi ${L.kw}`, `Webhook TPDI terverifikasi, nominal cocok dengan tagihan, dana masuk BTN ••••4417. Jurnal Bank (D) / Pendapatan (K) terbentuk.${L.dup ? ` Webhook ganda diabaikan ${L.dup}×.` : ''}`)}
            <div class="label">Payload webhook (ringkas)</div><div class="code">${E(payload)}</div>
            <div class="row">${ui.btn('Simulasi: TPDI mengirim webhook yang sama lagi', { act: 'hookGanda' })}${ui.btn('Kembali ke kasir', { go: 'kasir', variant: 'ghost' })}</div>`;
        }
        main = `<div class="grid g2">${ui.card({ title: isQ ? 'QRIS dinamis' : 'Virtual Account BTN', sub: `dibuat ${inv.at} · ${inv.tx}`, body: show })}
          ${ui.card({ title: 'Status tagihan', body: `<div class="stack">${ctl}${ev}</div>` })}</div>`;
      }
      return `${ui.steps(['Buat tagihan', 'Menunggu bayar', 'Webhook diterima', 'Lunas'], idx)}${head}${main}
        ${L.paidAt ? ui.next('klaim', `Pembayaran ${inv ? inv.ch : ''} ${rp(b.amount)} lunas otomatis lewat webhook TPDI.`) : ''}`;
    },
    trx(L, J) {
      const rows = [];
      const b = this.bill(L, J);
      if (L.paidAt && L.inv) rows.push([L.paidAt, E(b.who), `<span class="mono">${E(b.inv)}</span>`, E(L.inv.ch), rp(b.amount), ui.chip('Berhasil', 'success')]);
      else if (L.inv) rows.push([L.inv.at, E(b.who), `<span class="mono">${E(b.inv)}</span>`, E(L.inv.ch), rp(b.amount), ui.chip('Menunggu', 'warning')]);
      [
        ['4 Okt 16.20', 'Ny. Dewi K.', 'INV-2610-02228', 'QRIS', 2000000, ['Berhasil', 'success']],
        ['4 Okt 15.05', 'Ny. Wulan', 'INV-2610-02225', 'QRIS', 142500, ['Kedaluwarsa', '']],
        ['4 Okt 14.47', 'Tn. Joko S.', 'INV-2610-02198', 'VA BTN', 640000, ['Berhasil · webhook gagal', 'warning']],
        ['4 Okt 11.31', 'Tn. Bambang H.', 'INV-2610-02212', 'QRIS', 96000, ['Berhasil', 'success']],
        ['4 Okt 09.12', 'Ny. Ratna Sari', 'INV-2610-02231', 'VA BTN', 2000000, ['Berhasil', 'success']],
        ['4 Okt 08.30', 'An. Raka P.', 'INV-2610-02236', 'VA BTN', 1320000, ['Menunggu', 'warning']],
        ['2 Okt 09.15', 'Tn. Agus Wijaya', 'INV-2610-02150', 'VA BTN', 3000000, [L.rfStage >= 5 ? 'Dikembalikan' : 'Berhasil', L.rfStage >= 5 ? 'info' : 'success']],
      ].forEach((r) => rows.push([r[0], E(r[1]), `<span class="mono">${E(r[2])}</span>`, E(r[3]), rp(r[4]), ui.chip(r[5][0], r[5][1])]));
      return ui.card({ title: 'Transaksi digital', sub: 'QRIS dan VA BTN lewat TPDI', flush: true, body: ui.table(['Waktu', 'Pasien', 'Tagihan', 'Kanal', { label: 'Nominal', r: true }, 'Status'], rows) });
    },
    rekon(L, J) {
      if (!L.rekRun) {
        return ui.card({ title: 'Rekonsiliasi harian · Minggu, 4 Okt 2026', body: `<div class="stack">${ui.alert('info', 'Tiga sumber dicocokkan', 'Catatan kasir SIM RS × laporan transaksi TPDI × mutasi rekening BTN (H2H). Pencocokan per referensi bank / nomor tagihan, lalu nominal, lalu tanggal.')}
          <div>${ui.btn('Tarik laporan TPDI dan mutasi BTN', { act: 'rekRun', variant: 'primary' })}</div></div>` });
      }
      const D = L.rekDone || {};
      const rows = REK.map((r) => {
        const done = r.ex && D[r.id];
        const a = r.id === 'x1' && done ? 640000 : r.id === 'x3' && done && D.x3.act === 'padan' ? 142500 : r.a;
        const c = (v, bad) => (v ? `<span style="color:${bad ? 'var(--danger)' : 'inherit'}">${rp(v)}</span>` : `<span style="color:${bad ? 'var(--danger)' : 'var(--ink-400)'}">—</span>`);
        const status = !r.ex ? ui.chip('Cocok', 'success') : done ? ui.chip('Ditangani', 'success') : ui.chip('Selisih', 'danger');
        let aksi = r.note ? `<span class="small muted">${E(r.note)}</span>` : '';
        if (r.ex && !done) {
          aksi = `<div class="stack" style="gap:6px;min-width:220px"><span class="small muted">${E(r.why)}</span>${ui.select(`act_${r.id}`, L[`act_${r.id}`], [{ value: '', label: 'Pilih tindak lanjut…' }].concat(r.opts))}
            ${ui.btn('Terapkan', { act: 'tindak', arg: r.id, size: 'sm', variant: 'primary', disabled: !L[`act_${r.id}`], reason: 'Pilih tindak lanjut dulu.' })}</div>`;
        } else if (done) {
          aksi = `<span class="small">${E((r.opts.find((o) => o.value === D[r.id].act) || {}).label || '')} · ${E(D[r.id].at)} · tercatat di audit</span>`;
        }
        return [`<b>${E(r.who)}</b><div class="small muted">${E(r.sub)}</div>`, c(a, r.ex && !done && r.a !== r.b), c(r.b, false), c(r.id === 'x2' && done ? 2000000 : r.c, r.id === 'x2' && !done), status, aksi];
      });
      const b = this.bill(L, J);
      if (L.paidAt) rows.unshift([`<b>${E(b.who)}</b><div class="small muted">${E(L.inv ? L.inv.ch : '')} · ${E(b.inv)} · hari ini</div>`, rp(b.amount), rp(b.amount), rp(b.amount), ui.chip('Cocok', 'success'), '<span class="small muted">masuk rekonsiliasi besok</span>']);
      const open = REK.filter((r) => r.ex && !D[r.id]);
      const sel = open.reduce((a, r) => a + Math.abs(r.c - r.a || r.c - r.b), 0);
      return `<div class="grid g3">${ui.kpi('Pengecualian terbuka', String(open.length), open.length ? 'perlu tindakan' : 'semua ditangani', open.length ? 'down' : 'up')}${ui.kpi('Selisih belum dijelaskan', rp(sel), `ditarik ${L.rekRun}`, sel ? 'down' : 'up')}${ui.kpi('Baris cocok', String(REK.length - open.length), 'dari 5 baris contoh', 'up')}</div>
        ${ui.card({ title: 'SIM RS × TPDI × mutasi BTN', sub: '4 Okt 2026 · rekening operasional ••••4417', flush: true, body: ui.table(['Transaksi', { label: 'SIM RS', r: true }, { label: 'TPDI', r: true }, { label: 'BTN', r: true }, 'Status', 'Tindak lanjut'], rows) })}
        ${open.length ? '' : ui.alert('success', 'Rekonsiliasi 4 Okt final', 'Ketiga sumber cocok atau selisihnya sudah dijelaskan. Jurnal final; periode bisa ditutup di Akuntansi.')}`;
    },
    refund(L) {
      const s = L.rfStage;
      const kat = [{ value: '', label: 'Pilih alasan…' }, { value: 'Batal rawat inap', label: 'Batal rawat inap' }, { value: 'Deposit berlebih', label: 'Deposit berlebih' }, { value: 'Pembayaran ganda', label: 'Pembayaran ganda' }, { value: 'Layanan dibatalkan', label: 'Layanan dibatalkan' }];
      const head = ui.card({ title: 'RF-2610-0014 · Tn. Agus Wijaya', sub: 'deposit rawat inap via VA BTN · TPDI-TX-2610-004201', html: true,
        body: `${kv('Transaksi asal', 'INV-2610-02150 · 2 Okt 09.15')}${kv('Deposit diterima', rp(3000000))}${kv('Rekening tujuan', 'rekening asal pembayar ••••5530', { mono: false })}${kv('Sumber dana', 'BTN ••••4417 (rekening RS)', { mono: false })}` });
      let ctl = '';
      if (s === 0) {
        ctl = `<div class="stack">${ui.field('Nominal refund (Rp)', ui.input('rfNom', L.rfNom, { mono: true, inputmode: 'numeric' }), `Maksimal ${rp(3000000)}.`)}
          ${ui.field('Alasan', ui.select('rfKat', L.rfKat, kat))}
          ${ui.field('Keterangan (minimal 15 huruf, dibaca penyetuju)', ui.input('rfKet', L.rfKet, { area: true, placeholder: 'Contoh: pasien batal dirawat, deposit dikembalikan penuh' }))}
          ${L.rfErr ? ui.alert('warning', 'Belum bisa diajukan', E(L.rfErr)) : ''}
          <div>${ui.btn('Ajukan refund', { act: 'rfAjukan', variant: 'primary', needs: 'rfKet:15' })}</div></div>`;
      } else if (s === 1) {
        ctl = `<div class="row">${ui.btn('Setujui (Anda)', { disabled: true, reason: 'Pengaju refund tidak boleh menyetujui sendiri.' })}${ui.btn(`Simulasi peran: supervisor ${SUPERVISOR} menyetujui`, { act: 'rfMaju', variant: 'primary' })}</div>`;
      } else if (s === 2) {
        ctl = `<div class="row">${ui.btn(`Simulasi peran: manajer keuangan ${MANAJER} menyetujui`, { act: 'rfMaju', variant: 'primary' })}<span class="small muted">Tingkat 2 · setelah disetujui, instruksi transfer dikirim lewat TPDI ke BTN.</span></div>`;
      } else if (s === 3 || s === 4) {
        ctl = `<div>${ui.btn('Simulasi: BTN konfirmasi dana diterima pasien', { act: 'rfMaju', variant: 'primary' })}</div>`;
      } else {
        ctl = ui.alert('success', 'Dana kembali ke pasien', `${rp(angka(L.rfNom))} diterima rekening ••••5530. Jurnal Uang muka pasien (D) / Bank BTN ••••4417 (K) terbentuk.`);
      }
      const doneN = s >= 5 ? 5 : s === 4 ? 3 : s;
      return `${head}${ui.steps(RF_STEPS, doneN)}${ui.card({ title: 'Refund dua tingkat', sub: 'pengaju ≠ penyetuju · semua langkah tercatat di audit', body: ctl })}
        ${L.rfLog.length ? ui.card({ title: 'Jejak refund', body: ui.timeline(L.rfLog.map((x) => ({ t: x.t, text: x.w, tone: 'success' }))) }) : ''}`;
    },
    actions: {
      buat(L, J, el, S) {
        if (L.inv || L.paidAt) return;
        const b = S.screens.get('pembayaran').bill(L, J);
        if (J.payment && J.payment.inv === b.inv && J.payment.status === 'paid') { SIM.toast('Tagihan ini sudah lunas di kasir.', 'warning'); return; }
        const t = SIM.now(1);
        const isQ = L.ch !== 'VA BTN';
        L.inv = { ch: isQ ? 'QRIS' : 'VA BTN', at: t, exp: isQ ? plusMenit(t, 10) : `besok ${t}`, tx: 'TPDI-TX-2610-004466', ref: isQ ? 'QR-2610-88466' : '8808 0127 0226 1002', va: '8808 0127 0226 1002' };
        L.events = [{ t, text: `Tagihan ${L.inv.ch} dibuat lewat TPDI`, sub: 'Idempotency-Key = nomor tagihan; aman diulang tanpa tagihan ganda' }];
        SIM.note(`${L.inv.ch} ${rp(b.amount)} untuk ${b.who} dibuat lewat TPDI`);
      },
      ganti(L) { if (!L.inv || L.paidAt) return; L.inv = null; L.events = []; SIM.toast('Tagihan TPDI dikedaluwarsakan. Pilih kanal lain.', ''); },
      hookPalsu(L) {
        if (!L.inv || L.paidAt) return;
        L.events.push({ t: SIM.now(1), text: 'Webhook ditolak: tanda tangan tidak cocok', sub: 'dibalas 401, disimpan untuk audit; status tagihan tidak berubah', tone: 'danger' });
        SIM.note('Webhook dengan tanda tangan salah ditolak; tagihan tetap menunggu', 'warning');
      },
      hookNominal(L, J, el, S) {
        if (!L.inv || L.paidAt) return;
        const b = S.screens.get('pembayaran').bill(L, J);
        L.events.push({ t: SIM.now(1), text: `Webhook nominal ${rp(b.amount - 12500)} ≠ tagihan ${rp(b.amount)}`, sub: 'tidak dilunasi otomatis; masuk pengecualian rekonsiliasi untuk ditelusuri', tone: 'warning' });
        SIM.note('Webhook dengan nominal berbeda tidak melunasi tagihan; dicatat sebagai pengecualian', 'warning');
      },
      bayar(L, J, el, S) {
        if (!L.inv || L.paidAt) return;
        const b = S.screens.get('pembayaran').bill(L, J);
        const t = SIM.now(3);
        L.paidAt = t; L.kw = `KW-2610-00${L.kwSeq++}`;
        L.events.push({ t, text: 'Pasien membayar dari m-banking', sub: 'BTN mengkredit rekening operasional ••••4417', tone: 'success' });
        L.events.push({ t, text: 'Webhook payment.paid diterima · tanda tangan valid', sub: 'nominal cocok dengan tagihan → lunas otomatis', tone: 'success' });
        J.payment = { method: L.inv.ch, amount: b.amount, ref: L.inv.ref, status: 'paid', inv: b.inv, kw: L.kw, t };
        if (b.inv === UMUM_INV) {
          const K = S.local('kasir');
          K.uInv = K.uInv || UMUM_INV; K.uAt = K.uAt || t; K.sent = '';
          K.pay = { method: L.inv.ch, amount: b.amount, ref: L.inv.ref, kw: L.kw, at: t, hook: true };
        }
        SIM.done();
        SIM.note(`Webhook TPDI masuk: ${L.inv.ch} ${rp(b.amount)} lunas otomatis`, 'success');
      },
      hookGanda(L) {
        if (!L.paidAt) return;
        L.dup += 1;
        L.events.push({ t: SIM.now(1), text: 'Webhook ganda diabaikan (idempoten)', sub: 'Event-Id sama · dibalas 200 OK tanpa pelunasan ganda', tone: '' });
        SIM.note('Webhook TPDI ganda diabaikan; tidak ada pembayaran ganda');
      },
      rekRun(L) { if (L.rekRun) return; L.rekRun = SIM.now(2); SIM.note('Rekonsiliasi 3 arah 4 Okt dijalankan: 3 pengecualian'); },
      tindak(L, J, el) {
        const id = el.dataset.arg;
        const r = REK.find((x) => x.id === id && x.ex);
        if (!r || !L[`act_${id}`] || (L.rekDone && L.rekDone[id])) return;
        L.rekDone = Object.assign({}, L.rekDone, { [id]: { act: L[`act_${id}`], at: SIM.now(1) } });
        SIM.note(`Selisih rekonsiliasi ${r.who} ditindaklanjuti`);
        if (REK.filter((x) => x.ex).every((x) => L.rekDone[x.id])) SIM.note('Rekonsiliasi 3 arah 4 Okt final, tanpa selisih tersisa', 'success');
      },
      rfAjukan(L) {
        if (L.rfStage !== 0) return;
        const nom = angka(L.rfNom);
        const ket = String(L.rfKet || '').trim();
        if (!nom || nom > 3000000) { L.rfErr = `Nominal harus antara Rp1 dan ${rp(3000000)}.`; return; }
        if (!L.rfKat) { L.rfErr = 'Pilih alasan refund.'; return; }
        if (ket.length < 15) { L.rfErr = `Keterangan minimal 15 huruf (sekarang ${ket.length}).`; return; }
        L.rfErr = ''; L.rfStage = 1;
        L.rfLog = [{ t: SIM.now(1), w: `Diajukan oleh ${KASIR} · ${rp(nom)} · ${L.rfKat}` }];
        SIM.note(`Refund ${rp(nom)} untuk Tn. Agus Wijaya diajukan`);
      },
      rfMaju(L) {
        const s = L.rfStage;
        if (s < 1 || s >= 5) return;
        const t = SIM.now(s === 3 || s === 4 ? 30 : 4);
        if (s === 1) { L.rfLog.push({ t, w: `Disetujui supervisor kasir · ${SUPERVISOR}` }); L.rfStage = 2; SIM.note('Refund disetujui supervisor (tingkat 1)'); }
        else if (s === 2) { L.rfLog.push({ t, w: `Disetujui manajer keuangan · ${MANAJER}` }); L.rfLog.push({ t, w: 'Instruksi transfer dikirim lewat TPDI → BTN, debit ••••4417' }); L.rfStage = 4; SIM.note('Refund disetujui manajer keuangan (tingkat 2); transfer diproses BTN'); }
        else { L.rfLog.push({ t, w: 'Dana diterima rekening pasien · refund.completed dari TPDI' }); L.rfStage = 5; SIM.note('Refund selesai; dana kembali ke pasien', 'success'); }
      },
    },
  });

  /* =====================================================================
   * F6 · PEMBIAYAAN BTN
   * ===================================================================== */
  const PLAFON = 15000000000;
  const ADV = 0.9;
  const RATE = 0.08;
  const POOLS = [
    { id: 'p1', per: 'Jul 2026', jenis: 'RJ + RI', berkas: 3214, nilai: 4800000000, st: 'dibiayai', note: 'PCR-2609-01 · berjalan' },
    { id: 'p2', per: 'Agu 2026', jenis: 'RI tahap 1', berkas: 402, nilai: 3500000000, st: 'dibiayai', note: 'PCR-2609-02 · berjalan' },
    { id: 'p3', per: 'Agu 2026', jenis: 'Rawat jalan', berkas: 1842, nilai: 2140000000, st: 'layak', note: 'BA verifikasi 24 Sep' },
    { id: 'p4', per: 'Agu 2026', jenis: 'RI tahap 2', berkas: 210, nilai: 1960000000, st: 'layak', note: 'BA verifikasi 28 Sep' },
    { id: 'p5', per: 'Sep 2026', jenis: 'Rawat jalan', berkas: 1910, nilai: 2480000000, st: 'layak', note: 'BA verifikasi 2 Okt' },
    { id: 'p6', per: 'Sep 2026', jenis: 'RI tahap 1', berkas: 388, nilai: 3120000000, st: 'layak', note: 'BA verifikasi 2 Okt' },
    { id: 'p7', per: 'Sep 2026', jenis: 'RI tahap 2', berkas: 486, nilai: 2940000000, st: 'pending', note: 'menunggu BA verifikasi BPJS' },
    { id: 'p8', per: 'Agu 2026', jenis: 'RI dispute', berkas: 14, nilai: 12400000, st: 'dispute', note: 'dispute verifikator' },
  ];
  const OUT_BASE = 4320000000 + 3150000000;
  const RATNA_SELISIH = 8400000;
  const RATNA_DEPOSIT = 2000000;
  const RATNA_SISA = RATNA_SELISIH - RATNA_DEPOSIT;
  const CIC_STEPS = ['Diajukan', 'Verifikasi BTN', 'Disetujui BTN', 'Akad TTE', 'Dana cair ke RS'];
  const CIC_NEXT = ['', 'Simulasi: BTN memverifikasi data', 'Simulasi: BTN menyetujui', 'Simulasi: pasien tanda tangan akad (TTE)', 'Simulasi: BTN mencairkan dana ke RS'];
  function angsuran(P0, n) {
    const r = 0.11 / 12;
    const a = (P0 * r) / (1 - Math.pow(1 + r, -n));
    let sisa = P0; const rows = [];
    for (let i = 0; i < n; i++) {
      const m = sisa * r; const pk = a - m; sisa = Math.max(0, sisa - pk);
      const mi = (10 + i) % 12; const yr = 2026 + Math.floor((10 + i) / 12);
      rows.push({ ke: i + 1, tgl: `5 ${BULAN[mi]} ${yr}`, pokok: pk, margin: m, ang: a, sisa: i === n - 1 ? 0 : sisa });
    }
    return { a, rows };
  }

  SIM.register({
    id: 'pembiayaan',
    phase: 6,
    title: 'Pembiayaan BTN',
    nav: 'Pembiayaan BTN',
    codes: 'U04',
    role: 'akuntan',
    desc: 'Piutang klaim BPJS yang layak bayar dijaminkan ke BTN (dibatasi plafon dan advance rate) dan dilunasi otomatis saat BPJS membayar. Juga cicilan biaya pasien lewat BTN.',
    hint: 'Pilih batch klaim layak bayar, ajukan ke BTN, simulasikan persetujuan, pencairan, dan BPJS membayar. Coba juga cicilan Ny. Ratna.',
    init: { tab: 'piutang', sel_p3: true, sel_p4: true, sel_p5: false, sel_p6: false, draw: null, tenor: '6', consent: false, cst: 0, ct: [] },
    render(L, J) {
      const tabs = ui.tabs('tab', L.tab, [{ value: 'piutang', label: 'Piutang BPJS' }, { value: 'cicilan', label: 'Cicilan pasien' }]);
      const done = (L.draw && (L.draw.stage === 'cair' || L.draw.stage === 'lunas')) || L.cst >= 5;
      return tabs + (L.tab === 'cicilan' ? this.cicilan(L, J) : this.piutang(L, J))
        + (done ? ui.next('integrasi', L.draw && L.draw.cairAt ? `Pembiayaan ${L.draw.id} ${rp(L.draw.pokok)} cair ke BTN ••••4417.` : 'Cicilan Ny. Ratna dicairkan BTN; tagihan RS lunas.') : '');
    },
    piutang(L, J) {
      const d = L.draw;
      let outstanding = OUT_BASE; let reserved = 0;
      if (d && d.stage === 'cair') outstanding += d.pokok;
      if (d && (d.stage === 'diajukan' || d.stage === 'disetujui')) reserved = d.pokok;
      const sisa = Math.max(0, PLAFON - outstanding - reserved);
      const inDraw = (id) => d && d.pools.includes(id);
      let selTot = 0; let eligible = 0;
      const rows = POOLS.map((p) => {
        const can = p.st === 'layak' && !inDraw(p.id);
        if (can) eligible += p.nilai;
        const on = can && !!L[`sel_${p.id}`];
        if (on) selTot += p.nilai;
        let chip;
        if (inDraw(p.id)) chip = d.stage === 'lunas' ? ui.chip('Dibayar BPJS · lunas', '') : d.stage === 'cair' ? ui.chip(`Dibiayai · ${d.id}`, 'brand') : ui.chip(`Diajukan · ${d.id}`, 'info');
        else chip = { layak: ui.chip('Layak bayar', 'success'), dibiayai: ui.chip('Dibiayai', 'brand'), pending: ui.chip('Pending', 'warning'), dispute: ui.chip('Dispute', 'danger') }[p.st];
        const pick = can && !(d && d.stage !== 'lunas') ? ui.check(`sel_${p.id}`, on, `${p.per} · ${p.jenis}`) : `<span>${E(p.per)} · ${E(p.jenis)}</span>`;
        return [pick, `<span class="small muted">${E(p.note)}</span>`, `<span class="num">${p.berkas.toLocaleString('id-ID')}</span>`, singkat(p.nilai), can ? singkat(p.nilai * ADV) : '—', chip];
      });
      const busy = d && d.stage !== 'lunas';
      const adv = Math.round(selTot * ADV);
      const pokok = Math.min(adv, sisa);
      const provisi = Math.round(pokok * 0.0025);
      const estMargin = Math.round((pokok * RATE * 34) / 365);
      const sel = Object.keys(L).filter((k) => k.startsWith('sel_') && L[k]).length;
      const reason = busy ? `Selesaikan pengajuan ${d.id} dulu.` : selTot === 0 ? 'Pilih minimal satu batch layak bayar.' : sisa <= 0 ? 'Plafon fasilitas sudah terpakai penuh.' : '';
      const calc = ui.card({ title: 'Simulasi pengajuan', sub: `${sel} batch dipilih`, html: true,
        body: `${kv('Nilai klaim dijaminkan', rp(selTot))}${kv('Porsi pembiayaan (advance 90%)', rp(adv))}${kv('Sisa plafon', rp(sisa))}${adv > sisa ? ui.alert('warning', 'Melebihi sisa plafon', 'Nilai pencairan dibatasi ke sisa plafon. Kurangi pilihan agar klaim tidak terikat berlebih.') : ''}
          ${kv('Biaya provisi 0,25% (simulasi)', rp(provisi))}${kv('Estimasi margin 8% p.a. × 34 hari', rp(estMargin))}${kv('Dana cair ke ••••4417', rp(pokok), { strong: true, top: true })}
          <div style="margin-top:8px">${ui.btn('Ajukan pembiayaan ke BTN', { act: 'ajukan', variant: 'primary', disabled: !!reason, reason })}</div>
          <div class="small muted" style="margin-top:6px">Angka produk, margin, dan syarat milik BTN; di SIM RS hanya estimasi berlabel.</div>` });
      let prog = '';
      if (d) {
        const lvl = { diajukan: 1, disetujui: 2, cair: 3, lunas: 4 }[d.stage];
        const next = d.stage === 'diajukan' ? ui.btn('Simulasi: BTN menyetujui', { act: 'majuDraw', variant: 'primary' })
          : d.stage === 'disetujui' ? ui.btn('Simulasi: BTN mencairkan dana', { act: 'majuDraw', variant: 'primary' })
            : d.stage === 'cair' ? ui.btn('Simulasi: BPJS membayar klaim batch ini', { act: 'bpjsBayar', variant: 'primary' }) : '';
        const pay = d.pay ? ui.card({ title: `BPJS membayar · ${d.lunasAt}`, sub: 'pelunasan otomatis lewat auto-debit rekening penampungan', tone: 'success', html: true,
          body: `${kv('Dana BPJS masuk ••••9021', rp(d.pay.klaim))}${kv(`Pelunasan pokok ${d.id}`, `− ${rp(d.pokok)}`)}${kv(`Margin ${d.pay.days} hari × 8% p.a.`, `− ${rp(d.pay.margin)}`)}${kv('Diteruskan ke operasional ••••4417', rp(d.pay.sisa), { strong: true, top: true })}
            <div class="small muted" style="margin-top:6px">Jurnal: Bank penampungan (D) / Piutang BPJS (K) · Utang pembiayaan + Beban margin (D) / Bank penampungan (K) · sisa ke operasional.</div>` }) : '';
        prog = ui.card({ title: `Pengajuan ${d.id} · ${rp(d.pokok)}`, sub: `dasar: ${d.pools.map((id) => { const p = POOLS.find((x) => x.id === id); return `${p.per} ${p.jenis}`; }).join(', ')} · ${singkat(d.klaim)}`,
          body: `<div class="stack">${ui.steps(['Diajukan', 'Disetujui BTN', 'Dana cair', 'Dilunasi BPJS'], lvl)}${ui.timeline([
            { t: d.ajuAt, text: 'Diajukan ke BTN', tone: 'success' },
            { t: d.okAt, text: 'Disetujui BTN', sub: d.okAt ? 'plafon dan porsi dikonfirmasi BTN' : 'menunggu', tone: d.okAt ? 'success' : '' },
            { t: d.cairAt, text: 'Dana cair ke rekening operasional ••••4417', sub: d.cairAt ? 'Bank (D) / Utang pembiayaan BTN (K)' : 'menunggu', tone: d.cairAt ? 'success' : '' },
            { t: d.lunasAt, text: 'Pelunasan otomatis saat BPJS membayar', sub: d.lunasAt ? 'pokok + margin didebit dari ••••9021' : 'menunggu pembayaran klaim', tone: d.lunasAt ? 'success' : '' },
          ])}<div class="row">${next}</div>${pay}</div>` });
      }
      const cs = J.claim ? ({ grouped: 'ter-grouping', final: 'final', sent: 'terkirim', verifikasi: 'diverifikasi', layak: 'layak bayar', paid: 'sudah dibayar' }[J.claim.status] || J.claim.status) : 'terkirim';
      return `<div class="grid g4">${ui.kpi('Plafon fasilitas', singkat(PLAFON), 'simulasi · revolving')}${ui.kpi('Outstanding', singkat(outstanding), d && d.stage === 'cair' ? '3 pencairan berjalan' : '2 pencairan berjalan')}${ui.kpi('Sisa plafon', singkat(sisa), reserved ? `${singkat(reserved)} dalam proses` : `${Math.round((sisa / PLAFON) * 100)}% tersedia`, 'up')}${ui.kpi('Klaim layak belum dijaminkan', singkat(eligible), 'rata-rata cair BPJS 34 hari')}</div>
        ${ui.card({ title: 'Pool piutang klaim BPJS', sub: 'hanya klaim layak bayar, belum dibiayai, belum dibayar, dan tidak dispute', flush: true, body: ui.table(['Batch', 'Keterangan', { label: 'Berkas', r: true }, { label: 'Nilai', r: true }, { label: 'Maks. 90%', r: true }, 'Status'], rows) })}
        <div class="small muted">Klaim Tn. Suryo (${CBG.code}, ${rp(J.claim ? J.claim.tariff : CBG.tariff)}) berstatus ${E(cs)}${J.claim ? '' : ' (data contoh)'}; masuk pool Oktober setelah berita acara layak bayar.</div>
        <div class="grid g2">${calc}${prog || ui.card({ title: 'Alur pembiayaan', body: ui.timeline([{ t: '', text: 'Klaim layak bayar → pool fasilitas BTN' }, { t: '', text: 'Pengajuan ≤ 90% nilai klaim dan ≤ sisa plafon' }, { t: '', text: 'BTN menyetujui dan mencairkan ke ••••4417' }, { t: '', text: 'BPJS membayar ke ••••9021 → auto-debit pokok + margin, sisa ke operasional' }]) })}</div>`;
    },
    cicilan(L, J) {
      const s = L.cst;
      const n = Number(L.tenor) || 6;
      const sch = angsuran(RATNA_SISA, n);
      const tenorSel = s === 0 ? ui.seg('tenor', L.tenor, [{ value: '3', label: '3 bulan' }, { value: '6', label: '6 bulan' }, { value: '12', label: '12 bulan' }]) : ui.chip(`Tenor ${n} bulan · terkunci`, '');
      const op = J.surgery ? ui.chip(`Operasi selesai${J.surgery.signOut ? ` ${J.surgery.signOut}` : ''}`, 'success') : contoh();
      let ctl = '';
      if (s === 0) {
        ctl = `<div class="stack">${ui.check('consent', L.consent, 'Pasien menyetujui identitas, kontak, nilai, dan tenor dikirim ke BTN untuk pengajuan cicilan (UU PDP). Data penghasilan diisi pasien langsung di kanal BTN.')}
          <div>${ui.btn('Ajukan cicilan ke BTN', { act: 'cicAjukan', variant: 'primary', disabled: !L.consent, reason: 'Centang persetujuan pasien dulu.' })}</div></div>`;
      } else if (s < 5) {
        ctl = `<div class="row">${ui.btn(CIC_NEXT[s], { act: 'cicMaju', variant: 'primary' })}<span class="small muted">Keputusan kredit oleh BTN, bukan RS.</span></div>`;
      } else {
        ctl = ui.alert('success', `Dana cair ${L.ct[4] || ''} · tagihan RS lunas`, `BTN mentransfer ${rp(RATNA_SISA)} ke ••••4417; tagihan INV-2610-02240 lunas dengan metode pembiayaan BTN. Angsuran dibayar pasien langsung ke BTN.`);
      }
      const rows = sch.rows.map((r) => [String(r.ke), E(r.tgl), rp(r.pokok), rp(r.margin), rp(r.ang), rp(r.sisa)]);
      return `${ui.banner(RATNA, `${ui.chip('Naik kelas VIP', 'warning')}${op}`)}
        <div class="grid g2">${ui.card({ title: 'Selisih biaya naik kelas', sub: 'Kolesistektomi laparoskopik · hak BPJS kelas 2 → VIP', html: true,
          body: `${kv('Selisih naik kelas VIP (aturan JKN)', rp(RATNA_SELISIH))}${kv('Deposit via VA BTN (4 Okt)', `− ${rp(RATNA_DEPOSIT)}`)}${kv('Diajukan cicilan', rp(RATNA_SISA), { strong: true, top: true })}
            <div style="margin-top:8px">${tenorSel}</div>${kv('Estimasi angsuran per bulan', rp(sch.a), { strong: true })}<div class="small muted">Simulasi margin 11% p.a. anuitas; angka final ditetapkan BTN.</div>` })}
        ${ui.card({ title: 'Status pengajuan', sub: 'INV-2610-02240', body: `<div class="stack">${ui.steps(CIC_STEPS, s)}${ui.timeline(CIC_STEPS.map((l, i) => ({ t: L.ct[i] || '', text: l, tone: i < s ? 'success' : '' })))}${ctl}</div>` })}</div>
        ${ui.card({ title: `Jadwal angsuran · ${n} bulan`, sub: s >= 3 ? 'disetujui BTN' : 'estimasi', flush: true, body: ui.table(['Ke', 'Jatuh tempo', { label: 'Pokok', r: true }, { label: 'Margin', r: true }, { label: 'Angsuran', r: true }, { label: 'Sisa pokok', r: true }], rows) })}`;
    },
    actions: {
      ajukan(L, J) {
        if (L.draw && L.draw.stage !== 'lunas') return;
        const pools = POOLS.filter((p) => p.st === 'layak' && L[`sel_${p.id}`] && !(L.draw && L.draw.pools.includes(p.id)));
        if (!pools.length) { SIM.toast('Pilih minimal satu batch layak bayar.', 'warning'); return; }
        const klaim = pools.reduce((a, p) => a + p.nilai, 0);
        const sisa = PLAFON - OUT_BASE;
        const pokok = Math.min(Math.round(klaim * ADV), sisa);
        L.draw = { id: 'PCR-2610-01', pools: pools.map((p) => p.id), klaim, pokok, stage: 'diajukan', ajuAt: SIM.now(2), okAt: '', cairAt: '', lunasAt: '', pay: null };
        pools.forEach((p) => { L[`sel_${p.id}`] = false; });
        J.financing = Object.assign({}, J.financing, { id: L.draw.id, amount: pokok, klaim, status: 'diajukan' });
        SIM.note(`Pembiayaan piutang BPJS ${rp(pokok)} diajukan ke BTN`);
      },
      majuDraw(L, J) {
        const d = L.draw;
        if (!d) return;
        if (d.stage === 'diajukan') { d.stage = 'disetujui'; d.okAt = SIM.now(30); SIM.note(`BTN menyetujui pembiayaan ${d.id}`); }
        else if (d.stage === 'disetujui') { d.stage = 'cair'; d.cairAt = SIM.now(20); SIM.done(); SIM.note(`Dana pembiayaan ${rp(d.pokok)} cair ke BTN ••••4417`, 'success'); }
        else return;
        J.financing = Object.assign({}, J.financing, { status: d.stage });
      },
      bpjsBayar(L, J) {
        const d = L.draw;
        if (!d || d.stage !== 'cair') return;
        const days = 31;
        const margin = Math.round((d.pokok * RATE * days) / 365);
        d.pay = { klaim: d.klaim, days, margin, sisa: d.klaim - d.pokok - margin };
        d.stage = 'lunas'; d.lunasAt = SIM.now(5);
        J.financing = Object.assign({}, J.financing, { status: 'lunas', margin, sisa: d.pay.sisa });
        SIM.note(`BPJS membayar klaim; pembiayaan ${d.id} lunas otomatis`, 'success');
      },
      cicAjukan(L, J) {
        if (L.cst !== 0 || !L.consent) return;
        L.cst = 1; L.ct = [SIM.now(2)];
        J.financing = Object.assign({ amount: 0, status: 'belum' }, J.financing, { cicilan: { patient: 'ratna', amount: RATNA_SISA, tenor: Number(L.tenor) || 6, status: 'diajukan' } });
        SIM.note(`Cicilan selisih naik kelas Ratna ${rp(RATNA_SISA)} diajukan ke BTN`);
      },
      cicMaju(L, J) {
        if (L.cst < 1 || L.cst >= 5) return;
        L.ct.push(SIM.now(L.cst === 3 ? 10 : 20));
        L.cst += 1;
        const st = ['', 'diajukan', 'verifikasi', 'disetujui', 'akad', 'dicairkan'][L.cst];
        J.financing = Object.assign({ amount: 0, status: 'belum' }, J.financing);
        J.financing.cicilan = Object.assign({}, J.financing.cicilan, { status: st });
        if (L.cst === 5) { SIM.done(); SIM.note('BTN mencairkan cicilan Ratna; tagihan RS lunas', 'success'); }
        else SIM.note(`Cicilan Ratna: ${CIC_STEPS[L.cst - 1].toLowerCase()}`);
      },
    },
  });

  /* =====================================================================
   * F7 · INTEGRASI (integration hub + SATUSEHAT)
   * ===================================================================== */
  function suryoMsgs(L, J) {
    const lab = J.labResult && Array.isArray(J.labResult.items) ? J.labResult.items.find((i) => /a1c/i.test(i.name || '')) : null;
    const hba = lab ? `${lab.value ?? ''} ${lab.unit ?? ''}`.trim() : '9,1 %';
    const td = J.soap && J.soap.ttv && J.soap.ttv.td ? J.soap.ttv.td : '148/92';
    const enc = J.encounter && J.encounter.no ? J.encounter.no : 'RJ-261005-0042';
    return [
      { id: 'm1', res: 'Encounter', what: 'Kunjungan rawat jalan dimulai', t: '08.14', st: 'ok',
        body: { resourceType: 'Encounter', status: 'arrived', class: { code: 'AMB', display: 'ambulatory' }, subject: { reference: 'Patient/P02478375538' }, location: [{ location: { display: P.poli } }], identifier: [{ value: enc }] } },
      { id: 'm2', res: 'Condition', what: 'E11.9 Diabetes melitus tipe 2', t: '08.33', st: 'ok',
        body: { resourceType: 'Condition', code: { coding: [{ system: 'http://hl7.org/fhir/sid/icd-10', code: 'E11.9' }] }, subject: { reference: 'Patient/P02478375538' }, encounter: { reference: 'Encounter/{id-kunjungan}' } } },
      { id: 'm3', res: 'Observation', what: `Tanda vital: TD ${td}`, t: '08.33', st: 'ok',
        body: { resourceType: 'Observation', status: 'final', code: { coding: [{ system: 'http://loinc.org', code: '85354-9', display: 'Blood pressure panel' }] }, valueString: td } },
      { id: 'm4', res: 'Observation', what: `HbA1c ${hba}`, t: '09.02', st: L.m4At ? 'ok' : 'dlq',
        body: { resourceType: 'Observation', status: 'final', code: { coding: [L.mapped ? { system: 'http://loinc.org', code: '4548-4', display: 'Hemoglobin A1c/Hemoglobin.total in Blood' } : { system: 'http://loinc.org', code: 'lokal-HbA1c' }] }, valueString: hba } },
      { id: 'm5', res: 'MedicationRequest', what: 'Metformin 500 mg 2 × 1', t: '08.47', st: 'ok',
        body: { resourceType: 'MedicationRequest', status: 'active', intent: 'order', medicationReference: { display: 'Metformin 500 mg tablet (KFA)' }, dosageInstruction: [{ text: '2 × 1 sesudah makan' }] } },
      { id: 'm6', res: 'Encounter', what: 'Kunjungan selesai + diagnosis', t: L.m6At || '—', st: L.m6At ? 'ok' : 'hold',
        body: { resourceType: 'Encounter', status: 'finished', diagnosis: [{ condition: { reference: 'Condition/{id-E11.9}' }, rank: 1 }] } },
    ];
  }
  const OTHER_DLQ = [
    { id: 'd1', dest: 'SATUSEHAT', res: 'Encounter · Ny. Ratna Sari', err: 'Nomor IHS pasien belum ada', t: '08.05', needIhs: true,
      payload: 'POST /fhir/Encounter  → 422 Unprocessable Entity\n{ "issue": [{ "severity": "error", "code": "required",\n  "diagnostics": "Encounter.subject: IHS number pasien belum ada" }] }' },
    { id: 'd2', dest: 'BPJS Antrean', res: 'updatewaktu task 5', err: 'Task 4 belum dikirim untuk kode booking', t: '08.40',
      payload: 'POST /antreanrs/antrean/updatewaktu  → 200 OK (ditolak di level bisnis)\n{ "metadata": { "code": 201, "message": "Task 4 belum dikirim untuk kodebooking ini" },\n  "request": { "taskid": 5 } }' },
    { id: 'd3', dest: 'TPDI · BTN', res: 'POST /v1/invoices · VA BTN', err: 'API BTN tidak merespons lewat TPDI (504)', t: '07.58',
      payload: 'POST /tpdi/v1/invoices  → 504 Gateway Timeout\nIdempotency-Key: INV-2610-02240-VA-01  (aman diulang, tidak membuat VA ganda)\n{ "channel": "VA_BTN", "invoice": "INV-2610-02240", "amount": 1320000 }' },
  ];
  const SYSTEMS = [
    { n: 'SATUSEHAT', p: 'FHIR R4 · OAuth2', vol: '18.402', lat: '820 ms' },
    { n: 'BPJS VClaim', p: 'REST · tanda tangan HMAC', vol: '1.312', lat: '410 ms' },
    { n: 'BPJS Antrean', p: 'REST · task ID 1–7', vol: '7.886', lat: '290 ms' },
    { n: 'BPJS Aplicare', p: 'REST · ketersediaan bed', vol: '288', lat: '350 ms' },
    { n: 'BPJS E-Klaim', p: 'REST lokal · terenkripsi', vol: '214', lat: '180 ms' },
    { n: 'Kemenkes SIRS', p: 'RS Online · RL', vol: '96', lat: '640 ms' },
    { n: 'Dukcapil', p: 'verifikasi NIK', vol: '142', lat: '510 ms' },
    { n: 'TPDI · BTN', p: 'webhook HMAC · H2H mTLS', vol: '611', lat: '350 ms' },
  ];

  SIM.register({
    id: 'integrasi',
    phase: 7,
    title: 'Integrasi',
    codes: 'I01 · I02 · I03 · I04 · I05',
    role: 'admin',
    desc: 'Integration hub: status tiap sistem luar, antrean pesan, DLQ dan kirim ulang yang diaudit, serta pengiriman resource SATUSEHAT berurutan.',
    hint: 'Buka pesan HbA1c Suryo yang gagal, perbaiki pemetaan LOINC, kirim ulang, lalu cari IHS Ny. Ratna.',
    init: { dest: '', sel: 'm4', mapped: false, m4At: '', m6At: '', gone: {}, ihsRatna: '', flash: '' },
    render(L, J) {
      const msgs = suryoMsgs(L, J);
      const dlqOthers = OTHER_DLQ.filter((d) => !L.gone[d.id]);
      const dlqCount = (n) => (n === 'SATUSEHAT' ? (L.m4At ? 0 : 1) : 0) + dlqOthers.filter((d) => d.dest === n).length;
      const queue = { SATUSEHAT: L.m6At ? 3 : 4, 'BPJS Antrean': 2, 'TPDI · BTN': 0 };
      const cards = SYSTEMS.map((s) => {
        const bad = dlqCount(s.n);
        const on = L.dest === s.n;
        return `<button type="button" class="card" data-set="dest=${on ? '' : E(s.n)}" style="text-align:left;padding:12px 14px;cursor:pointer;${on ? 'border-color:var(--brand-600);box-shadow:0 0 0 1px var(--brand-600)' : ''}">
          <div class="row between"><b>${E(s.n)}</b>${bad ? ui.chip('Terganggu', 'danger') : ui.chip('Sehat', 'success')}</div>
          <div class="small muted">${E(s.p)}</div>
          <div class="row small" style="margin-top:6px;gap:12px"><span>Hari ini <b class="num">${E(s.vol)}</b></span><span>Latensi <b class="num">${E(s.lat)}</b></span><span>Antrean <b class="num">${queue[s.n] || 0}</b></span><span style="color:${bad ? 'var(--danger)' : 'inherit'}">DLQ <b class="num">${bad}</b></span></div></button>`;
      }).join('');
      const sent = msgs.filter((m) => m.st === 'ok').length;
      const msgRows = msgs.map((m) => [
        `<span class="mono">${E(m.t)}</span>`, `<b>${E(m.res)}</b>`, E(m.what),
        m.st === 'ok' ? ui.chip('Terkirim', 'success') : m.st === 'dlq' ? ui.chip('Gagal · DLQ', 'danger') : ui.chip('Ditahan, tunggu Observation', 'warning'),
      ]);
      const showSS = !L.dest || L.dest === 'SATUSEHAT';
      const bundle = showSS ? ui.card({ title: 'SATUSEHAT · kunjungan Tn. Suryo', sub: `${sent}/${msgs.length} resource terkirim · urutan Encounter → anak → Encounter selesai`, flush: true,
        body: ui.table(['Waktu', 'Resource', 'Isi', 'Status'], msgRows, { act: 'pilih', sel: msgs.findIndex((m) => m.id === L.sel), rowArgs: msgs.map((m) => m.id) }) }) : '';
      const dlqRows = [];
      if (!L.m4At && showSS) dlqRows.push({ id: 'm4', dest: 'SATUSEHAT', res: 'Observation · HbA1c Tn. Suryo', err: 'Kode LOINC tidak dikenal: lokal-HbA1c', t: '09.02' });
      dlqOthers.filter((d) => !L.dest || d.dest === L.dest).forEach((d) => dlqRows.push(d));
      const dlq = ui.card({ title: 'Antrean gagal (DLQ)', sub: `${dlqRows.length} pesan${L.dest ? ` · ${L.dest}` : ''} · klik untuk detail`, flush: true,
        body: ui.table(['Waktu', 'Tujuan', 'Pesan', 'Galat'], dlqRows.map((d) => [`<span class="mono">${E(d.t)}</span>`, E(d.dest), E(d.res), `<span style="color:var(--danger)">${E(d.err)}</span>`]), { act: 'pilih', sel: dlqRows.findIndex((d) => d.id === L.sel), rowArgs: dlqRows.map((d) => d.id), empty: 'DLQ kosong. Semua pesan terkirim.' }) });
      const detail = this.detail(L, J, msgs);
      const ihs = ui.card({ title: 'Peta ID pasien ke IHS', sub: 'nomor IHS disimpan terenkripsi; dicari lewat NIK tervalidasi Dukcapil', flush: true,
        body: ui.table(['Pasien', 'No. RM', 'NIK', 'IHS', 'Status'], [
          [E(P.name), `<span class="mono">${E(P.rm)}</span>`, `<span class="mono">${E(P.nik)}</span>`, '<span class="mono">P02478375538</span>', ui.chip('Terverifikasi', 'success')],
          [E(HARTONO.name), `<span class="mono">${E(HARTONO.rm)}</span>`, `<span class="mono">${E(HARTONO.nik)}</span>`, '<span class="mono">P01938442210</span>', ui.chip('Terverifikasi', 'success')],
          [E(RATNA.name), `<span class="mono">${E(RATNA.rm)}</span>`, `<span class="mono">${E(RATNA.nik)}</span>`, L.ihsRatna ? '<span class="mono">P03319027764</span>' : '<span class="muted">belum ada</span>',
            L.ihsRatna ? ui.chip(`Ditemukan ${L.ihsRatna}`, 'success') : ui.btn('Cari IHS lewat NIK', { act: 'cariIhs', size: 'sm' })],
        ]) });
      const flash = L.flash ? ui.alert('success', 'Kirim ulang berhasil', E(L.flash)) : '';
      return `<div class="row">${ui.chip(`${SYSTEMS.filter((s) => dlqCount(s.n)).length} sistem terganggu`, SYSTEMS.some((s) => dlqCount(s.n)) ? 'warning' : 'success')}${L.dest ? `${ui.chip(`Filter: ${L.dest}`, 'brand')}${ui.btn('Hapus filter', { set: 'dest=', size: 'sm', variant: 'ghost' })}` : '<span class="small muted">Klik kartu sistem untuk menyaring DLQ.</span>'}</div>
        <div class="grid g4">${cards}</div>${flash}
        <div class="grid g2"><div class="stack">${bundle}${dlq}</div>${detail}</div>${ihs}
        ${L.m6At ? ui.next('akuntansi', `Kunjungan Suryo lengkap terkirim ke SATUSEHAT (${sent} resource) setelah kirim ulang ${L.m4At}.`) : ''}`;
    },
    detail(L, J, msgs) {
      const m = msgs.find((x) => x.id === L.sel);
      if (m) {
        const status = m.st === 'ok' ? `← 201 Created · ${m.t}` : m.st === 'dlq' ? '→ 400 Bad Request (5/5 percobaan, masuk DLQ)' : 'ditahan sampai semua Observation terkirim';
        let code = `POST /fhir/${m.res}  ${status}\n${JSON.stringify(m.body, null, 2)}`;
        if (m.st === 'dlq') code += `\n\n{ "issue": [{ "severity": "error", "code": "code-invalid",\n  "diagnostics": "Observation.code.coding[0]: '${L.mapped ? '4548-4' : 'lokal-HbA1c'}' ${L.mapped ? 'valid' : 'tidak ada di http://loinc.org'}" }] }`;
        let acts = '';
        if (m.id === 'm4' && !L.m4At) {
          acts = `<div class="stack">${L.mapped ? ui.alert('success', 'Pemetaan diperbaiki', 'lokal-HbA1c → LOINC 4548-4 (Hemoglobin A1c). Berlaku untuk pesan berikutnya juga.') : ui.alert('warning', 'Perbaiki data dulu', 'Kode pemeriksaan lokal belum dipetakan ke LOINC. Kirim ulang tanpa perbaikan akan gagal lagi.')}
            <div class="row">${L.mapped ? '' : ui.btn('Petakan lokal-HbA1c → LOINC 4548-4', { act: 'petakan' })}${ui.btn('Kirim ulang', { act: 'kirimUlang', arg: 'm4', variant: 'primary', disabled: !L.mapped, reason: 'Perbaiki pemetaan kode LOINC dulu.' })}</div></div>`;
        }
        return ui.card({ title: `Detail pesan · ${m.res}`, sub: m.what, body: `<div class="stack"><div class="code">${E(code)}</div>${acts}</div>` });
      }
      const d = OTHER_DLQ.find((x) => x.id === L.sel && !L.gone[x.id]);
      if (d) {
        const blocked = d.needIhs && !L.ihsRatna;
        return ui.card({ title: `Detail pesan · ${d.dest}`, sub: d.res, body: `<div class="stack"><div class="code">${E(d.payload)}</div>
          ${ui.btn(d.id === 'd2' ? 'Kirim ulang berurutan (task 4 lalu 5)' : 'Kirim ulang', { act: 'kirimUlang', arg: d.id, variant: 'primary', disabled: blocked, reason: 'Cari IHS Ny. Ratna dulu di peta ID pasien.' })}</div>` });
      }
      return ui.card({ title: 'Detail pesan', body: ui.empty('Pilih pesan di daftar untuk melihat payload.') });
    },
    actions: {
      pilih(L, J, el) { if (el.dataset.arg) L.sel = el.dataset.arg; },
      petakan(L) { if (L.mapped) return; L.mapped = true; L.sel = 'm4'; SIM.note('Kode lab lokal HbA1c dipetakan ke LOINC 4548-4'); },
      kirimUlang(L, J, el) {
        const id = el.dataset.arg;
        if (id === 'm4') {
          if (!L.mapped || L.m4At) return;
          L.m4At = SIM.now(1); L.m6At = SIM.now(1);
          L.flash = `Observation HbA1c Suryo dikirim ulang ${L.m4At} → 201 Created; Encounter selesai ikut terkirim ${L.m6At}. Tercatat di log audit.`;
          J.satusehat = { sent: 6, failed: 0 };
          SIM.done();
          SIM.note('Observation HbA1c Suryo dikirim ulang; kunjungan lengkap terkirim ke SATUSEHAT', 'success');
          return;
        }
        const d = OTHER_DLQ.find((x) => x.id === id);
        if (!d || L.gone[id] || (d.needIhs && !L.ihsRatna)) return;
        L.gone = Object.assign({}, L.gone, { [id]: SIM.now(1) });
        L.flash = `${d.dest} · ${d.res} dikirim ulang ${L.gone[id]} → diterima, dihapus dari DLQ, tercatat di log audit.`;
        if (L.sel === id) L.sel = 'm4';
        SIM.note(`Pesan ${d.dest} dikirim ulang dari DLQ`);
      },
      cariIhs(L) { if (L.ihsRatna) return; L.ihsRatna = SIM.now(1); L.sel = 'd1'; SIM.note('IHS Ny. Ratna ditemukan lewat NIK tervalidasi'); },
    },
    onEnter(L, J) {
      if (!J.satusehat) J.satusehat = { sent: L.m4At ? 6 : 4, failed: L.m4At ? 0 : 1 };
    },
  });
})();
