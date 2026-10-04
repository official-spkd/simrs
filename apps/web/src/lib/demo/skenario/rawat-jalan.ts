import { STAF } from '../fixtures/staf';
import type { ScenarioDef } from '../engine/types';
import { emptyRecord } from './base';

/** Skenario 1 · Rawat jalan BPJS (port `rj` di `design/mockups/Simulasi.dc.html`; pasien dan angka fiktif). */
export const RAWAT_JALAN: ScenarioDef = {
  id: 'rawat-jalan',
  label: 'Rawat jalan BPJS',
  startDate: '2026-10-05',
  startMin: 7 * 60 + 10,
  showDay: false,
  base: emptyRecord({
    nama: 'Tn. Suryo Adi Nugroho',
    initials: 'SA',
    jk: 'L',
    umur: 54,
    rm: '00-28-44-17',
    alergi: 'Tidak ada',
    riwayat: 'DM tipe 2 sejak 2018 · hipoglikemia berat 2025',
    penjamin: 'BPJS · belum diverifikasi',
    lokasi: 'Rumah, booking via aplikasi',
  }),
  auto: [
    'Kode booking menjadi antrean, SEP, dan kunjungan tanpa ketik ulang',
    'Tanda vital perawat langsung tampil di layar dokter',
    'Order dokter langsung masuk worklist lab, hasil analyzer langsung ke dokter',
    'Resep dokter menjadi worklist farmasi dan memotong stok saat diserahkan',
    'Setiap layanan otomatis menjadi baris tagihan (charge capture)',
    'Status antrean BPJS task 1–7 dan data SATUSEHAT terkirim di latar belakang',
  ],
  steps: [
    {
      id: 'kedatangan',
      stage: 'Kedatangan',
      actor: 'Pasien · anjungan',
      role: 'petugas_pendaftaran',
      screen: 'kiosk',
      title: 'Check-in di anjungan mandiri',
      desc: 'Pasien sudah booking lewat aplikasi. Di rumah sakit cukup pindai kode booking, verifikasi biometrik, lalu ambil tiket.',
      wait: 0,
      tasks: [
        {
          id: 'scan',
          kind: 'act',
          label: 'Pindai kode booking dari aplikasi pasien',
          btn: 'Pindai kode booking',
          dur: 1,
          result: `Booking 2610050117 · Poli Penyakit Dalam · ${STAF.dpjpPenyakitDalam}`,
          apply: (r, _v, c) => {
            r.lokasi = 'Ruang tunggu admisi';
            c.log('Check-in dengan kode booking 2610050117', 'BPJS Antrean · task 1');
          },
        },
        {
          id: 'bio',
          kind: 'choice',
          label: 'Verifikasi biometrik peserta JKN',
          hint: 'Dipakai sebagai syarat penerbitan SEP rawat jalan.',
          options: [
            { id: 'wajah', label: 'Pengenalan wajah cocok' },
            { id: 'jari', label: 'Sidik jari cocok' },
          ],
          dur: 1,
          apply: (_r, _v, c) =>
            c.log(`Biometrik peserta terverifikasi: ${c.opt.toLowerCase()}`, 'BPJS · biometrik'),
        },
        {
          id: 'tiket',
          kind: 'act',
          label: 'Cetak tiket antrean admisi',
          btn: 'Cetak tiket',
          dur: 1,
          result: 'Tiket A-031 · perkiraan dipanggil 12 menit',
          apply: (r, _v, c) => {
            r.antrean = 'A-031 (admisi)';
            c.log('Tiket A-031 tercetak, notifikasi dikirim ke aplikasi pasien');
          },
        },
      ],
    },
    {
      id: 'pendaftaran',
      stage: 'Pendaftaran & SEP',
      actor: 'Petugas pendaftaran',
      role: 'petugas_pendaftaran',
      screen: 'daftar',
      title: 'Verifikasi penjaminan dan terbitkan SEP',
      desc: 'Kepesertaan, surat kontrol, dan kuota dokter dicek otomatis ke VClaim. Petugas cukup mengonfirmasi.',
      wait: 11,
      tasks: [
        {
          id: 'panggil',
          kind: 'act',
          label: 'Panggil A-031 ke loket 3',
          btn: 'Panggil',
          dur: 1,
          result: 'Pasien di loket 3',
          apply: (r, _v, c) => {
            r.lokasi = 'Loket pendaftaran 3';
            c.log('A-031 dipanggil ke loket 3', 'BPJS Antrean · task 2');
          },
        },
        {
          id: 'cek',
          kind: 'act',
          label: 'Cek kepesertaan dan surat kontrol',
          btn: 'Cek ke VClaim',
          dur: 2,
          result: 'Peserta aktif · PBPU kelas 2 · surat kontrol berlaku s.d. 12 Okt',
          apply: (r, _v, c) => {
            r.penjamin = 'BPJS PBPU kelas 2 · aktif';
            c.log('Peserta aktif, surat kontrol valid', 'BPJS VClaim');
          },
        },
        {
          id: 'sep',
          kind: 'act',
          label: 'Terbitkan SEP rawat jalan',
          btn: 'Terbitkan SEP',
          dur: 2,
          result: 'SEP 0301R0011026V005102 · antrean poli PD-027',
          apply: (r, _v, c) => {
            r.sep = '0301R0011026V005102';
            r.antrean = 'PD-027 (Poli PD)';
            r.lokasi = 'Ruang tunggu Poli PD';
            c.charge('Administrasi rawat jalan', 30_000n);
            c.log('SEP 0301R0011026V005102 terbit', 'BPJS VClaim · insert SEP');
            c.log('Masuk antrean poli PD-027', 'BPJS Antrean · task 3');
            c.log('Kunjungan rawat jalan dibuat', 'SATUSEHAT · Encounter');
          },
        },
      ],
    },
    {
      id: 'asesmen-perawat',
      stage: 'Asesmen perawat',
      actor: 'Perawat poli',
      role: 'perawat',
      screen: 'poli',
      title: 'Asesmen awal keperawatan',
      desc: 'Perawat mengisi tanda vital dan skrining. Nilai di luar batas langsung ditandai untuk dokter.',
      wait: 18,
      tasks: [
        {
          id: 'td',
          kind: 'input',
          label: 'Tekanan darah (mmHg)',
          def: '138/86',
          ph: 'mis. 120/80',
          check: (v) =>
            /^\d{2,3}\/\d{2,3}$/.test(v.trim()) ? '' : 'Isi dengan format sistolik/diastolik, mis. 120/80.',
          dur: 2,
          apply: (r, v, c) => {
            const td = String(v).trim();
            r.ttv = `TD ${td}`;
            c.log(`Tekanan darah ${td} mmHg`, 'SATUSEHAT · Observation');
          },
        },
        {
          id: 'gds',
          kind: 'input',
          label: 'Gula darah sewaktu dengan glukometer (mg/dL)',
          def: '212',
          ph: '20–600',
          check: (v) => {
            const n = Number(v.trim());
            return v.trim() !== '' && n >= 20 && n <= 600 ? '' : 'Isi angka antara 20 dan 600.';
          },
          dur: 2,
          apply: (r, v, c) => {
            const n = Number(String(v).trim());
            r.ttv += ` · GDS ${n} mg/dL`;
            c.charge('Pemeriksaan GDS glukometer', 25_000n);
            c.log(
              `GDS ${n} mg/dL${n >= 200 ? ', ditandai tinggi untuk dokter' : ''}`,
              'SATUSEHAT · Observation',
            );
          },
        },
        {
          id: 'jatuh',
          kind: 'choice',
          label: 'Skrining risiko jatuh (Get Up and Go)',
          options: [
            { id: 'tidak', label: 'Tidak berisiko' },
            { id: 'rendah', label: 'Risiko rendah' },
            { id: 'tinggi', label: 'Risiko tinggi', sub: 'pasang gelang kuning' },
          ],
          dur: 1,
          apply: (r, v, c) => {
            if (v === 'tinggi') r.lokasi += ' · gelang kuning';
            c.charge('Asesmen keperawatan', 25_000n);
            c.log(`Skrining risiko jatuh: ${c.opt.toLowerCase()}`);
          },
        },
      ],
    },
    {
      id: 'pemeriksaan-dokter',
      stage: 'Pemeriksaan dokter',
      actor: 'DPJP Poli PD',
      role: 'dokter',
      screen: 'poli',
      title: 'Pemeriksaan dan order penunjang',
      desc: 'Dokter melihat ringkasan pasien, skrining perawat, dan riwayat. Order dikirim lewat CPOE dan langsung masuk worklist lab.',
      wait: 24,
      tasks: [
        {
          id: 'panggil',
          kind: 'act',
          label: 'Panggil PD-027 ke ruang periksa 2',
          btn: 'Panggil pasien',
          dur: 1,
          result: 'Pasien di ruang periksa 2',
          apply: (r, _v, c) => {
            r.lokasi = 'Ruang periksa 2 Poli PD';
            c.log('Mulai pelayanan poli', 'BPJS Antrean · task 4');
          },
        },
        {
          id: 'dx',
          kind: 'act',
          label: 'Tetapkan diagnosis kerja: E11.9 · DM tipe 2 tanpa komplikasi',
          hint: 'Anamnesis dan pemeriksaan fisik dicatat di SOAP. GDS tinggi dari perawat sudah tampil.',
          btn: 'Simpan SOAP dan diagnosis',
          dur: 7,
          result: 'SOAP tersimpan, diagnosis E11.9',
          apply: (r, _v, c) => {
            r.dx = ['E11.9 · DM tipe 2 tanpa komplikasi'];
            c.charge('Konsultasi dokter spesialis', 150_000n);
            c.log('SOAP dan diagnosis kerja E11.9', 'SATUSEHAT · Condition');
          },
        },
        {
          id: 'order',
          kind: 'choice',
          label: 'Order penunjang lewat CPOE',
          options: [
            { id: 'paket', label: 'Paket kontrol DM', sub: 'HbA1c, profil lipid, kreatinin' },
            { id: 'hba1c', label: 'HbA1c saja' },
          ],
          dur: 2,
          apply: (r, v, c) => {
            r.order = v === 'paket' ? ['HbA1c', 'Profil lipid', 'Kreatinin'] : ['HbA1c'];
            r.lokasi = 'Laboratorium (sampling)';
            c.log(`Order lab dikirim: ${r.order.join(', ')}`, 'SATUSEHAT · ServiceRequest');
          },
        },
      ],
    },
    {
      id: 'laboratorium',
      stage: 'Laboratorium',
      actor: 'Analis lab',
      role: 'analis_lab',
      screen: 'lab',
      title: 'Sampling, analisis, dan validasi',
      desc: 'Label barcode tabung dibuat dari order. Hasil analyzer masuk otomatis (HL7), lalu QC dan delta check dijalankan sebelum validasi.',
      wait: 7,
      tasks: [
        {
          id: 'sampling',
          kind: 'act',
          label: 'Ambil sampel darah dan pindai barcode tabung',
          btn: 'Pindai tabung',
          dur: 4,
          result: 'Sampel L2610050088 diterima',
          apply: (_r, _v, c) => c.log('Sampel L2610050088 diterima laboratorium'),
        },
        {
          id: 'hasil',
          kind: 'act',
          label: 'Terima hasil dari analyzer',
          btn: 'Terima hasil (HL7 ORU)',
          dur: 52,
          result: 'Hasil masuk, QC harian lolos',
          apply: (r, _v, c) => {
            r.hasil =
              r.order.length > 1
                ? ['HbA1c 8,4% (tinggi)', 'LDL 142 mg/dL (tinggi)', 'Kreatinin 1,1 mg/dL · eGFR 74']
                : ['HbA1c 8,4% (tinggi)'];
            c.log('Hasil analyzer masuk, QC lolos', 'LIS · HL7 ORU');
          },
        },
        {
          id: 'validasi',
          kind: 'act',
          label: `Validasi klinis ${STAF.dokterPatologiKlinik} (TTE)`,
          btn: 'Validasi dan rilis',
          dur: 5,
          result: 'Hasil dirilis ke dokter dan aplikasi pasien',
          apply: (r, _v, c) => {
            c.charge('HbA1c', 185_000n);
            if (r.order.length > 1) {
              c.charge('Profil lipid', 160_000n);
              c.charge('Kreatinin', 45_000n);
            }
            r.lokasi = 'Ruang tunggu Poli PD';
            c.log('Hasil divalidasi dan dirilis', 'SATUSEHAT · DiagnosticReport');
          },
        },
      ],
    },
    {
      id: 'resep',
      stage: 'Tinjau hasil & resep',
      actor: 'DPJP Poli PD',
      role: 'dokter',
      screen: 'order',
      title: 'Tinjau hasil dan tulis resep',
      desc: 'Hasil lab tampil di CPPT. Resep diperiksa CDS terhadap alergi, interaksi, fungsi ginjal, dan riwayat pasien.',
      wait: 9,
      tasks: [
        {
          id: 'terapi',
          kind: 'choice',
          label: 'Rencana terapi',
          def: 'a',
          options: [
            {
              id: 'a',
              label: 'Metformin + glimepirid + atorvastatin',
              sub: 'Metformin 1000 mg 2×1, glimepirid 2 mg 1×1, atorvastatin 20 mg',
            },
            {
              id: 'b',
              label: 'Metformin + atorvastatin',
              sub: 'Metformin 1000 mg 2×1, atorvastatin 20 mg, evaluasi 1 bulan',
            },
          ],
          dur: 4,
          apply: (r, v, c) => {
            r.obat =
              v === 'a'
                ? ['Metformin 1000 mg 2×1', 'Glimepirid 2 mg 1×1 pagi', 'Atorvastatin 20 mg 1×1 malam']
                : ['Metformin 1000 mg 2×1', 'Atorvastatin 20 mg 1×1 malam'];
            if (r.order.some((o) => o.startsWith('Profil lipid'))) r.dx.push('E78.5 · Hiperlipidemia');
            c.log(`Resep disusun, ${r.obat.length} item`);
          },
        },
        {
          id: 'cds',
          kind: 'choice',
          tone: 'danger',
          when: (_r, done) => done('terapi') === 'a',
          label: 'CDS: sulfonilurea pada pasien dengan riwayat hipoglikemia berat',
          hint: 'Glimepirid meningkatkan risiko hipoglikemia berulang. Resep tidak bisa dikirim sebelum ditindaklanjuti.',
          def: 'ganti',
          options: [
            { id: 'ganti', label: 'Hapus glimepirid', sub: 'optimalkan metformin, evaluasi 1 bulan' },
            {
              id: 'lanjut',
              label: 'Tetap lanjut dengan alasan',
              sub: 'edukasi hipoglikemia + cek gula mandiri',
            },
          ],
          dur: 1,
          apply: (r, v, c) => {
            if (v === 'ganti') {
              r.obat = r.obat.filter((o) => !o.startsWith('Glimepirid'));
              c.log('Peringatan CDS ditindaklanjuti: glimepirid dihapus', 'Keselamatan · CDS');
            } else {
              c.log('Peringatan CDS di-override, alasan terdokumentasi', 'Keselamatan · CDS');
            }
          },
        },
        {
          id: 'prb',
          kind: 'choice',
          label: 'Program rujuk balik (PRB)',
          options: [
            { id: 'ya', label: 'Ya · obat PRB 30 hari', sub: 'kontrol rutin di FKTP' },
            { id: 'tidak', label: 'Tidak · resep 7 hari' },
          ],
          dur: 1,
          apply: (r, v, c) => {
            r.prb = v === 'ya';
            r.obat = r.obat.map((o) => `${o}${v === 'ya' ? ' · 30 hari' : ' · 7 hari'}`);
            c.log(v === 'ya' ? 'Pasien didaftarkan PRB' : 'Resep 7 hari', v === 'ya' ? 'BPJS · PRB' : '');
          },
        },
        {
          id: 'tte',
          kind: 'act',
          label: 'Tanda tangani resume rawat jalan',
          btn: 'Tanda tangani (TTE)',
          dur: 3,
          result: 'Resume final, resep terkirim ke farmasi',
          apply: (r, _v, c) => {
            r.lokasi = 'Farmasi rawat jalan';
            c.log('Pelayanan poli selesai, resep ke farmasi', 'BPJS Antrean · task 5');
            c.log('Resume dan resep terkirim', 'SATUSEHAT · Composition');
          },
        },
      ],
    },
    {
      id: 'farmasi',
      stage: 'Farmasi',
      actor: 'Apoteker',
      role: 'apoteker',
      screen: 'farmasi',
      title: 'Telaah, siapkan, dan serahkan obat',
      desc: 'Apoteker menerima resep yang sama persis dengan yang ditulis dokter, tanpa ketik ulang. Stok depo berkurang saat obat diserahkan.',
      wait: 14,
      tasks: [
        {
          id: 'telaah',
          kind: 'act',
          label: 'Telaah resep (administratif, farmasetik, klinis)',
          btn: 'Telaah lolos',
          dur: 3,
          result: 'Tidak ada masalah terapi',
          apply: (_r, _v, c) => c.log('Telaah resep lolos, mulai disiapkan', 'BPJS Antrean · task 6'),
        },
        {
          id: 'siap',
          kind: 'act',
          label: 'Siapkan obat dan cetak label',
          btn: 'Selesai disiapkan',
          dur: 11,
          result: 'Obat siap, label aturan pakai tercetak',
          apply: (r, _v, c) => {
            const n = r.obat.length;
            const amount = r.prb ? (n > 2 ? 246_000n : 186_000n) : n > 2 ? 58_000n : 44_000n;
            c.charge(`Obat ${r.prb ? '30 hari (PRB)' : '7 hari'} · ${n} item`, amount);
            c.log('Obat selesai disiapkan', 'BPJS Antrean · task 7');
          },
        },
        {
          id: 'serah',
          kind: 'choice',
          label: 'Serah terima dan edukasi',
          options: [
            { id: 'pasien', label: 'Diterima pasien sendiri' },
            { id: 'keluarga', label: 'Diterima keluarga' },
          ],
          dur: 4,
          apply: (r, _v, c) => {
            r.lokasi = 'Kasir';
            c.log('Obat diserahkan dengan edukasi cara minum', 'SATUSEHAT · MedicationDispense');
          },
        },
      ],
    },
    {
      id: 'kasir',
      stage: 'Kasir',
      actor: 'Kasir rawat jalan',
      role: 'kasir',
      screen: 'kasir',
      title: 'Tagihan final dan tutup kunjungan',
      desc: 'Semua tarif sudah tertangkap dari setiap langkah. Kasir hanya memfinalkan, tidak memasukkan item manual.',
      wait: 3,
      tasks: [
        {
          id: 'final',
          kind: 'act',
          label: 'Finalkan tagihan',
          btn: 'Finalkan',
          dur: 1,
          result: 'Tagihan terkunci',
          apply: (_r, _v, c) => c.log('Tagihan difinalkan'),
        },
        {
          id: 'tutup',
          kind: 'act',
          label: 'Tutup kunjungan: ditanggung BPJS, pasien bayar Rp 0',
          btn: 'Tutup kunjungan',
          dur: 1,
          result: 'Pasien pulang',
          apply: (r, _v, c) => {
            r.bayarPasien = 0n;
            r.lokasi = 'Pulang';
            r.pulangAt = c.now;
            r.penjamin = 'BPJS PBPU kelas 2 · ditagihkan';
            c.log('Kunjungan ditutup', 'SATUSEHAT · Encounter finished');
          },
        },
      ],
    },
    {
      id: 'pasca',
      stage: 'Pasca kunjungan',
      actor: 'Sistem dan koder',
      role: 'koder',
      screen: 'klaim',
      title: 'Setelah pasien pulang',
      desc: 'Data yang sama dipakai untuk notifikasi pasien, jadwal kontrol, dan klaim.',
      wait: 0,
      tasks: [
        {
          id: 'notif',
          kind: 'act',
          label: 'Kirim resume, hasil lab, dan pengingat obat ke aplikasi pasien',
          btn: 'Kirim notifikasi',
          dur: 1,
          result: 'Terkirim ke aplikasi pasien',
          apply: (_r, _v, c) => c.log('Notifikasi terkirim ke aplikasi pasien'),
        },
        {
          id: 'kontrol',
          kind: 'choice',
          label: 'Jadwal kontrol berikutnya',
          options: (r) =>
            r.prb
              ? [{ id: 'fktp', label: 'Rujuk balik ke FKTP', sub: 'evaluasi di RS Senin 4 Jan 2027' }]
              : [
                  { id: '2mg', label: 'Kontrol 2 minggu', sub: 'Senin 19 Okt 2026' },
                  { id: '4mg', label: 'Kontrol 4 minggu', sub: 'Senin 2 Nov 2026' },
                ],
          dur: 1,
          apply: (r, _v, c) => {
            r.kontrol = `${c.opt} · ${c.optSub}`;
            c.log(`Jadwal kontrol dibuat: ${c.optSub}`, 'BPJS Antrean · booking');
          },
        },
        {
          id: 'klaim',
          kind: 'act',
          label: 'Kirim ke antrean koder dan E-Klaim',
          btn: 'Kirim berkas klaim',
          dur: 2,
          result: 'Berkas klaim lengkap otomatis',
          apply: (r, _v, c) => {
            r.klaim = `Siap grouping · ${r.dx.map((d) => d.split(' ')[0]).join(', ')}`;
            c.log('Berkas klaim lengkap, masuk antrean koder', 'E-Klaim');
          },
        },
      ],
    },
  ],
};
