/* =====================================================================
 * Layar fase 0–2 (agen A).
 * Fase 0: fondasi · Fase 1: masuk, akses, audit, mpi, formulir
 * Fase 2: jadwal, layanan-publik, anjungan, pendaftaran, kendali, display
 * Hanya berisi SIM.register({...}); semua data fiktif.
 * ===================================================================== */
(function () {
  'use strict';
  const { ui, PEOPLE } = SIM;
  const esc = ui.esc;
  const P = PEOPLE.suryo;
  const RS = PEOPLE.rs;

  /* ---------------- helper bersama ---------------- */
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const contoh = (on = true) => (on ? ui.chip('data contoh', 'info') : '');
  const argOf = (el) => (el && el.dataset ? el.dataset.arg : undefined);
  const nextOf = (ids, text) => { for (const id of ids) if (SIM.screens.has(id)) return ui.next(id, text); return ''; };
  const hhmm = (min) => { const m = ((min % 1440) + 1440) % 1440; return `${String(Math.floor(m / 60)).padStart(2, '0')}.${String(m % 60).padStart(2, '0')}`; };
  /** Baris kunci–nilai; v berupa HTML (escape di pemanggil). */
  const kv = (k, v) => `<div class="row between small" style="gap:12px;flex-wrap:nowrap"><span class="muted">${esc(k)}</span><b style="text-align:right">${v}</b></div>`;
  const mask = (name) => String(name).replace(/^(Tn\.|Ny\.|An\.|Nn\.)\s*/, '').split(/\s+/).map((w) => w.slice(0, 2) + '•'.repeat(Math.max(1, w.length - 2))).join(' ');
  const BULAN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
  const dobNoYear = (dob) => { const [d, m] = String(dob).split('-'); return `${Number(d)} ${BULAN[Number(m) - 1] || ''}`.trim(); };
  const BOOKING = { code: '2610050042', date: 'Senin, 5 Okt 2026', poli: 'Poli Penyakit Dalam', dokter: 'dr. Andi Wiratama, Sp.PD', sesi: '08.00–12.00', no: 'PD-007', patient: 'suryo' };
  const booking = (J) => J.booking || BOOKING;
  const tno = (pfx, n) => `${pfx}-${String(n).padStart(3, '0')}`;
  const bar = (pct, tone = 'var(--brand-600)') => `<div style="height:6px;border-radius:99px;background:var(--line-soft);overflow:hidden"><div style="height:100%;width:${Math.max(0, Math.min(100, pct))}%;background:${tone}"></div></div>`;
  const quotaTone = (pct) => (pct >= 100 ? 'var(--danger)' : pct >= 80 ? 'var(--warning)' : 'var(--brand-600)');
  /** Kertas cetak termal 80 mm (±302 px). */
  const paper = (inner) => `<div style="width:302px;max-width:100%;margin:0 auto;background:var(--card);border:1px solid var(--line);border-radius:4px;padding:16px 18px 20px;font-family:var(--font-mono);font-size:12px;line-height:1.55;color:var(--ink-900);box-shadow:var(--shadow)">${inner}</div>`;
  const barcode = '<div aria-hidden="true" style="height:34px;margin-top:10px;background:repeating-linear-gradient(90deg,var(--ink-900) 0 2px,transparent 2px 4px,var(--ink-900) 4px 5px,transparent 5px 8px,var(--ink-900) 8px 11px,transparent 11px 13px)"></div>';
  const dash = '<div style="border-top:1px dashed var(--line-strong);margin:8px 0"></div>';
  const center = (html, style = '') => `<div style="text-align:center;${style}">${html}</div>`;
  /** Keypad angka 3×4; arg = digit | clr | del. */
  const keypad = (act, size = 'lg') => {
    const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'clr', '0', 'del'];
    const lbl = { clr: 'Kosongkan', del: 'Hapus' };
    return `<div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px">${keys.map((k) => ui.btn(lbl[k] || k, { act, arg: k, size })).join('')}</div>`;
  };
  const press = (cur, k, max) => {
    const s = String(cur || '');
    if (k === 'clr') return '';
    if (k === 'del') return s.slice(0, -1);
    if (/^\d$/.test(String(k)) && s.length < max) return s + k;
    return s;
  };

  /* =====================================================================
   * FASE 0 · Status fondasi
   * ===================================================================== */
  const SERVICES = [
    { name: 'Web (Next.js)', port: ':3000', check: 'Halaman beranda dan /dev/ui terbuka', ms: 38 },
    { name: 'API (NestJS)', port: ':4000', check: '/ready: database, Redis, MinIO hijau', ms: 21 },
    { name: 'Mock integrasi', port: ':4100', check: 'BPJS, Dukcapil, SATUSEHAT, TTE, TPDI, BTN', ms: 12 },
    { name: 'PostgreSQL 16', port: ':5432', check: 'Peran aplikasi + isolasi RS aktif', ms: 4 },
    { name: 'MinIO (dokumen)', port: ':9000', check: 'Wadah simrs-dokumen bisa ditulis', ms: 9 },
    { name: 'Mailpit (email uji)', port: ':8025', check: 'Email OTP dan undangan tertangkap', ms: 6 },
  ];
  const RLS = {
    sendiri: { label: 'Baca pasien RS sendiri', ok: true, text: `Sesi terikat ke ${RS.name}. Daftar pasien mengembalikan 200 baris, semuanya milik RS ini.` },
    lain: { label: 'Coba baca data RS lain', ok: false, text: 'Ditolak. Sesi RS Fiktif Andalas meminta pasien RS Fiktif Bahari: 0 baris kembali, dan percobaan tercatat di audit.' },
    tanpa: { label: 'Query tanpa konteks RS', ok: false, text: 'Ditolak. Query tanpa konteks RS gagal sebelum menyentuh data apa pun.' },
  };
  const CI_STAGES = [['Lint', '18 dtk'], ['Typecheck', '41 dtk'], ['Uji unit · 412', '1 mnt 52 dtk'], ['Uji isolasi RS · 18', '24 dtk'], ['Uji izin · 36 kombinasi', '19 dtk'], ['E2E Playwright · 24', '2 mnt 31 dtk'], ['Build', '55 dtk']];

  function fondasiTick() {
    const L = SIM.local('fondasi');
    if (!L.running) return;
    L.at.push(SIM.time());
    L.checked += 1;
    if (L.checked >= SERVICES.length) {
      L.running = false;
      if (SIM.cur === 'fondasi') SIM.note('Enam layanan lokal sehat; pemeriksaan kesiapan hijau', 'success');
      if (L.rlsDenied) SIM.done('fondasi');
    }
    if (SIM.cur === 'fondasi') SIM.render(); else SIM.save();
    if (L.running) setTimeout(fondasiTick, 420);
  }

  SIM.register({
    id: 'fondasi', phase: 0, title: 'Status fondasi', nav: 'Status fondasi', codes: 'Fase 0 · /dev/ui', role: 'admin',
    desc: 'Bukti bahwa kerangka hidup dari ujung ke ujung: layanan lokal, isolasi data per RS, CI, dan katalog komponen UI bersama.',
    hint: 'Klik "Periksa kesehatan", lalu "Coba baca data RS lain" di kartu isolasi.',
    init: { checked: 0, at: [], running: false, rls: [], rlsDenied: false, ciAt: '', comp: 'tombol', alasan: '', batalAt: '', demoNik: '317105' },
    onEnter(L) { if (L.running) L.running = false; },
    render(L) {
      const allOk = L.checked >= SERVICES.length;
      const rows = SERVICES.map((s, i) => {
        const ok = i < L.checked; const busy = L.running && i === L.checked;
        return [`<b>${esc(s.name)}</b>`, `<span class="mono">${esc(s.port)}</span>`, `<span class="small muted">${esc(s.check)}</span>`, ok ? `${s.ms} ms` : '—',
          ok ? ui.chip(`Sehat · ${L.at[i] || SIM.time()}`, 'success') : busy ? ui.chip('Memeriksa…', 'warning') : ui.chip('Belum diperiksa')];
      });
      const svc = ui.card({
        title: 'Layanan lokal', sub: 'docker compose + pnpm dev',
        actions: ui.btn(L.running ? 'Memeriksa…' : allOk ? 'Periksa ulang' : 'Periksa kesehatan', { act: 'periksa', variant: 'primary', disabled: L.running, reason: L.running ? 'Pemeriksaan sedang berjalan' : '' }),
        flush: true, body: ui.table(['Layanan', 'Alamat', 'Pemeriksaan', { label: 'Respons', r: true }, 'Status'], rows),
      });
      const rlsLog = L.rls.length ? ui.timeline(L.rls.map((r) => ({ t: r.t, text: `<b>${esc(RLS[r.k].label)}</b> · ${RLS[r.k].ok ? ui.chip('Diizinkan', 'success') : ui.chip('Ditolak', 'danger')}`, html: true, sub: RLS[r.k].text, tone: RLS[r.k].ok ? 'success' : 'danger' })))
        : ui.empty('Belum ada uji. Coba baca data RS lain untuk membuktikan isolasi.');
      const rls = ui.card({
        title: 'Isolasi data per RS', sub: `Sesi uji: ${RS.name} (${RS.code})`, tone: L.rlsDenied ? 'success' : '',
        body: `<div class="stack"><div class="row">${Object.keys(RLS).map((k) => ui.btn(RLS[k].label, { act: 'rls', arg: k, size: 'sm', variant: k === 'lain' ? 'primary' : '' })).join('')}</div>
          ${L.rlsDenied ? ui.alert('success', 'Isolasi terbukti', 'Data RS lain tidak pernah terlihat. Aturan isolasi dipaksa di database, bukan hanya di aplikasi.') : ''}${rlsLog}</div>`,
      });
      const ci = ui.card({
        title: 'CI cabang main', sub: `commit 8c41e2f · ${L.ciAt || '07.12'} · 6 mnt 40 dtk`, actions: ui.btn('Jalankan ulang CI', { act: 'ci', size: 'sm' }),
        body: `<div class="stack">${CI_STAGES.map(([n, d]) => `<div class="row between"><span>${ui.chip('✓', 'success')} ${esc(n)}</span><span class="mono small muted">${esc(d)}</span></div>`).join('')}
          <div class="small muted">Semua tahap hijau${L.ciAt ? ` · dijalankan ulang ${esc(L.ciAt)}` : ''}. Merge ke main ditolak bila satu tahap gagal.</div></div>`,
      });
      const tabs = [{ value: 'tombol', label: 'Tombol' }, { value: 'status', label: 'Status & chip' }, { value: 'peringatan', label: 'Peringatan' }, { value: 'isian', label: 'Isian' }, { value: 'pasien', label: 'Banner & tabel' }];
      let comp = '';
      if (L.comp === 'status') {
        comp = `<div class="row">${ui.chip('Diperiksa', 'success')}${ui.chip('Menunggu', 'warning')}${ui.chip('Menunggu hasil', 'info')}${ui.chip('Selesai', 'brand')}${ui.chip('Dibatalkan')}${ui.chip('Terkirim SATUSEHAT', 'success')}${ui.chip('Alergi: Amoksisilin', 'solid-danger')}${ui.chip('Risiko jatuh tinggi', 'danger')}${ui.chip('I10 · Hipertensi esensial', 'brand')}</div>
          <p class="small muted">Status tidak pernah dibedakan hanya dengan warna: selalu ada teks.</p>`;
      } else if (L.comp === 'peringatan') {
        comp = `<div class="stack">${ui.alert('danger', 'Kritis', 'Kalium 6,8 mmol/L. Wajib konfirmasi DPJP dalam 30 menit.')}${ui.alert('warning', 'Perhatian', 'Dosis amlodipin dinaikkan 5 → 10 mg.')}${ui.alert('info', 'Info', 'SEP terbit otomatis dari rujukan FKTP.')}${ui.alert('success', 'Berhasil', 'Resume ditandatangani dan dikirim ke SATUSEHAT.')}</div>`;
      } else if (L.comp === 'isian') {
        const nikOk = /^\d{16}$/.test(String(L.demoNik || ''));
        comp = `<div class="grid g2"><div class="field"><label for="f-demoNik">NIK *</label>${ui.input('demoNik', L.demoNik, { mono: true, inputmode: 'numeric' })}<span class="help" style="${nikOk ? '' : 'color:var(--danger)'}">${nikOk ? 'Format NIK benar.' : 'NIK harus 16 digit angka. Periksa kembali KTP pasien.'}</span></div>
          ${ui.field('Penjamin', ui.select('demoPenj', L.demoPenj || 'BPJS', ['BPJS', 'Umum', 'Asuransi swasta']))}</div>
          <div class="row">${ui.btn('Periksa isian', { act: 'demoCek', size: 'sm' })}<span class="small muted">Label selalu terlihat di atas isian; galat tepat di bawahnya.</span></div>`;
      } else if (L.comp === 'pasien') {
        comp = `<div class="stack">${ui.banner(P)}${ui.table(['Pemeriksaan', { label: 'Hasil', r: true }, 'Satuan', 'Rujukan', 'Flag'], [['Hemoglobin', '12,8', 'g/dL', '12,0–15,5', '—'], ['Kalium', '<b style="color:var(--danger)">6,8</b>', 'mmol/L', '3,5–5,1', ui.chip('Kritis', 'solid-danger')]])}</div>`;
      } else {
        comp = `<div class="stack"><div class="row">${ui.btn('Utama', { act: 'demoKlik', arg: 'utama', variant: 'primary' })}${ui.btn('Sekunder', { act: 'demoKlik', arg: 'sekunder' })}${ui.btn('Teks', { act: 'demoKlik', arg: 'teks', variant: 'ghost' })}${ui.btn('Nonaktif', { disabled: true, reason: 'Contoh: tombol nonaktif selalu disertai alasan.' })}</div>
          <hr class="sep"><div class="field"><label for="f-alasan">Alasan pembatalan (aksi destruktif wajib alasan)</label>${ui.input('alasan', L.alasan, { placeholder: 'Minimal 10 huruf' })}</div>
          <div class="row">${ui.btn('Ya, batalkan tindakan', { act: 'demoBatal', variant: 'danger', needs: 'alasan:10' })}${L.batalAt ? ui.chip(`Dibatalkan dengan alasan · ${L.batalAt}`, 'success') : ''}</div></div>`;
      }
      const katalog = ui.card({ title: 'Katalog komponen UI', sub: 'packages/ui · sama dengan halaman /dev/ui (Klinis Bersih)', body: `${ui.tabs('comp', L.comp, tabs)}<div style="padding-top:14px">${comp}</div>` });
      const done = allOk && L.rlsDenied;
      return `<div class="grid g4">${ui.kpi('Layanan lokal', `${L.checked}/${SERVICES.length}`, allOk ? 'semua sehat' : L.running ? 'sedang diperiksa' : 'belum diperiksa', allOk ? 'up' : '')}
          ${ui.kpi('Isolasi per RS', L.rlsDenied ? 'Terbukti' : 'Belum diuji', 'dipaksa di 38 tabel', L.rlsDenied ? 'up' : '')}
          ${ui.kpi('CI main', 'Hijau', '7 tahap lulus', 'up')}${ui.kpi('Komponen UI', '24', 'token + komponen dasar')}</div>
        ${svc}<div class="grid g2">${rls}${ci}</div>${katalog}
        ${done ? ui.next('masuk', 'Fondasi hidup: 6 layanan sehat dan data RS lain ditolak.') : ''}`;
    },
    actions: {
      periksa(L) {
        if (L.running) return false;
        L.checked = 0; L.at = []; L.running = true;
        SIM.now(1);
        setTimeout(fondasiTick, 420);
      },
      rls(L, J, el) {
        const k = argOf(el);
        if (!RLS[k]) return false;
        L.rls.unshift({ k, t: SIM.now(1) });
        L.rls = L.rls.slice(0, 4);
        if (k === 'lain' && !L.rlsDenied) { L.rlsDenied = true; SIM.note('Uji isolasi: data RS lain ditolak (0 baris)', 'success'); }
        if (L.rlsDenied && L.checked >= SERVICES.length) SIM.done();
      },
      ci(L) { L.ciAt = SIM.now(3); SIM.toast(`CI hijau · ${L.ciAt}`, 'success'); },
      demoKlik(L, J, el) { SIM.toast(`Tombol ${argOf(el) || ''} diklik`); return false; },
      demoBatal(L) {
        if (String(L.alasan || '').trim().length < 10) return false;
        L.batalAt = SIM.now(1); L.alasan = '';
      },
      demoCek(L) { SIM.toast(/^\d{16}$/.test(String(L.demoNik || '')) ? 'NIK valid' : 'NIK belum 16 digit', /^\d{16}$/.test(String(L.demoNik || '')) ? 'success' : 'warning'); },
    },
  });

  /* =====================================================================
   * FASE 1 · Masuk + MFA
   * ===================================================================== */
  const SANDI = 'Andalas#2026';
  const OTP = '481205';
  const UNITS = [
    { id: 'loket', name: 'Loket pendaftaran rawat jalan', note: 'Shift pagi · 07.00–14.00' },
    { id: 'anjungan', name: 'Meja informasi & anjungan', note: 'Tugas tambahan' },
    { id: 'igd', name: 'Pendaftaran IGD', note: 'Cadangan bila loket IGD penuh' },
  ];
  SIM.register({
    id: 'masuk', phase: 1, title: 'Masuk SIM RS', nav: 'Masuk + MFA', codes: 'P02', role: 'daftar',
    desc: 'Petugas masuk dengan sandi, kode verifikasi 6 digit, lalu memilih unit kerja. Sandi salah 3× mengunci akun sementara.',
    hint: 'Klik "Masuk dan minta kode", isi kode verifikasi, pilih unit, lalu masuk. Coba juga cabang sandi salah.',
    init: { step: 0, user: 'dewi.lestari@rsfa.test', pass: SANDI, err: '', fails: 0, lockedUntil: '', otp: '', otpErr: '', mailAt: '', trust: false, unit: '', mfaAt: '', at: '' },
    render(L) {
      const step = Number(L.step) || 0;
      const locked = !!L.lockedUntil;
      const unit = UNITS.find((u) => u.id === L.unit);
      let body = '';
      if (step === 0) {
        body = `<div class="stack">
          <div><h2 style="font-size:18px">Masuk ke SIM RS</h2><p class="small muted" style="margin:4px 0 0">Gunakan NIP atau email RS dan kata sandi. Setelah itu sistem meminta kode verifikasi.</p></div>
          ${locked ? ui.alert('danger', `Akun terkunci sampai ${L.lockedUntil}`, 'Kata sandi salah 3 kali berturut-turut. Coba lagi setelah 15 menit atau minta admin SIM RS membuka kunci. Kejadian ini tercatat di jejak audit.') : ''}
          ${!locked && L.err ? ui.alert('warning', L.err, `Sisa ${Math.max(0, 3 - L.fails)} percobaan sebelum akun dikunci 15 menit.`) : ''}
          ${ui.field('NIP atau email RS', ui.input('user', L.user, { placeholder: 'nama@rs' }), '', 'f-user')}
          ${ui.field('Kata sandi', ui.input('pass', L.pass, { type: 'password' }), `Sandi contoh: ${SANDI}`, 'f-pass')}
          <div class="row">${ui.btn('Masuk dan minta kode', { act: 'login', variant: 'primary', size: 'lg', disabled: locked, reason: locked ? `Akun terkunci sampai ${L.lockedUntil}` : '' })}
            ${ui.btn('Coba sandi salah', { act: 'salah', disabled: locked, reason: locked ? 'Akun sedang terkunci' : '' })}
            ${!locked && L.pass !== SANDI ? ui.btn('Isi sandi contoh', { act: 'isiSandi', variant: 'ghost' }) : ''}</div>
          ${locked ? `<div class="row">${ui.btn('Tunggu 15 menit (simulasi)', { act: 'tunggu' })}<span class="small muted">Jam simulasi maju 15 menit.</span></div>` : ''}
          <p class="small muted" style="margin:0">Lupa kata sandi? Hubungi admin SIM RS untuk reset akun.</p></div>`;
      } else if (step === 1) {
        const otp = String(L.otp || '');
        const boxes = Array.from({ length: 6 }, (_, i) => `<span class="mono" style="width:46px;height:54px;border-radius:10px;display:grid;place-items:center;font-size:24px;font-weight:600;border:${otp[i] ? '1px solid var(--brand-600)' : i === otp.length ? '2px solid var(--brand-600)' : `1px solid ${L.otpErr ? 'var(--danger)' : 'var(--line-strong)'}`};background:${otp[i] ? 'var(--selected)' : 'var(--card)'}">${esc(otp[i] || '')}</span>`).join('');
        body = `<div class="stack">
          <div><h2 style="font-size:18px">Verifikasi dua langkah</h2><p class="small muted" style="margin:4px 0 0">Masukkan 6 digit kode dari aplikasi autentikator untuk akun <b>${esc(L.user)}</b>.</p></div>
          <div class="row" style="gap:8px" aria-label="Kode verifikasi">${boxes}</div>
          ${L.otpErr ? ui.alert('danger', L.otpErr) : ''}
          ${ui.alert('info', `Petunjuk prototipe: kode di aplikasi autentikator saat ini ${OTP.slice(0, 3)} ${OTP.slice(3)}`, 'Kode berlaku 30 detik.')}
          <div style="max-width:340px">${keypad('key', 'lg')}</div>
          <div class="row">${ui.btn('Isi kode contoh', { act: 'isiKode', variant: 'ghost', size: 'sm' })}${ui.btn('Kirim kode lewat email', { act: 'email', size: 'sm' })}${L.mailAt ? `<span class="small muted">Kode dikirim ke email kantor pukul ${esc(L.mailAt)}.</span>` : ''}</div>
          ${ui.check('trust', L.trust, 'Percayai perangkat ini selama 12 jam (hanya komputer milik RS)')}
          <div class="row">${ui.btn('Verifikasi dan lanjut', { act: 'verifikasi', variant: 'primary', size: 'lg' })}${ui.btn('Kembali ke halaman masuk', { act: 'kembali', arg: '0', variant: 'ghost' })}</div></div>`;
      } else if (step === 2) {
        body = `<div class="stack">
          <div><h2 style="font-size:18px">Pilih unit kerja</h2><p class="small muted" style="margin:4px 0 0">Akun <b>${esc(L.user)}</b> terverifikasi ${esc(L.mfaAt)}. Hak akses mengikuti unit dan shift yang dipilih.</p></div>
          <div class="list" style="border:1px solid var(--line);border-radius:var(--r-control);overflow:hidden">${UNITS.map((u) => `<button type="button" class="li ${u.id === L.unit ? 'sel' : ''}" data-set="unit=${u.id}"><div><div class="lt">${esc(u.name)}</div><div class="ls">${esc(u.note)}</div></div>${u.id === L.unit ? `<div class="lr">${ui.chip('Dipilih', 'brand')}</div>` : ''}</button>`).join('')}</div>
          <div class="row">${ui.btn(unit ? `Masuk ke ${unit.name}` : 'Masuk', { act: 'masuk', variant: 'primary', size: 'lg', disabled: !unit, reason: 'Pilih salah satu unit kerja dulu.' })}${ui.btn('Kembali ke verifikasi', { act: 'kembali', arg: '1', variant: 'ghost' })}</div></div>`;
      } else {
        body = `<div class="stack">${ui.alert('success', `Selamat datang, Dewi Lestari · ${L.at}`, `Anda masuk ke ${esc(unit ? unit.name : 'unit kerja')}. Sesi tercatat di jejak audit.`)}
          ${kv('Akun', esc(L.user))}${kv('Unit kerja', esc(unit ? `${unit.name} · ${unit.note}` : '—'))}${kv('Verifikasi dua langkah', `${ui.chip(`Terverifikasi · ${L.mfaAt}`, 'success')}`)}
          ${kv('Perangkat dipercaya', L.trust ? 'Ya, 12 jam' : 'Tidak')}${kv('Sesi menganggur', 'Terkunci otomatis setelah 15 menit')}
          <div class="row">${ui.btn('Keluar', { act: 'keluar', size: 'sm' })}${ui.btn('Lihat di jejak audit', { go: 'audit', variant: 'ghost', size: 'sm' })}</div></div>`;
      }
      const info = ui.card({
        title: 'Keamanan masuk', sub: RS.name,
        body: `<div class="stack small">
          <div>${ui.chip('Sandi', 'brand')} minimal 12 karakter, diganti tiap 180 hari.</div>
          <div>${ui.chip('3× salah', 'danger')} akun terkunci 15 menit dan tercatat di audit.</div>
          <div>${ui.chip('Verifikasi 2 langkah', 'brand')} wajib untuk semua akun yang membuka data pasien.</div>
          <div>${ui.chip('Perangkat bersama', 'info')} memakai PIN 6 digit yang diatur admin.</div>
          <hr class="sep"><div class="muted">Akun bersifat pribadi dan tidak boleh dipakai bersama. Seluruh aktivitas tercatat di jejak audit.</div>
          ${L.fails ? `<div>${ui.chip(`Percobaan gagal: ${L.fails}`, L.fails >= 3 ? 'danger' : 'warning')}</div>` : ''}</div>`,
      });
      return `${ui.steps(['Akun', 'Verifikasi', 'Unit kerja', 'Masuk'], step)}
        ${ui.split(info, ui.card({ body }))}
        ${step === 3 ? ui.next('akses', `Dewi Lestari masuk dengan verifikasi dua langkah · ${L.at}`) : ''}`;
    },
    actions: {
      login(L) {
        if (L.lockedUntil) return false;
        if (!String(L.user || '').trim()) { L.err = 'NIP atau email RS wajib diisi.'; return; }
        if (L.pass !== SANDI) { masukGagal(L); return; }
        L.step = 1; L.err = ''; L.fails = 0; L.otp = ''; L.otpErr = '';
        SIM.now(1);
      },
      salah(L) { if (L.lockedUntil) return false; masukGagal(L); },
      isiSandi(L) { L.pass = SANDI; },
      tunggu(L) {
        SIM.now(15); L.lockedUntil = ''; L.fails = 0; L.err = ''; L.pass = SANDI;
        SIM.note('Kunci akun berakhir setelah 15 menit', 'brand');
      },
      key(L, J, el) { const k = argOf(el); if (k == null) return false; L.otp = press(L.otp, k, 6); L.otpErr = ''; },
      isiKode(L) { L.otp = OTP; L.otpErr = ''; },
      email(L) { L.mailAt = SIM.now(1); SIM.toast(`Kode dikirim ke email kantor · ${L.mailAt}`, 'success'); },
      verifikasi(L) {
        const n = String(L.otp || '').length;
        if (n < 6) { L.otpErr = n ? `Kode harus 6 digit. Baru terisi ${n} digit.` : 'Kode verifikasi wajib diisi (6 digit).'; return; }
        if (L.otp !== OTP) { L.otpErr = 'Kode salah atau sudah kedaluwarsa. Periksa aplikasi autentikator.'; L.otp = ''; return; }
        L.step = 2; L.mfaAt = SIM.now(1); L.otpErr = '';
      },
      kembali(L, J, el) { const n = Number(argOf(el)); if (!(n >= 0 && n <= 2)) return false; L.step = n; if (n === 0) L.pass = SANDI; },
      masuk(L, J) {
        const unit = UNITS.find((u) => u.id === L.unit);
        if (!unit) return false;
        L.step = 3; L.at = SIM.now(1); J.loggedIn = true;
        SIM.note(`Dewi Lestari masuk dengan verifikasi dua langkah ke ${unit.name}`, 'success');
        SIM.done();
      },
      keluar(L) { L.step = 0; L.otp = ''; L.unit = ''; SIM.toast('Sesi diakhiri'); },
    },
  });
  function masukGagal(L) {
    L.fails = (Number(L.fails) || 0) + 1;
    SIM.now(1);
    L.pass = '';
    if (L.fails >= 3) {
      L.lockedUntil = hhmm(SIM.clock + 15);
      L.err = '';
      SIM.note('Akun dewi.lestari terkunci 15 menit setelah 3× sandi salah', 'danger');
    } else {
      L.err = 'Kata sandi salah.';
    }
  }

  /* =====================================================================
   * FASE 1 · Peran & izin
   * ===================================================================== */
  const MODS = ['Pendaftaran & antrean', 'Jadwal dokter', 'Asesmen & CPPT', 'Order lab & radiologi', 'Resep', 'Resume medis', 'Billing & kasir'];
  const PCOLS = ['Lihat', 'Tulis', 'Final', 'Ekspor'];
  const PERM0 = {
    'Petugas pendaftaran': [['✓', '✓', '✓', '—'], ['✓', '✓', '—', '—'], ['—', '—', '—', '—'], ['—', '—', '—', '—'], ['—', '—', '—', '—'], ['—', '—', '—', '—'], ['✓', '—', '—', '—']],
    'Perawat rawat jalan': [['◐', '—', '—', '—'], ['✓', '—', '—', '—'], ['◐', '◐', '◐', '—'], ['◐', '—', '—', '—'], ['◐', '—', '—', '—'], ['◐', '—', '—', '—'], ['—', '—', '—', '—']],
    DPJP: [['◐', '—', '—', '—'], ['✓', '—', '—', '—'], ['◐', '◐', '◐', '—'], ['◐', '◐', '◐', '—'], ['◐', '◐', '◐', '—'], ['◐', '◐', '◐', '◐'], ['—', '—', '—', '—']],
    Apoteker: [['—', '—', '—', '—'], ['✓', '—', '—', '—'], ['◐', '—', '—', '—'], ['✓', '—', '—', '—'], ['✓', '✓', '✓', '—'], ['✓', '—', '—', '—'], ['—', '—', '—', '—']],
    'Perekam medis': [['✓', '—', '—', '—'], ['✓', '—', '—', '—'], ['✓', '—', '—', '—'], ['✓', '—', '—', '—'], ['✓', '—', '—', '—'], ['✓', '—', '—', '✓'], ['✓', '—', '—', '—']],
    Kasir: [['✓', '—', '—', '—'], ['—', '—', '—', '—'], ['—', '—', '—', '—'], ['✓', '—', '—', '—'], ['✓', '—', '—', '—'], ['—', '—', '—', '—'], ['✓', '✓', '✓', '✓']],
  };
  const ROLES = Object.keys(PERM0);
  const PNEXT = { '✓': '◐', '◐': '—', '—': '✓' };
  const PMEAN = { '✓': 'diizinkan', '◐': 'hanya pasien di unit/relasi sendiri', '—': 'ditolak' };
  const USERS0 = [
    { name: 'Dewi Lestari', nip: '19910312 201503 2 007', role: 'Petugas pendaftaran', unit: 'Loket rawat jalan', mfa: 'Aktif', last: 'hari ini 07.41', status: 'Aktif' },
    { name: 'dr. Andi Wiratama, Sp.PD', nip: '19750306 200501 1 002', role: 'DPJP', unit: 'Poli PD, rawat inap', mfa: 'Aktif', last: 'hari ini 07.38', status: 'Aktif' },
    { name: 'Ns. Fitri Handayani', nip: '19880412 201101 2 004', role: 'Perawat rawat jalan', unit: 'Poli PD', mfa: 'Aktif', last: 'hari ini 07.20', status: 'Aktif' },
    { name: 'apt. Rina Kusuma', nip: '19900921 201503 2 008', role: 'Apoteker', unit: 'Farmasi rawat jalan', mfa: 'Aktif', last: 'hari ini 07.55', status: 'Aktif' },
    { name: 'Anisa Rahma, A.Md.RMIK', nip: '19930117 201801 2 011', role: 'Perekam medis', unit: 'Unit rekam medis', mfa: 'Belum', last: '2 hari lalu', status: 'Aktif' },
    { name: 'Sri Wahyuni', nip: '19850730 200901 2 006', role: 'Kasir', unit: 'Kasir rawat jalan', mfa: 'Aktif', last: '71 hari lalu', status: 'Dormant' },
    { name: 'Bambang Kurniawan', nip: '19800211 200701 1 009', role: 'Petugas pendaftaran', unit: 'Loket rawat jalan', mfa: 'Aktif', last: 'gagal 3× 06.58', status: 'Dikunci' },
  ];
  const USTATUS = { Aktif: 'success', Dikunci: 'danger', Dormant: 'warning', Undangan: 'info' };
  const ABAC_PTS = ['suryo', 'hartono', 'ratna'];
  const RULES = [
    ['Akses hanya pasien di unit dan shift aktif', 'Relasi pasien–unit dicek setiap rekam medis dibuka', true],
    ['Dokter hanya melihat pasien DPJP-nya', 'Kecuali tim perawatan atau konsul yang tercatat', true],
    ['Break-the-glass dengan alasan', 'Akses darurat di luar relasi; wajib alasan, ditinjau tim audit', true],
    ['Pasien rahasia (VIP, kasus sensitif)', 'Hanya DPJP dan petugas yang ditunjuk', true],
  ];
  const DEVICES0 = [
    { id: 'TAB-POLI-07', name: 'Tablet Poli PD 07', unit: 'Poli Penyakit Dalam', pin: true, pinAt: '3 Okt' },
    { id: 'PC-NURSE-MELATI', name: 'PC nurse station Melati', unit: 'Rawat inap Melati', pin: true, pinAt: '1 Okt' },
    { id: 'TAB-IGD-02', name: 'Tablet IGD 02', unit: 'IGD', pin: false, pinAt: '' },
  ];
  const dirtyCount = (L) => {
    let n = 0;
    for (const r of ROLES) (L.perms[r] || []).forEach((row, i) => row.forEach((v, j) => { if (L.base[r] && v !== L.base[r][i][j]) n++; }));
    return n;
  };

  SIM.register({
    id: 'akses', phase: 1, title: 'Peran dan izin', nav: 'Peran & izin', codes: 'P02 · P03', role: 'admin',
    desc: 'Matriks izin per peran, akun staf baru dengan undangan, aturan kontekstual (dokter hanya melihat pasien DPJP-nya), dan PIN perangkat bersama.',
    hint: 'Klik sel izin untuk mengganti, tulis alasan, lalu Simpan. Coba juga tab Aturan kontekstual.',
    init: () => ({ tab: 'matriks', role: 'Petugas pendaftaran', perms: clone(PERM0), base: clone(PERM0), alasan: '', saved: null,
      users: clone(USERS0), nNama: '', nNip: '', nEmail: '', nPeran: 'Perawat rawat jalan', nUnit: 'Poli Penyakit Dalam', invite: null,
      abac: '', btgReason: '', btg: null, devs: clone(DEVICES0), pinDev: 'TAB-IGD-02', pin: '', pinErr: '', pinTest: null }),
    render(L, J) {
      const tabs = ui.tabs('tab', L.tab, [{ value: 'matriks', label: 'Matriks izin' }, { value: 'pengguna', label: 'Pengguna & undangan' }, { value: 'abac', label: 'Aturan kontekstual' }, { value: 'pin', label: 'PIN perangkat bersama' }]);
      let body = '';
      if (L.tab === 'pengguna') {
        const rows = L.users.map((u, i) => [`<b>${esc(u.name)}</b><div class="small muted mono">NIP ${esc(u.nip)}</div>`, esc(u.role), esc(u.unit),
          u.mfa === 'Aktif' ? ui.chip('Aktif', 'success') : ui.chip('Belum', 'danger'), `<span class="small">${esc(u.last)}</span>`,
          `${ui.chip(u.status, USTATUS[u.status] || '')}${u.status === 'Dikunci' ? ` ${ui.btn('Buka kunci', { act: 'bukaKunci', arg: String(i), size: 'sm', variant: 'ghost' })}` : ''}`]);
        const inv = L.invite ? ui.alert('success', `Undangan terkirim · ${L.invite.t}`, `Email aktivasi untuk <b>${esc(L.invite.name)}</b> (${esc(L.invite.email)}) tertangkap di Mailpit. Tautan berlaku 24 jam; saat aktivasi pengguna wajib membuat sandi dan memasang verifikasi dua langkah.`) : '';
        body = `<div class="grid g4">${ui.kpi('Pengguna aktif', '1.284', 'dari 1.312 akun')}${ui.kpi('Verifikasi 2 langkah', '97,7%', '30 akun belum', 'down')}${ui.kpi('Dikunci', String(L.users.filter((u) => u.status === 'Dikunci').length), 'percobaan gagal')}${ui.kpi('Undangan menunggu', String(L.users.filter((u) => u.status === 'Undangan').length), 'belum aktivasi')}</div>
          ${ui.card({ title: 'Pengguna dan peran', sub: 'Sinkron dari data SDM', flush: true, body: ui.table(['Pengguna', 'Peran', 'Unit', '2 langkah', 'Masuk terakhir', 'Status'], rows) })}
          ${ui.card({ title: 'Buat akun staf baru', sub: 'Akun aktif setelah pengguna menerima undangan', body: `<div class="stack"><div class="grid g3">
            ${ui.field('Nama lengkap', ui.input('nNama', L.nNama, { placeholder: 'mis. Ns. Wulan Sari' }), '', 'f-nNama')}
            ${ui.field('NIP', ui.input('nNip', L.nNip, { mono: true, placeholder: '18 digit' }), '', 'f-nNip')}
            ${ui.field('Email RS', ui.input('nEmail', L.nEmail, { placeholder: 'nama@rsfa.test' }), '', 'f-nEmail')}
            ${ui.field('Peran', ui.select('nPeran', L.nPeran, ROLES))}
            ${ui.field('Unit', ui.select('nUnit', L.nUnit, ['Poli Penyakit Dalam', 'Loket rawat jalan', 'IGD', 'Rawat inap Melati', 'Farmasi rawat jalan']))}</div>
            <div class="row">${ui.btn('Buat akun dan kirim undangan', { act: 'buat', variant: 'primary', needs: 'nNama:3' })}<span class="small muted">Tombol aktif setelah nama diisi.</span></div>${inv}</div>` })}`;
      } else if (L.tab === 'abac') {
        const pts = ABAC_PTS.map((k) => {
          const p = PEOPLE[k]; const mine = p.dokter === P.dokter;
          return [`<b>${esc(p.name)}</b><div class="small muted mono">RM ${esc(p.rm)}</div>`, esc(p.dokter), mine ? ui.chip('DPJP sendiri', 'success') : ui.chip('Bukan DPJP', ''),
            ui.btn('Buka rekam medis', { act: 'abac', arg: k, size: 'sm', variant: L.abac === k ? 'primary' : '' })];
        });
        let res = '';
        if (L.abac) {
          const p = PEOPLE[L.abac] || P; const ok = p.dokter === P.dokter;
          if (ok) res = ui.alert('success', `Diizinkan · ${L.abacAt}`, `dr. Andi Wiratama adalah DPJP ${esc(p.name)}. Rekam medis terbuka; akses baca tercatat di audit.`);
          else if (L.btg && L.btg.k === L.abac) res = ui.alert('warning', `Dibuka darurat (break-the-glass) · ${L.btg.t}`, `Alasan tercatat dan tim audit menerima notifikasi. Akses berlaku 4 jam untuk ${esc(p.name)}.`);
          else res = ui.gate({ title: `Ditolak · ${L.abacAt}: dr. Andi Wiratama bukan DPJP ${p.name}`, body: `Pasien ini dirawat ${esc(p.dokter)}. Percobaan akses tercatat merah di jejak audit. Bila ada kondisi darurat, buka dengan alasan.`, override: { label: 'Buka darurat (break-the-glass)', act: 'btg' }, reasonKey: 'btgReason', reasonValue: L.btgReason });
        }
        body = `<div class="grid g2">${ui.card({ title: 'Uji aturan: sudut pandang dr. Andi Wiratama, Sp.PD', sub: 'DPJP Poli Penyakit Dalam', flush: true, body: ui.table(['Pasien', 'DPJP', 'Relasi', ''], pts) })}
          ${ui.card({ title: 'Aturan kontekstual aktif', sub: 'berlaku untuk semua peran klinis', body: `<div class="stack">${RULES.map((r) => `<div class="row between" style="flex-wrap:nowrap;align-items:flex-start"><div><b class="small">${esc(r[0])}</b><div class="small muted">${esc(r[1])}</div></div>${ui.chip(r[2] ? 'Aktif' : 'Nonaktif', r[2] ? 'success' : '')}</div>`).join('<hr class="sep">')}</div>` })}</div>${res}`;
      } else if (L.tab === 'pin') {
        const devRows = L.devs.map((d) => [`<b>${esc(d.name)}</b><div class="small muted mono">${esc(d.id)}</div>`, esc(d.unit), d.pin ? ui.chip(`PIN aktif · ${d.pinAt}`, 'success') : ui.chip('Belum ada PIN')]);
        body = `<div class="grid g2">${ui.card({ title: 'Perangkat bersama terdaftar', flush: true, body: ui.table(['Perangkat', 'Unit', 'PIN masuk cepat'], devRows) })}
          ${ui.card({ title: 'Aktifkan PIN untuk perangkat', sub: 'PIN hanya berlaku di perangkat ini, terikat ke akun pribadi', body: `<div class="stack">
            ${ui.field('Perangkat', ui.select('pinDev', L.pinDev, L.devs.map((d) => ({ value: d.id, label: d.name }))))}
            ${ui.field('PIN 6 digit', ui.input('pin', L.pin, { mono: true, inputmode: 'numeric', placeholder: 'mis. 582914', type: 'password' }), 'Bukan angka berurutan atau berulang.', 'f-pin')}
            ${L.pinErr ? ui.alert('danger', L.pinErr) : ''}
            <div class="row">${ui.btn('Aktifkan PIN', { act: 'aktifPin', variant: 'primary', needs: 'pin:6' })}${ui.btn('Uji masuk cepat dengan PIN', { act: 'ujiPin' })}</div>
            ${L.pinTest ? ui.alert('success', `Masuk cepat · ${L.pinTest.t}`, `Ns. Fitri Handayani masuk dengan PIN di ${esc(L.pinTest.dev)}. Setelah 5× PIN salah, perangkat kembali meminta sandi + kode verifikasi.`) : ''}</div>` })}</div>`;
      } else {
        const perms = L.perms[L.role] || L.perms[ROLES[0]];
        const base = L.base[L.role] || L.base[ROLES[0]];
        const rows = MODS.map((m, i) => [esc(m), ...PCOLS.map((c, j) => {
          const v = perms[i][j]; const changed = v !== base[i][j];
          const color = v === '✓' ? 'var(--success)' : v === '◐' ? 'var(--brand-700)' : 'var(--ink-400)';
          return `<button type="button" class="btn sm" data-act="cell" data-arg="${i}-${j}" aria-label="${esc(`${m}, ${c}: ${PMEAN[v]}. Klik untuk mengganti.`)}" style="min-width:46px;color:${color};${changed ? 'background:var(--warning-bg);border-color:var(--warning-border)' : ''}">${esc(v)}</button>`;
        })]);
        const dirty = dirtyCount(L);
        body = `<div class="row between"><div class="row">${ui.field('Peran', ui.select('role', L.role, ROLES))}</div><span class="small muted">✓ diizinkan · ◐ hanya pasien di unit/relasi sendiri · — ditolak</span></div>
          ${ui.card({ title: `Matriks izin · ${L.role}`, sub: 'Klik sel untuk mengganti. Sel kuning belum disimpan.', flush: true, body: ui.table(['Modul', ...PCOLS], rows) })}
          ${ui.card({ title: dirty ? `${dirty} perubahan belum disimpan` : 'Tidak ada perubahan', tone: dirty ? 'warning' : '', body: `<div class="stack">
            ${ui.field('Alasan perubahan (wajib, tercatat di audit)', ui.input('alasan', L.alasan, { placeholder: 'mis. Petugas pendaftaran perlu mengubah jadwal dokter sesuai keputusan 5 Okt' }), '', 'f-alasan')}
            <div class="row">${ui.btn('Simpan perubahan', { act: 'simpan', variant: 'primary', needs: 'alasan:10', disabled: !dirty, reason: 'Belum ada izin yang diubah.' })}${dirty ? ui.btn('Batalkan', { act: 'batal', variant: 'ghost' }) : ''}</div>
            ${L.saved ? ui.alert('success', `Tersimpan pukul ${L.saved.t}`, `${L.saved.n} perubahan izin peran ${esc(L.saved.role)} tercatat di audit atas nama Admin Sistem. Alasan: ${esc(L.saved.alasan)}`) : ''}</div>` })}`;
      }
      return `${tabs}${body}${L.saved ? `<div class="row">${ui.btn('Lihat di jejak audit', { go: 'audit', variant: 'ghost', size: 'sm' })}</div>${nextOf(['mpi'], `Perubahan izin tersimpan dengan alasan · ${L.saved.t}`)}` : ''}`;
    },
    actions: {
      cell(L, J, el) {
        const a = String(argOf(el) || '').split('-').map(Number);
        const row = (L.perms[L.role] || [])[a[0]];
        if (!row || !(a[1] in row)) return false;
        row[a[1]] = PNEXT[row[a[1]]] || '✓';
      },
      simpan(L) {
        const n = dirtyCount(L);
        if (!n || String(L.alasan || '').trim().length < 10) return false;
        L.saved = { t: SIM.now(2), n, alasan: String(L.alasan).trim(), role: L.role };
        L.base = clone(L.perms); L.alasan = '';
        SIM.note(`Izin peran ${L.role} diubah (${n} sel) dengan alasan`, 'success');
        SIM.done();
      },
      batal(L) { L.perms = clone(L.base); },
      buat(L) {
        const name = String(L.nNama || '').trim();
        if (name.length < 3) return false;
        const email = String(L.nEmail || '').trim() || `${name.toLowerCase().replace(/^(dr|ns|apt)\.\s*/, '').split(/\s+/)[0]}@rsfa.test`;
        L.users.unshift({ name, nip: String(L.nNip || '').trim() || '—', role: L.nPeran, unit: L.nUnit, mfa: 'Belum', last: '—', status: 'Undangan' });
        L.invite = { name, email, t: SIM.now(1) };
        L.nNama = ''; L.nNip = ''; L.nEmail = '';
        SIM.note(`Akun staf ${name} dibuat dan undangan dikirim`, 'brand');
      },
      bukaKunci(L, J, el) {
        const u = L.users[Number(argOf(el))];
        if (!u || u.status !== 'Dikunci') return false;
        u.status = 'Aktif'; u.last = `dibuka admin ${SIM.now(1)}`;
        SIM.toast(`Kunci akun ${u.name} dibuka`, 'success');
      },
      abac(L, J, el) {
        const k = argOf(el);
        if (!PEOPLE[k]) return false;
        L.abac = k; L.abacAt = SIM.now(1); L.btgReason = '';
        if (PEOPLE[k].dokter !== P.dokter) SIM.note(`Akses dr. Andi ke rekam medis ${PEOPLE[k].short} ditolak (bukan DPJP)`, 'danger');
      },
      btg(L) {
        if (!L.abac || String(L.btgReason || '').trim().length < 10) return false;
        L.btg = { k: L.abac, t: SIM.now(1) };
        SIM.note(`Break-the-glass ke rekam medis ${PEOPLE[L.abac].short} dengan alasan`, 'warning');
      },
      aktifPin(L) {
        const pin = String(L.pin || '');
        const d = L.devs.find((x) => x.id === L.pinDev);
        if (!d) return false;
        if (!/^\d{6}$/.test(pin)) { L.pinErr = 'PIN harus tepat 6 angka.'; return; }
        if (/(\d)\1\1/.test(pin) || '0123456789'.includes(pin) || '9876543210'.includes(pin)) { L.pinErr = 'PIN terlalu mudah ditebak (berurutan atau berulang). Pilih kombinasi lain.'; return; }
        d.pin = true; d.pinAt = `5 Okt ${SIM.now(1)}`; L.pin = ''; L.pinErr = '';
        SIM.note(`PIN masuk cepat diaktifkan untuk ${d.name}`, 'brand');
      },
      ujiPin(L) {
        const d = L.devs.find((x) => x.pin);
        if (!d) return false;
        L.pinTest = { dev: d.name, t: SIM.now(1) };
      },
    },
  });

  /* =====================================================================
   * FASE 1 · Jejak audit
   * ===================================================================== */
  const AUDIT0 = [
    { id: 'a2', t: '5 Okt 07.38', user: 'dr. Andi Wiratama, Sp.PD', role: 'DPJP', act: 'Ditolak', obj: 'Rekam medis Tn. Hartono Wibisono · bukan DPJP', dev: 'PC-POLI-PD-02', g: 'tolak', pt: 'hartono' },
    { id: 'a3', t: '5 Okt 07.15', user: 'dr. Maya Kartika', role: 'Dokter IGD', act: 'Break-the-glass', obj: 'Ringkasan Tn. Hartono Wibisono · alasan: konsul jaga', dev: 'PC-IGD-01', g: 'btg', pt: 'hartono' },
    { id: 'a4', t: '5 Okt 06.58', user: 'Bambang Kurniawan', role: 'Pendaftaran', act: 'Ditolak', obj: 'Masuk gagal 3× · akun dikunci 15 menit', dev: 'PC-LOKET-03', g: 'tolak', pt: '' },
    { id: 'a5', t: '4 Okt 22.47', user: 'Bambang Kurniawan', role: 'Pendaftaran', act: 'Baca', obj: 'Identitas Tn. Suryo Adi Nugroho · di luar jam dinas', dev: 'PC-LOKET-03', g: 'baca', pt: 'suryo', anom: true },
    { id: 'a6', t: '4 Okt 14.10', user: 'Ns. Fitri Handayani', role: 'Perawat', act: 'Koreksi', obj: 'CPPT 4 Okt Tn. Suryo Adi Nugroho · v1 → v2', dev: 'TAB-POLI-07', g: 'ubah', pt: 'suryo' },
    { id: 'a7', t: '4 Okt 13.02', user: 'dr. Andi Wiratama, Sp.PD', role: 'DPJP', act: 'Tanda tangan', obj: 'Resume rawat jalan Tn. Suryo Adi Nugroho', dev: 'PC-POLI-PD-02', g: 'ubah', pt: 'suryo' },
    { id: 'a8', t: '4 Okt 13.05', user: 'Anisa Rahma, A.Md.RMIK', role: 'Rekam medis', act: 'Cetak', obj: 'Resume medis Tn. Suryo Adi Nugroho · untuk BPJS', dev: 'PC-RM-01', g: 'cetak', pt: 'suryo' },
    { id: 'a9', t: '4 Okt 09.30', user: 'apt. Rina Kusuma', role: 'Apoteker', act: 'Baca', obj: 'Daftar obat aktif Tn. Suryo Adi Nugroho', dev: 'PC-FARMASI-01', g: 'baca', pt: 'suryo' },
  ];
  const ACT_TONE = { Baca: '', Ubah: 'info', Koreksi: 'warning', Cetak: '', 'Break-the-glass': 'danger', 'Tanda tangan': 'success', Masuk: 'brand', Ditolak: 'solid-danger' };
  const AUDIT_TOTAL = 10452;
  const hx = (n) => { let h = (2166136261 ^ n) >>> 0; for (let i = 0; i < 4; i++) h = Math.imul(h ^ (h >>> 13), 16777619) >>> 0; return h.toString(16).padStart(8, '0'); };
  const auditRows = (J) => {
    const dyn = [];
    if (J.encounter) dyn.push({ id: 'd2', t: `5 Okt ${J.encounter.t}`, user: 'Dewi Lestari', role: 'Pendaftaran', act: 'Ubah', obj: `Pendaftaran ${J.encounter.no} · Tn. Suryo Adi Nugroho`, dev: 'PC-LOKET-01', g: 'ubah', pt: 'suryo' });
    if (J.loggedIn) dyn.push({ id: 'd1', t: '5 Okt 07.41', user: 'Dewi Lestari', role: 'Pendaftaran', act: 'Masuk', obj: 'Sesi baru · verifikasi dua langkah berhasil', dev: 'PC-LOKET-01', g: 'sesi', pt: '' });
    return [...dyn, ...AUDIT0];
  };

  SIM.register({
    id: 'audit', phase: 1, title: 'Jejak audit', nav: 'Jejak audit', codes: 'P04', role: 'admin',
    desc: 'Setiap akses rekam pasien tercatat, tidak bisa diubah, dan berantai hash. Percobaan yang ditolak tampil merah.',
    hint: 'Saring jenis aktivitas, klik baris untuk detail, lalu klik "Verifikasi rantai".',
    init: { jenis: 'semua', peran: 'Semua peran', pasien: 'semua', sel: 'a3', review: {}, ver: null, tamper: false, paket: '' },
    headActions(L) { return ui.btn(L.paket ? `Paket bukti dibuat · ${L.paket}` : 'Buat paket bukti akreditasi', { act: 'paket', size: 'sm' }); },
    render(L, J) {
      const all = auditRows(J);
      const roles = ['Semua peran', ...new Set(all.map((r) => r.role))];
      const list = all.filter((r) => (L.jenis === 'semua' || r.g === L.jenis) && (L.peran === 'Semua peran' || r.role === L.peran) && (L.pasien === 'semua' || r.pt === L.pasien));
      const red = (r, h) => (r.g === 'tolak' ? `<span style="color:var(--danger);font-weight:600">${h}</span>` : h);
      const rows = list.map((r) => {
        const n = AUDIT_TOTAL - all.indexOf(r);
        return [red(r, `<span class="mono small">${esc(r.t)}</span>`), red(r, `${esc(r.user)}<div class="small muted">${esc(r.role)}</div>`),
          ui.chip(r.act, ACT_TONE[r.act] || '') + (r.anom && !L.review[r.id] ? ` ${ui.chip('Anomali', 'warning')}` : ''),
          red(r, esc(r.obj)), `<span class="mono small">${esc(r.dev)}</span>`, `<span class="mono small muted">#${n} · ${hx(n).slice(0, 6)}…</span>`];
      });
      const selIdx = list.findIndex((r) => r.id === L.sel);
      const filters = `<div class="row between"><div class="row">${ui.seg('jenis', L.jenis, [{ value: 'semua', label: 'Semua' }, { value: 'baca', label: 'Baca' }, { value: 'ubah', label: 'Ubah & koreksi' }, { value: 'cetak', label: 'Cetak' }, { value: 'btg', label: 'Break-the-glass' }, { value: 'tolak', label: 'Ditolak' }])}</div>
        <div class="row">${ui.select('peran', L.peran, roles)}${ui.select('pasien', L.pasien, [{ value: 'semua', label: 'Semua pasien' }, { value: 'suryo', label: 'Tn. Suryo Adi Nugroho' }, { value: 'hartono', label: 'Tn. Hartono Wibisono' }])}</div></div>`;
      const table = ui.card({ title: 'Aktivitas rekam medis', sub: `${list.length} dari ${all.length} entri · hanya bisa ditambah, tidak bisa diubah`, flush: true,
        body: ui.table(['Waktu', 'Pengguna', 'Aksi', 'Objek', 'Perangkat', 'Entri · hash'], rows, { act: 'pilih', sel: selIdx, rowArgs: list.map((r) => r.id), empty: 'Tidak ada aktivitas yang cocok dengan filter.' }) });
      const cur = all.find((r) => r.id === L.sel) || all[0];
      const n = AUDIT_TOTAL - all.indexOf(cur);
      let extra = '';
      if (cur.g === 'tolak') extra = ui.alert('danger', 'Akses ditolak oleh aturan', 'Tidak ada data pasien yang ditampilkan ke pengguna. Pengulangan 3× dalam 10 menit memicu notifikasi ke tim audit.');
      else if (cur.act === 'Koreksi') extra = `<div class="stack"><span class="label">Alasan koreksi (wajib)</span><div class="small">Salah tulis dosis saat entri, dikonfirmasi ulang dengan pasien.</div>
        <div class="code">− v1  Pasien minum metformin 850 mg 2×1 di rumah.\n+ v2  Pasien minum metformin 500 mg 2×1 di rumah.</div><div class="small muted">Versi 1 tetap tersimpan dan dapat dibuka. Entri final tidak pernah dihapus atau ditimpa.</div></div>`;
      else if (cur.act === 'Break-the-glass' || cur.anom) {
        const rv = L.review[cur.id];
        extra = `<div class="stack">${cur.act === 'Break-the-glass' ? `<span class="label">Alasan akses darurat (wajib)</span><div class="small">Konsul jaga: pasien sesak, DPJP belum bisa dihubungi.</div>` : ''}
          ${rv ? ui.alert('success', `Ditinjau ${rv.t} oleh Admin Sistem`, rv.dec === 'sah' ? 'Akses sah.' : 'Perlu klarifikasi ke pengguna; atasan langsung diberi tahu.') : `<div class="row">${ui.btn('Ditinjau: akses sah', { act: 'tinjau', arg: 'sah', size: 'sm', variant: 'primary' })}${ui.btn('Perlu klarifikasi', { act: 'tinjau', arg: 'klarifikasi', size: 'sm' })}</div>`}</div>`;
      }
      const detail = ui.card({ title: `${cur.act} · ${cur.obj.split(' · ')[0]}`, sub: `Detail entri #${n}`, tone: cur.g === 'tolak' ? 'danger' : '',
        body: `<div class="stack">${kv('Waktu catat server', esc(cur.t))}${kv('Pengguna', esc(`${cur.user} · ${cur.role}`))}${kv('Objek', esc(cur.obj))}${kv('Perangkat', `<span class="mono">${esc(cur.dev)}</span>`)}${kv('Hash entri', `<span class="mono">${hx(n)}</span>`)}${kv('Hash sebelumnya', `<span class="mono">${hx(n - 1)}</span>`)}${extra}</div>` });
      const blocks = [AUDIT_TOTAL, AUDIT_TOTAL - 1, AUDIT_TOTAL - 2, AUDIT_TOTAL - 3].map((b) => {
        const broken = L.ver && !L.ver.ok && b === AUDIT_TOTAL - 3;
        return `<div class="row between small" style="padding:6px 8px;border-radius:8px;border:1px solid ${broken ? 'var(--danger-border)' : 'var(--line-soft)'};background:${broken ? 'var(--danger-bg)' : 'var(--subtle)'}"><span class="mono">#${b}</span><span class="mono muted">${hx(b - 1).slice(0, 8)} → ${hx(b).slice(0, 8)}</span>${L.ver ? (broken ? ui.chip('Putus', 'danger') : ui.chip('✓', 'success')) : ''}</div>`;
      }).join('');
      const verRes = L.ver ? (L.ver.ok ? ui.alert('success', `✓ Rantai utuh · diverifikasi ${L.ver.t}`, `${AUDIT_TOTAL.toLocaleString('id-ID')} entri dihitung ulang dari entri pertama; tidak ada yang berubah atau hilang.`)
        : ui.alert('danger', `Rantai putus di entri #${AUDIT_TOTAL - 3} · ${L.ver.t}`, 'Isi entri tidak cocok dengan hash-nya. Insiden keamanan dibuat dan tim TI diberi tahu.')) : '';
      const chain = ui.card({ title: 'Rantai hash', sub: 'Setiap entri menyimpan hash entri sebelumnya', body: `<div class="stack">${blocks}
        <div class="row">${ui.btn('Verifikasi rantai', { act: 'verifikasi', variant: 'primary' })}${L.tamper ? ui.btn('Pulihkan dari cadangan', { act: 'pulihkan', size: 'sm' }) : ui.btn('Uji: ubah 1 entri langsung di database', { act: 'ubahPaksa', size: 'sm', variant: 'ghost' })}</div>${verRes}</div>` });
      return `${filters}${table}<div class="grid g2">${detail}${chain}</div>${L.ver && L.ver.ok ? nextOf(['mpi'], `Rantai hash audit terverifikasi utuh · ${L.ver.t}`) : ''}`;
    },
    actions: {
      pilih(L, J, el) { const id = argOf(el); if (!id) return false; L.sel = id; },
      tinjau(L, J, el) {
        const dec = argOf(el);
        if (dec !== 'sah' && dec !== 'klarifikasi') return false;
        L.review[L.sel] = { dec, t: SIM.now(1) };
        SIM.note(`Tinjauan anomali audit: ${dec === 'sah' ? 'akses sah' : 'perlu klarifikasi'}`, 'brand');
      },
      verifikasi(L) {
        L.ver = { t: SIM.now(1), ok: !L.tamper };
        if (L.ver.ok) { SIM.note(`Rantai hash audit diverifikasi utuh (${AUDIT_TOTAL} entri)`, 'success'); SIM.done(); }
        else SIM.note('Verifikasi rantai audit menemukan entri yang diubah', 'danger');
      },
      ubahPaksa(L) { L.tamper = true; L.ver = null; SIM.toast('Simulasi: satu entri diubah langsung di database', 'warning'); },
      pulihkan(L) { L.tamper = false; L.ver = null; },
      paket(L) { L.paket = SIM.now(1); SIM.toast(`Paket bukti akreditasi siap · ${L.paket}`, 'success'); },
    },
  });

  /* =====================================================================
   * FASE 1 · Master Patient Index
   * ===================================================================== */
  const MPI_DB = [
    { key: 'suryo', name: P.name, rm: P.rm, dob: P.dob, nik: P.nik, addr: P.addr, last: '12 Sep 2026 · Poli PD', hay: `${P.name} ${P.rm} 0000281417 ${P.dob}` },
    { key: 'suryo2', name: 'Suryo Adinugroho', rm: '00-41-09-33', dob: '18-06-1972', nik: '—', addr: 'Jl. Melati Raya No. 8, Jakpus', last: 'Mar 2025 · IGD', hay: 'Suryo Adinugroho 00-41-09-33 18-06-1972', dup: 0 },
    { key: 'hartono', name: PEOPLE.hartono.name, rm: PEOPLE.hartono.rm, dob: PEOPLE.hartono.dob, nik: PEOPLE.hartono.nik, addr: PEOPLE.hartono.addr, last: 'hari ini · IGD', hay: `${PEOPLE.hartono.name} ${PEOPLE.hartono.rm}` },
    { key: 'ratna', name: PEOPLE.ratna.name, rm: PEOPLE.ratna.rm, dob: PEOPLE.ratna.dob, nik: PEOPLE.ratna.nik, addr: PEOPLE.ratna.addr, last: '28 Sep 2026 · Poli Bedah', hay: `${PEOPLE.ratna.name} ${PEOPLE.ratna.rm}` },
    { key: 'suryani', name: 'Ny. Suryani', rm: '00-17-52-60', dob: '02-11-1969', nik: '9999••••••••1102', addr: 'Jl. Kenari 9, Jakarta Pusat', last: 'Jul 2026 · Poli Mata', hay: 'Ny. Suryani 00-17-52-60' },
  ];
  const PAIRS = [
    { name: 'Suryo Adi Nugroho / Suryo Adinugroho', score: 91, reason: 'Tgl lahir, alamat, no. HP sama; NIK kosong di B', rmA: P.rm, rmB: '00-41-09-33',
      banner: 'Rekam medis B dibuat di IGD Mar 2025 tanpa NIK. Tanggal lahir, alamat, nomor BPJS, dan nomor HP sama dengan A.',
      rows: [['Nama', 'Tn. Suryo Adi Nugroho', 'Suryo Adinugroho', 'mirip'], ['NIK', P.nik, '—', 'kosong'], ['Tanggal lahir', '18 Jun 1972', '18 Jun 1972', 'sama'], ['Nama ibu kandung', 'Sumarni', 'Sumarni', 'sama'], ['Alamat', P.addr, 'Jl. Melati Raya No. 8, Jakpus', 'mirip'], ['No. peserta BPJS', P.bpjs, P.bpjs, 'sama'], ['No. HP', P.phone, P.phone, 'sama'], ['Kunjungan', '14 kunjungan, terakhir 12 Sep 2026', '1 kunjungan IGD, Mar 2025', '—']],
      impact: [['1', 'kunjungan B dipindah ke A'], ['0', 'alergi baru dari B'], ['1', 'dokumen bertanda tangan tetap utuh']] },
    { name: 'Siti Rahmawati / Siti Rachmawati', score: 92, reason: 'NIK, tgl lahir, ibu kandung sama', rmA: '00-12-45-78', rmB: '00-31-07-92',
      banner: 'NIK, tanggal lahir, dan nama ibu kandung sama. Nama berbeda ejaan. Kemungkinan didaftarkan ulang tanpa NIK pada 2024.',
      rows: [['Nama', 'Siti Rahmawati', 'Siti Rachmawati', 'mirip'], ['NIK', '9999••••••••4521', '9999••••••••4521', 'sama'], ['Tanggal lahir', '14 Mar 1972', '14 Mar 1972', 'sama'], ['Nama ibu kandung', 'Aminah', 'Aminah', 'sama'], ['Alamat', 'Jl. Kenanga 12, Jakarta Timur', 'Kenanga No.12, Jaktim', 'mirip'], ['No. peserta BPJS', '0001234•••890', '—', 'kosong'], ['Kunjungan', '14 kunjungan, terakhir 3 Okt 2026', '3 kunjungan, terakhir Mar 2024', '—']],
      impact: [['3', 'kunjungan B dipindah ke A'], ['1', 'alergi B digabung ke A (penisilin)'], ['2', 'dokumen bertanda tangan tetap utuh']] },
    { name: 'Budi Santoso / Budi Santosa', score: 78, reason: 'Tgl lahir dan alamat sama, NIK kosong di B', rmA: '00-08-77-12', rmB: '00-29-40-05',
      banner: 'Tanggal lahir dan alamat sama, nama beda satu huruf. NIK kosong di rekam medis B: verifikasi KTP sebelum digabung.',
      rows: [['Nama', 'Budi Santoso', 'Budi Santosa', 'mirip'], ['NIK', '9999••••••••0937', '—', 'kosong'], ['Tanggal lahir', '2 Jun 1965', '2 Jun 1965', 'sama'], ['Nama ibu kandung', 'Sumiati', 'Sumiyati', 'mirip'], ['Alamat', 'Jl. Melati 4, Jakarta Timur', 'Jl. Melati 4, Jakarta Timur', 'sama'], ['No. HP', '0813•••2210', '—', 'kosong'], ['Kunjungan', '22 kunjungan, terakhir 28 Sep 2026', '1 kunjungan, Jan 2025', '—']],
      impact: [['1', 'kunjungan B dipindah ke A'], ['0', 'alergi baru dari B'], ['1', 'dokumen bertanda tangan tetap utuh']] },
  ];
  const MATCH_TONE = { sama: 'success', mirip: 'warning', beda: 'danger', kosong: '' };
  const scoreTone = (s) => (s >= 85 ? 'danger' : s >= 70 ? 'warning' : '');

  SIM.register({
    id: 'mpi', phase: 1, title: 'Master Patient Index', nav: 'MPI pasien', codes: 'P05', role: 'rm',
    desc: 'Cari pasien, tinjau kandidat rekam medis ganda dengan skor kemiripan, gabungkan dengan alasan, dan daftarkan pasien baru dari data Dukcapil.',
    hint: 'Di tab Kandidat duplikat: pilih pasangan Suryo, bandingkan berdampingan, tulis alasan, lalu Gabungkan.',
    init: { tab: 'dup', q: 'Suryo', searched: true, qErr: '', pick: '', sel: '0', cmp: false, alasan: '', status: {},
      nik: '9999011505880003', nikErr: '', dk: null, hp: '0813-0000-1505', pj: 'Agus Santoso (suami)', saved: null },
    render(L) {
      const tabs = ui.tabs('tab', L.tab, [{ value: 'cari', label: 'Cari pasien' }, { value: 'dup', label: `Kandidat duplikat · ${PAIRS.length - Object.keys(L.status).length}` }, { value: 'baru', label: 'Pasien baru (Dukcapil)' }]);
      let body = '';
      if (L.tab === 'cari') {
        const q = String(L.q || '').trim().toLowerCase();
        const res = L.searched && !L.qErr ? MPI_DB.filter((r) => r.hay.toLowerCase().includes(q) || r.name.toLowerCase().includes(q)) : [];
        const pick = MPI_DB.find((r) => r.key === L.pick);
        let detail = '';
        if (pick && pick.key === 'suryo') detail = ui.banner(P, ui.chip('NIK cocok Dukcapil', 'success'));
        else if (pick) detail = ui.card({ title: pick.name, sub: `RM ${pick.rm}`, body: `<div class="stack">${kv('Tanggal lahir', esc(pick.dob))}${kv('NIK', `<span class="mono">${esc(pick.nik)}</span>`)}${kv('Alamat', esc(pick.addr))}${kv('Kunjungan terakhir', esc(pick.last))}
          ${pick.dup === 0 ? `${ui.alert('warning', `Kemungkinan rekam medis ganda dengan ${P.rm} (skor 91%)`, 'RM ini dibuat tanpa NIK. Tinjau sebelum dipakai untuk pendaftaran.')}<div>${ui.btn('Tinjau di antrean duplikat', { act: 'tinjau', variant: 'primary', size: 'sm' })}</div>` : ''}</div>` });
        body = ui.split(ui.card({ title: 'Cari pasien', sub: 'NIK, No. RM, No. BPJS, atau nama + tgl lahir', body: `<div class="stack">${ui.input('q', L.q, { placeholder: 'mis. Suryo' })}
            ${L.qErr ? ui.alert('danger', L.qErr) : ''}<div class="row">${ui.btn('Cari', { act: 'cari', variant: 'primary' })}</div>
            ${L.searched && !L.qErr ? (res.length ? ui.list(res.map((r) => ({ title: r.name, sub: `RM ${r.rm} · lahir ${r.dob} · ${r.last}`, arg: r.key, sel: r.key === L.pick, right: r.dup === 0 ? ui.chip('Kemungkinan ganda', 'warning') : '' })), 'pilihPasien') : `${ui.empty('Tidak ditemukan.')}<div>${ui.btn('Daftarkan pasien baru', { set: 'tab=baru', size: 'sm' })}</div>`) : ''}</div>` }),
          detail || ui.card({ body: ui.empty('Pilih pasien dari hasil pencarian untuk melihat identitasnya.') }));
      } else if (L.tab === 'baru') {
        const dk = L.dk;
        const form = dk && !dk.notfound ? `<div class="grid g2">
            ${ui.field('Nama (Dukcapil)', `<div class="inp" style="background:var(--subtle)">${esc(dk.name)}</div>`)}${ui.field('Tanggal lahir', `<div class="inp mono" style="background:var(--subtle)">${esc(dk.dob)}</div>`)}
            ${ui.field('Jenis kelamin', `<div class="inp" style="background:var(--subtle)">${dk.jk === 'P' ? 'Perempuan' : 'Laki-laki'}</div>`)}${ui.field('Nama ibu kandung', `<div class="inp" style="background:var(--subtle)">${esc(dk.ibu)}</div>`)}
            ${ui.field('Alamat KTP', `<div class="inp" style="background:var(--subtle)">${esc(dk.addr)}</div>`)}${ui.field('No. HP', ui.input('hp', L.hp, { mono: true }), '', 'f-hp')}
            ${ui.field('Penanggung jawab', ui.input('pj', L.pj), '', 'f-pj')}</div>
            ${ui.alert('success', `Pemeriksaan duplikat · ${dk.t}`, 'Tidak ada kandidat rekam medis ganda (skor tertinggi 34%: Ny. Rina Oktavia, beda tanggal lahir).')}` : '';
        const step = L.saved ? 3 : dk ? 2 : 0;
        body = `${ui.steps(['NIK', 'Ambil data Dukcapil', 'Lengkapi & cek duplikat', 'Simpan'], step)}${ui.card({ title: 'Pasien baru', sub: 'Identitas diambil dari Dukcapil, petugas hanya melengkapi kontak', body: `<div class="stack">
          <div class="row" style="align-items:flex-end">${ui.field('NIK (16 digit)', ui.input('nik', L.nik, { mono: true, inputmode: 'numeric' }), 'NIK berawalan 0000 = contoh tidak terdaftar.', 'f-nik')}${ui.btn('Ambil dari Dukcapil', { act: 'dukcapil', variant: dk ? '' : 'primary' })}</div>
          ${L.nikErr ? ui.alert('danger', L.nikErr) : ''}
          ${dk && dk.notfound ? ui.alert('warning', `NIK tidak ditemukan di Dukcapil · ${dk.t}`, 'Isi identitas manual dari KTP fisik; rekam medis ditandai "belum terverifikasi" sampai NIK dicek ulang.') : ''}
          ${dk && !dk.notfound ? ui.chip(`Terverifikasi Dukcapil · ${dk.t}`, 'success') : ''}${form}
          ${L.saved ? ui.alert('success', `Rekam medis baru ${L.saved.rm} · ${L.saved.t}`, `${esc(dk ? dk.name : '')} siap didaftarkan ke poli. Data identitas terkunci dan hanya bisa dikoreksi dengan alasan.`)
            : `<div>${ui.btn('Simpan pasien baru', { act: 'simpanBaru', variant: 'primary', disabled: !(dk && !dk.notfound), reason: 'Ambil data Dukcapil dulu.' })}</div>`}</div>` })}`;
      } else {
        const i = Math.min(PAIRS.length - 1, Math.max(0, Number(L.sel) || 0));
        const pr = PAIRS[i]; const st = L.status[i];
        const queue = ui.card({ title: 'Antrean tinjauan', sub: `${PAIRS.length} pasangan · 12 total bulan ini`, flush: true, body: ui.list(PAIRS.map((p, k) => {
          const s = L.status[k];
          return { title: p.name, sub: p.reason, arg: String(k), sel: k === i, right: s ? ui.chip(s.kind === 'merge' ? 'Digabung' : 'Bukan duplikat', s.kind === 'merge' ? 'success' : '') : ui.chip(`${p.score}%`, scoreTone(p.score)) };
        }), 'pasangan') });
        let right = `${ui.steps(['Pilih pasangan', 'Bandingkan', 'Putuskan dengan alasan'], st ? 3 : L.cmp ? 2 : 1)}
          ${ui.alert(pr.score >= 85 ? 'warning' : 'info', `Skor kecocokan ${pr.score}%`, esc(pr.banner))}`;
        if (!L.cmp && !st) right += `<div>${ui.btn('Bandingkan berdampingan', { act: 'bandingkan', variant: 'primary' })}</div>`;
        else {
          right += ui.card({ title: 'Perbandingan berdampingan', flush: true, body: ui.table(['Atribut', `A · ${pr.rmA} (dipertahankan)`, `B · ${pr.rmB} (digabung)`, 'Cocok'], pr.rows.map((r) => [esc(r[0]), esc(r[1]), esc(r[2]), r[3] === '—' ? '—' : ui.chip(r[3], MATCH_TONE[r[3]])])) });
          right += `<div class="grid g3">${pr.impact.map((m) => ui.kpi(m[1], m[0])).join('')}</div>`;
          if (st) {
            right += `${ui.alert('success', st.kind === 'merge' ? `Digabung ke ${pr.rmA} · ${st.t}` : `Ditandai bukan orang yang sama · ${st.t}`, `${st.kind === 'merge' ? `RM ${pr.rmB} dialihkan ke ${pr.rmA}; tidak ada data yang dihapus. Dapat dibatalkan dalam 30 hari.` : 'Pasangan tidak akan diusulkan lagi.'} Alasan: ${esc(st.alasan)}`)}
              <div class="row">${ui.btn('Batalkan keputusan', { act: 'urung', size: 'sm' })}${ui.btn('Lihat di jejak audit', { go: 'audit', variant: 'ghost', size: 'sm' })}</div>`;
          } else {
            right += `${ui.field('Alasan dan dasar verifikasi (wajib)', ui.input('alasan', L.alasan, { area: true, placeholder: 'mis. Dikonfirmasi dengan KTP dan wawancara pasien di loket 5 Okt 2026' }), '', 'f-alasan')}
              <div class="row">${ui.btn(`Gabungkan ke ${pr.rmA}`, { act: 'putus', arg: 'merge', variant: 'primary', needs: 'alasan:10' })}${ui.btn('Bukan orang yang sama', { act: 'putus', arg: 'beda', needs: 'alasan:10' })}</div>
              <p class="small muted" style="margin:0">Penggabungan berjejak: nomor RM B dialihkan ke A dan tautan ke SATUSEHAT diperbarui.</p>`;
          }
        }
        body = ui.split(queue, `<div class="stack">${right}</div>`);
      }
      const doneMsg = L.status[0] && L.status[0].kind === 'merge' ? 'RM ganda Tn. Suryo digabung dengan alasan' : Object.keys(L.status).length ? 'Kandidat duplikat diputuskan dengan alasan' : '';
      return `${tabs}${body}${doneMsg ? nextOf(['jadwal'], doneMsg) : ''}`;
    },
    actions: {
      cari(L) {
        const q = String(L.q || '').trim();
        L.searched = true; L.pick = '';
        L.qErr = q.length < 3 ? 'Masukkan minimal 3 karakter: NIK, No. RM, No. BPJS, atau nama.' : '';
      },
      pilihPasien(L, J, el) { const k = argOf(el); if (!MPI_DB.some((r) => r.key === k)) return false; L.pick = k; },
      tinjau(L) { L.tab = 'dup'; L.sel = '0'; L.cmp = false; },
      pasangan(L, J, el) { const k = Number(argOf(el)); if (!(k >= 0 && k < PAIRS.length)) return false; L.sel = String(k); L.cmp = !!L.status[k]; L.alasan = ''; },
      bandingkan(L) { L.cmp = true; },
      putus(L, J, el) {
        const kind = argOf(el);
        const i = Number(L.sel) || 0;
        if ((kind !== 'merge' && kind !== 'beda') || L.status[i] || String(L.alasan || '').trim().length < 10) return false;
        L.status[i] = { kind, t: SIM.now(2), alasan: String(L.alasan).trim() };
        L.alasan = ''; L.cmp = true;
        SIM.note(kind === 'merge' ? `RM ${PAIRS[i].rmB} digabung ke ${PAIRS[i].rmA} dengan alasan` : `${PAIRS[i].name}: ditandai bukan orang yang sama`, 'success');
        SIM.done();
      },
      urung(L) { const i = Number(L.sel) || 0; if (!L.status[i]) return false; delete L.status[i]; SIM.toast('Keputusan dibatalkan; pasangan kembali ke antrean'); },
      dukcapil(L) {
        const d = String(L.nik || '').replace(/\D/g, '');
        L.saved = null;
        if (d.length !== 16) { L.nikErr = `NIK harus 16 digit. Baru ${d.length} digit.`; L.dk = null; return; }
        L.nikErr = '';
        const t = SIM.now(1);
        L.dk = d.startsWith('0000') ? { notfound: true, t } : { name: 'Ny. Rina Oktaviani', dob: '15-05-1988', jk: 'P', ibu: 'Sulastri', addr: 'Jl. Kenanga 12, Kel. Cempaka Putih, Jakarta Pusat', t };
      },
      simpanBaru(L) {
        if (!L.dk || L.dk.notfound || L.saved) return false;
        L.saved = { rm: '00-63-12-08', t: SIM.now(1) };
        SIM.note('Pasien baru Ny. Rina Oktaviani terdaftar dari data Dukcapil (RM 00-63-12-08)', 'success');
      },
    },
  });

  /* =====================================================================
   * FASE 1 · Pembuat formulir klinis
   * ===================================================================== */
  const MORSE = [
    { id: 'q1', q: 'Riwayat jatuh dalam 3 bulan', opts: [['Tidak', 0], ['Ya', 25]] },
    { id: 'q2', q: 'Diagnosis sekunder (lebih dari satu)', opts: [['Tidak', 0], ['Ya', 15]] },
    { id: 'q3', q: 'Alat bantu berjalan', opts: [['Tidak ada / tirah baring / dibantu perawat', 0], ['Kruk / tongkat / walker', 15], ['Berpegangan pada furnitur', 30]] },
    { id: 'q4', q: 'Terpasang infus atau heparin lock', opts: [['Tidak', 0], ['Ya', 20]] },
    { id: 'q5', q: 'Cara berjalan', opts: [['Normal / tirah baring', 0], ['Lemah', 10], ['Terganggu', 20]] },
    { id: 'q6', q: 'Status mental', opts: [['Sadar akan kemampuan', 0], ['Lupa keterbatasan', 15]] },
  ].map((x) => ({ ...x, type: 'pilih', req: true, scored: true, isNew: false, ph: '' }));
  const FTYPES = [
    { k: 'teks', label: 'Teks pendek', ph: 'Isian teks pendek' }, { k: 'angka', label: 'Angka + satuan', ph: 'Angka · satuan' },
    { k: 'pilih', label: 'Pilihan tunggal' }, { k: 'tanggal', label: 'Tanggal / jam', ph: 'dd/mm/yyyy · jj.mm' },
    { k: 'icd', label: 'Diagnosis ICD-10', ph: 'Cari kode ICD-10' }, { k: 'ttd', label: 'Tanda tangan', ph: 'Area tanda tangan elektronik' },
  ];
  const OLD_ENTRY = {
    3: { who: 'Ns. Fitri Handayani', when: '2 Okt 2026 09.12', pt: 'Tn. Hartono Wibisono', ans: { q1: 1, q2: 1, q3: 0, q4: 1, q5: 1, q6: 0 } },
    2: { who: 'Ns. Lina Marlina', when: '14 Jun 2026 10.40', pt: 'Ny. Ratna Sari', ans: { q1: 0, q2: 0, q3: 0, q4: 1, q5: 0, q6: 0 } },
    1: { who: 'Ns. Fitri Handayani', when: '2 Feb 2026 08.05', pt: 'Tn. Suryo Adi Nugroho', ans: { q1: 0, q2: 1, q3: 1, q4: 0, q5: 1 } },
  };
  const morseScore = (items, ans) => {
    let total = 0; let n = 0;
    items.forEach((it) => { if (it.scored && ans[it.id] !== undefined && it.opts[ans[it.id]]) { total += it.opts[ans[it.id]][1]; n++; } });
    return { total, n, kat: total >= 45 ? ['Risiko tinggi', 'danger'] : total >= 25 ? ['Risiko sedang', 'warning'] : ['Risiko rendah', 'success'] };
  };
  const formView = (items, ans, act) => items.map((it) => {
    let ctl;
    if (it.type === 'pilih') ctl = `<div class="row">${it.opts.map((o, oi) => {
      const on = ans[it.id] === oi;
      const lbl = `${o[0]}${it.scored ? ` · +${o[1]}` : ''}`;
      return act ? ui.btn(lbl, { act, arg: `${it.id}:${oi}`, size: 'sm', variant: on ? 'primary' : '' }) : ui.chip(lbl, on ? 'brand' : '');
    }).join('')}</div>`;
    else ctl = `<div class="inp small muted" style="background:var(--subtle)">${esc(it.ph || '—')}</div>`;
    return `<div class="stack" style="gap:6px"><b class="small">${esc(it.q || '(tanpa label)')}${it.req ? ' <span style="color:var(--danger)">*</span>' : ''}</b>${ctl}</div>`;
  }).join('<hr class="sep">');
  const ensureDraft = (L) => { if (L.phase === 'terbit') { L.phase = 'draf'; L.ver = Number(L.ver) + 1; L.catatan = ''; } };

  SIM.register({
    id: 'formulir', phase: 1, title: 'Pembuat formulir klinis', nav: 'Formulir klinis', codes: 'P07', role: 'admin',
    desc: 'Asesmen risiko jatuh dewasa (Morse): tambah field, pratinjau di tablet, terbitkan versi baru. Entri lama tetap dibaca dengan versinya.',
    hint: 'Tambah field dari palet, lihat Pratinjau, tulis catatan versi, lalu Terbitkan. Klik v3 di riwayat untuk membuka entri lama.',
    init: () => ({ items: clone(MORSE), sel: 'q3', seq: 0, ver: 4, phase: 'draf', tab: 'kanvas', ans: {}, lbl: 'Alat bantu berjalan', req: true, err: '',
      catatan: 'Tambah intervensi pencegahan jatuh', pubAt: '', view: '',
      hist: [{ n: 3, d: '12 Sep 2026', note: 'Disetujui Komite RM', status: 'Berlaku', items: clone(MORSE) }, { n: 2, d: '3 Mar 2026', note: 'Perbaikan kode LOINC', status: 'Arsip', items: clone(MORSE) }, { n: 1, d: '10 Jan 2026', note: 'Impor dari formulir kertas', status: 'Arsip', items: clone(MORSE.slice(0, 5)) }] }),
    headActions(L) { return L.phase === 'terbit' ? ui.chip(`v${L.ver} berlaku · ${L.pubAt}`, 'success') : ui.chip(`Draf v${L.ver}`, 'warning'); },
    onChange(key, L) {
      if (key !== 'req') return;
      const it = L.items.find((x) => x.id === L.sel);
      if (it && it.req !== !!L.req) { ensureDraft(L); it.req = !!L.req; }
    },
    render(L) {
      const cur = L.items.find((x) => x.id === L.sel) || L.items[0];
      const palette = ui.card({ title: 'Jenis field', sub: 'Klik untuk menambah ke kanvas', body: `<div class="grid g2" style="gap:8px">${FTYPES.map((f) => ui.btn(`+ ${f.label}`, { act: 'tambah', arg: f.k, size: 'sm' })).join('')}</div>` });
      const versions = [];
      if (L.phase === 'draf') versions.push({ title: `v${L.ver} · draf`, sub: L.catatan || 'Belum ada catatan versi', right: ui.chip('Draf', 'warning'), arg: '' });
      L.hist.forEach((h) => versions.push({ title: `v${h.n} · ${h.d}`, sub: h.note, right: ui.chip(h.status, h.status === 'Berlaku' ? 'success' : ''), arg: String(h.n), sel: String(h.n) === String(L.view) }));
      const hist = ui.card({ title: 'Riwayat versi', sub: 'Klik versi untuk membuka entri lama', flush: true, body: `${ui.list(versions, 'lihatVersi')}<div class="cb small muted">Entri lama tetap ditampilkan dengan versi formulir saat diisi.</div>` });
      let main = '';
      const vh = L.view ? L.hist.find((h) => String(h.n) === String(L.view)) : null;
      if (vh) {
        const e = OLD_ENTRY[vh.n];
        const sc = e ? morseScore(vh.items, e.ans) : null;
        main = ui.card({ title: `Entri lama dibaca dengan v${vh.n}`, sub: e ? `${e.pt} · diisi ${e.who} · ${e.when}` : 'Belum ada entri dengan versi ini', actions: ui.btn('Tutup', { act: 'tutupVersi', size: 'sm' }),
          body: `<div class="stack">${ui.alert('info', `Versi ${vh.n} (${vh.status.toLowerCase()})`, `Formulir ditampilkan persis seperti saat diisi: ${vh.items.length} pertanyaan. Perubahan di versi baru tidak mengubah entri ini.`)}
            ${formView(vh.items, e ? e.ans : {}, '')}${sc ? `<div class="row between"><b>Skor total</b><span>${ui.chip(`${sc.total} · ${sc.kat[0]}`, sc.kat[1])}</span></div>` : ''}</div>` });
      } else if (L.tab === 'pratinjau') {
        const sc = morseScore(L.items, L.ans);
        const inner = `<div style="padding:18px;display:flex;flex-direction:column;gap:12px"><div class="row between"><div><b>Asesmen risiko jatuh dewasa (Morse)</b><div class="small muted">${esc(P.name)} · RM ${esc(P.rm)} · v${L.ver}</div></div>${ui.chip(`${sc.total} · ${sc.kat[0]}`, sc.kat[1])}</div>
          ${formView(L.items, L.ans, 'jawab')}
          ${sc.total >= 45 ? ui.alert('danger', 'Risiko tinggi: bundle pencegahan jatuh aktif', 'Gelang kuning, pagar tempat tidur, edukasi keluarga, asesmen ulang tiap shift.') : `<div class="small muted">0–24 rendah · 25–44 sedang · ≥ 45 tinggi · terjawab ${sc.n}/6</div>`}</div>`;
        main = ui.device('tablet', inner, 'Pratinjau di tablet perawat');
      } else {
        const fields = ui.list(L.items.map((it) => ({ title: `${it.q || '(tanpa label)'}${it.req ? ' *' : ''}`, sub: `${it.isNew ? 'field baru · ' : ''}${(FTYPES.find((f) => f.k === it.type) || {}).label || ''}${it.scored ? ' · skor' : ''}`, arg: it.id, sel: it.id === cur.id, right: it.isNew ? ui.chip('Baru', 'warning') : '' })), 'pilihField');
        const props = ui.card({ title: 'Properti field terpilih', body: `<div class="stack">
          ${ui.field('Label', ui.input('lbl', L.lbl), L.err || '', 'f-lbl')}
          ${ui.check('req', L.req, 'Wajib diisi sebelum tanda tangan')}
          <div class="row">${ui.btn('Terapkan label', { act: 'terapkan', size: 'sm', variant: 'primary' })}
          ${ui.btn('Hapus field', { act: 'hapus', size: 'sm', variant: 'ghost', disabled: !cur.isNew, reason: 'Field skor Morse dipakai rumus total; tidak bisa dihapus.' })}</div></div>` });
        main = `<div class="grid g2">${ui.card({ title: 'Kanvas · Penilaian Morse Fall Scale', sub: `${L.items.length} field`, flush: true, body: fields })}${props}</div>`;
      }
      const pub = L.phase === 'terbit'
        ? ui.alert('success', `v${L.ver} berlaku sejak ${L.pubAt}`, 'Entri baru memakai versi ini; entri lama tetap ditampilkan dengan versi saat diisi. Ubah field untuk memulai draf berikutnya.')
        : ui.card({ title: `Terbitkan v${L.ver}`, sub: 'Disetujui Komite RM (simulasi)', tone: 'warning', body: `<div class="stack">${ui.field('Catatan versi (wajib)', ui.input('catatan', L.catatan, { placeholder: 'Apa yang berubah?' }), '', 'f-catatan')}
          <div>${ui.btn(`Terbitkan versi ${L.ver}`, { act: 'terbit', variant: 'primary', needs: 'catatan:5' })}</div></div>` });
      return `${ui.split(`<div class="stack">${palette}${hist}</div>`, `<div class="stack">${vh ? '' : ui.tabs('tab', L.tab, [{ value: 'kanvas', label: 'Kanvas' }, { value: 'pratinjau', label: 'Pratinjau' }])}${main}${pub}</div>`)}
        ${L.phase === 'terbit' ? nextOf(['jadwal'], `Formulir Morse v${L.ver} terbit · ${L.pubAt}; versi lama tetap terbaca`) : ''}`;
    },
    actions: {
      tambah(L, J, el) {
        const f = FTYPES.find((x) => x.k === argOf(el));
        if (!f) return false;
        ensureDraft(L);
        L.seq = Number(L.seq) + 1;
        const it = { id: `f${L.seq}`, q: `${f.label} (field baru)`, type: f.k, req: false, scored: false, isNew: true, ph: f.ph || '', opts: f.k === 'pilih' ? [['Opsi 1', 0], ['Opsi 2', 0]] : [] };
        L.items.push(it); L.sel = it.id; L.lbl = it.q; L.req = false; L.tab = 'kanvas'; L.view = ''; L.err = '';
      },
      pilihField(L, J, el) { const it = L.items.find((x) => x.id === argOf(el)); if (!it) return false; L.sel = it.id; L.lbl = it.q; L.req = !!it.req; L.err = ''; },
      terapkan(L) {
        const it = L.items.find((x) => x.id === L.sel);
        if (!it) return false;
        const v = String(L.lbl || '').trim();
        if (!v) { L.err = 'Label wajib diisi sebelum formulir diterbitkan.'; return; }
        if (v !== it.q) { ensureDraft(L); it.q = v; }
        L.err = '';
      },
      hapus(L) {
        const it = L.items.find((x) => x.id === L.sel);
        if (!it || !it.isNew) return false;
        L.items = L.items.filter((x) => x.id !== it.id);
        L.sel = L.items[L.items.length - 1].id; L.lbl = L.items[L.items.length - 1].q;
      },
      jawab(L, J, el) {
        const [id, oi] = String(argOf(el) || '').split(':');
        const it = L.items.find((x) => x.id === id);
        if (!it || !it.opts[Number(oi)]) return false;
        if (L.ans[id] === Number(oi)) delete L.ans[id]; else L.ans[id] = Number(oi);
      },
      lihatVersi(L, J, el) { const a = argOf(el); L.view = a || ''; },
      tutupVersi(L) { L.view = ''; },
      terbit(L) {
        if (L.phase !== 'draf' || String(L.catatan || '').trim().length < 5) return false;
        L.hist.forEach((h) => { if (h.status === 'Berlaku') h.status = 'Arsip'; });
        L.hist.unshift({ n: Number(L.ver), d: '5 Okt 2026', note: String(L.catatan).trim(), status: 'Berlaku', items: clone(L.items) });
        L.phase = 'terbit'; L.pubAt = SIM.now(2); L.view = '';
        SIM.note(`Formulir Morse v${L.ver} diterbitkan; versi lama tetap terbaca`, 'success');
        SIM.done();
      },
    },
  });

  /* =====================================================================
   * FASE 2 · Jadwal dokter + kuota + HFIS
   * ===================================================================== */
  const DAYS = ['Sen 5', 'Sel 6', 'Rab 7', 'Kam 8', 'Jum 9', 'Sab 10'];
  const DAYS_FULL = ['Senin 5 Okt', 'Selasa 6 Okt', 'Rabu 7 Okt', 'Kamis 8 Okt', 'Jumat 9 Okt', 'Sabtu 10 Okt'];
  const POLI_NAME = { PD: 'Penyakit Dalam', JT: 'Jantung', SR: 'Saraf', PR: 'Paru' };
  const DOCS = [
    { id: 'andi', doc: 'dr. Andi Wiratama, Sp.PD', poli: 'PD', cells: [['08.00–12.00', 22, 30], ['08.00–12.00', 26, 30], ['08.00–12.00', 12, 30], ['08.00–12.00', 9, 30], null, ['08.00–11.00', 5, 20]] },
    { id: 'ratih', doc: 'dr. Ratih Pramesti, Sp.PD', poli: 'PD', cells: [['13.00–16.00', 9, 25], null, ['13.00–16.00', 20, 25], ['13.00–16.00', 4, 25], ['13.00–16.00', 2, 25], null] },
    { id: 'fajar', doc: 'dr. Fajar Nugraha, Sp.JP', poli: 'JT', cells: [['09.00–12.00', 18, 20], ['09.00–12.00', 11, 20], ['09.00–12.00', 18, 20], ['09.00–12.00', 7, 20], ['09.00–12.00', 6, 20], null] },
    { id: 'sinta', doc: 'dr. Sinta Maharani, Sp.JP', poli: 'JT', cells: [null, ['13.00–15.00', 6, 15], null, ['13.00–15.00', 3, 15], null, ['08.00–10.00', 1, 10]] },
    { id: 'hadi', doc: 'dr. Hadi Kusuma, Sp.N', poli: 'SR', cells: [['09.30–12.00', 15, 20], ['09.30–12.00', 17, 20], ['09.30–12.00', 10, 20], null, ['09.30–12.00', 8, 20], null] },
    { id: 'yusuf', doc: 'dr. Yusuf Hakim, Sp.P', poli: 'PR', cells: [['08.00–11.00', 14, 20], ['08.00–11.00', 9, 20], ['08.00–11.00', 16, 20], ['08.00–11.00', 5, 20], ['08.00–11.00', 4, 20], ['08.00–10.00', 2, 10]] },
  ];
  const docIdx = (id) => DOCS.findIndex((d) => d.id === id);
  const slotOf = (L, ri, ci) => {
    const d = DOCS[ri]; const cell = d && d.cells[ci];
    if (!cell) return null;
    const key = `${ri}-${ci}`;
    const o = L.q[key];
    const jkn = o ? o.jkn : Math.round(cell[2] * 0.8);
    const non = o ? o.non : cell[2] - Math.round(cell[2] * 0.8);
    return { key, time: cell[0], used: cell[1] + (Number(L.extra[key]) || 0), jkn, non, total: jkn + non, hfisTotal: cell[2], cuti: L.cuti[key] || null };
  };
  /** Sel pengganti: dokter yang menggantikan cuti di hari tertentu. */
  const subOf = (L, ri, ci) => {
    for (const k of Object.keys(L.cuti)) {
      const c = L.cuti[k]; const [cri, cci] = k.split('-').map(Number);
      if (c.sub && docIdx(c.sub) === ri && cci === ci) return { from: DOCS[cri], slot: slotOf(L, cri, cci) };
    }
    return null;
  };
  const jadwalDiffs = (L) => {
    const out = [];
    Object.keys(L.cuti).forEach((k) => { const c = L.cuti[k]; if (!c.hfis) { const [ri, ci] = k.split('-').map(Number); out.push(`Cuti ${DOCS[ri].doc} ${DAYS_FULL[ci]}: RS = cuti${c.sub ? ` (pengganti ${DOCS[docIdx(c.sub)].doc})` : ''}, HFIS = praktik`); } });
    Object.keys(L.dirty).forEach((k) => { const [ri, ci] = k.split('-').map(Number); const s = slotOf(L, ri, ci); if (s) out.push(`Kuota ${DOCS[ri].doc} ${DAYS_FULL[ci]}: RS = ${s.total}, HFIS = ${s.hfisTotal}`); });
    return out;
  };

  SIM.register({
    id: 'jadwal', phase: 2, title: 'Jadwal praktik dokter', nav: 'Jadwal dokter', codes: 'F01', role: 'daftar',
    desc: 'Jadwal per minggu dengan kuota JKN/non-JKN per sesi, cuti dan dokter pengganti, lalu sinkron ke HFIS BPJS.',
    hint: 'Klik sesi dr. Andi Senin, coba turunkan kuota di bawah jumlah booking, lalu Kirim ke HFIS dan selesaikan beda data.',
    init: { poli: 'all', sel: '0-0', q: {}, extra: {}, dirty: {}, err: '', qTotal: '', showCuti: false,
      cuti: { '2-2': { sub: 'sinta', alasan: 'Seminar nasional kardiologi', hfis: false, t: '4 Okt' } },
      cDoc: 'ratih', cDay: '3', cSub: 'andi', cAlasan: '', cErr: '', sync: { state: 'beda', t: '07.30' }, conflict: null },
    onChange(key, L) {
      if (key === 'cDoc') { const d = DOCS[docIdx(L.cDoc)]; const subs = DOCS.filter((x) => d && x.poli === d.poli && x.id !== d.id); L.cSub = subs[0] ? subs[0].id : ''; }
    },
    render(L, J) {
      const BK = booking(J);
      const rows = DOCS.map((d, ri) => ({ d, ri })).filter((x) => L.poli === 'all' || x.d.poli === L.poli).map(({ d, ri }) => [
        `<b>${esc(d.doc)}</b><div class="small muted">${esc(POLI_NAME[d.poli])}</div>`,
        ...DAYS.map((_, ci) => {
          const s = slotOf(L, ri, ci); const sub = subOf(L, ri, ci); const key = `${ri}-${ci}`;
          const on = L.sel === key ? 'outline:2px solid var(--brand-600);outline-offset:1px;' : '';
          const cellBtn = (bg, bd, top, bottom) => `<button type="button" class="btn sm" data-act="pilih" data-arg="${key}" style="width:100%;min-width:96px;flex-direction:column;align-items:flex-start;gap:0;min-height:48px;padding:4px 8px;background:${bg};border-color:${bd};${on}"><span class="mono small">${top}</span><span class="small" style="font-weight:500">${bottom}</span></button>`;
          if (s && s.cuti) return cellBtn('var(--danger-bg)', 'var(--danger-border)', 'Cuti', s.cuti.hfis ? 'HFIS diperbarui' : 'HFIS belum diubah');
          if (sub) return cellBtn('var(--info-bg)', 'var(--info-border)', esc(sub.slot ? sub.slot.time : ''), 'pengganti');
          if (!s) return '<span class="small muted">—</span>';
          const pct = s.total ? (s.used / s.total) * 100 : 100;
          return cellBtn(pct >= 80 ? 'var(--warning-bg)' : 'var(--selected)', pct >= 80 ? 'var(--warning-border)' : 'var(--brand-200)', esc(s.time), `${s.used}/${s.total}${L.dirty[key] ? ' •' : ''}`);
        }),
      ]);
      const grid = ui.card({ title: 'Jadwal praktik · 5–10 Okt 2026', sub: 'Angka = pasien booking / kuota sesi · • = belum dikirim ke HFIS', flush: true,
        actions: `${ui.seg('poli', L.poli, [{ value: 'all', label: 'Semua' }, { value: 'PD', label: 'PD' }, { value: 'JT', label: 'Jantung' }, { value: 'SR', label: 'Saraf' }, { value: 'PR', label: 'Paru' }])}${ui.btn('+ Catat cuti / pengganti', { act: 'bukaCuti', size: 'sm' })}`,
        body: ui.table(['Dokter · poli', ...DAYS], rows) });

      // Panel sesi terpilih
      const [sri, sci] = String(L.sel || '0-0').split('-').map(Number);
      const sd = DOCS[sri] || DOCS[0];
      const ss = slotOf(L, sri, sci); const ssub = subOf(L, sri, sci);
      let panel;
      if (ss && ss.cuti) {
        const subDoc = ss.cuti.sub ? DOCS[docIdx(ss.cuti.sub)] : null;
        panel = `<div class="stack">${ui.chip('Cuti', 'danger')}<div class="small">${esc(ss.cuti.alasan)} · dicatat ${esc(ss.cuti.t)}</div>
          ${ui.alert('warning', `${ss.used} pasien sudah booking`, subDoc ? `Dialihkan ke ${esc(subDoc.doc)} pada jam yang sama. Pemberitahuan WhatsApp (tanpa isi klinis) siap dikirim.` : 'Tanpa pengganti: pasien perlu dijadwal ulang; pemberitahuan WhatsApp siap dikirim.')}
          <div>${ui.btn('Batalkan cuti', { act: 'batalCuti', size: 'sm', variant: 'ghost' })}</div></div>`;
      } else if (ssub) {
        panel = `<div class="stack">${ui.chip('Dokter pengganti', 'info')}<div class="small">Menggantikan ${esc(ssub.from.doc)} · ${esc(ssub.slot ? ssub.slot.time : '')}. Kuota mengikuti sesi yang digantikan (${ssub.slot ? ssub.slot.used : 0}/${ssub.slot ? ssub.slot.total : 0}).</div></div>`;
      } else if (!ss) {
        panel = ui.empty('Tidak ada jadwal praktik di hari ini.');
      } else {
        const pct = ss.total ? Math.round((ss.used / ss.total) * 100) : 100;
        const isBk = sri === 0 && sci === 0;
        panel = `<div class="stack">
          <div class="row between"><b>Kuota JKN</b><div class="row">${ui.btn('−', { act: 'kuota', arg: 'jkn:-1', size: 'sm' })}<span class="mono" style="min-width:32px;text-align:center;font-size:18px">${ss.jkn}</span>${ui.btn('+', { act: 'kuota', arg: 'jkn:1', size: 'sm' })}</div></div>
          <div class="row between"><b>Kuota non-JKN</b><div class="row">${ui.btn('−', { act: 'kuota', arg: 'non:-1', size: 'sm' })}<span class="mono" style="min-width:32px;text-align:center;font-size:18px">${ss.non}</span>${ui.btn('+', { act: 'kuota', arg: 'non:1', size: 'sm' })}</div></div>
          ${bar(pct, quotaTone(pct))}<div class="small"><b>${ss.used}</b> pasien booking dari <b>${ss.total}</b> kuota · ${pct}% terisi · sisa <b>${Math.max(0, ss.total - ss.used)}</b></div>
          <div class="row" style="align-items:flex-end">${ui.field('Ubah total kuota', ui.input('qTotal', L.qTotal, { mono: true, inputmode: 'numeric', placeholder: `mis. ${ss.used - 2}` }), '', 'f-qTotal')}${ui.btn('Terapkan', { act: 'terapkanKuota' })}</div>
          ${L.err ? ui.alert('danger', 'Kuota ditolak', esc(L.err)) : ''}
          ${L.dirty[ss.key] ? ui.chip('Perubahan kuota belum dikirim ke HFIS', 'warning') : ''}
          ${isBk ? `<hr class="sep"><div class="small muted">Booking lewat loket mengurangi sisa kuota sesi ini.</div>${ui.btn(`Booking loket untuk ${P.short}`, { act: 'bookingLoket', size: 'sm', disabled: !!J.booking, reason: `Tn. Suryo sudah punya booking ${BK.code} (${BK.no}).` })}` : ''}</div>`;
      }
      const detail = ui.card({ title: `${sd.doc}`, sub: `${POLI_NAME[sd.poli]} · ${DAYS_FULL[sci] || ''}${ss ? ` · ${ss.time}` : ''}`, body: panel });

      // Form cuti
      const cd = DOCS[docIdx(L.cDoc)] || DOCS[1];
      const subs = DOCS.filter((x) => x.poli === cd.poli && x.id !== cd.id);
      const cutiForm = L.showCuti ? ui.card({ title: 'Catat cuti atau dokter pengganti', tone: 'warning', actions: ui.btn('Tutup', { act: 'tutupCuti', size: 'sm', variant: 'ghost' }), body: `<div class="stack"><div class="grid g2">
          ${ui.field('Dokter', ui.select('cDoc', L.cDoc, DOCS.map((d) => ({ value: d.id, label: d.doc }))))}
          ${ui.field('Hari', ui.select('cDay', L.cDay, DAYS_FULL.map((d, i) => ({ value: String(i), label: d }))))}
          ${ui.field('Dokter pengganti', ui.select('cSub', L.cSub, [...subs.map((d) => ({ value: d.id, label: d.doc })), { value: '', label: 'Tanpa pengganti (jadwal ulang pasien)' }]))}
          ${ui.field('Alasan cuti', ui.input('cAlasan', L.cAlasan, { placeholder: 'mis. Cuti tahunan' }), '', 'f-cAlasan')}</div>
          ${L.cErr ? ui.alert('danger', L.cErr) : ''}<div>${ui.btn('Simpan cuti', { act: 'simpanCuti', variant: 'primary', needs: 'cAlasan:5' })}</div></div>` }) : '';

      // HFIS
      const diffs = jadwalDiffs(L);
      let hfis;
      if (L.sync.state === 'conflict') {
        hfis = `${ui.alert('warning', `Terkirim ${L.sync.t}, tetapi ada 1 beda data dari HFIS`, 'Jam praktik dr. Hadi Kusuma, Sp.N Senin 5 Okt: RS 09.30–12.00, HFIS 09.00–12.00. Pilih data yang benar.')}
          <div class="row">${ui.btn('Pakai data RS (kirim ulang)', { act: 'selesaikan', arg: 'rs', variant: 'primary' })}${ui.btn('Pakai data HFIS', { act: 'selesaikan', arg: 'hfis' })}</div>`;
      } else if (!diffs.length && L.sync.state === 'ok') {
        hfis = ui.alert('success', `Tersinkron dengan HFIS · ${L.sync.t}`, `Jadwal RS dan HFIS sama.${L.conflict ? ` Beda jam dr. Hadi diselesaikan memakai data ${L.conflict === 'rs' ? 'RS' : 'HFIS'}.` : ''} Sesi cuti tidak bisa dibooking di Mobile JKN.`);
      } else {
        hfis = `<div class="stack">${diffs.length ? diffs.map((d) => `<div class="row small" style="flex-wrap:nowrap;align-items:flex-start">${ui.chip('Beda', 'warning')}<span>${esc(d)}</span></div>`).join('') : ui.empty('Tidak ada perubahan baru.')}
          <div>${ui.btn('Kirim ke HFIS BPJS', { act: 'kirimHfis', variant: 'primary', disabled: !diffs.length, reason: 'Tidak ada perubahan yang perlu dikirim.' })}</div></div>`;
      }
      const hfisCard = ui.card({ title: 'Sinkron HFIS BPJS', sub: `Terakhir dibandingkan ${L.sync.t}`, tone: L.sync.state === 'ok' && !diffs.length ? 'success' : 'warning', body: hfis });
      return `${grid}${cutiForm}<div class="grid g2">${detail}${hfisCard}</div>
        ${L.sync.state === 'ok' && !diffs.length ? nextOf(['app-pasien', 'anjungan'], `Jadwal dan kuota tersinkron dengan HFIS · ${L.sync.t}`) : ''}`;
    },
    actions: {
      pilih(L, J, el) { const a = argOf(el); if (!a || !/^\d+-\d+$/.test(a)) return false; L.sel = a; L.err = ''; L.qTotal = ''; },
      kuota(L, J, el) {
        const [f, d] = String(argOf(el) || '').split(':');
        const [ri, ci] = String(L.sel).split('-').map(Number);
        const s = slotOf(L, ri, ci);
        if (!s || s.cuti || (f !== 'jkn' && f !== 'non')) return false;
        const nx = { jkn: s.jkn, non: s.non }; nx[f] += Number(d) || 0;
        if (nx[f] < 0) { L.err = `Kuota ${f === 'jkn' ? 'JKN' : 'non-JKN'} tidak bisa kurang dari 0.`; return; }
        if (nx.jkn + nx.non < s.used) { L.err = `Total kuota tidak bisa di bawah jumlah pasien yang sudah booking (${s.used}). Alihkan atau batalkan booking dulu. · ${SIM.now(0)}`; return; }
        L.q[s.key] = nx; L.dirty[s.key] = true; L.err = '';
        if (L.sync.state === 'ok') L.sync.state = 'beda';
      },
      terapkanKuota(L) {
        const [ri, ci] = String(L.sel).split('-').map(Number);
        const s = slotOf(L, ri, ci);
        if (!s || s.cuti) return false;
        const n = parseInt(String(L.qTotal || ''), 10);
        if (!(n >= 0)) { L.err = 'Isi total kuota dengan angka.'; return; }
        if (n < s.used) { L.err = `Ditolak: kuota ${n} di bawah jumlah pasien yang sudah booking (${s.used}). · ${SIM.now(0)}`; SIM.note(`Ubah kuota ${DOCS[ri].doc} ke ${n} ditolak (sudah ${s.used} booking)`, 'danger'); return; }
        const jkn = Math.round(n * 0.8);
        L.q[s.key] = { jkn, non: n - jkn }; L.dirty[s.key] = true; L.err = ''; L.qTotal = '';
        if (L.sync.state === 'ok') L.sync.state = 'beda';
        SIM.toast(`Kuota disimpan: ${n} · ${SIM.now(1)}`, 'success');
      },
      bookingLoket(L, J) {
        if (J.booking) return false;
        J.booking = { ...BOOKING };
        L.extra['0-0'] = (Number(L.extra['0-0']) || 0) + 1;
        SIM.note(`Booking loket ${BOOKING.code} untuk Tn. Suryo · ${BOOKING.no}`, 'success');
        SIM.now(1);
      },
      bukaCuti(L) { L.showCuti = true; L.cErr = ''; },
      tutupCuti(L) { L.showCuti = false; },
      simpanCuti(L) {
        const ri = docIdx(L.cDoc); const ci = Number(L.cDay);
        if (ri < 0 || String(L.cAlasan || '').trim().length < 5) return false;
        const s = slotOf(L, ri, ci);
        if (!s) { L.cErr = `${DOCS[ri].doc} tidak praktik pada ${DAYS_FULL[ci]}. Pilih hari praktik.`; return; }
        if (s.cuti) { L.cErr = 'Cuti untuk sesi ini sudah tercatat.'; return; }
        if (L.cSub && DOCS[docIdx(L.cSub)] && DOCS[docIdx(L.cSub)].cells[ci] && DOCS[docIdx(L.cSub)].cells[ci][0] === s.time) { L.cErr = 'Dokter pengganti sudah praktik di jam yang sama.'; return; }
        const t = SIM.now(2);
        L.cuti[s.key] = { sub: L.cSub || '', alasan: String(L.cAlasan).trim(), hfis: false, t: `5 Okt ${t}` };
        L.showCuti = false; L.cErr = ''; L.cAlasan = ''; L.sel = s.key;
        if (L.sync.state === 'ok') L.sync.state = 'beda';
        SIM.note(`Cuti ${DOCS[ri].doc} ${DAYS_FULL[ci]} dicatat${L.cSub ? `, pengganti ${DOCS[docIdx(L.cSub)].doc}` : ''}`, 'warning');
      },
      batalCuti(L) {
        if (!L.cuti[L.sel] || L.sel === '2-2') { if (L.cuti[L.sel]) SIM.toast('Cuti ini sudah disetujui direksi; batalkan lewat Komite Medik', 'warning'); return false; }
        delete L.cuti[L.sel];
      },
      kirimHfis(L) {
        if (!jadwalDiffs(L).length) return false;
        Object.keys(L.cuti).forEach((k) => { L.cuti[k].hfis = true; });
        L.dirty = {};
        const t = SIM.now(2);
        L.sync = { state: L.conflict ? 'ok' : 'conflict', t };
        SIM.note(L.conflict ? 'Perubahan jadwal terkirim ke HFIS' : 'Jadwal dikirim ke HFIS; 1 beda data perlu diselesaikan', L.conflict ? 'success' : 'warning');
        if (L.conflict) SIM.done();
      },
      selesaikan(L, J, el) {
        const a = argOf(el);
        if ((a !== 'rs' && a !== 'hfis') || L.sync.state !== 'conflict') return false;
        L.conflict = a; L.sync = { state: 'ok', t: SIM.now(1) };
        SIM.note(`Beda data HFIS diselesaikan (pakai data ${a === 'rs' ? 'RS' : 'HFIS'}); jadwal tersinkron`, 'success');
        SIM.done();
      },
    },
  });

  /* =====================================================================
   * FASE 2 · Info publik (ponsel, tanpa login)
   * ===================================================================== */
  SIM.register({
    id: 'layanan-publik', phase: 2, title: 'Layanan informasi publik', nav: 'Info publik', codes: 'F08', role: 'pasien', device: 'ponsel',
    desc: 'Halaman publik tanpa login: jadwal dan sisa kuota, antrean yang sedang berjalan, dan cek status booking dengan kode + tanggal lahir.',
    hint: 'Buka tab Cek booking, lalu klik Cek status. Coba juga tanggal lahir yang salah.',
    init: { tab: 'jadwal', poli: 'PD', code: '2610050042', dob: '18-06-1972', tries: 0, res: null },
    onEnter(L, J) { if (J.booking && !L.res) L.code = J.booking.code; },
    render(L, J) {
      const BK = booking(J);
      let inner = '';
      if (L.tab === 'antrean') {
        const pdNow = J.called && /^PD-/.test(J.called.ticket) ? J.called.ticket : 'PD-006';
        const svcs = [['Loket pendaftaran', J.called && /^A-/.test(J.called.ticket) ? J.called.ticket : (J.checkin ? J.checkin.ticket : 'A-011'), 6, '4 menit'], ['Poli Penyakit Dalam', pdNow, 9, '12 menit'], ['Poli Jantung', 'JT-014', 5, '15 menit'], ['Poli Paru', 'PR-009', 4, '10 menit'], ['Farmasi rawat jalan', 'F-018', 7, '8 menit']];
        inner = `<div class="stack">${svcs.map((s) => `<div style="border:1px solid var(--line);border-radius:12px;padding:10px 12px"><div class="row between"><b>${esc(s[0])}</b><span class="mono" style="font-size:18px;color:var(--brand-700)">${esc(s[1])}</span></div><div class="small muted">${s[2]} menunggu · ±${esc(s[3])} per pasien</div></div>`).join('')}
          <div class="small muted">Diperbarui ${SIM.time()} · ${J.called ? '' : 'data contoh'}</div></div>`;
      } else if (L.tab === 'cek') {
        const blocked = L.tries >= 5;
        let res = '';
        if (L.res && L.res.ok) {
          res = `<div style="border:1px solid var(--success-border);background:var(--success-bg);border-radius:12px;padding:12px" class="stack">
            <div class="row between"><b>Booking ditemukan</b>${ui.chip(J.checkin ? 'Sudah check-in' : 'Terdaftar', 'success')}</div>
            ${kv('Nama', esc(mask(P.name)))}${kv('Tanggal', esc(BK.date))}${kv('Poli', esc(BK.poli))}${kv('Dokter', esc(BK.dokter))}${kv('Sesi', esc(BK.sesi))}${kv('Antrean poli', `<span class="mono">${esc(BK.no)}</span>`)}
            <div class="small">${J.checkin ? `Check-in ${esc(J.checkin.t)} · tiket loket ${esc(J.checkin.ticket)}.` : 'Datang 30 menit sebelum sesi dan check-in di anjungan dengan kode booking.'}</div></div>`;
        } else if (L.res) {
          res = ui.alert('danger', 'Data tidak cocok', `Periksa kode booking dan tanggal lahir. Sisa ${Math.max(0, 5 - L.tries)} percobaan dalam 1 menit.`);
        }
        inner = `<div class="stack">${ui.field('Kode booking (10 digit)', ui.input('code', L.code, { mono: true, inputmode: 'numeric' }), '', 'f-code')}
          ${ui.field('Tanggal lahir (dd-mm-yyyy)', ui.input('dob', L.dob, { mono: true }), '', 'f-dob')}
          ${ui.btn('Cek status', { act: 'cek', variant: 'primary', size: 'lg', disabled: blocked, reason: 'Terlalu banyak percobaan. Coba lagi 1 menit lagi.' })}
          ${blocked ? ui.btn('Tunggu 1 menit (simulasi)', { act: 'tunggu', size: 'sm' }) : ''}
          <div class="row">${ui.btn('Coba tanggal lahir salah', { act: 'salahDob', size: 'sm', variant: 'ghost' })}</div>${res}</div>`;
      } else {
        const list = DOCS.filter((d) => d.poli === L.poli && d.cells[0]);
        inner = `<div class="stack"><div class="small muted">Senin, 5 Okt 2026</div>${ui.seg('poli', L.poli, [{ value: 'PD', label: 'PD' }, { value: 'JT', label: 'Jantung' }, { value: 'SR', label: 'Saraf' }, { value: 'PR', label: 'Paru' }])}
          ${list.length ? list.map((d) => {
            const c = d.cells[0]; const used = c[1] + (d.id === 'andi' && J.booking ? 1 : 0); const sisa = Math.max(0, c[2] - used);
            return `<div style="border:1px solid var(--line);border-radius:12px;padding:10px 12px" class="stack"><div class="row between"><b class="small">${esc(d.doc)}</b>${ui.chip(sisa ? `Sisa ${sisa}` : 'Penuh', sisa ? (sisa <= 5 ? 'warning' : 'success') : 'danger')}</div><div class="small muted mono">${esc(c[0])} · ${used}/${c[2]} terisi</div>${bar((used / c[2]) * 100, quotaTone((used / c[2]) * 100))}</div>`;
          }).join('') : ui.empty('Tidak ada jadwal hari ini.')}</div>`;
      }
      const phone = `<div style="padding:18px 16px;display:flex;flex-direction:column;gap:12px">
        <div class="row between"><div><b>${esc(RS.name)}</b><div class="small muted">Info layanan publik</div></div>${ui.chip('tanpa login', 'brand')}</div>
        ${ui.tabs('tab', L.tab, [{ value: 'jadwal', label: 'Jadwal' }, { value: 'antrean', label: 'Antrean' }, { value: 'cek', label: 'Cek booking' }])}${inner}</div>`;
      const side = ui.card({ title: 'Aturan halaman publik', body: `<div class="stack small">
        <div>${ui.chip('Tanpa data medis', 'success')} Hanya jadwal, sisa kuota, dan status booking.</div>
        <div>${ui.chip('Nama tersamar', 'info')} Nama pasien tidak pernah tampil utuh.</div>
        <div>${ui.chip('Batas percobaan', 'warning')} 5 kali per menit per perangkat untuk cek booking.</div>
        <div>${ui.chip('Data contoh', 'info')} ${J.booking ? 'Booking diambil dari alur.' : `Kode ${esc(BOOKING.code)} dipakai bila belum ada booking.`}</div></div>` });
      return `<div class="grid g2" style="align-items:start">${ui.device('phone', phone, 'Ponsel pasien · browser')}<div class="stack">${side}${!J.booking ? contoh() : ''}
        ${L.res && L.res.ok ? nextOf(['anjungan'], 'Status booking dicek tanpa login') : ''}</div></div>`;
    },
    actions: {
      cek(L, J) {
        if (L.tries >= 5) return false;
        const BK = booking(J);
        const ok = String(L.code || '').replace(/\D/g, '') === BK.code && String(L.dob || '').trim() === P.dob;
        L.res = { ok, t: SIM.now(1) };
        if (ok) { L.tries = 0; SIM.note(`Status booking ${BK.code} dicek di halaman publik`, 'brand'); SIM.done(); } else L.tries = (Number(L.tries) || 0) + 1;
      },
      salahDob(L) { L.dob = '18-06-1973'; L.res = null; SIM.toast('Tanggal lahir diubah ke 18-06-1973; klik Cek status'); },
      tunggu(L) { SIM.now(1); L.tries = 0; L.res = null; L.dob = P.dob; },
    },
  });

  /* =====================================================================
   * FASE 2 · Anjungan mandiri
   * ===================================================================== */
  const K_PURPOSE = [
    { t: 'Saya sudah punya booking', d: 'Kode dari aplikasi, Mobile JKN, atau WhatsApp', rec: 'booking', pfx: 'A' },
    { t: 'Pasien BPJS', d: 'Kontrol atau rujukan baru, tanpa booking', rec: 'bpjs', pfx: 'A' },
    { t: 'Pasien umum atau asuransi', d: 'Daftar ke poli di loket', rec: 'nik', pfx: 'A' },
    { t: 'Antrean farmasi atau kasir', d: 'Setelah pemeriksaan selesai', rec: 'nik', pfx: 'F' },
  ];
  const K_METHOD = { booking: { t: 'Kode booking', d: '10 digit', len: 10 }, nik: { t: 'NIK e-KTP', d: '16 digit pada KTP', len: 16 }, bpjs: { t: 'Nomor kartu BPJS', d: '13 digit pada kartu JKN-KIS', len: 13 } };
  const kSample = (J) => ({ booking: booking(J).code, nik: '9999011806720617', bpjs: '0000281000417' });
  const kBig = (title, sub) => `<span style="display:flex;flex-direction:column;align-items:flex-start;white-space:normal;text-align:left;gap:2px;padding:6px 0"><span>${esc(title)}</span>${sub ? `<span style="font-size:15px;font-weight:400;opacity:.85">${esc(sub)}</span>` : ''}</span>`;
  const kioskHome = (L) => { L.scr = 'home'; L.digits = ''; L.helpAt = ''; };

  SIM.register({
    id: 'anjungan', phase: 2, title: 'Anjungan pendaftaran mandiri', nav: 'Anjungan', codes: 'F05 · F02', role: 'perangkat', device: 'anjungan',
    desc: 'Pasien check-in booking sendiri: pilih tujuan, identifikasi dengan keypad, konfirmasi nama tersamar, lalu tiket antrean dicetak.',
    hint: 'Sentuh "Saya sudah punya booking" → Kode booking → isi angka (atau "Isi data contoh") → Lanjut → Ya, ini saya.',
    init: { scr: 'home', purpose: '0', method: 'booking', digits: '', seq: 13, ticket: null, helpAt: '' },
    render(L, J) {
      const BK = booking(J);
      const pur = K_PURPOSE[Number(L.purpose)] || K_PURPOSE[0];
      const met = K_METHOD[L.method] || K_METHOD.booking;
      const head = `<div style="background:var(--brand-700);color:var(--card);padding:14px 22px;display:flex;justify-content:space-between;align-items:center"><div><b style="font-size:18px">${esc(RS.name)}</b><div style="font-size:14px;opacity:.85">Anjungan Pendaftaran Mandiri · Lobi utama</div></div><div class="mono" style="font-size:24px">${SIM.time()}</div></div>`;
      const back = (to) => ui.btn('Kembali', { act: 'ke', arg: to, size: 'xl' });
      let s = '';
      if (L.scr === 'metode') {
        s = `<h2 style="font-size:26px">Bagaimana kami menemukan data Anda?</h2><p class="muted" style="margin:0">${esc(pur.t)}. Pilih salah satu cara.</p>
          <div class="stack" style="gap:14px">${Object.keys(K_METHOD).map((k) => ui.btn(kBig(K_METHOD[k].t + (k === pur.rec ? ' · disarankan' : ''), K_METHOD[k].d), { act: 'metode', arg: k, size: 'xl', variant: k === pur.rec ? 'primary' : '', html: true })).join('')}</div>${back('home')}`;
      } else if (L.scr === 'id') {
        const dg = String(L.digits || '');
        const full = dg.length >= met.len;
        const disp = (dg + '_'.repeat(Math.max(0, met.len - dg.length))).slice(0, met.len).replace(/(.{4})(?=.)/g, '$1 ');
        s = `<h2 style="font-size:26px">Masukkan ${esc(met.t)}</h2>
          <div class="mono" style="font-size:34px;letter-spacing:.06em;text-align:center;padding:14px;border:2px solid var(--brand-600);border-radius:14px;background:var(--selected)">${esc(disp)}</div>
          <div class="muted" style="text-align:center;font-size:16px">${dg.length === 0 ? `${met.len} digit diperlukan` : full ? 'Lengkap. Sentuh Lanjut.' : `Kurang ${met.len - dg.length} digit lagi`}</div>
          ${keypad('key', 'xl')}
          <div style="display:grid;grid-template-columns:1fr 2fr;gap:12px">${back('metode')}${ui.btn('Lanjut', { act: 'lanjut', size: 'xl', variant: 'primary', disabled: !full, reason: `Masukkan ${met.len} digit dulu.` })}</div>`;
      } else if (L.scr === 'konfirmasi') {
        const rows = [['Tanggal lahir', dobNoYear(P.dob)], ['Penjamin', `${P.payer} · ${P.kelas}`], ['Tujuan', BK.poli], ['Dokter', `${BK.dokter} · ${BK.sesi}`], ['Dasar', L.method === 'booking' ? `Booking ${BK.code}` : 'Data pasien lama']];
        s = `<h2 style="font-size:26px">Apakah ini data Anda?</h2><p class="muted" style="margin:0">Periksa nama dan tanggal lahir. Bila tidak sesuai, sentuh Bukan saya.</p>
          <div style="border:2px solid var(--line);border-radius:16px;padding:18px" class="stack"><div class="mono" style="font-size:32px;font-weight:600">${esc(mask(P.name))}</div>
          ${rows.map((r) => `<div class="row between" style="font-size:18px"><span class="muted">${esc(r[0])}</span><b>${esc(r[1])}</b></div>`).join('')}</div>
          <div class="stack" style="gap:12px">${ui.btn(pur.pfx === 'F' ? 'Ya, ini saya · ambil antrean' : 'Ya, ini saya · check-in', { act: 'checkin', size: 'xl', variant: 'primary' })}${ui.btn('Bukan saya, ulangi', { act: 'ke', arg: 'id', size: 'xl' })}</div>`;
      } else if (L.scr === 'gagal') {
        s = `<div style="border:2px solid var(--danger-border);background:var(--danger-bg);border-radius:16px;padding:18px"><h2 style="font-size:26px;color:var(--danger-strong)">Data tidak ditemukan</h2><p style="margin:6px 0 0;font-size:18px">Nomor yang dimasukkan tidak cocok dengan data kami. Periksa kembali, atau ambil nomor antrean loket; petugas akan membantu.</p></div>
          <div class="stack" style="gap:12px">${ui.btn('Ambil nomor antrean loket', { act: 'loket', size: 'xl', variant: 'primary' })}${ui.btn('Ulangi memasukkan nomor', { act: 'ke', arg: 'id', size: 'xl' })}</div>`;
      } else if (L.scr === 'tiket' && L.ticket) {
        const tk = L.ticket;
        s = `<div style="text-align:center"><h2 style="font-size:26px">Tiket sedang dicetak</h2><p class="muted" style="margin:4px 0 0">Ambil tiket di bawah layar.</p></div>
          ${paper(`${center(`<b>${esc(RS.name.toUpperCase())}</b><br>Anjungan 1 · Lobi utama`)}${dash}
            ${center(`${tk.kind === 'farmasi' ? 'NOMOR ANTREAN FARMASI' : 'NOMOR ANTREAN LOKET'}<div style="font-size:44px;font-weight:700;line-height:1.1;margin:4px 0">${esc(tk.no)}</div>${tk.kind === 'farmasi' ? 'Farmasi rawat jalan · Lantai 1' : 'Loket pendaftaran · Lantai 1'}`)}${dash}
            ${tk.kind === 'checkin' ? `Check-in booking ${esc(BK.code)}<br>${esc(BK.poli)}<br>${esc(BK.dokter)}<br>Sesi ${esc(BK.sesi)} · antrean poli ${esc(BK.no)}<br>${esc(mask(P.name))}${dash}` : ''}
            ${tk.kind === 'loket' ? `Data tidak ditemukan di anjungan.<br>Bawa KTP / kartu BPJS ke loket.${dash}` : ''}
            Dicetak ${esc(tk.t)} · Senin 5 Okt 2026<br>Perkiraan dipanggil ${esc(tk.eta)} · ${tk.ahead} orang di depan${barcode}`)}
          ${ui.btn('Selesai', { act: 'selesai', size: 'xl', variant: 'primary' })}<div class="muted" style="text-align:center;font-size:15px">Layar kembali ke awal otomatis dalam 12 detik.</div>`;
      } else {
        s = `<div><h2 style="font-size:30px">Selamat pagi.</h2><p class="muted" style="margin:4px 0 0;font-size:18px">Apa yang ingin Anda lakukan? Sentuh salah satu pilihan.</p></div>
          <div class="stack" style="gap:14px">${K_PURPOSE.map((p, i) => ui.btn(kBig(p.t, p.d), { act: 'tujuan', arg: String(i), size: 'xl', variant: i === 0 ? 'primary' : '', html: true })).join('')}</div>
          ${ui.btn(L.helpAt ? `Petugas dipanggil ${L.helpAt}` : 'Panggil petugas', { act: 'bantuan', size: 'xl', variant: 'ghost' })}
          <div class="muted" style="font-size:15px">Pasien BPJS: siapkan kartu atau NIK. Petugas siap membantu di meja informasi.</div>`;
      }
      const kiosk = `${head}<div style="padding:22px;display:flex;flex-direction:column;gap:16px">${s}</div>`;
      const helpers = ui.card({ title: 'Alat bantu prototipe', sub: 'di luar layar anjungan', body: `<div class="stack small">
        <div class="row">${ui.btn('Isi data contoh', { act: 'isiContoh', size: 'sm', disabled: L.scr !== 'id', reason: 'Aktif di layar isian nomor.' })}${ui.btn('Isi nomor tak terdaftar', { act: 'isiAsing', size: 'sm', disabled: L.scr !== 'id', reason: 'Aktif di layar isian nomor.' })}</div>
        <div>Booking: <span class="mono">${esc(BK.code)}</span> ${contoh(!J.booking)}</div>
        <div class="muted">Konfirmasi memakai nama tersamar + tanggal lahir tanpa tahun; percobaan dibatasi per perangkat.</div>
        ${J.checkin ? ui.chip(`Check-in tercatat · ${J.checkin.ticket} · ${J.checkin.t}`, 'success') : ''}</div>` });
      return `<div class="row" style="align-items:flex-start;gap:16px"><div style="flex:1 1 560px;min-width:0">${ui.device('kiosk', kiosk, 'Layar sentuh 21,5 inci · printer termal 80 mm')}</div><div style="flex:1 1 240px;min-width:0" class="stack">${helpers}
        ${J.checkin && L.scr === 'home' ? nextOf(['pendaftaran'], `Check-in ${J.checkin.ticket} · ${J.checkin.t}`) : ''}</div></div>`;
    },
    actions: {
      tujuan(L, J, el) { const i = Number(argOf(el)); if (!K_PURPOSE[i]) return false; L.purpose = String(i); L.method = K_PURPOSE[i].rec; L.scr = 'metode'; L.digits = ''; },
      metode(L, J, el) { const k = argOf(el); if (!K_METHOD[k]) return false; L.method = k; L.scr = 'id'; L.digits = ''; },
      ke(L, J, el) { const to = argOf(el); if (!['home', 'metode', 'id'].includes(to)) return false; if (to === 'home') kioskHome(L); else { L.scr = to; if (to === 'id') L.digits = ''; } },
      key(L, J, el) { const k = argOf(el); if (k == null || L.scr !== 'id') return false; L.digits = press(L.digits, k, (K_METHOD[L.method] || K_METHOD.booking).len); },
      isiContoh(L, J) { if (L.scr !== 'id') return false; L.digits = kSample(J)[L.method] || ''; },
      isiAsing(L) { if (L.scr !== 'id') return false; L.digits = '1234567890123456'.slice(0, (K_METHOD[L.method] || K_METHOD.booking).len); },
      lanjut(L, J) {
        const met = K_METHOD[L.method];
        if (!met || String(L.digits || '').length < met.len) return false;
        SIM.now(1);
        L.scr = L.digits === kSample(J)[L.method] ? 'konfirmasi' : 'gagal';
        if (L.scr === 'gagal') SIM.note('Anjungan: data tidak ditemukan, pasien diarahkan ke loket', 'warning');
      },
      checkin(L, J) {
        if (L.scr !== 'konfirmasi') return false;
        const pur = K_PURPOSE[Number(L.purpose)] || K_PURPOSE[0];
        const t = SIM.now(2);
        if (pur.pfx === 'F') { L.ticket = { no: 'F-021', kind: 'farmasi', t, eta: hhmm(SIM.clock + 20), ahead: 5 }; }
        else {
          // Check-in booking selalu memakai nomor yang sama (cetak ulang bila diulang).
          L.ticket = { no: J.checkin ? J.checkin.ticket : 'A-012', kind: 'checkin', t, eta: hhmm(SIM.clock + 8), ahead: 1 };
          J.checkin = { ticket: L.ticket.no, t };
          SIM.note(`Check-in anjungan ${J.checkin.ticket}: booking ${booking(J).code} Tn. Suryo`, 'success');
          SIM.done();
        }
        L.scr = 'tiket';
        anjunganAutoReturn();
      },
      loket(L) {
        if (L.scr !== 'gagal') return false;
        const t = SIM.now(1);
        L.ticket = { no: tno('A', Number(L.seq) || 13), kind: 'loket', t, eta: hhmm(SIM.clock + 10), ahead: 2 };
        L.seq = (Number(L.seq) || 13) + 1;
        L.scr = 'tiket';
        anjunganAutoReturn();
      },
      selesai(L) { kioskHome(L); },
      bantuan(L) { L.helpAt = SIM.now(1); SIM.toast(`Petugas meja informasi dipanggil · ${L.helpAt}`); },
    },
  });
  function anjunganAutoReturn() {
    setTimeout(() => {
      const L = SIM.local('anjungan');
      if (L.scr === 'tiket') { kioskHome(L); if (SIM.cur === 'anjungan') SIM.render(); else SIM.save(); }
    }, 12000);
  }

  /* =====================================================================
   * FASE 2 · Pendaftaran rawat jalan + SEP
   * ===================================================================== */
  const ENC_NO = 'RJ-261005-0042';
  const SEP_NO = '0901R0011025V000123';
  const REG_DB = [
    { key: 'suryo', name: P.name, rm: P.rm, sub: `Lahir ${P.dob} · NIK ${P.nik} · BPJS ${P.bpjs}`, hay: `${P.name} ${P.rm} 0028441 0000281 ${P.dob}`.toLowerCase() },
    { key: 'suryo2', name: 'Suryo Adinugroho', rm: '00-41-09-33', sub: 'Lahir 18-06-1972 · tanpa NIK · dibuat di IGD Mar 2025', hay: 'suryo adinugroho 00-41-09-33 18-06-1972', dup: true },
  ];
  const REFS = [
    { id: 'r1', t: 'Rujukan FKTP · Puskesmas Kecamatan Gambir', m: '0901U0420926P001234 · E11.9 · berlaku s.d. 28 Des 2026 · kunjungan ke-3' },
    { id: 'r2', t: 'Surat kontrol · Poli Penyakit Dalam', m: '0901R0011025K000456 · dari kunjungan 12 Sep 2026 · berlaku s.d. 12 Okt 2026' },
    { id: 'r3', t: 'Rujukan FKTP · Klinik Pratama Sehat', m: 'K29.7 · berakhir 1 Sep 2026', expired: true },
  ];
  const REG_DOCS = [
    { id: 'andi', poli: 'PD', doc: 'dr. Andi Wiratama, Sp.PD', time: '08.00–12.00', used: 22, total: 30, room: 'Ruang 2', no: 'PD-007', eta: '08.35' },
    { id: 'ratih', poli: 'PD', doc: 'dr. Ratih Pramesti, Sp.PD', time: '13.00–16.00', used: 9, total: 25, room: 'Ruang 3', no: 'PD-110', eta: '13.40' },
    { id: 'lukman', poli: 'PD', doc: 'dr. Lukman Hakim, Sp.PD-KGH', time: '09.00–11.00', used: 12, total: 12, room: 'Ruang 1', no: '—', eta: '—' },
    { id: 'fajar', poli: 'JT', doc: 'dr. Fajar Nugraha, Sp.JP', time: '09.00–12.00', used: 18, total: 20, room: 'Ruang 4', no: 'JT-019', eta: '11.30' },
    { id: 'hadi', poli: 'SR', doc: 'dr. Hadi Kusuma, Sp.N', time: '09.30–12.00', used: 15, total: 20, room: 'Ruang 5', no: 'SR-016', eta: '11.15' },
    { id: 'yusuf', poli: 'PR', doc: 'dr. Yusuf Hakim, Sp.P', time: '08.00–11.00', used: 14, total: 20, room: 'Ruang 6', no: 'PR-015', eta: '10.20' },
  ];
  const regInit = () => ({ step: 0, q: 'Suryo', results: false, qErr: '', dupWarn: false, found: false, loketAt: '', penj: 'BPJS', cek: null, ref: '', diag: 'E11.9 · Diabetes melitus tipe 2',
    poli: 'PD', doc: '', pj: 'Sri Wahyuni (istri) · 0812-0000-2845', jelas: false, gc: '', gcAt: '', done: false, at: '', sepAt: '', sepTry: 0, sepReason: '', tasks: [], printed: '', bpjsDown: false });
  const penjOk = (L) => L.penj !== 'BPJS' || (L.cek && L.ref && String(L.diag || '').trim());
  const regDoc = (L) => REG_DOCS.find((d) => d.id === L.doc);
  const sepIssue = (L, J) => {
    if (!J.sep || J.sep.status === 'issued') return;
    J.sep.status = 'issued'; L.sepAt = SIM.time(); L.sepReason = '';
    L.tasks.forEach((t) => { if (t.st === 'queued') { t.st = 'sent'; t.t = L.sepAt; } });
  };

  SIM.register({
    id: 'pendaftaran', phase: 2, title: 'Pendaftaran rawat jalan', nav: 'Pendaftaran', codes: 'F03 · F06', role: 'daftar',
    desc: 'Cari pasien, cek kepesertaan BPJS dan rujukan, pilih poli/dokter sesuai kuota, persetujuan umum, lalu daftar: nomor kunjungan, antrean poli, dan SEP.',
    hint: 'Cari "Suryo" → pilih → Cek kepesertaan → pilih rujukan FKTP → pilih dr. Andi → tanda tangan persetujuan → Daftarkan. Coba juga sakelar "BPJS gangguan".',
    init: regInit,
    headActions(L) { return `${ui.check('bpjsDown', !!L.bpjsDown, 'Simulasi: BPJS gangguan')}${L.bpjsDown ? ui.chip('VClaim tidak merespons', 'danger') : ui.chip('VClaim 320 ms', 'success')}`; },
    onChange(key, L) { if (key === 'bpjsDown') SIM.note(L.bpjsDown ? 'Simulasi gangguan BPJS dinyalakan' : 'Simulasi gangguan BPJS dimatikan (BPJS pulih)', L.bpjsDown ? 'warning' : 'success'); },
    render(L, J) {
      const BK = booking(J);
      const step = Number(L.step) || 0;
      const ck = J.checkin || { ticket: 'A-012', t: '07.52' };
      const strip = `<div class="row between" style="padding:10px 14px;border:1px solid var(--line);border-radius:var(--r-control);background:var(--card)"><div class="row"><span class="label">Loket 1</span><span>Sedang dilayani <b class="mono">${esc(ck.ticket)}</b> · check-in anjungan ${esc(ck.t)}</span>${contoh(!J.checkin)}</div>${ui.chip(`Booking ${BK.code}`, 'brand')}${contoh(!J.booking)}</div>`;
      const steps = ui.steps(['Pasien', 'Penjamin & rujukan', 'Poli & dokter', 'Persetujuan umum', 'Selesai'], L.done ? 5 : step);
      const banner = L.found ? ui.banner(P, `${ui.chip(`Booking ${BK.code} · ${BK.no}`, 'brand')}${L.cek && !L.cek.offline ? ui.chip('BPJS aktif · Kelas 2', 'success') : ''}`) : '';
      let body = '';
      if (L.done) {
        const d = regDoc(L) || REG_DOCS[0];
        const isB = L.penj === 'BPJS';
        const sepChip = !isB ? ui.chip('Tanpa SEP (non-JKN)') : J.sep && J.sep.status === 'issued' ? ui.chip(`SEP terbit · ${L.sepAt}`, 'success') : ui.chip('SEP pending', 'warning');
        const sepBox = !isB ? '' : J.sep && J.sep.status === 'issued'
          ? ui.alert('success', `SEP ${SEP_NO} terbit · ${L.sepAt}`, 'Data SEP dibekukan; perubahan hanya lewat pembaruan SEP berversi.')
          : `${ui.alert('warning', `SEP pending · percobaan ${L.sepTry}`, `${esc(L.sepReason || 'Menunggu respons VClaim.')} Pendaftaran tetap sah; pasien boleh ke poli. SEP dikirim ulang otomatis sampai akhir hari layanan.`)}
            <div class="row">${ui.btn('Kirim ulang SEP', { act: 'kirimUlang', variant: 'primary', size: 'sm' })}${ui.btn('Perbarui status', { act: 'cekSep', size: 'sm' })}</div>`;
        const tasks = isB ? ui.timeline(L.tasks.map((t) => ({ t: t.t, text: `<b>Task ${t.n}</b> · ${esc(t.label)} ${t.st === 'sent' ? ui.chip('terkirim', 'success') : ui.chip('antre kirim', 'warning')}`, html: true, tone: t.st === 'sent' ? 'success' : 'warning' })))
          : '<div class="small muted">Antrean non-JKN tidak dikirim ke Antrean BPJS.</div>';
        const ticket = paper(`${center(`<b>${esc(RS.name.toUpperCase())}</b><br>Rawat jalan · Lantai 2`)}${dash}
          ${center(`NOMOR ANTREAN POLI<div style="font-size:40px;font-weight:700;line-height:1.1;margin:4px 0">${esc(d.no)}</div>Poli ${esc(POLI_NAME[d.poli])} · ${esc(d.room)}<br>${esc(d.doc)}<br>Perkiraan dipanggil ${esc(d.eta)}`)}${dash}
          No. kunjungan ${ENC_NO}<br>Tn. S. A. N. · RM ${esc(P.rm)}${isB ? `${dash}<b>BUKTI SEP</b><br>${J.sep && J.sep.status === 'issued' ? `No. SEP ${SEP_NO}<br>Tgl SEP 05-10-2026<br>No. kartu ${esc(P.bpjs)}<br>Peserta PBPU · ${esc(P.kelas)}<br>Poli tujuan ${esc(POLI_NAME[d.poli])}<br>Diagnosa awal ${esc(String(L.diag).split(' ')[0])}<br>Perujuk Puskesmas Kec. Gambir` : 'SEP menyusul (BPJS gangguan).<br>Dicetak ulang otomatis setelah terbit.'}` : ''}${barcode}`);
        body = `${banner}<div class="grid g2" style="align-items:start"><div class="stack">
            ${ui.card({ title: `Terdaftar · ${L.at}`, tone: 'success', actions: sepChip, body: `<div class="stack">${kv('Nomor kunjungan', `<span class="mono">${ENC_NO}</span>`)}${kv('Nomor antrean poli', `<span class="mono" style="font-size:18px">${esc(d.no)}</span>`)}${kv('Poli · dokter', esc(`${POLI_NAME[d.poli]} · ${d.doc}`))}${kv('Penjamin', esc(isB ? `BPJS Kelas 2 · ${(REFS.find((r) => r.id === L.ref) || REFS[0]).t}` : L.penj))}${kv('Persetujuan umum', `Ditandatangani ${esc(L.gcAt)}`)}${sepBox}</div>` })}
            ${ui.card({ title: 'Task ID Antrean BPJS', sub: 'dikirim otomatis dari kejadian, bukan tombol', body: tasks })}
            <div class="row">${ui.btn('Pasien berikutnya', { act: 'baru' })}${ui.btn('Lihat di jejak audit', { go: 'audit', variant: 'ghost', size: 'sm' })}</div></div>
          <div class="stack">${ui.card({ title: 'Pratinjau cetak 80 mm', sub: isB ? 'Tiket antrean + bukti SEP' : 'Tiket antrean', body: `${ticket}<div class="row" style="justify-content:center;margin-top:12px">${ui.btn(L.printed ? `Tercetak ${L.printed} · cetak ulang` : isB && J.sep && J.sep.status !== 'issued' ? 'Cetak tiket (SEP menyusul)' : isB ? 'Cetak tiket dan SEP' : 'Cetak tiket', { act: 'cetak', variant: 'primary' })}</div>` })}</div></div>
          ${ui.next('kendali', `Tn. Suryo terdaftar ${ENC_NO} · antrean ${d.no}${isB ? ` · SEP ${J.sep && J.sep.status === 'issued' ? 'terbit' : 'pending'}` : ''}`)}`;
      } else if (step === 0) {
        const q = String(L.q || '').trim().toLowerCase();
        const res = L.results && !L.qErr ? REG_DB.filter((r) => r.hay.includes(q) || r.name.toLowerCase().includes(q)) : [];
        body = ui.card({ title: 'Cari pasien', sub: 'NIK, No. RM, No. BPJS, atau nama + tgl lahir', body: `<div class="stack">
          <div class="row" style="flex-wrap:nowrap">${ui.input('q', L.q, { placeholder: 'mis. Suryo' })}${ui.btn('Cari pasien', { act: 'cari', variant: 'primary' })}</div>
          <div class="row">${ui.btn('Baca e-KTP', { act: 'ktp', size: 'sm' })}${ui.btn(`Pakai data check-in ${ck.ticket}`, { act: 'dariCheckin', size: 'sm' })}${contoh(!J.checkin)}</div>
          ${L.qErr ? ui.alert('danger', L.qErr) : ''}
          ${L.results && !L.qErr ? (res.length ? ui.list(res.map((r) => ({ title: r.name, sub: `RM ${r.rm} · ${r.sub}`, arg: r.key, right: r.dup ? ui.chip('Kemungkinan ganda', 'warning') : ui.chip('Pasien lama', 'success') })), 'pilihPasien')
            : `${ui.empty('Pasien tidak ditemukan.')}<div>${ui.btn('Daftarkan pasien baru di MPI', { go: 'mpi', size: 'sm' })}</div>`) : ''}
          ${L.dupWarn ? `${ui.alert('warning', `RM 00-41-09-33 adalah kandidat duplikat dari ${P.rm} (skor 91%)`, 'Gunakan rekam medis utama agar riwayat tidak terpecah. Penggabungan dilakukan petugas rekam medis.')}<div>${ui.btn(`Pakai RM utama ${P.rm}`, { act: 'pilihPasien', arg: 'suryo', size: 'sm', variant: 'primary' })}</div>` : ''}</div>` });
      } else if (step === 1) {
        const isB = L.penj === 'BPJS';
        let bpjs = '';
        if (isB) {
          const cek = L.cek;
          bpjs = `<div class="row">${ui.btn(cek ? `Cek ulang kepesertaan` : 'Cek kepesertaan', { act: 'cekPeserta', variant: cek ? '' : 'primary' })}${cek ? `<span class="small muted">Dicek ${esc(cek.t)}</span>` : ''}</div>
            ${cek && cek.offline ? ui.alert('warning', `VClaim tidak merespons (batas 10 dtk) · ${cek.t}`, 'Data kepesertaan terakhir dipakai: aktif, Kelas 2 (12 Sep 2026). SEP dibuat setelah BPJS pulih; pendaftaran tetap jalan.') : ''}
            ${cek && !cek.offline ? `<div class="grid g2">${kv('Status peserta', ui.chip('AKTIF', 'success'))}${kv('No. kartu', `<span class="mono">${esc(P.bpjs)}</span>`)}${kv('Hak kelas', 'Kelas 2 · PBPU')}${kv('FKTP', 'Puskesmas Kecamatan Gambir')}${kv('Prolanis', 'DM tipe 2')}${kv('Dicek', esc(cek.t))}</div>` : ''}
            ${cek ? `<span class="label">Pilih rujukan aktif</span><div class="stack" style="gap:8px">${REFS.map((r) => r.expired
              ? `<div class="row between" style="padding:10px 12px;border:1px solid var(--line);border-radius:var(--r-control);opacity:.7"><div><b class="small">${esc(r.t)}</b><div class="small muted mono">${esc(r.m)}</div></div>${ui.btn('Pilih', { size: 'sm', disabled: true, reason: 'Rujukan kedaluwarsa; minta rujukan baru ke FKTP.' })}</div>`
              : `<button type="button" class="li ${L.ref === r.id ? 'sel' : ''}" data-set="ref=${r.id}" style="border:1px solid var(--line);border-radius:var(--r-control)"><div><div class="lt">${esc(r.t)}</div><div class="ls mono">${esc(r.m)}</div></div><div class="lr">${ui.chip(L.ref === r.id ? 'Dipakai' : 'Aktif', L.ref === r.id ? 'brand' : 'success')}</div></button>`).join('')}</div>
              ${ui.field('Diagnosa awal (ICD-10)', ui.input('diag', L.diag), 'Wajib untuk SEP; terisi dari rujukan.', 'f-diag')}` : ''}`;
        } else {
          bpjs = ui.alert('info', L.penj === 'Umum' ? 'Pasien umum · tanpa SEP' : 'Asuransi swasta · tanpa SEP', L.penj === 'Umum' ? 'Tarif sesuai kelas layanan, dibayar di kasir setelah pemeriksaan.' : 'Kartu dan limit asuransi diverifikasi kasir.');
        }
        const why = !L.cek ? 'Cek kepesertaan BPJS dulu.' : !L.ref ? 'Pilih rujukan aktif dulu.' : 'Isi diagnosa awal dulu.';
        body = `${banner}${ui.card({ title: 'Penjamin dan rujukan', actions: ui.seg('penj', L.penj, ['BPJS', 'Umum', 'Asuransi']), body: `<div class="stack">${bpjs}
          <div class="row">${ui.btn('← Pasien', { act: 'ke', arg: '0', variant: 'ghost' })}${ui.btn('Lanjut ke poli dan dokter', { act: 'ke', arg: '2', variant: 'primary', disabled: !penjOk(L), reason: why })}</div></div>` })}`;
      } else if (step === 2) {
        const list = REG_DOCS.filter((d) => d.poli === L.poli);
        const cards = list.map((d) => {
          const isBk = d.id === 'andi' && BK.dokter === d.doc;
          const full = d.used >= d.total; const pct = Math.round((d.used / d.total) * 100); const on = L.doc === d.id;
          const inner = `<div style="min-width:0;flex:1"><div class="row between"><b>${esc(d.doc)}</b>${isBk ? ui.chip(`Sesuai booking ${BK.code}`, 'brand') : full ? ui.chip('Kuota penuh', 'danger') : ''}</div>
            <div class="small muted mono">${esc(d.time)} · ${esc(d.room)} · ${d.used}/${d.total} terisi · sisa ${Math.max(0, d.total - d.used)}</div>${bar(pct, quotaTone(pct))}</div>`;
          return full ? `<div class="li" style="border:1px solid var(--line);border-radius:var(--r-control);cursor:not-allowed;opacity:.75">${inner}</div><span class="reason">Kuota sesi penuh; pilih dokter atau sesi lain.</span>`
            : `<button type="button" class="li ${on ? 'sel' : ''}" data-set="doc=${d.id}" style="border:1px solid var(--line);border-radius:var(--r-control)">${inner}</button>`;
        }).join('');
        body = `${banner}${ui.card({ title: 'Poli dan dokter', sub: 'Kuota dari jadwal hari ini · Senin 5 Okt 2026', actions: ui.select('poli', L.poli, Object.keys(POLI_NAME).map((k) => ({ value: k, label: `Poli ${POLI_NAME[k]}` }))), body: `<div class="stack" style="gap:8px">${cards || ui.empty('Tidak ada jadwal.')}
          <div class="row" style="margin-top:6px">${ui.btn('← Penjamin', { act: 'ke', arg: '1', variant: 'ghost' })}${ui.btn('Lanjut ke persetujuan umum', { act: 'ke', arg: '3', variant: 'primary', disabled: !regDoc(L), reason: 'Pilih dokter dengan kuota tersedia.' })}</div></div>` })}`;
      } else {
        const why = !L.gc ? 'Persetujuan umum belum ditandatangani pasien.' : 'Centang bahwa isi persetujuan sudah dijelaskan.';
        body = `${banner}${ui.card({ title: 'Persetujuan umum (general consent)', sub: 'Rawat jalan: berlaku sampai dicabut', body: `<div class="stack">
          <ul class="small" style="margin:0;padding-left:18px;color:var(--ink-700)"><li>Hak dan kewajiban pasien serta tata tertib RS.</li><li>Persetujuan pemeriksaan dan tindakan rutin rawat jalan.</li><li>Pelepasan informasi ke BPJS Kesehatan untuk klaim dan ke SATUSEHAT.</li><li>Kerahasiaan rekam medis; siapa yang boleh menerima informasi.</li></ul>
          ${ui.field('Penanggung jawab / keluarga', ui.input('pj', L.pj), '', 'f-pj')}
          ${ui.sig('gc', !!L.gc, 'Suryo A. Nugroho')}
          ${ui.check('jelas', !!L.jelas, 'Petugas sudah menjelaskan isi persetujuan dan pasien memahaminya')}
          <div class="row">${ui.btn('← Poli dan dokter', { act: 'ke', arg: '2', variant: 'ghost' })}${ui.btn('Daftarkan kunjungan', { act: 'daftar', variant: 'primary', size: 'lg', disabled: !(L.gc && L.jelas), reason: why })}</div>
          ${L.bpjsDown && L.penj === 'BPJS' ? ui.alert('warning', 'BPJS sedang gangguan', 'Pendaftaran tetap bisa disimpan. SEP akan berstatus pending dan dikirim ulang otomatis.') : ''}</div>` })}`;
      }
      return `${strip}${steps}${body}`;
    },
    actions: {
      cari(L) {
        const q = String(L.q || '').trim();
        L.results = true; L.dupWarn = false;
        L.qErr = q.length < 3 ? 'Masukkan minimal 3 karakter: NIK, No. RM, No. BPJS, atau nama + tgl lahir.' : '';
      },
      ktp(L) { L.q = '9999011806720617'; L.results = true; L.qErr = ''; L.dupWarn = false; SIM.toast('e-KTP terbaca'); },
      dariCheckin(L) { regPick(L, 'checkin'); },
      pilihPasien(L, J, el) {
        const k = argOf(el);
        if (k === 'suryo2') { L.dupWarn = true; return; }
        if (k !== 'suryo') return false;
        regPick(L, 'cari');
      },
      ke(L, J, el) {
        const n = Number(argOf(el));
        if (!(n >= 0 && n <= 3) || L.done) return false;
        if (n >= 1 && !L.found) return false;
        if (n >= 2 && !penjOk(L)) return false;
        if (n >= 3 && !regDoc(L)) return false;
        L.step = n;
      },
      cekPeserta(L) {
        if (!L.found) return false;
        L.cek = { t: SIM.now(1), offline: !!L.bpjsDown };
        SIM.note(L.bpjsDown ? 'Cek kepesertaan BPJS gagal (gangguan); data terakhir dipakai' : 'Kepesertaan BPJS Tn. Suryo aktif, Kelas 2', L.bpjsDown ? 'warning' : 'success');
      },
      daftar(L, J) {
        const d = regDoc(L);
        if (L.done || !L.found || !L.gc || !L.jelas || !d) return false;
        L.done = true; L.at = SIM.now(2); L.gcAt = L.gcAt || L.at;
        J.encounter = { no: ENC_NO, t: L.at, patient: 'suryo' };
        if (L.penj === 'BPJS') {
          J.sep = { no: SEP_NO, status: 'pending' };
          L.sepTry = 1;
          L.sepReason = L.bpjsDown ? `VClaim tidak merespons (batas 10 dtk) pukul ${L.at}.` : 'Menunggu respons VClaim.';
          const ck = J.checkin || { t: '07.52' };
          L.tasks = [{ n: 1, label: 'Check-in (anjungan)', t: ck.t, st: 'sent' }, { n: 2, label: 'Mulai dilayani di loket', t: L.loketAt || L.at, st: 'sent' }, { n: 3, label: 'Selesai di loket (terdaftar)', t: L.at, st: L.bpjsDown ? 'queued' : 'sent' }];
        }
        SIM.note(`Tn. Suryo terdaftar ${ENC_NO} · antrean ${d.no}${L.penj === 'BPJS' ? ' · SEP pending' : ''}`, 'success');
        SIM.done();
        if (L.penj === 'BPJS' && !L.bpjsDown) {
          setTimeout(() => {
            const L2 = SIM.local('pendaftaran');
            if (!SIM.j.sep || SIM.j.sep.status !== 'pending' || L2.bpjsDown) return;
            sepIssue(L2, SIM.j);
            if (SIM.cur === 'pendaftaran') { SIM.note(`SEP ${SEP_NO} terbit`, 'success'); SIM.render(); } else SIM.save();
          }, 1800);
        }
      },
      cekSep(L, J) { return sepRetry(L, J, false); },
      kirimUlang(L, J) { return sepRetry(L, J, true); },
      cetak(L) { if (!L.done) return false; L.printed = SIM.now(1); SIM.toast(`Dikirim ke printer loket 1 (80 mm) · ${L.printed}`, 'success'); },
      baru(L) { const down = L.bpjsDown; Object.keys(L).forEach((k) => delete L[k]); Object.assign(L, regInit(), { bpjsDown: down, q: '' }); },
    },
  });
  function regPick(L, via) {
    if (L.done) return;
    L.found = true; L.step = 1; L.dupWarn = false; L.loketAt = SIM.now(1);
    if (L.gc && !L.gcAt) L.gcAt = L.loketAt;
    SIM.note(`Tn. Suryo ditemukan di MPI (RM ${P.rm})${via === 'checkin' ? ' dari check-in anjungan' : ''}`, 'brand');
  }
  function sepRetry(L, J, manual) {
    if (!J.sep || J.sep.status === 'issued' || !L.done) return false;
    const t = SIM.now(1);
    L.sepTry = (Number(L.sepTry) || 1) + 1;
    if (L.bpjsDown) {
      L.sepReason = `VClaim masih tidak merespons pukul ${t}. Dicoba lagi otomatis pukul ${hhmm(SIM.clock + 10)}.`;
      SIM.toast(manual ? 'Kirim ulang gagal: BPJS masih gangguan' : 'SEP masih pending', 'warning');
    } else {
      sepIssue(L, J);
      SIM.note(`SEP ${SEP_NO} terbit${manual ? ' setelah kirim ulang' : ''}`, 'success');
    }
  }

  /* =====================================================================
   * FASE 2 · Kendali antrean
   * ===================================================================== */
  const Q_ROOMS = { loket: ['Loket 1', 'Loket 2', 'Loket 3'], pd: ['Poli PD 1', 'Poli PD 2', 'Poli PD 3'] };
  const Q_INIT = () => ({
    loket: [{ no: 'A-009', st: 'selesai', at: 'Loket 2', who: 'Pasien umum' }, { no: 'A-010', st: 'selesai', at: 'Loket 1', who: 'Pasien BPJS · rujukan baru' }, { no: 'A-011', st: 'dilayani', at: 'Loket 1', who: 'Pasien asuransi' },
      { no: 'A-012', st: 'menunggu', at: '', who: 'Ambil di anjungan' }, { no: 'A-013', st: 'menunggu', at: '', who: 'Ambil di anjungan' }, { no: 'A-014', st: 'menunggu', at: '', who: 'Ambil di anjungan' }, { no: 'A-015', st: 'menunggu', at: '', who: 'Ambil di anjungan' }],
    pd: [{ no: 'PD-004', st: 'selesai', at: 'Poli PD 2', who: 'Ny. Wartini · BPJS' }, { no: 'PD-005', st: 'selesai', at: 'Poli PD 2', who: 'Tn. Rahmat · umum' }, { no: 'PD-006', st: 'dilayani', at: 'Poli PD 2', who: 'Ny. Yuliana · BPJS' },
      { no: 'PD-007', st: 'menunggu', at: '', who: '' }, { no: 'PD-008', st: 'menunggu', at: '', who: 'Tn. Bagus · BPJS' }, { no: 'PD-009', st: 'menunggu', at: '', who: 'Ny. Lastri · BPJS' }, { no: 'PD-010', st: 'menunggu', at: '', who: 'Tn. Hendro · umum' }],
  });
  const Q_TONE = { menunggu: '', dipanggil: 'warning', dilayani: 'info', selesai: 'success', dilewati: 'danger' };
  const qRoom = (L) => { const rs = Q_ROOMS[L.svc] || Q_ROOMS.pd; const r = L.svc === 'loket' ? L.rLoket : L.rPd; return rs.includes(r) ? r : rs[0]; };
  const qCur = (L) => { const room = qRoom(L); return (L.q[L.svc] || []).find((t) => (t.st === 'dipanggil' || t.st === 'dilayani') && t.at === room); };
  const qMine = (J, svc) => (svc === 'loket' ? (J.checkin ? J.checkin.ticket : 'A-012') : booking(J).no);
  const qLog = (L, text, tone = '') => { L.log.unshift({ t: SIM.time(), text, tone }); L.log = L.log.slice(0, 8); };

  SIM.register({
    id: 'kendali', phase: 2, title: 'Kendali antrean', nav: 'Kendali antrean', codes: 'F04', role: 'daftar',
    desc: 'Petugas loket atau perawat poli memanggil, mengulang, melewati, memulai, dan menyelesaikan nomor. Transisi yang tidak sah ditolak.',
    hint: 'Di Poli PD 2: klik Selesai untuk PD-006, lalu Panggil berikutnya (PD-007 milik Tn. Suryo). Coba juga tombol yang tidak sah.',
    init: () => ({ svc: 'pd', rLoket: 'Loket 1', rPd: 'Poli PD 2', q: Q_INIT(), log: [], err: '', msg: '' }),
    render(L, J) {
      const room = qRoom(L); const cur = qCur(L); const mine = qMine(J, L.svc);
      const list = L.q[L.svc] || [];
      const sample = L.svc === 'loket' ? !J.checkin : !J.encounter;
      const whoOf = (t) => (t.no === mine ? (L.svc === 'loket' ? `${mask(P.name)} · check-in booking ${booking(J).code}` : `${P.name} · BPJS · ${J.encounter ? `terdaftar ${J.encounter.t}` : 'terdaftar'}`) : t.who);
      const curCard = ui.card({ title: `${room} · nomor aktif`, tone: cur ? (cur.st === 'dipanggil' ? 'warning' : '') : '', body: `<div class="stack">
        <div class="row between"><div class="mono" style="font-size:44px;font-weight:700;line-height:1">${cur ? esc(cur.no) : '—'}</div>${cur ? ui.chip(cur.st === 'dipanggil' ? `Dipanggil ${cur.calls || 1}×` : 'Sedang dilayani', Q_TONE[cur.st]) : ui.chip('Kosong')}</div>
        <div class="small muted">${cur ? esc(whoOf(cur)) : 'Belum ada nomor di ruang ini. Panggil berikutnya.'}${cur && cur.no === mine ? ` ${ui.chip('pasien skenario', 'brand')}` : ''}</div>
        <div class="row">${ui.btn('Panggil berikutnya', { act: 'panggil', variant: 'primary' })}${ui.btn('Panggil ulang', { act: 'ulang' })}${ui.btn('Lewati', { act: 'lewati' })}${ui.btn('Mulai layani', { act: 'mulai' })}${ui.btn('Selesai', { act: 'selesai' })}</div>
        ${L.err ? ui.alert('danger', 'Ditolak', esc(L.err)) : L.msg ? ui.alert('success', L.msg) : ''}
        <div class="small muted">Alur sah: menunggu → dipanggil → dilayani → selesai · dipanggil → dilewati (dipanggil ulang setelah 3 nomor).</div></div>` });
      const rows = list.map((t) => [`<b class="mono">${esc(t.no)}</b>`, `${esc(whoOf(t))}${t.no === mine ? ` ${ui.chip('pasien skenario', 'brand')}${contoh(sample)}` : ''}`, ui.chip(t.st, Q_TONE[t.st]), esc(t.at || '—'),
        t.st === 'dilewati' ? ui.btn('Kembalikan ke antrean', { act: 'kembalikan', arg: t.no, size: 'sm', variant: 'ghost' }) : '']);
      const waiting = list.filter((t) => t.st === 'menunggu').length;
      const queue = ui.card({ title: L.svc === 'loket' ? 'Antrean loket pendaftaran (A)' : 'Antrean Poli Penyakit Dalam (PD)', sub: `${waiting} menunggu · diperbarui ${SIM.time()}`, flush: true, body: ui.table(['Nomor', 'Pasien / keterangan', 'Status', 'Ruang', ''], rows) });
      const log = ui.card({ title: 'Riwayat panggilan', body: L.log.length ? ui.timeline(L.log.map((e) => ({ t: e.t, text: e.text, tone: e.tone }))) : ui.empty('Belum ada aksi di sesi ini.') });
      const doneCall = (L.q.pd || []).find((t) => t.no === booking(J).no && t.st !== 'menunggu');
      return `<div class="row between"><div class="row">${ui.seg('svc', L.svc, [{ value: 'loket', label: 'Loket A' }, { value: 'pd', label: 'Poli PD' }])}
          ${L.svc === 'loket' ? ui.select('rLoket', room, Q_ROOMS.loket) : ui.select('rPd', room, Q_ROOMS.pd)}</div><span class="small muted">Panggilan tampil di display TV dan memicu task ID otomatis.</span></div>
        <div class="grid g2" style="align-items:start"><div class="stack">${curCard}${log}</div>${queue}</div>
        ${doneCall && J.called ? nextOf(['display'], `${J.called.ticket} dipanggil ke ${J.called.room} · ${J.called.t}`) : ''}`;
    },
    actions: {
      panggil(L, J) {
        const room = qRoom(L); const cur = qCur(L);
        if (cur) { L.err = `${cur.no} masih ${cur.st} di ${room}. Selesaikan atau lewati dulu sebelum memanggil nomor berikutnya.`; L.msg = ''; return; }
        const nx = (L.q[L.svc] || []).find((t) => t.st === 'menunggu');
        if (!nx) { L.err = 'Tidak ada nomor yang menunggu.'; L.msg = ''; return; }
        const t = SIM.now(1);
        nx.st = 'dipanggil'; nx.at = room; nx.calls = 1;
        J.called = { ticket: nx.no, room, t };
        L.err = ''; L.msg = `${nx.no} dipanggil ke ${room} · ${t}${L.svc === 'loket' ? ' · task 2 terkirim' : ''}`;
        qLog(L, `${nx.no} dipanggil ke ${room}`, 'warning');
        if (nx.no === qMine(J, L.svc)) {
          SIM.note(`${nx.no} (Tn. Suryo) dipanggil ke ${room}`, 'success');
          if (L.svc === 'pd') SIM.done();
        }
      },
      ulang(L, J) {
        const cur = qCur(L);
        if (!cur || cur.st !== 'dipanggil') { L.err = cur ? `${cur.no} sedang dilayani; panggil ulang hanya untuk nomor berstatus dipanggil.` : 'Tidak ada nomor yang sedang dipanggil di ruang ini.'; L.msg = ''; return; }
        cur.calls = (cur.calls || 1) + 1;
        const t = SIM.now(1);
        J.called = { ticket: cur.no, room: cur.at, t };
        L.err = ''; L.msg = `${cur.no} dipanggil ulang (${cur.calls}×) · ${t}`;
        qLog(L, `${cur.no} dipanggil ulang`, 'warning');
      },
      lewati(L) {
        const cur = qCur(L);
        if (!cur || cur.st !== 'dipanggil') { L.err = cur ? `${cur.no} sudah dilayani; nomor yang sedang dilayani tidak bisa dilewati.` : 'Tidak ada nomor yang sedang dipanggil untuk dilewati.'; L.msg = ''; return; }
        cur.st = 'dilewati'; cur.at = '';
        L.err = ''; L.msg = `${cur.no} dilewati · ${SIM.now(1)}`;
        qLog(L, `${cur.no} dilewati (tidak hadir)`, 'danger');
      },
      mulai(L) {
        const cur = qCur(L);
        if (!cur || cur.st !== 'dipanggil') { L.err = cur ? `Transisi tidak sah: ${cur.no} sudah sedang dilayani.` : 'Transisi tidak sah: belum ada nomor yang dipanggil di ruang ini.'; L.msg = ''; return; }
        cur.st = 'dilayani';
        L.err = ''; L.msg = `${cur.no} mulai dilayani · ${SIM.now(1)}${L.svc === 'pd' ? ' · task 4 terkirim' : ''}`;
        qLog(L, `${cur.no} mulai dilayani`, 'brand');
      },
      selesai(L) {
        const cur = qCur(L);
        if (!cur || cur.st !== 'dilayani') { L.err = cur ? `Transisi tidak sah: ${cur.no} belum mulai dilayani (status dipanggil). Klik Mulai layani dulu.` : 'Transisi tidak sah: tidak ada nomor yang sedang dilayani.'; L.msg = ''; return; }
        cur.st = 'selesai';
        L.err = ''; L.msg = `${cur.no} selesai · ${SIM.now(1)}${L.svc === 'pd' ? ' · task 5 terkirim' : ''}`;
        qLog(L, `${cur.no} selesai`, 'success');
      },
      kembalikan(L, J, el) {
        const list = L.q[L.svc] || [];
        const i = list.findIndex((t) => t.no === argOf(el) && t.st === 'dilewati');
        if (i < 0) return false;
        const [t] = list.splice(i, 1);
        t.st = 'menunggu';
        let seen = 0; let at = list.length;
        for (let k = 0; k < list.length; k++) if (list[k].st === 'menunggu' && ++seen === 3) { at = k + 1; break; }
        list.splice(at, 0, t);
        qLog(L, `${t.no} dikembalikan ke antrean`, '');
      },
    },
  });

  /* =====================================================================
   * FASE 2 · Display antrean (TV)
   * ===================================================================== */
  const TV_SVC = {
    A: { name: 'Loket pendaftaran', room: 'Loket 1' },
    PD: { name: 'Poli Penyakit Dalam', room: 'Ruang 2 · dr. Andi Wiratama, Sp.PD' },
    JT: { name: 'Poli Jantung', room: 'Ruang 4 · dr. Fajar Nugraha, Sp.JP' },
    PR: { name: 'Poli Paru', room: 'Ruang 6 · dr. Yusuf Hakim, Sp.P' },
  };
  const TV_ORDER = ['PD', 'A', 'JT', 'PR'];
  const DIGIT = ['nol', 'satu', 'dua', 'tiga', 'empat', 'lima', 'enam', 'tujuh', 'delapan', 'sembilan'];
  const spell = (no) => String(no).replace(/-/g, ' ').split('').map((c) => (/\d/.test(c) ? DIGIT[Number(c)] : c === ' ' ? '' : c)).filter(Boolean).join(' ');
  const tvRoom = (room) => { const m = /^Poli PD (\d+)$/.exec(String(room || '')); return m ? `Ruang ${m[1]}` : String(room || ''); };

  SIM.register({
    id: 'display', phase: 2, title: 'Display antrean ruang tunggu', nav: 'Display TV', codes: 'F04', role: 'perangkat', device: 'TV',
    desc: 'TV ruang tunggu menampilkan nomor yang sedang dipanggil, ruangannya, nomor berikutnya per layanan, jam, dan teks berjalan.',
    hint: 'Lihat nomor dari Kendali antrean di papan, lalu klik "Panggil berikutnya" di bawah TV.',
    init: { cur: { no: 'PD-006', svc: 'PD', room: 'Ruang 2' }, hist: [{ no: 'A-011', room: 'Loket 1' }, { no: 'JT-014', room: 'Ruang 4' }, { no: 'PR-009', room: 'Ruang 6' }], nums: { A: 11, PD: 6, JT: 14, PR: 9 }, rot: 0, flash: false, syncKey: '', fromJ: false, at: '' },
    onEnter(L, J) {
      if (!J.called) return;
      const key = `${J.called.ticket}@${J.called.t}`;
      if (L.syncKey === key) return;
      const m = /^([A-Z]+)-(\d+)$/.exec(J.called.ticket);
      const svc = m && TV_SVC[m[1]] ? m[1] : 'PD';
      if (L.cur && L.cur.no !== J.called.ticket) L.hist = [{ no: L.cur.no, room: L.cur.room }, ...L.hist].slice(0, 4);
      L.cur = { no: J.called.ticket, svc, room: tvRoom(J.called.room) };
      if (m) L.nums[svc] = Math.max(Number(L.nums[svc]) || 0, Number(m[2]));
      L.syncKey = key; L.fromJ = true; L.flash = true; L.at = J.called.t;
    },
    render(L, J) {
      const cur = L.cur || { no: 'PD-006', svc: 'PD', room: 'Ruang 2' };
      const svc = TV_SVC[cur.svc] || TV_SVC.PD;
      const ink = 'color:var(--device-ink)';
      const right = Object.keys(TV_SVC).map((k) => {
        const n = Number(L.nums[k]) || 0;
        return `<div style="padding:10px 14px;border-radius:12px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12)"><div style="display:flex;justify-content:space-between;gap:8px"><b style="font-size:clamp(12px,1.6vw,17px)">${esc(TV_SVC[k].name)}</b><span class="mono" style="font-size:clamp(14px,2vw,22px);font-weight:700;color:var(--brand-200)">${esc(tno(k, n))}</span></div>
          <div style="font-size:clamp(10px,1.2vw,13px);opacity:.75">${esc(TV_SVC[k].room)}</div><div style="font-size:clamp(10px,1.2vw,13px);opacity:.9">Berikutnya: <span class="mono">${esc(tno(k, n + 1))}, ${esc(tno(k, n + 2))}</span></div></div>`;
      }).join('');
      const tv = `<div style="height:100%;display:grid;grid-template-rows:auto minmax(0,1fr) auto;${ink};font-family:var(--font-sans)">
        <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 18px;border-bottom:1px solid rgba(255,255,255,.12)"><div><b style="font-size:clamp(13px,1.8vw,19px)">${esc(RS.name)} · Rawat Jalan Lantai 2</b><div style="font-size:clamp(10px,1.2vw,13px);opacity:.75">Poli Penyakit Dalam · Jantung · Paru · Loket pendaftaran</div></div>
          <div style="text-align:right"><div class="mono" style="font-size:clamp(18px,3vw,32px);font-weight:600">${SIM.time()}</div><div style="font-size:clamp(10px,1.2vw,13px);opacity:.75">Senin, 5 Oktober 2026</div></div></div>
        <div style="display:grid;grid-template-columns:minmax(0,1.25fr) minmax(0,1fr);gap:14px;padding:14px 18px;min-height:0">
          <div style="display:flex;flex-direction:column;gap:10px;min-width:0">
            <div style="flex:1;border-radius:16px;background:var(--brand-600);display:flex;flex-direction:column;align-items:center;justify-content:center;padding:12px;text-align:center;${L.flash ? 'animation:tin .45s ease-in-out 6 alternate;' : ''}">
              <div style="font-size:clamp(11px,1.5vw,16px);letter-spacing:.12em;font-weight:600;opacity:.9">SEDANG DIPANGGIL</div>
              <div class="mono" style="font-size:clamp(48px,9vw,110px);font-weight:700;line-height:1;color:var(--card)">${esc(cur.no)}</div>
              <div style="font-size:clamp(14px,2.4vw,26px);font-weight:600">${esc(svc.name)}</div><div style="font-size:clamp(12px,1.8vw,20px);opacity:.9">${esc(cur.room)}</div></div>
            <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;font-size:clamp(10px,1.2vw,13px)"><span style="opacity:.75">Sebelumnya:</span>${(L.hist || []).map((h, i) => `<span class="mono" style="padding:2px 8px;border-radius:99px;border:1px solid rgba(255,255,255,.2);opacity:${1 - i * 0.18}">${esc(h.no)} · ${esc(h.room)}</span>`).join('')}</div></div>
          <div style="display:flex;flex-direction:column;gap:8px;min-width:0;overflow:hidden">${right}</div></div>
        <div style="background:rgba(0,0,0,.25);padding:6px 0;font-size:clamp(11px,1.4vw,15px)"><marquee scrollamount="4" aria-label="Info">Tidak mendengar panggilan? Cek nomor Anda di aplikasi atau Mobile JKN. Nomor yang terlewat dipanggil ulang setelah 3 nomor berikutnya. · Pasien BPJS: siapkan kartu atau NIK. · Jaga kebersihan dan pakai masker bila batuk.</marquee></div></div>`;
      const src = L.fromJ ? ui.chip(`Dari Kendali antrean · ${L.at}`, 'success') : contoh();
      return `${ui.device('tv', tv, 'TV 43 inci · perangkat terdaftar, menerima panggilan langsung')}
        <div class="row between"><div class="row">${ui.btn('Panggil berikutnya', { act: 'panggil', variant: 'primary' })}${ui.btn('Panggil ulang', { act: 'ulang' })}${src}</div>
          <span class="small muted">Suara: “Nomor antrean ${esc(spell(cur.no))}, silakan menuju ${esc(svc.name)}, ${esc(cur.room.split(' · ')[0])}.”</span></div>
        ${SIM.isDone('display') ? nextOf(['poli'], `Display memanggil ${cur.no} ke ${svc.name}`) : ''}`;
    },
    actions: {
      panggil(L) {
        const k = TV_ORDER[(Number(L.rot) || 0) % TV_ORDER.length];
        L.rot = (Number(L.rot) || 0) + 1;
        L.nums[k] = (Number(L.nums[k]) || 0) + 1;
        if (L.cur) L.hist = [{ no: L.cur.no, room: L.cur.room }, ...(L.hist || [])].slice(0, 4);
        L.cur = { no: tno(k, L.nums[k]), svc: k, room: TV_SVC[k].room.split(' · ')[0] };
        L.flash = true; L.fromJ = false; L.at = SIM.now(1);
        if (!SIM.isDone('display')) SIM.note(`Display TV memanggil ${L.cur.no} ke ${TV_SVC[k].name}`, 'brand');
        SIM.done();
      },
      ulang(L) { L.flash = true; SIM.toast(`${L.cur ? L.cur.no : ''} dipanggil ulang`); },
    },
  });
})();
