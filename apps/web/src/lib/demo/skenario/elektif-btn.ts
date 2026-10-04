import { STAF } from '../fixtures/staf';
import type { ScenarioDef } from '../engine/types';
import { emptyRecord } from './base';

/** Nama produk cicilan BTN belum ditetapkan (placeholder mockup); tampil jelas sebagai simulasi. */
const PRODUK_CICILAN = 'Pembiayaan kesehatan BTN (simulasi)';

/**
 * Skenario 3 · Bedah elektif dengan TPDI × BTN (port `btn` di `design/mockups/Simulasi.dc.html`). Dana pasien
 * langsung ke rekening RS di BTN, tidak transit di TPDI (ADR-0005). Semua angka, nomor rekening, dan VA fiktif.
 */
export const ELEKTIF_BTN: ScenarioDef = {
  id: 'elektif-btn',
  label: 'Elektif · TPDI × BTN',
  startDate: '2026-10-12',
  startMin: 7 * 60 + 30,
  showDay: true,
  base: emptyRecord({
    nama: 'Ny. Ratna Sari',
    initials: 'RS',
    jk: 'P',
    umur: 45,
    rm: '00-52-03-19',
    alergi: 'Tidak ada',
    riwayat: 'Kolelitiasis simptomatik · rencana laparoskopi elektif',
    penjamin: 'BPJS · belum diverifikasi',
    lokasi: 'Admisi rawat inap',
  }),
  auto: [
    'Tagihan deposit dibuat lewat API TPDI; dana langsung masuk rekening RS di BTN, tidak transit di TPDI',
    'Webhook TPDI melunasi deposit di kasir secara otomatis; callback ganda diabaikan',
    'Tarif operasi, BHP, dan akomodasi VIP tertangkap otomatis dari OK dan ADT',
    'Sisa selisih dibiayai BTN: RS menerima pelunasan penuh, pasien mengangsur ke BTN',
    'Rekonsiliasi 3 arah kasir ↔ TPDI ↔ mutasi BTN tanpa pencocokan manual',
    'Klaim layak bayar langsung bisa dibiayai BTN dan dilunasi otomatis saat BPJS membayar',
  ],
  extra: (r) => [
    {
      label: 'Diterima via TPDI × BTN',
      value: r.deposit + r.lunasQris,
      note: 'VA/QRIS, langsung ke ••••4417',
    },
    {
      label: 'Cicilan dibiayai BTN',
      value: r.dibiayai,
      note: r.dibiayai ? 'RS lunas, pasien mengangsur ke BTN' : 'tidak dipakai',
    },
    {
      label: 'Piutang BPJS dibiayai',
      value: r.piutangBiaya,
      note: r.piutangBiaya ? 'cair sebelum BPJS membayar' : 'tidak dipakai',
    },
  ],
  steps: [
    {
      id: 'admisi',
      stage: 'Admisi elektif',
      actor: 'Admisi rawat inap',
      role: 'petugas_pendaftaran',
      screen: 'bed',
      title: 'Admisi bedah elektif dan pilihan kelas',
      desc: 'Pasien datang sehari sebelum operasi. Hak kelas dicek ke VClaim; bila pasien minta naik kelas, estimasi selisih biaya disetujui tertulis sebelum dirawat.',
      wait: 0,
      tasks: [
        {
          id: 'cek',
          kind: 'act',
          label: 'Cek kepesertaan BPJS',
          btn: 'Cek ke VClaim',
          dur: 2,
          result: 'Aktif · PPU kelas 2',
          apply: (r, _v, c) => {
            r.penjamin = 'BPJS PPU kelas 2 · aktif';
            c.log('Peserta aktif, hak kelas 2', 'BPJS VClaim');
          },
        },
        {
          id: 'kelas',
          kind: 'choice',
          label: 'Kelas perawatan yang diminta pasien',
          def: 'vip',
          options: [
            { id: 'vip', label: 'Naik kelas VIP', sub: 'selisih biaya dibayar pasien' },
            { id: 'hak', label: 'Sesuai hak kelas 2', sub: 'ditanggung BPJS' },
          ],
          dur: 2,
          apply: (r, v, c) => {
            r.vip = v === 'vip';
            c.log(r.vip ? 'Pasien meminta naik kelas VIP' : 'Dirawat sesuai hak kelas 2');
          },
        },
        {
          id: 'setuju',
          kind: 'act',
          when: (r) => !!r.vip,
          label: 'Persetujuan selisih biaya naik kelas',
          hint: 'Estimasi selisih Rp 9.400.000 (angka simulasi, dihitung dari master aturan selisih JKN).',
          btn: 'Tanda tangani persetujuan',
          dur: 4,
          result: 'Ditandatangani pasien dan petugas (TTE)',
          apply: (_r, _v, c) => c.log('Persetujuan selisih biaya naik kelas final', 'RME · consent'),
        },
        {
          id: 'sep',
          kind: 'act',
          label: 'Terbitkan SPRI dan SEP rawat inap',
          btn: 'Terbitkan SEP',
          dur: 3,
          result: 'SEP 0301R0011026V005377',
          apply: (r, _v, c) => {
            r.sep = '0301R0011026V005377';
            r.lokasi = r.vip ? 'Paviliun VIP 3' : 'Melati M-210 · kelas 2';
            c.charge('Administrasi rawat inap', 75_000n);
            c.log('SEP rawat inap terbit', 'BPJS VClaim · insert SEP');
            c.log('Kunjungan rawat inap dibuat', 'SATUSEHAT · Encounter');
          },
        },
      ],
    },
    {
      id: 'deposit',
      stage: 'Deposit via TPDI',
      actor: 'Kasir rawat inap',
      role: 'kasir',
      screen: 'pembayaran',
      title: 'Deposit naik kelas lewat kanal BTN',
      desc: 'Kasir membuat tagihan lewat API TPDI. Pasien membayar ke VA atau QRIS BTN, dana langsung masuk rekening operasional RS di BTN, dan TPDI mengirim notifikasi ke SIM RS.',
      wait: 8,
      tasks: [
        {
          id: 'kanal',
          kind: 'choice',
          when: (r) => !!r.vip,
          label: 'Kanal pembayaran deposit',
          options: [
            { id: 'va', label: 'Virtual Account BTN', sub: 'berlaku 24 jam, bisa dari bank mana pun' },
            { id: 'qris', label: 'QRIS dinamis', sub: 'acquirer BTN, berlaku 10 menit' },
          ],
          dur: 1,
          apply: (r, v, c) => {
            r.kanal = String(v);
            c.log(`Kanal deposit: ${c.opt}`);
          },
        },
        {
          id: 'buat',
          kind: 'act',
          when: (r) => !!r.vip,
          label: 'Buat tagihan deposit Rp 3.000.000 lewat API TPDI',
          btn: 'Buat tagihan',
          dur: 1,
          result: 'Tagihan INV-DP-2610-0412 dikirim ke WhatsApp dan aplikasi pasien',
          apply: (r, _v, c) => {
            r.bayar.push(
              `Deposit Rp 3.000.000 · ${r.kanal === 'qris' ? 'QRIS' : 'VA 8808 0127 0005 2031'} · menunggu`,
            );
            c.log(
              r.kanal === 'qris' ? 'QRIS dinamis dibuat' : 'VA BTN 8808 0127 0005 2031 dibuat',
              'TPDI · buat tagihan',
            );
          },
        },
        {
          id: 'bayar',
          kind: 'act',
          when: (r) => !!r.vip,
          label: 'Pasien membayar dari m-banking',
          btn: 'Simulasikan pembayaran',
          dur: 18,
          result: 'Dana Rp 3.000.000 masuk rekening operasional RS BTN ••••4417',
          apply: (_r, _v, c) => c.log('Kredit Rp 3.000.000 ke rekening RS ••••4417', 'BTN · kredit rekening'),
        },
        {
          id: 'webhook',
          kind: 'act',
          when: (r) => !!r.vip,
          label: 'Terima webhook TPDI',
          hint: 'Signature HMAC diverifikasi sebelum status diubah.',
          btn: 'Proses webhook',
          dur: 1,
          result: 'Signature valid · deposit lunas di kasir',
          apply: (r, _v, c) => {
            r.deposit = 3_000_000n;
            r.bayar[r.bayar.length - 1] =
              `Deposit Rp 3.000.000 · ${r.kanal === 'qris' ? 'QRIS' : 'VA BTN'} · lunas`;
            c.log('Webhook pembayaran diterima, deposit lunas', 'TPDI · webhook');
          },
        },
        {
          id: 'dupe',
          kind: 'act',
          tone: 'warn',
          when: (r) => !!r.vip,
          label: 'Webhook yang sama datang lagi (retry dari TPDI)',
          hint: 'Tanpa idempotensi, deposit bisa tercatat dua kali.',
          btn: 'Proses webhook kedua',
          dur: 1,
          result: 'Diabaikan: idempotency key sudah tercatat, saldo deposit tetap Rp 3.000.000',
          apply: (_r, _v, c) => c.log('Callback ganda diabaikan (idempotent)', 'Keselamatan · idempotensi'),
        },
        {
          id: 'none',
          kind: 'act',
          when: (r) => !r.vip,
          label: 'Deposit tidak diperlukan',
          hint: 'Seluruh perawatan kelas 2 ditanggung BPJS.',
          btn: 'Lanjutkan',
          dur: 1,
          result: 'Tanpa deposit',
          apply: (_r, _v, c) => c.log('Tanpa deposit, sesuai hak kelas'),
        },
      ],
    },
    {
      id: 'operasi',
      stage: 'Operasi',
      actor: 'Tim bedah IBS',
      role: 'dokter',
      screen: 'ok',
      title: 'Laparoskopi kolesistektomi',
      desc: `Operator ${STAF.dpjpBedah}. Daftar tilik keselamatan WHO wajib lengkap. Pemakaian BHP dan alat dicatat sekali dan langsung menjadi tagihan.`,
      wait: 1350,
      tasks: [
        {
          id: 'tilik',
          kind: 'act',
          label: 'Sign in, time out, sign out lengkap',
          btn: 'Konfirmasi daftar tilik',
          dur: 12,
          result: 'Tiga fase lengkap, hitung kasa cocok',
          apply: (_r, _v, c) => c.log('Surgical safety checklist lengkap', 'Keselamatan · checklist'),
        },
        {
          id: 'op',
          kind: 'act',
          label: 'Operasi berjalan',
          btn: 'Catat operasi selesai',
          dur: 95,
          result: 'Kolesistektomi laparoskopik tanpa penyulit',
          apply: (r, _v, c) => {
            r.tindakan.push('51.23 · Kolesistektomi laparoskopik');
            c.charge('Jasa operator dan anestesi', 6_500_000n);
            c.charge('Sewa kamar operasi', 2_200_000n);
            c.charge('BHP dan alat laparoskopi', 3_100_000n);
            c.log('Laporan operasi dan anestesi tersimpan', 'SATUSEHAT · Procedure');
          },
        },
        {
          id: 'pulih',
          kind: 'act',
          label: 'Ruang pulih, lalu kembali ke kamar',
          btn: 'Pindahkan ke kamar',
          dur: 90,
          result: 'Aldrete 10, kembali ke kamar',
          apply: (r, _v, c) => c.log(`Serah terima dari ruang pulih ke ${r.lokasi}`),
        },
      ],
    },
    {
      id: 'pasca-operasi',
      stage: 'Pasca operasi',
      actor: 'PPA ruangan',
      role: 'perawat',
      screen: 'ranap',
      title: 'Perawatan pasca operasi',
      desc: 'Obat diberikan lewat pindai gelang, CPPT ditulis semua PPA. Lompat hari dengan tombol.',
      wait: 20,
      tasks: [
        {
          id: 'emar',
          kind: 'act',
          label: 'Analgesik dan antibiotik lewat pindai gelang',
          btn: 'Pindai gelang',
          dur: 10,
          result: 'Tercatat di eMAR',
          apply: (_r, _v, c) => c.log('Obat pasca operasi diberikan', 'eMAR · pindai gelang'),
        },
        {
          id: 'h2',
          kind: 'act',
          label: 'Hari berikutnya: mobilisasi, diet lunak, nyeri terkontrol',
          btn: 'Lompat ke esok hari',
          dur: 1320,
          result: 'Layak pulang besok pagi',
          apply: (r, _v, c) => {
            c.charge(
              r.vip ? 'Akomodasi VIP · 2 malam' : 'Akomodasi kelas 2 · 2 malam',
              r.vip ? 3_600_000n : 700_000n,
            );
            c.charge('Visite dokter', 900_000n);
            c.charge('Obat dan alkes', 1_150_000n);
            c.charge('Laboratorium', 380_000n);
            c.log('CPPT pasca operasi, co-sign DPJP');
          },
        },
      ],
    },
    {
      id: 'resume',
      stage: 'Resume & pulang',
      actor: 'DPJP bedah',
      role: 'dokter',
      screen: 'resume',
      title: 'Resume medis pulang',
      desc: 'Resume dihimpun dari laporan operasi, CPPT, dan eMAR.',
      wait: 60,
      tasks: [
        {
          id: 'resume',
          kind: 'act',
          label: 'Himpun resume dan rekonsiliasi obat',
          btn: 'Himpun resume',
          dur: 4,
          result: 'K80.2 · 51.23 · obat pulang: parasetamol, sefiksim',
          apply: (r, _v, c) => {
            r.dx = ['K80.2 · Batu kandung empedu tanpa kolesistitis'];
            r.obat = ['Parasetamol 500 mg 3×1 · 5 hari', 'Sefiksim 100 mg 2×1 · 3 hari'];
            c.log('Draf resume terisi otomatis');
          },
        },
        {
          id: 'tte',
          kind: 'act',
          label: 'Tanda tangani resume dan surat kontrol',
          btn: 'Tanda tangani (TTE)',
          dur: 2,
          result: 'Kontrol Poli Bedah · Kamis 22 Okt 2026',
          apply: (r, _v, c) => {
            r.kontrol = 'Poli Bedah · Kamis 22 Okt 2026';
            c.log('Resume medis final', 'SATUSEHAT · Composition');
            c.log('Surat kontrol terbit', 'BPJS VClaim · surat kontrol');
          },
        },
      ],
    },
    {
      id: 'kasir',
      stage: 'Kasir & cicilan',
      actor: 'Kasir rawat inap',
      role: 'kasir',
      screen: 'kasir',
      title: 'Pelunasan selisih naik kelas',
      desc: 'Selisih dikurangi deposit. Sisanya bisa dilunasi langsung atau dibiayai BTN; untuk RS hasilnya sama: tagihan lunas penuh hari ini.',
      wait: 20,
      tasks: [
        {
          id: 'final',
          kind: 'act',
          label: 'Finalkan tagihan dan hitung selisih',
          btn: 'Finalkan',
          dur: 3,
          result: (r) =>
            r.vip
              ? 'Selisih Rp 9.400.000 − deposit Rp 3.000.000 = sisa Rp 6.400.000'
              : 'Ditanggung BPJS sesuai hak kelas 2',
          apply: (r, _v, c) => {
            r.selisih = r.vip ? 9_400_000n : 0n;
            c.log('Tagihan difinalkan');
          },
        },
        {
          id: 'cara',
          kind: 'choice',
          when: (r) => !!r.vip,
          label: 'Pelunasan sisa Rp 6.400.000',
          def: 'cicil',
          options: [
            { id: 'cicil', label: 'Cicilan BTN', sub: PRODUK_CICILAN },
            { id: 'qris', label: 'Bayar lunas via QRIS', sub: 'TPDI · acquirer BTN' },
          ],
          dur: 2,
          apply: (r, v, c) => {
            r.cara = String(v);
            c.log(v === 'cicil' ? 'Pasien memilih cicilan BTN' : 'Pasien memilih lunas via QRIS');
          },
        },
        {
          id: 'tenor',
          kind: 'choice',
          when: (r) => !!r.vip && r.cara === 'cicil',
          label: 'Tenor cicilan',
          def: '6',
          options: [
            { id: '3', label: '3 bulan', sub: '±Rp 2.192.000/bulan (simulasi)' },
            { id: '6', label: '6 bulan', sub: '±Rp 1.125.000/bulan (simulasi)' },
            { id: '12', label: '12 bulan', sub: '±Rp 592.000/bulan (simulasi)' },
          ],
          dur: 1,
          apply: (r, v) => {
            r.tenor = String(v);
          },
        },
        {
          id: 'ajukan',
          kind: 'act',
          when: (r) => !!r.vip && r.cara === 'cicil',
          label: 'Ajukan ke BTN',
          hint: 'Data identitas dan kontak diambil dari profil pasien; pasien mengisi penghasilan di aplikasi.',
          btn: 'Ajukan pembiayaan',
          dur: 3,
          result: 'Pengajuan PB-2610-0088 terkirim',
          apply: (r, _v, c) =>
            c.log(`Pengajuan cicilan Rp 6.400.000, tenor ${r.tenor ?? ''} bulan`, 'BTN · pembiayaan'),
        },
        {
          id: 'setuju',
          kind: 'act',
          when: (r) => !!r.vip && r.cara === 'cicil',
          label: 'BTN menyetujui, pasien menandatangani akad digital',
          btn: 'Simulasikan persetujuan',
          dur: 35,
          result: 'Disetujui · akad ditandatangani (TTE)',
          apply: (_r, _v, c) =>
            c.log('Pembiayaan disetujui, akad digital ditandatangani', 'BTN · pembiayaan'),
        },
        {
          id: 'cair',
          kind: 'act',
          when: (r) => !!r.vip && r.cara === 'cicil',
          label: 'BTN mencairkan Rp 6.400.000 ke rekening RS',
          btn: 'Simulasikan pencairan',
          dur: 5,
          result: 'Tagihan RS lunas · angsuran pasien ke BTN',
          apply: (r, _v, c) => {
            r.dibiayai = 6_400_000n;
            r.bayarPasien = r.selisih;
            r.bayar.push(`Sisa Rp 6.400.000 · dibiayai BTN, tenor ${r.tenor ?? ''} bulan · lunas di RS`);
            r.biaya.push(`Cicilan pasien Rp 6.400.000 · tenor ${r.tenor ?? ''} bulan`);
            c.log('Kredit Rp 6.400.000 ke rekening RS ••••4417, tagihan lunas', 'BTN · kredit rekening');
          },
        },
        {
          id: 'qrisbayar',
          kind: 'act',
          when: (r) => !!r.vip && r.cara === 'qris',
          label: 'Buat QRIS Rp 6.400.000 dan terima pembayaran',
          btn: 'Simulasikan pembayaran',
          dur: 4,
          result: 'Webhook TPDI diterima, tagihan lunas',
          apply: (r, _v, c) => {
            r.lunasQris = 6_400_000n;
            r.bayarPasien = r.selisih;
            r.bayar.push('Sisa Rp 6.400.000 · QRIS · lunas');
            c.log('Kredit Rp 6.400.000 ke rekening RS ••••4417', 'BTN · kredit rekening');
            c.log('Webhook pembayaran diterima', 'TPDI · webhook');
          },
        },
        {
          id: 'pulang',
          kind: 'act',
          label: 'Pasien pulang',
          btn: 'Pulangkan pasien',
          dur: 10,
          result: 'Bed berstatus kotor, kunjungan selesai',
          apply: (r, _v, c) => {
            if (!r.vip) r.bayarPasien = 0n;
            r.pulangAt = c.now;
            c.log(`Pasien pulang, bed ${r.lokasi} → kotor`, 'ADT · papan bed');
            r.lokasi = 'Pulang';
            c.log('Kunjungan selesai', 'SATUSEHAT · Encounter finished');
          },
        },
      ],
    },
    {
      id: 'rekonsiliasi',
      stage: 'Rekonsiliasi',
      actor: 'Staf keuangan',
      role: 'akuntan',
      screen: 'pembayaran',
      title: 'Rekonsiliasi 3 arah keesokan pagi',
      desc: 'Transaksi kasir, laporan TPDI, dan mutasi rekening BTN dicocokkan otomatis. Hanya selisih yang perlu disentuh manusia.',
      wait: 1320,
      tasks: [
        {
          id: 'tarik',
          kind: 'act',
          label: 'Tarik laporan TPDI dan mutasi BTN (H2H)',
          btn: 'Tarik data',
          dur: 2,
          result: 'Laporan TPDI dan mutasi ••••4417 tersinkron',
          apply: (_r, _v, c) => {
            c.log('Laporan transaksi harian ditarik', 'TPDI · laporan');
            c.log('Mutasi rekening ••••4417 ditarik', 'BTN · mutasi H2H');
          },
        },
        {
          id: 'cocok',
          kind: 'act',
          label: 'Jalankan rekonsiliasi kasir ↔ TPDI ↔ BTN',
          btn: 'Rekonsiliasi',
          dur: 1,
          result: (r) => {
            const n = (r.deposit ? 1 : 0) + (r.dibiayai || r.lunasQris ? 1 : 0);
            return n
              ? `${n} transaksi pasien cocok di tiga sumber, 0 selisih`
              : 'Tidak ada transaksi pasien untuk dicocokkan';
          },
          apply: (_r, _v, c) => c.log('Rekonsiliasi 3 arah selesai tanpa selisih'),
        },
        {
          id: 'jurnal',
          kind: 'act',
          label: 'Posting jurnal otomatis',
          btn: 'Posting',
          dur: 1,
          result: 'Bank BTN ••••4417 (D) · uang muka dan piutang pasien (K)',
          apply: (_r, _v, c) => c.log('Jurnal penerimaan terposting', 'Akuntansi · jurnal'),
        },
      ],
    },
    {
      id: 'klaim',
      stage: 'Klaim BPJS',
      actor: 'Koder casemix',
      role: 'koder',
      screen: 'klaim',
      title: 'Koding dan verifikasi klaim',
      desc: 'Kode ditarik dari resume dan laporan operasi. Setelah verifikator menyatakan layak bayar, klaim bisa dibiayai BTN.',
      wait: 240,
      tasks: [
        {
          id: 'kode',
          kind: 'act',
          label: 'Validasi kode K80.2 dan 51.23',
          btn: 'Validasi',
          dur: 8,
          result: 'Kode sesuai bukti',
          apply: (_r, _v, c) => c.log('Kode diagnosis dan prosedur divalidasi'),
        },
        {
          id: 'kirim',
          kind: 'act',
          label: 'Grouping dan kirim E-Klaim',
          btn: 'Kirim klaim',
          dur: 3,
          result: 'Terkirim ke verifikator BPJS',
          apply: (r, _v, c) => {
            r.klaim = 'Terkirim · tarif INA-CBG kelas 2 Rp 7.140.000 (simulasi)';
            c.log('Klaim terkirim ke verifikator', 'E-Klaim');
          },
        },
        {
          id: 'layak',
          kind: 'act',
          label: 'Verifikator menyatakan layak bayar',
          btn: 'Lompat ke hasil verifikasi',
          dur: 14 * 1440,
          result: 'Layak bayar Rp 7.140.000',
          apply: (r, _v, c) => {
            r.klaim = 'Layak bayar · Rp 7.140.000 (simulasi)';
            c.log('Klaim berstatus layak bayar', 'BPJS · verifikasi klaim');
          },
        },
      ],
    },
    {
      id: 'pembiayaan',
      stage: 'Pembiayaan piutang',
      actor: 'Kepala akuntansi',
      role: 'akuntan',
      screen: 'pembiayaan',
      title: 'Piutang BPJS dibiayai BTN',
      desc: 'Klaim layak bayar masuk pool fasilitas BTN. RS bisa mencairkan dana lebih awal; saat BPJS membayar ke rekening penampungan, pelunasan berjalan otomatis.',
      wait: 60,
      tasks: [
        {
          id: 'pool',
          kind: 'act',
          label: 'Masukkan klaim ke pool pembiayaan BTN',
          btn: 'Masukkan ke pool',
          dur: 1,
          result: 'Eligible · advance rate 90% (parameter perjanjian)',
          apply: (_r, _v, c) => c.log('Klaim masuk pool pembiayaan piutang', 'BTN · pembiayaan'),
        },
        {
          id: 'ajukan',
          kind: 'choice',
          label: 'Cairkan lebih awal?',
          def: 'ya',
          options: [
            { id: 'ya', label: 'Ajukan 90% · Rp 6.426.000', sub: 'margin simulasi 8% p.a.' },
            { id: 'tidak', label: 'Tunggu BPJS membayar', sub: 'tanpa biaya pembiayaan' },
          ],
          dur: 2,
          apply: (r, v, c) => {
            r.ajukan = v === 'ya';
            c.log(r.ajukan ? 'Pencairan Rp 6.426.000 diajukan' : 'Tidak diajukan pencairan');
          },
        },
        {
          id: 'cair',
          kind: 'act',
          when: (r) => !!r.ajukan,
          label: 'BTN mencairkan ke rekening operasional ••••4417',
          btn: 'Simulasikan pencairan',
          dur: 120,
          result: 'Dana Rp 6.426.000 diterima RS',
          apply: (r, _v, c) => {
            r.piutangBiaya = 6_426_000n;
            r.biaya.push('Piutang klaim Rp 6.426.000 · cair lebih awal');
            c.log('Kredit Rp 6.426.000 ke rekening RS ••••4417', 'BTN · kredit rekening');
          },
        },
        {
          id: 'bpjs',
          kind: 'act',
          label: 'BPJS membayar klaim ke rekening penampungan ••••9021',
          btn: 'Lompat ke pembayaran BPJS',
          dur: 21 * 1440,
          result: (r) =>
            r.ajukan
              ? 'Rp 7.140.000 masuk · pelunasan BTN Rp 6.455.600 (pokok + margin 21 hari) · sisa Rp 684.400 ke ••••4417'
              : 'Rp 7.140.000 masuk dan diteruskan penuh ke ••••4417',
          apply: (r, _v, c) => {
            c.log('BPJS membayar Rp 7.140.000 ke ••••9021', 'BPJS · pembayaran klaim');
            if (r.ajukan) {
              c.log('Auto-debit pelunasan pokok + margin Rp 6.455.600', 'BTN · pelunasan');
              c.log('Sisa Rp 684.400 diteruskan ke ••••4417', 'BTN · kredit rekening');
              r.biaya.push('Lunas otomatis saat BPJS membayar');
            } else {
              c.log('Rp 7.140.000 diteruskan ke ••••4417', 'BTN · kredit rekening');
            }
            r.klaim = 'Dibayar BPJS · Rp 7.140.000 (simulasi)';
          },
        },
      ],
    },
  ],
};
