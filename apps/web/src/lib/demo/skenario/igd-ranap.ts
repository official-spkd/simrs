import { STAF } from '../fixtures/staf';
import type { ScenarioDef, TaskOption } from '../engine/types';
import { emptyRecord } from './base';

const BEDS: Record<string, readonly TaskOption[]> = {
  icu: [
    { id: 'ICU 3', label: 'ICU 3', sub: 'siap sekarang' },
    { id: 'ICU 5', label: 'ICU 5', sub: 'sedang dibersihkan, siap ±30 menit' },
  ],
  hcu: [
    { id: 'HCU 2', label: 'HCU 2', sub: 'siap sekarang' },
    { id: 'HCU 4', label: 'HCU 4', sub: 'sedang dibersihkan, siap ±30 menit' },
  ],
  bangsal: [
    { id: 'Anggrek A-07', label: 'Anggrek A-07 · kelas 1', sub: 'siap, telemetri tersedia' },
    { id: 'Anggrek A-09', label: 'Anggrek A-09 · kelas 1', sub: 'sedang dibersihkan' },
  ],
};

/** Skenario 2 · IGD → rawat inap (port `igd` di `design/mockups/Simulasi.dc.html`; pasien dan angka fiktif). */
export const IGD_RANAP: ScenarioDef = {
  id: 'igd-ranap',
  label: 'IGD → rawat inap',
  startDate: '2026-10-03',
  startMin: 21 * 60 + 40,
  showDay: true,
  base: emptyRecord({
    nama: 'Tn. Hartono Wibisono',
    initials: 'HW',
    jk: 'L',
    umur: 61,
    rm: '00-61-30-05',
    alergi: 'Tidak ada',
    riwayat: 'Hipertensi · CKD st. 3 · obat rutin amlodipin, omeprazol',
    penjamin: 'Belum dicek · gawat darurat',
    lokasi: 'Pintu IGD, diantar keluarga',
  }),
  auto: [
    'Identitas ditemukan di MPI, riwayat CKD dan obat rutin langsung terbaca',
    'Order set IGD sekaligus mengisi worklist lab, radiologi, dan tagihan',
    'Nilai kritis memicu alarm, timer, dan pelaporan dengan read-back',
    'Permintaan bed masuk papan bed, SEP rawat inap terbit dari data IGD',
    'Resume pulang dihimpun dari CPPT, hasil, dan eMAR',
    'Kode diagnosis dan prosedur ditarik ke klaim tanpa input ulang',
  ],
  steps: [
    {
      id: 'kedatangan',
      stage: 'Kedatangan IGD',
      actor: 'Petugas admisi IGD',
      role: 'petugas_pendaftaran',
      screen: 'igd',
      title: 'Pasien datang dengan nyeri dada',
      desc: 'Pasien gawat darurat dilayani lebih dulu; penjaminan menyusul (BPJS memberi waktu 3×24 jam hari kerja). Identitas dicari di MPI agar riwayat lama terbaca.',
      wait: 0,
      tasks: [
        {
          id: 'id',
          kind: 'choice',
          label: 'Identifikasi pasien',
          options: [
            { id: 'ktp', label: 'Baca e-KTP', sub: 'NIK cocok di MPI' },
            { id: 'nama', label: 'Cari di MPI', sub: 'nama + tanggal lahir' },
          ],
          dur: 2,
          apply: (_r, _v, c) => c.log('Pasien ditemukan di MPI (RM 00-61-30-05), riwayat CKD terbaca', 'MPI'),
        },
        {
          id: 'gelang',
          kind: 'act',
          label: 'Pasang gelang identitas dan buka kunjungan IGD',
          btn: 'Buka kunjungan',
          dur: 1,
          result: 'Gelang terpasang, kunjungan IGD terbuka',
          apply: (r, _v, c) => {
            r.lokasi = 'IGD · area triase';
            c.charge('Administrasi IGD', 50_000n);
            c.log('Kunjungan gawat darurat dibuka', 'SATUSEHAT · Encounter');
          },
        },
      ],
    },
    {
      id: 'triase',
      stage: 'Triase',
      actor: 'Perawat triase',
      role: 'perawat',
      screen: 'igd',
      title: 'Triase dalam 5 menit',
      desc: 'Sistem menyarankan level dari keluhan dan tanda vital. Menurunkan level di bawah saran wajib disertai alasan.',
      wait: 2,
      tasks: [
        {
          id: 'ttv',
          kind: 'input',
          label: 'Tanda vital (TD · nadi · RR · SpO2)',
          def: '158/94 · 112 · 24 · 94%',
          ph: 'TD · nadi · RR · SpO2',
          check: (v) => (v.trim().length >= 10 ? '' : 'Lengkapi TD, nadi, RR, dan SpO2.'),
          dur: 2,
          apply: (r, v, c) => {
            r.ttv = String(v).trim();
            c.log(`Tanda vital ${String(v).trim()}`, 'SATUSEHAT · Observation');
          },
        },
        {
          id: 'level',
          kind: 'choice',
          label: 'Level triase',
          hint: 'Saran sistem: level 2 (nyeri dada + takikardia + SpO2 94%).',
          def: '2',
          options: [
            { id: '1', label: 'Level 1 · resusitasi' },
            { id: '2', label: 'Level 2 · emergensi', sub: 'disarankan sistem' },
            { id: '3', label: 'Level 3 · urgen', sub: 'di bawah saran, butuh alasan' },
          ],
          dur: 1,
          apply: (r, v, c) => {
            r.triase = `Level ${String(v)}`;
            c.log(`Triase level ${String(v)}`);
          },
        },
        {
          id: 'alasan',
          kind: 'input',
          tone: 'danger',
          when: (_r, done) => done('level') === '3',
          label: 'Level di bawah saran sistem: tulis alasan klinis',
          hint: 'Tercatat di jejak audit dan ditinjau komite mutu.',
          def: '',
          ph: 'Alasan minimal 10 karakter',
          check: (v) => (v.trim().length >= 10 ? '' : 'Alasan minimal 10 karakter.'),
          dur: 1,
          apply: (_r, v, c) => c.log(`Override triase: ${String(v).trim()}`, 'Keselamatan · audit'),
        },
        {
          id: 'bed',
          kind: 'act',
          label: 'Tempatkan di bed resusitasi 2 dan pasang monitor',
          btn: 'Tempatkan pasien',
          dur: 2,
          result: 'Monitor EKG, SpO2, dan TD terpasang',
          apply: (r, _v, c) => {
            r.lokasi = 'IGD · bed resusitasi 2';
            c.log('Pasien di bed R2, monitor terpasang');
          },
        },
      ],
    },
    {
      id: 'asesmen-dokter',
      stage: 'Asesmen dokter',
      actor: 'Dokter jaga IGD',
      role: 'dokter',
      screen: 'order',
      title: 'EKG dan order set nyeri dada',
      desc: 'Order set mencegah pemeriksaan wajib terlewat, sekaligus mengisi worklist unit terkait dan tagihan.',
      wait: 3,
      tasks: [
        {
          id: 'ekg',
          kind: 'act',
          label: 'Rekam EKG 12 sadapan',
          btn: 'Rekam EKG',
          dur: 6,
          result: 'Depresi ST V4–V6, gelombang T tinggi runcing',
          apply: (r, _v, c) => {
            r.hasil.push('EKG: depresi ST V4–V6, T tinggi runcing');
            r.tindakan.push('89.52 · EKG');
            c.charge('EKG 12 sadapan', 85_000n);
            c.log('EKG tersimpan di RME', 'SATUSEHAT · Procedure');
          },
        },
        {
          id: 'orderset',
          kind: 'choice',
          label: 'Order penunjang',
          options: [
            {
              id: 'set',
              label: 'Order set nyeri dada',
              sub: 'troponin I, elektrolit, DL, ureum/kreatinin, foto toraks',
            },
            { id: 'manual', label: 'Order manual', sub: 'troponin I + elektrolit' },
          ],
          dur: 3,
          apply: (r, v, c) => {
            if (v === 'set') {
              r.order = ['Troponin I', 'Elektrolit', 'Darah lengkap', 'Ureum/kreatinin', 'Foto toraks'];
              c.charge('Lab order set nyeri dada', 735_000n);
              c.charge('Foto toraks', 150_000n);
            } else {
              r.order = ['Troponin I', 'Elektrolit'];
              c.charge('Troponin I + elektrolit', 420_000n);
            }
            c.log(`Order dikirim: ${r.order.join(', ')}`, 'SATUSEHAT · ServiceRequest');
          },
        },
        {
          id: 'awal',
          kind: 'choice',
          label: 'Terapi awal',
          options: [
            { id: 'asa', label: 'Aspirin 160 mg dikunyah + ISDN 5 mg SL' },
            { id: 'tunda', label: 'Tunda sampai hasil lab' },
          ],
          dur: 3,
          apply: (r, v, c) => {
            if (v === 'asa') {
              r.obat.push('Aspirin 160 mg (dosis awal)', 'ISDN 5 mg SL');
              c.charge('Obat dan BHP IGD', 185_000n);
              c.log('Terapi awal diberikan, tercatat di eMAR IGD');
            } else {
              c.log('Terapi ditunda menunggu hasil lab');
            }
          },
        },
      ],
    },
    {
      id: 'nilai-kritis',
      stage: 'Lab & nilai kritis',
      actor: 'Analis lab → dokter jaga',
      role: 'analis_lab',
      screen: 'lab',
      title: 'Hasil keluar dengan nilai kritis',
      desc: 'Nilai kritis memicu alarm dan timer 30 menit. Laporan baru sah setelah penerima membacakan ulang (read-back).',
      wait: 32,
      tasks: [
        {
          id: 'hasil',
          kind: 'act',
          tone: 'danger',
          label: 'Hasil keluar: kalium 6,8 mmol/L (KRITIS), troponin I meningkat',
          btn: 'Buka hasil',
          dur: 1,
          result: 'Alarm nilai kritis aktif, timer lapor 30 menit berjalan',
          apply: (r, _v, c) => {
            r.hasil.push(
              'Kalium 6,8 mmol/L (KRITIS)',
              'Troponin I meningkat',
              'Kreatinin 1,8 mg/dL · eGFR 38',
            );
            c.log('Nilai kritis kalium terdeteksi, timer lapor dimulai', 'Keselamatan · nilai kritis');
          },
        },
        {
          id: 'lapor',
          kind: 'input',
          tone: 'danger',
          label: 'Laporkan ke dokter: nama penerima',
          def: `${STAF.dokterJagaIgd} (dokter jaga IGD)`,
          ph: 'Nama dan peran penerima',
          check: (v) => (v.trim().length >= 5 ? '' : 'Isi nama penerima laporan.'),
          dur: 4,
          apply: (_r, v, c) => c.log(`Nilai kritis dilaporkan ke ${String(v).trim()}`),
        },
        {
          id: 'readback',
          kind: 'act',
          tone: 'danger',
          label: 'Konfirmasi read-back dari penerima',
          btn: 'Read-back benar',
          dur: 1,
          result: 'Dilaporkan 5 menit setelah hasil keluar (target ≤ 30 menit)',
          apply: (_r, _v, c) =>
            c.log('Read-back terkonfirmasi, pelaporan nilai kritis selesai', 'Keselamatan · nilai kritis'),
        },
      ],
    },
    {
      id: 'tata-laksana',
      stage: 'Tata laksana',
      actor: 'Dokter jaga + DPJP jantung',
      role: 'dokter',
      screen: 'order',
      title: 'Atasi hiperkalemia, tetapkan rawat',
      desc: `Diagnosis kerja NSTEMI dengan hiperkalemia. DPJP jantung (${STAF.dpjpJantung}) menyetujui rencana lewat aplikasi dokter.`,
      wait: 4,
      tasks: [
        {
          id: 'k',
          kind: 'choice',
          label: 'Tata laksana hiperkalemia',
          options: [
            {
              id: 'lengkap',
              label: 'Kalsium glukonat IV + insulin–dekstrosa',
              sub: 'monitor EKG, cek kalium ulang 1 jam',
            },
            { id: 'ca', label: 'Kalsium glukonat IV saja', sub: 'cek kalium ulang 1 jam' },
          ],
          dur: 8,
          apply: (r, v, c) => {
            r.obat.push(
              v === 'lengkap' ? 'Kalsium glukonat 10% IV + insulin–dekstrosa' : 'Kalsium glukonat 10% IV',
            );
            r.dx = ['I21.4 · NSTEMI (kerja)', 'E87.5 · Hiperkalemia'];
            c.charge('Obat tata laksana hiperkalemia', 95_000n);
            c.log('Diagnosis kerja NSTEMI dan hiperkalemia', 'SATUSEHAT · Condition');
          },
        },
        {
          id: 'cds',
          kind: 'choice',
          tone: 'danger',
          label: 'CDS: klopidogrel berinteraksi dengan omeprazol (obat rutin pasien)',
          hint: 'Omeprazol menurunkan efek antiplatelet klopidogrel. Order antiplatelet tertahan sampai ditindaklanjuti.',
          def: 'ganti',
          options: [
            {
              id: 'ganti',
              label: 'Ganti omeprazol ke pantoprazol',
              sub: 'klopidogrel 300 mg loading tetap diberikan',
            },
            { id: 'lanjut', label: 'Lanjutkan dengan alasan klinis' },
          ],
          dur: 2,
          apply: (r, v, c) => {
            r.ppi = v === 'ganti' ? 'Pantoprazol 40 mg 1×1' : 'Omeprazol 20 mg 1×1';
            r.obat.push('Klopidogrel 300 mg (loading)', r.ppi);
            c.log(
              v === 'ganti'
                ? 'Interaksi dicegah: omeprazol diganti pantoprazol'
                : 'Interaksi di-override dengan alasan',
              'Keselamatan · CDS',
            );
          },
        },
        {
          id: 'dispo',
          kind: 'choice',
          label: 'Keputusan rawat',
          def: 'icu',
          options: [
            { id: 'icu', label: 'ICU/ICCU' },
            { id: 'hcu', label: 'HCU' },
            { id: 'bangsal', label: 'Bangsal dengan telemetri' },
          ],
          dur: 3,
          apply: (r, v, c) => {
            r.dispo = String(v);
            c.log(`Disposisi: rawat ${c.opt}`);
          },
        },
        {
          id: 'consent',
          kind: 'act',
          label: 'Persetujuan rawat dan tindakan di tablet',
          hint: 'Pasien kompeten; istri menjadi saksi.',
          btn: 'Tanda tangani',
          dur: 6,
          result: 'Ditandatangani pasien, saksi, dan dokter (TTE)',
          apply: (_r, _v, c) => c.log('Persetujuan tindakan final, dokumen ber-TTE', 'RME · consent'),
        },
      ],
    },
    {
      id: 'admisi',
      stage: 'Bed & admisi',
      actor: 'Admisi rawat inap',
      role: 'petugas_pendaftaran',
      screen: 'bed',
      title: 'Alokasi tempat tidur dan SEP rawat inap',
      desc: 'Permintaan bed masuk papan bed. Admisi mencocokkan hak kelas, jenis ruang, dan kebutuhan isolasi.',
      wait: 18,
      tasks: [
        {
          id: 'bpjs',
          kind: 'act',
          label: 'Cek kepesertaan BPJS',
          btn: 'Cek ke VClaim',
          dur: 2,
          result: 'Peserta aktif · PPU kelas 1',
          apply: (r, _v, c) => {
            r.penjamin = 'BPJS PPU kelas 1 · aktif';
            c.log('Peserta aktif, PPU kelas 1', 'BPJS VClaim');
          },
        },
        {
          id: 'alok',
          kind: 'choice',
          label: 'Alokasikan tempat tidur',
          options: (r) => BEDS[r.dispo ?? 'icu'] ?? BEDS.icu ?? [],
          dur: (v) => (/5|4|09/.test(String(v)) ? 30 : 2),
          apply: (r, v, c) => {
            r.bed = String(v);
            c.log(`Tempat tidur ${String(v)} dipesan`, 'ADT · papan bed');
          },
        },
        {
          id: 'sep',
          kind: 'act',
          label: 'Terbitkan SPRI dan SEP rawat inap',
          btn: 'Terbitkan SEP',
          dur: 3,
          result: 'SEP 0301R0011026V004988',
          apply: (r, _v, c) => {
            r.sep = '0301R0011026V004988';
            c.log('SEP rawat inap terbit', 'BPJS VClaim · insert SEP');
            c.log('Kunjungan berubah menjadi rawat inap', 'SATUSEHAT · Encounter');
          },
        },
        {
          id: 'transfer',
          kind: 'act',
          label: 'Transfer pasien dan serah terima SBAR',
          btn: 'Serah terima',
          dur: 15,
          result: 'Pasien tiba di ruang rawat',
          apply: (r, _v, c) => {
            r.lokasi = r.bed ?? r.lokasi;
            c.charge('Pelayanan IGD (dokter, perawat, tindakan)', 420_000n);
            c.log(`Serah terima SBAR IGD → ${r.bed ?? ''}`);
          },
        },
      ],
    },
    {
      id: 'rawat-inap',
      stage: 'Rawat inap',
      actor: 'PPA ruangan',
      role: 'perawat',
      screen: 'ranap',
      title: 'Perawatan hari ke-1 sampai ke-4',
      desc: 'Setiap pemberian obat lewat pindai gelang. CPPT ditulis semua PPA dan di-co-sign DPJP. Gunakan tombol untuk melompat antarhari.',
      wait: 20,
      tasks: [
        {
          id: 'emar',
          kind: 'act',
          label: 'Pindai gelang dan berikan obat jadwal pertama',
          btn: 'Pindai gelang',
          dur: 10,
          result: 'Identitas cocok, obat tercatat di eMAR',
          apply: (_r, _v, c) =>
            c.log('Identitas cocok, obat jadwal pertama diberikan', 'eMAR · pindai gelang'),
        },
        {
          id: 'h1',
          kind: 'act',
          label: 'Hari 1: kalium turun ke 5,1, nyeri dada hilang',
          btn: 'Lompat ke hari 1 pagi',
          dur: 600,
          result: 'CPPT dokter dan perawat, co-sign DPJP',
          apply: (r, _v, c) => {
            r.hasil.push('Kalium ulang 5,1 mmol/L');
            c.log('CPPT hari 1, co-sign DPJP');
          },
        },
        {
          id: 'echo',
          kind: 'act',
          label: 'Hari 2: ekokardiografi, rawat bersama Sp.JP',
          btn: 'Lompat ke hari 2',
          dur: 1500,
          result: 'EF 48%, hipokinetik anterior',
          apply: (r, _v, c) => {
            r.hasil.push('Ekokardiografi: EF 48%, hipokinetik anterior');
            r.tindakan.push('88.72 · Ekokardiografi');
            c.charge('Ekokardiografi', 450_000n);
            c.log('Hasil ekokardiografi masuk RME', 'SATUSEHAT · Procedure');
          },
        },
        {
          id: 'pindah',
          kind: 'act',
          when: (r) => r.dispo !== 'bangsal',
          label: 'Hari 3: pindah ke bangsal kelas 1 (step-down)',
          btn: 'Lompat ke hari 3',
          dur: 1440,
          result: 'Pindah ke Anggrek A-12',
          apply: (r, _v, c) => {
            r.lokasi = 'Anggrek A-12 · kelas 1';
            c.log('Transfer intra-RS ke Anggrek A-12', 'ADT · papan bed');
          },
        },
        {
          id: 'akhir',
          kind: 'act',
          label: 'Hari 4: stabil, rencana pulang besok',
          btn: 'Lompat ke hari 4',
          dur: 1440,
          result: 'Rencana pulang dan edukasi dimulai',
          apply: (r, _v, c) => {
            const d = r.dispo ?? 'icu';
            if (d === 'icu') {
              c.charge('Akomodasi ICU · 2 hari', 3_000_000n);
              c.charge('Akomodasi kelas 1 · 3 hari', 1_350_000n);
            } else if (d === 'hcu') {
              c.charge('Akomodasi HCU · 2 hari', 2_000_000n);
              c.charge('Akomodasi kelas 1 · 3 hari', 1_350_000n);
            } else {
              c.charge('Akomodasi kelas 1 · 5 hari', 2_250_000n);
            }
            c.charge('Visite dan konsultasi dokter', 1_320_000n);
            c.charge('Obat dan alkes rawat inap', 2_140_000n);
            c.charge('Laboratorium harian', 640_000n);
            c.log('Rencana pulang disusun');
          },
        },
      ],
    },
    {
      id: 'resume',
      stage: 'Resume & pulang',
      actor: 'DPJP jantung',
      role: 'dokter',
      screen: 'resume',
      title: 'Resume medis dan rekonsiliasi obat',
      desc: 'Resume dihimpun otomatis dari CPPT, hasil, dan eMAR. Dokter memverifikasi, bukan mengetik ulang.',
      wait: 1200,
      tasks: [
        {
          id: 'resume',
          kind: 'act',
          label: 'Tarik ringkasan otomatis ke resume',
          btn: 'Himpun resume',
          dur: 3,
          result: 'Diagnosis, tindakan, hasil, dan terapi terisi',
          apply: (r, _v, c) => {
            r.dx = ['I21.4 · NSTEMI', 'E87.5 · Hiperkalemia', 'N18.3 · CKD stadium 3', 'I10 · Hipertensi'];
            c.log('Draf resume terisi otomatis');
          },
        },
        {
          id: 'rekon',
          kind: 'choice',
          label: 'Rekonsiliasi obat pulang',
          options: [
            {
              id: 'lanjut',
              label: 'Lanjutkan amlodipin',
              sub: 'aspirin, klopidogrel, atorvastatin, bisoprolol, PPI, amlodipin',
            },
            { id: 'stop', label: 'Hentikan amlodipin', sub: 'TD terkontrol dengan bisoprolol' },
          ],
          dur: 5,
          apply: (r, v, c) => {
            r.obat = [
              'Aspirin 80 mg 1×1',
              'Klopidogrel 75 mg 1×1',
              'Atorvastatin 40 mg 1×1 malam',
              'Bisoprolol 2,5 mg 1×1',
              r.ppi ?? 'Pantoprazol 40 mg 1×1',
            ];
            if (v === 'lanjut') r.obat.push('Amlodipin 10 mg 1×1');
            c.log('Rekonsiliasi obat pulang dikonfirmasi DPJP');
          },
        },
        {
          id: 'tte',
          kind: 'act',
          label: 'Tanda tangani resume dan surat kontrol',
          btn: 'Tanda tangani (TTE)',
          dur: 2,
          result: 'Resume final · kontrol Poli Jantung Kamis 15 Okt',
          apply: (r, _v, c) => {
            r.kontrol = 'Poli Jantung · Kamis 15 Okt 2026';
            c.log('Resume medis final', 'SATUSEHAT · Composition');
            c.log('Surat kontrol terbit', 'BPJS VClaim · surat kontrol');
          },
        },
      ],
    },
    {
      id: 'kasir',
      stage: 'Kasir',
      actor: 'Kasir rawat inap',
      role: 'kasir',
      screen: 'kasir',
      title: 'Tagihan rawat inap',
      desc: 'Semua tarif sejak dari IGD sudah tertangkap otomatis dari order, eMAR, lab, dan ADT.',
      wait: 30,
      tasks: [
        {
          id: 'final',
          kind: 'act',
          label: 'Finalkan tagihan rawat inap',
          btn: 'Finalkan',
          dur: 3,
          result: 'Tagihan terkunci',
          apply: (_r, _v, c) => c.log('Tagihan rawat inap difinalkan'),
        },
        {
          id: 'pulang',
          kind: 'act',
          label: 'Ditanggung BPJS sesuai hak kelas 1; pasien bayar Rp 0, lalu pulang',
          btn: 'Pasien pulang',
          dur: 10,
          result: 'Pasien pulang, bed berstatus kotor',
          apply: (r, _v, c) => {
            r.bayarPasien = 0n;
            r.pulangAt = c.now;
            c.log(`Pasien pulang, bed ${r.lokasi.split(' ·')[0] ?? r.lokasi} → kotor`, 'ADT · papan bed');
            r.lokasi = 'Pulang';
            c.log('Kunjungan selesai', 'SATUSEHAT · Encounter finished');
          },
        },
      ],
    },
    {
      id: 'klaim',
      stage: 'Koding & klaim',
      actor: 'Koder casemix',
      role: 'koder',
      screen: 'klaim',
      title: 'Koding dan kirim klaim',
      desc: 'Koder memvalidasi kode yang sudah ditarik dari resume. Bukti klinis dicek sebelum kirim.',
      wait: 1440,
      tasks: [
        {
          id: 'utama',
          kind: 'choice',
          label: 'Validasi diagnosis utama',
          def: 'I21.4',
          options: [
            { id: 'I21.4', label: 'I21.4 · NSTEMI', sub: 'didukung troponin naik + EKG iskemik' },
            { id: 'I20.0', label: 'I20.0 · Angina tidak stabil', sub: 'tidak sesuai hasil troponin' },
          ],
          dur: 10,
          apply: (r, v, c) => {
            r.dxUtama = String(v);
            c.log(`Diagnosis utama divalidasi: ${String(v)}`);
          },
        },
        {
          id: 'bukti',
          kind: 'choice',
          tone: 'warn',
          when: (_r, done) => done('utama') === 'I20.0',
          label: 'Kode tidak sesuai bukti: troponin meningkat',
          hint: 'Sistem menandai ketidaksesuaian antara kode dan hasil lab.',
          options: [
            { id: 'kembali', label: 'Kembali ke I21.4', sub: 'sesuai bukti klinis' },
            { id: 'query', label: 'Kirim query ke DPJP', sub: 'klaim ditahan sampai dijawab' },
          ],
          def: 'kembali',
          dur: 2,
          apply: (r, v, c) => {
            r.dxUtama = 'I21.4';
            c.log(
              v === 'kembali' ? 'Kode dikoreksi ke I21.4' : 'Query dijawab DPJP: I21.4',
              'Keselamatan · koding',
            );
          },
        },
        {
          id: 'sekunder',
          kind: 'act',
          label: 'Validasi diagnosis sekunder dan prosedur',
          btn: 'Validasi',
          dur: 8,
          result: 'E87.5, N18.3, I10 · 89.52, 88.72',
          apply: (_r, _v, c) => c.log('Diagnosis sekunder dan prosedur divalidasi'),
        },
        {
          id: 'kirim',
          kind: 'act',
          label: 'Grouping dan kirim E-Klaim',
          btn: 'Kirim klaim',
          dur: 3,
          result: 'Terkirim ke verifikator BPJS',
          apply: (r, _v, c) => {
            r.klaim = `Terkirim · ${r.dxUtama ?? 'I21.4'} + E87.5, N18.3, I10`;
            c.log('Klaim terkirim ke verifikator', 'E-Klaim');
          },
        },
      ],
    },
  ],
};
