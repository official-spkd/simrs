/**
 * Id opak fixture mode presentasi (ADR-0023; rencana fase 2 potongan 0c): UUID v7 konstan yang dibangkitkan sekali,
 * sehingga URL, payload Server Action, dan keadaan simulasi tidak memuat nama orang fiktif. Nama hanya ada di kunci
 * objek dan komentar untuk pembaca kode. Layar, tes, dan E2E mengambil id dari sini, bukan menulis literal (dijaga
 * `fixtures.test.ts`). Baris turunan (catatan CPPT, obat, peringatan CDS) memakai id induknya + akhiran.
 */

/** Pasien fiktif (`PASIEN`). */
export const PATIENT_ID = {
  /** Tn. Suryo Adi Nugroho (skenario rawat jalan) */
  suryo: '01a107db-b268-746d-92f7-10598bb1cc42',
  /** Tn. Hartono Wibisono (skenario IGD → rawat inap) */
  hartono: '01a107db-b650-7665-8612-3e74278ceafa',
  /** Ny. Ratna Sari (skenario elektif TPDI × BTN) */
  ratna: '01a107db-ba38-78da-8167-4cc2859b0f5e',
  /** Ny. Siti Rahmawati */
  siti: '01a107db-be20-7176-addf-d8b91c9b4737',
  /** Ny. Endang Wijaya */
  endang: '01a107db-c208-7498-9234-5378892b360e',
  /** Tn. Darmawan Putra */
  darmawan: '01a107db-c5f0-7bcb-9c4b-d200e2342e39',
  /** Ny. Lestiani Hapsari */
  lestiani: '01a107db-c9d8-7a40-a58c-1e2a69cbe66c',
  /** Tn. Yusuf Hidayat */
  yusuf: '01a107db-cdc0-7b4c-984d-17f3db36c31c',
  /** Tn. Rizky Ramadhan */
  rizky: '01a107db-d1a8-73a3-809e-e77de27e2794',
  /** Ny. Maria Ulfa */
  maria: '01a107db-d590-7e3f-977a-c94d264b5e5d',
  /** Ny. Wulan Sari Dewi */
  wulan: '01a107db-d978-767e-92c8-3fda5e1c1561',
  /** An. Raka Pratama */
  raka: '01a107db-dd60-7600-92f4-91ab461e2ef5',
  /** Tn. Sutan Batubara */
  sutan: '01a107db-e148-7268-b14d-c1950da233b8',
  /** Ny. Ayu Lestari */
  ayu: '01a107db-e530-737d-b098-e3e4f59f29d1',
  /** Tn. Hendro Gunawan */
  hendro: '01a107db-e918-7280-90b7-fa74f8206796',
  /** Ny. Siti Aminah */
  aminah: '01a107db-ed00-74f8-a779-e200fcd40acc',
  /** An. Nadia Putri */
  nadia: '01a107db-f0e8-7b6c-a164-7928c51ddcfd',
  /** Tn. Fajar Nugraha */
  fajar: '01a107db-f4d0-7b63-9ff0-6512c67e0871',
  /** Ny. Dewi Kurniasih */
  dewi: '01a107db-f8b8-73b1-b048-bb53038e59ae',
  /** Tn. Bonifasius Tarigan */
  bonifasius: '01a107db-fca0-7be5-a155-1d262c00434b',
  /** Ny. Sumarni Pakpahan */
  sumarni: '01a107dc-0088-7791-88a9-1a749fe8dfeb',
  /** Tn. Joko Susilo */
  joko: '01a107dc-0470-76c6-a458-a9bac9720cf5',
  /** Tn. Ahmad Fauzi */
  fauzi: '01a107dc-0858-7527-8fbf-38925c82bbd6',
  /** Tn. Robert Manurung */
  robert: '01a107dc-0c40-7422-be61-106b10762e5e',
  /** Tn. Gilang Mahendra */
  gilang: '01a107dc-1028-79c4-a8bb-40160571a72c',
  /** Ny. Sri Wahyuni */
  wahyuni: '01a107dc-1410-70d8-845b-dd996e797354',
  /** Ny. Rohana Siregar */
  rohana: '01a107dc-17f8-70e3-a8bf-103dd2c29091',
  /** Tn. Sugeng Riyadi */
  sugeng: '01a107dc-1be0-76d7-8491-73e2eedc4b30',
  /** Ny. Fransiska Lumbantobing */
  fransiska: '01a107dc-1fc8-7e7e-8bbf-5f87ab581aaf',
  /** Ny. Anisa Rahmadani */
  anisa: '01a107dc-23b0-796a-9fd5-a5cac155a617',
  /** Tn. Lukman Hakim */
  lukman: '01a107dc-2798-7c33-bdd6-619c8892d58b',
} as const;

/** Kunjungan aktif hari demo per pasien (rute `/klinis/order/…`, `/klinis/rawat-inap/…`, `?pasien=`). */
export const ENCOUNTER_ID = {
  /** Tn. Suryo Adi Nugroho (skenario rawat jalan) */
  suryo: '01a107dc-2b80-711a-aecd-95ff2da5b38c',
  /** Tn. Hartono Wibisono (skenario IGD → rawat inap) */
  hartono: '01a107dc-2f68-7009-b275-60e6cec1fc08',
  /** Ny. Ratna Sari (skenario elektif TPDI × BTN) */
  ratna: '01a107dc-3350-7ee0-a493-e79af17199b8',
  /** Ny. Siti Rahmawati */
  siti: '01a107dc-3738-74df-a523-852c515fcaa1',
  /** Ny. Endang Wijaya */
  endang: '01a107dc-3b20-7ec2-93da-b065f22c20c3',
  /** Tn. Darmawan Putra */
  darmawan: '01a107dc-3f08-7444-931b-b9aabe659a75',
  /** Ny. Lestiani Hapsari */
  lestiani: '01a107dc-42f0-72ac-81a5-661e04d7dc4b',
  /** Tn. Yusuf Hidayat */
  yusuf: '01a107dc-46d8-7c26-a25b-c00946d4a03e',
  /** Tn. Rizky Ramadhan */
  rizky: '01a107dc-4ac0-75c4-9188-bba303981dd8',
  /** Ny. Maria Ulfa */
  maria: '01a107dc-4ea8-72d4-96d0-73cfecee0dbe',
  /** Ny. Wulan Sari Dewi */
  wulan: '01a107dc-5290-70a5-ae6c-afd63ff7cd82',
  /** An. Raka Pratama */
  raka: '01a107dc-5678-7738-bd3d-9cfd3de4fc7e',
  /** Tn. Sutan Batubara */
  sutan: '01a107dc-5a60-7e1f-9007-dd3b3581fb67',
  /** Ny. Ayu Lestari */
  ayu: '01a107dc-5e48-758f-aa21-82754d3af598',
  /** Tn. Hendro Gunawan */
  hendro: '01a107dc-6230-7a8e-b74c-f5f0f1eb7eeb',
  /** Ny. Siti Aminah */
  aminah: '01a107dc-6618-799a-b99d-283fa693a186',
  /** An. Nadia Putri */
  nadia: '01a107dc-6a00-7561-b2eb-1b99b4d9fbb8',
  /** Tn. Fajar Nugraha */
  fajar: '01a107dc-6de8-7932-ab01-88e49268c31c',
  /** Ny. Dewi Kurniasih */
  dewi: '01a107dc-71d0-79de-a74e-9d120add6abc',
  /** Tn. Bonifasius Tarigan */
  bonifasius: '01a107dc-75b8-71c3-b86b-4879e82ea632',
  /** Ny. Sumarni Pakpahan */
  sumarni: '01a107dc-79a0-7acc-9b24-15d3d47764cd',
  /** Tn. Joko Susilo */
  joko: '01a107dc-7d88-724d-9299-299fd9a58eaa',
  /** Tn. Ahmad Fauzi */
  fauzi: '01a107dc-8170-7499-a62f-2242506eaccd',
  /** Tn. Robert Manurung */
  robert: '01a107dc-8558-7f2c-8998-2d7e32d8f820',
  /** Tn. Gilang Mahendra */
  gilang: '01a107dc-8940-78cc-b33f-7ffc93b83a64',
  /** Ny. Sri Wahyuni */
  wahyuni: '01a107dc-8d28-79eb-a84a-c0de67397162',
  /** Ny. Rohana Siregar */
  rohana: '01a107dc-9110-77b6-a292-90d5b43ed2dd',
  /** Tn. Sugeng Riyadi */
  sugeng: '01a107dc-94f8-7f2d-8030-2427cb79f624',
  /** Ny. Fransiska Lumbantobing */
  fransiska: '01a107dc-98e0-7b0c-b701-bed5702fede9',
  /** Ny. Anisa Rahmadani */
  anisa: '01a107dc-9cc8-7fe6-936c-a91af3d14a80',
  /** Tn. Lukman Hakim */
  lukman: '01a107dc-a0b0-7dda-b182-d32023c6d573',
} as const;

/** Dokumen persetujuan tindakan per pasien (rute `/tablet/persetujuan/…`). */
export const CONSENT_ID = {
  /** Tn. Suryo Adi Nugroho (skenario rawat jalan) */
  suryo: '01a107dc-a498-7142-a4aa-eb11c038870b',
  /** Tn. Hartono Wibisono (skenario IGD → rawat inap) */
  hartono: '01a107dc-a880-7400-9c25-ed9a3ec0f53a',
  /** Ny. Ratna Sari (skenario elektif TPDI × BTN) */
  ratna: '01a107dc-ac68-7632-9f0b-9eb65e1bb367',
  /** Ny. Siti Rahmawati */
  siti: '01a107dc-b050-7455-84be-382952e73b62',
  /** Ny. Endang Wijaya */
  endang: '01a107dc-b438-73d0-9037-07198286be96',
  /** Tn. Darmawan Putra */
  darmawan: '01a107dc-b820-7bd7-b7e7-5a1e20ee2797',
  /** Ny. Lestiani Hapsari */
  lestiani: '01a107dc-bc08-70d9-b0c0-c57e4d51175b',
  /** Tn. Yusuf Hidayat */
  yusuf: '01a107dc-bff0-731b-b453-2b03edb26a70',
  /** Tn. Rizky Ramadhan */
  rizky: '01a107dc-c3d8-7576-9c41-a499cfa22ebf',
  /** Ny. Maria Ulfa */
  maria: '01a107dc-c7c0-7f15-84a2-a0b84ec8d346',
  /** Ny. Wulan Sari Dewi */
  wulan: '01a107dc-cba8-765f-9bf5-667ffa55bdc4',
  /** An. Raka Pratama */
  raka: '01a107dc-cf90-7ba9-9663-bc01af834fd7',
  /** Tn. Sutan Batubara */
  sutan: '01a107dc-d378-78de-807b-c92775b7f924',
  /** Ny. Ayu Lestari */
  ayu: '01a107dc-d760-7877-828b-3ed806a2c00e',
  /** Tn. Hendro Gunawan */
  hendro: '01a107dc-db48-7803-b83d-5dd56ac69667',
  /** Ny. Siti Aminah */
  aminah: '01a107dc-df30-710f-b83f-1eab8ee42307',
  /** An. Nadia Putri */
  nadia: '01a107dc-e318-7553-bcce-edeb7de8ab5e',
  /** Tn. Fajar Nugraha */
  fajar: '01a107dc-e700-7c1f-80a3-737fb5093967',
  /** Ny. Dewi Kurniasih */
  dewi: '01a107dc-eae8-7783-b3cf-17e2101af106',
  /** Tn. Bonifasius Tarigan */
  bonifasius: '01a107dc-eed0-7162-9771-dac2f440eb72',
  /** Ny. Sumarni Pakpahan */
  sumarni: '01a107dc-f2b8-77a0-91ec-305e6030b80a',
  /** Tn. Joko Susilo */
  joko: '01a107dc-f6a0-757d-ad01-6eddc190e857',
  /** Tn. Ahmad Fauzi */
  fauzi: '01a107dc-fa88-7156-a974-601078d9b705',
  /** Tn. Robert Manurung */
  robert: '01a107dc-fe70-7de8-aa98-ec4c3e69b178',
  /** Tn. Gilang Mahendra */
  gilang: '01a107dd-0258-7872-9dfe-965b620aa8e4',
  /** Ny. Sri Wahyuni */
  wahyuni: '01a107dd-0640-774a-9f4a-8e5e88be6602',
  /** Ny. Rohana Siregar */
  rohana: '01a107dd-0a28-7f16-8960-3d608deea47e',
  /** Tn. Sugeng Riyadi */
  sugeng: '01a107dd-0e10-79ad-a8ba-41d6be48dcdb',
  /** Ny. Fransiska Lumbantobing */
  fransiska: '01a107dd-11f8-7761-ae58-2e626b7f2605',
  /** Ny. Anisa Rahmadani */
  anisa: '01a107dd-15e0-796f-be39-1eba52dd34ca',
  /** Tn. Lukman Hakim */
  lukman: '01a107dd-19c8-7d15-8543-05d506f4ba20',
} as const;

/** Dokter fiktif (`DOKTER`); juga awal id slot jadwal `<id dokter>.<tanggal>`. */
export const DOCTOR_ID = {
  /** dr. Andini Prameswari, Sp.PD */
  andini: '01a107dd-1db0-7331-a52f-8fe2013c613c',
  /** dr. Rahmat Hidayat, Sp.PD */
  rahmat: '01a107dd-2198-7d53-af6c-a4944e44856a',
  /** dr. Sinta Maharani, Sp.PD-KGH */
  sinta: '01a107dd-2580-710d-a64f-4f1c3c76fa54',
  /** dr. Bagus Santoso, Sp.JP */
  bagus: '01a107dd-2968-77e4-98ad-32f044e75243',
  /** dr. Melati Kusumawardani, Sp.JP */
  melati: '01a107dd-2d50-7ee6-b09e-b4ffdb49dd35',
  /** dr. Yudha Pratama, Sp.N */
  yudha: '01a107dd-3138-7f5c-b84d-169abef8d490',
  /** dr. Kartika Sari, Sp.P */
  kartika: '01a107dd-3520-7ab5-bc54-e7557f40d318',
  /** dr. Nadia Rahmawati, Sp.A */
  nadia: '01a107dd-3908-703e-927b-a3e045d9ccdc',
  /** dr. Yohanes Kurnia, Sp.B */
  yohanes: '01a107dd-3cf0-759a-8c4e-934191913bc1',
  /** dr. Hana Wijayanti, Sp.OG */
  hana: '01a107dd-40d8-72df-b31f-1c4342d9196f',
  /** dr. Rina Kusuma (dokter jaga IGD) */
  rina: '01a107dd-44c0-7a72-8cbf-91c9f415a377',
  /** dr. Maya Lestari, Sp.PK */
  maya: '01a107dd-48a8-71ff-9ed5-45c0918c347f',
  /** dr. Ferry Setiawan, Sp.An */
  ferry: '01a107dd-4c90-7666-b4ea-44449415eeea',
  /** dr. Arman Siregar, Sp.Rad */
  arman: '01a107dd-5078-700a-a311-fa22a5535bcf',
} as const;

/** Tagihan kasir (`?pilih=` di Kasir). Tiga terakhir: tagihan pasien skenario. */
export const INVOICE_ID = {
  /** Ny. Endang Wijaya */
  endang: '01a107dd-5460-77d3-a3c2-46193f0b20a1',
  /** Ny. Ayu Lestari */
  ayu: '01a107dd-5848-7442-8bcf-a0e83d6b328b',
  /** Ny. Fransiska Lumbantobing */
  fransiska: '01a107dd-5c30-77f3-ae5f-aff78dda4743',
  /** Tn. Lukman Hakim */
  lukman: '01a107dd-6018-7aff-991a-828af60a80c3',
  /** An. Raka Pratama */
  raka: '01a107dd-6400-702c-ab41-dd08808c4487',
  /** Ny. Sri Wahyuni */
  wahyuni: '01a107dd-67e8-74e9-8cfa-238d007b071a',
  /** Tn. Bonifasius Tarigan */
  bonifasius: '01a107dd-6bd0-7b5b-9882-f2878b14a94b',
  /** Tn. Sugeng Riyadi */
  sugeng: '01a107dd-6fb8-709e-ab78-f0f9cd7765fc',
  /** Tn. Suryo Adi Nugroho (skenario rawat jalan) */
  suryo: '01a107dd-73a0-73aa-81b8-1e7705bf63ce',
  /** Tn. Hartono Wibisono (skenario IGD → rawat inap) */
  hartono: '01a107dd-7788-7dc6-ba4e-1d6c7fd4dcb0',
  /** Ny. Ratna Sari (skenario elektif TPDI × BTN) */
  ratna: '01a107dd-7b70-7172-836b-2c7c70f52f83',
} as const;

/** Berkas klaim INA-CBG (`?pilih=` di Klaim). Tiga terakhir: klaim pasien skenario. */
export const CLAIM_ID = {
  /** Ny. Endang Wijaya */
  endang: '01a107dd-7f58-7366-90cc-b0b5de53e0cb',
  /** An. Raka Pratama */
  raka: '01a107dd-8340-7894-b8a1-35657f889240',
  /** Tn. Lukman Hakim */
  lukman: '01a107dd-8728-7f07-9b1a-2693c1cd11a2',
  /** Tn. Bonifasius Tarigan */
  bonifasius: '01a107dd-8b10-733d-ae70-c0b5684313d3',
  /** Ny. Siti Aminah */
  aminah: '01a107dd-8ef8-7c9f-a903-1aeb3399c672',
  /** Ny. Lestiani Hapsari */
  lestiani: '01a107dd-92e0-7bd6-a1d2-a3551ca38356',
  /** Ny. Maria Ulfa */
  maria: '01a107dd-96c8-794e-86e4-829cbaaf5adc',
  /** Tn. Hendro Gunawan */
  hendro: '01a107dd-9ab0-721d-b8fa-47bfd0a180af',
  /** Tn. Joko Susilo */
  joko: '01a107dd-9e98-7d59-8b9b-20675196d241',
  /** Tn. Yusuf Hidayat */
  yusuf: '01a107dd-a280-7e0e-bf4e-41420d888183',
  /** Ny. Siti Rahmawati */
  siti: '01a107dd-a668-7537-a0f4-b95c56cee981',
  /** Tn. Suryo Adi Nugroho (skenario rawat jalan) */
  suryo: '01a107dd-aa50-77eb-834b-f2ba7bab14cf',
  /** Tn. Hartono Wibisono (skenario IGD → rawat inap) */
  hartono: '01a107dd-ae38-7104-8760-ff1382992de1',
  /** Ny. Ratna Sari (skenario elektif TPDI × BTN) */
  ratna: '01a107dd-b220-7f3a-ade9-f1e4a42a5185',
  /** Tn. Bonifasius Tarigan · klaim rawat inap angina (pulang 3 Okt) */
  bonifasiusRi: '01a107dd-b608-7385-8677-2cea998f78be',
} as const;

/** Jurnal otomatis yang terkait pasien tertentu. */
export const JOURNAL_ID = {
  /** tutup kunjungan RJ Ny. Sri Wahyuni */
  wahyuni: '01a107dd-b9f0-7524-9bac-6264a612a981',
  /** tutup kunjungan RJ Tn. Sugeng Riyadi */
  sugeng: '01a107dd-bdd8-7c63-b111-2a79e751985d',
  /** penurunan nilai klaim dispute Tn. Hendro Gunawan */
  disputeHendro: '01a107dd-c1c0-7439-b8a8-5dfb14d655bb',
  /** deposit naik kelas Ny. Ratna Sari */
  ratnaDeposit: '01a107dd-c5a8-7637-b54a-95de1b18c38d',
  /** pelunasan pasien Ny. Ratna Sari */
  ratnaSettled: '01a107dd-c990-74d8-94d5-ef4de3926842',
  /** pengakuan pendapatan Ny. Ratna Sari */
  ratna: '01a107dd-cd78-7c5c-91a8-0dadc3ccdacf',
  /** pencairan pembiayaan klaim Ny. Ratna Sari */
  ratnaAdvance: '01a107dd-d160-7620-b057-6cccf88d0adb',
  /** pembayaran klaim BPJS Ny. Ratna Sari */
  ratnaBpjs: '01a107dd-d548-7c56-8fbd-1923e2d1c8f8',
  /** pelunasan pembiayaan BTN Ny. Ratna Sari */
  ratnaForward: '01a107dd-d930-7dc6-978f-805249f73caf',
} as const;

/** Pembayaran tercatat di tagihan. */
export const PAYMENT_ID = {
  /** deposit VA Ny. Endang Wijaya */
  endangDeposit: '01a107dd-dd18-742f-87b8-563dc76dab97',
  /** deposit Ny. Ratna Sari */
  ratnaDeposit: '01a107dd-e100-7bb1-bc0d-286d22e318ef',
  /** pembiayaan BTN Ny. Ratna Sari */
  ratnaBtn: '01a107dd-e4e8-736b-82b0-cf213a0e0d78',
  /** pelunasan QRIS Ny. Ratna Sari */
  ratnaQris: '01a107dd-e8d0-785f-9151-b892306aa19b',
} as const;

/** Rujukan dan surat kontrol di meja pendaftaran. */
export const REFERRAL_ID = {
  /** surat kontrol Poli PD Ny. Siti Rahmawati */
  sitiKontrol: '01a107dd-ecb8-7a91-ba44-b9d66025cc01',
  /** rujukan FKTP Ny. Siti Rahmawati */
  sitiFktp: '01a107dd-f0a0-77b9-b88d-7010888077fc',
  /** rujukan FKTP kedaluwarsa Ny. Siti Rahmawati */
  sitiLama: '01a107dd-f488-7532-9edc-8db37698ba5f',
  /** surat kontrol Poli PD Ny. Maria Ulfa */
  mariaKontrol: '01a107dd-f870-76a4-9eb2-7a5ca33b73cd',
  /** surat kontrol Poli PD Tn. Suryo (skenario) */
  suryoKontrol: '01a107dd-fc58-7f2f-b795-277ee3d6fe58',
} as const;

/** Sampel laboratorium (`?pilih=` di Laboratorium). */
export const LAB_SAMPLE_ID = {
  /** Tn. Yusuf Hidayat */
  yusuf: '01a107de-0040-7dc3-b5bd-8049d49e2e87',
  /** Ny. Endang Wijaya */
  endang: '01a107de-0428-792c-9867-2fffe6f08d25',
  /** An. Raka Pratama */
  raka: '01a107de-0810-72c0-b1d4-7adc75e9181b',
  /** Ny. Anisa Rahmadani */
  anisa: '01a107de-0bf8-7e54-8ebe-b808bbcaf272',
  /** Ny. Maria Ulfa */
  maria: '01a107de-0fe0-7757-b464-07d3a6424b78',
  /** Tn. Hendro Gunawan */
  hendro: '01a107de-13c8-7df3-9351-ae2c1047d151',
  /** Ny. Lestiani Hapsari */
  lestiani: '01a107de-17b0-7c93-b052-7917e98042f7',
  /** Ny. Siti Aminah */
  aminah: '01a107de-1b98-7bcb-a222-49409332eeda',
  /** Tn. Suryo Adi Nugroho (skenario rawat jalan) */
  suryo: '01a107de-1f80-7722-81d8-d9786bc954e7',
  /** Tn. Hartono Wibisono (skenario IGD → rawat inap) */
  hartono: '01a107de-2368-7089-8a0d-610577de62f9',
} as const;

/** Resep di antrean farmasi. */
export const PRESCRIPTION_ID = {
  /** Tn. Sutan Batubara */
  sutan: '01a107de-2750-7cd1-ae8f-55c6661066d1',
  /** Ny. Endang Wijaya */
  endang: '01a107de-2b38-764e-a3b8-8d05b55dae93',
  /** An. Raka Pratama */
  raka: '01a107de-2f20-7a20-88d0-11b824a6569b',
  /** Ny. Anisa Rahmadani */
  anisa: '01a107de-3308-7bec-8997-6a6a84746967',
  /** Ny. Siti Aminah */
  aminah: '01a107de-36f0-7db2-8585-73b3d8b1439d',
  /** Tn. Sugeng Riyadi */
  sugeng: '01a107de-3ad8-7c00-84e2-6258256d6dc3',
  /** Tn. Fajar Nugraha */
  fajar: '01a107de-3ec0-78b5-909e-cc35c43dce10',
  /** Tn. Rizky Ramadhan */
  rizky: '01a107de-42a8-7223-9e0d-d56b2559f6f8',
  /** Ny. Sri Wahyuni */
  wahyuni: '01a107de-4690-7cee-aaec-83b24ef60fff',
  /** Tn. Bonifasius Tarigan */
  bonifasius: '01a107de-4a78-7449-8306-e3bfd0b564d2',
  /** An. Nadia Putri */
  nadia: '01a107de-4e60-7868-8455-df421c7646f5',
  /** Tn. Suryo Adi Nugroho (skenario rawat jalan) */
  suryo: '01a107de-5248-77a0-bb28-4d3a64b3be90',
  /** Tn. Hartono Wibisono (skenario IGD → rawat inap) */
  hartono: '01a107de-5630-701c-bca7-2679abe185ce',
} as const;

/** Pemeriksaan radiologi (`?pilih=` di Radiologi). */
export const RAD_EXAM_ID = {
  /** Tn. Hendro Gunawan */
  hendro: '01a107de-5a18-732a-879f-26371a0e3504',
  /** Ny. Maria Ulfa */
  maria: '01a107de-5e00-735f-b59a-e5bdbebe8225',
  /** Ny. Endang Wijaya */
  endang: '01a107de-61e8-7f4c-b09b-ee0142e1df6d',
  /** Ny. Dewi Kurniasih */
  dewi: '01a107de-65d0-74ae-8061-eebaa80fe308',
  /** Ny. Lestiani Hapsari */
  lestiani: '01a107de-69b8-7f88-aaaa-5f5edef78386',
  /** Ny. Sumarni Pakpahan */
  sumarni: '01a107de-6da0-757f-badc-8509062ed562',
  /** Tn. Rizky Ramadhan */
  rizky: '01a107de-7188-748b-87b5-937a9ebbf9ae',
  /** Tn. Sutan Batubara */
  sutan: '01a107de-7570-734d-a787-262e3e122780',
  /** Tn. Sugeng Riyadi */
  sugeng: '01a107de-7958-7f9e-a6f0-665dca9b049c',
  /** Tn. Hartono Wibisono (skenario IGD → rawat inap) */
  hartono: '01a107de-7d40-7d81-9b68-d9260fbbd8ed',
} as const;

/** Permintaan bed di Manajemen tempat tidur. */
export const BED_REQUEST_ID = {
  /** Ny. Sumarni Pakpahan */
  sumarni: '01a107de-8128-7acf-8807-1339051a8acd',
  /** Tn. Robert Manurung */
  robert: '01a107de-8510-7eee-8316-4f3c6f6d1a3a',
  /** Ny. Lestiani Hapsari */
  lestiani: '01a107de-88f8-75b0-9daa-c1032f2d845a',
  /** Tn. Fajar Nugraha */
  fajar: '01a107de-8ce0-760b-a7b9-13d98fff00a2',
  /** Ny. Maria Ulfa */
  maria: '01a107de-90c8-7a3d-9ddc-4433161ef8a4',
  /** Tn. Hartono Wibisono (skenario IGD → rawat inap) */
  hartono: '01a107de-94b0-780a-985e-579292efb2ec',
  /** Ny. Ratna Sari (skenario elektif TPDI × BTN) */
  ratna: '01a107de-9898-7cd8-8d0d-9d0522ec9da9',
} as const;

/** Baris pasien di pratinjau aplikasi dokter. */
export const DOCTOR_APP_PATIENT_ID = {
  /** Tn. Hartono Wibisono (skenario IGD → rawat inap) */
  hartono: '01a107de-9c80-724d-9b6c-553955875a6e',
  /** Ny. Endang Wijaya */
  endang: '01a107de-a068-7ce2-95e7-ade4ac81a4f7',
  /** Tn. Yusuf Hidayat */
  yusuf: '01a107de-a450-7280-b875-272e49c2805b',
  /** Ny. Siti Aminah */
  aminah: '01a107de-a838-759f-8b1a-f69774813ede',
  /** Tn. Sutan Batubara */
  sutan: '01a107de-ac20-763f-826a-cc57d72344b2',
} as const;

/** Catatan residen menunggu co-sign di aplikasi dokter. */
export const COSIGN_NOTE_ID = {
  /** Ny. Endang Wijaya */
  endang: '01a107de-b008-7375-8d59-8dacd616d949',
  /** Tn. Yusuf Hidayat */
  yusuf: '01a107de-b3f0-7b2e-826e-2af7e22d9698',
  /** Ny. Siti Aminah */
  aminah: '01a107de-b7d8-7c09-b156-c940e472231b',
} as const;

/** Id catatan CPPT ke-`n` pada kunjungan `encounterId` (urutan tulis di fixture). */
export function cpptNoteId(encounterId: string, n: number): string {
  return `${encounterId}-cppt-${n}`;
}

/** Kasus kamar operasi (`?pilih=` di Kamar operasi; jadwal `KAMAR_OK`, catatan anestesi). */
export const OR_CASE_ID = {
  /** Kamar OK 1 · Ny. Maria Ulfa */
  maria: '01a107e0-0000-7510-bf58-52412ca7cd4d',
  /** Kamar OK 1 · Tn. Yusuf Hidayat */
  yusuf: '01a107e0-03e8-71c0-8fe2-0579890f6f1e',
  /** Kamar OK 2 · Tn. Fajar Nugraha */
  fajar: '01a107e0-07d0-7f4e-8b6d-13b4076ae14a',
  /** Kamar OK 2 · Ny. Ratna Sari (skenario elektif TPDI × BTN) */
  ratna: '01a107e0-0bb8-74a9-b145-187a9a33318e',
  /** Kamar OK 2 · Ny. Sumarni Pakpahan */
  sumarni: '01a107e0-0fa0-7cfd-abfa-e5bd253285f7',
  /** Kamar OK 3 · Ny. Wulan Sari Dewi */
  wulan: '01a107e0-1388-7792-aebb-c93f45dcfc2e',
  /** Kamar OK 3 · Ny. Anisa Rahmadani */
  anisa: '01a107e0-1770-78e7-903b-8f17be8db11c',
  /** Kamar OK 4 · Tn. Rizky Ramadhan */
  rizky: '01a107e0-1b58-7b6c-aeba-849b3331a628',
} as const;

/**
 * Peringatan CDS farmasi (tindak lanjut apoteker dikirim ke Server Action). Bukan UUID: nomor resep + jenis
 * peringatan, tetap tanpa nama pasien. Obat dalam resep memakai pola yang sama (`r0884-omeprazol`).
 */
export const CDS_ALERT_ID = {
  /** Tn. Sutan · klopidogrel × omeprazol (R-2610-0884) */
  sutanInteraction: 'r0884-interaksi',
  /** Tn. Sutan · enoksaparin dosis ginjal (R-2610-0884) */
  sutanRenalDose: 'r0884-ginjal',
  /** Ny. Endang · riwayat alergi amoksisilin, sefiksim (R-2610-0871) */
  endangAllergy: 'r0871-alergi',
  /** Tn. Suryo (skenario) · sulfonilurea pada riwayat hipoglikemia (R-2610-0890) */
  suryoSulfonylurea: 'r0890-sulfonilurea',
  /** Tn. Hartono (skenario) · klopidogrel × PPI (R-2610-0893) */
  hartonoInteraction: 'r0893-interaksi',
} as const;
