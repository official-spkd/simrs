/**
 * P03 · Katalog izin (tetap, di kode) dan matriks bawaan peran (disalin ke database per RS, bisa diubah di layar Akses).
 * Izin = sumber × aksi, dengan lingkup:
 * - `all`          seluruh data tenant,
 * - `unit`         hanya data unit tempat penugasan aktif,
 * - `relationship` hanya pasien yang punya relasi dengan pelaku (DPJP, perawat penanggung jawab, rawat bersama)
 *                  atau akses darurat (break-the-glass) yang masih berlaku.
 */
export const PERMISSION_CATALOG = {
  'tenant.settings': { label: 'Pengaturan & modul RS', actions: ['read', 'write'] },
  facility: { label: 'Struktur RS (faskes, unit, bed)', actions: ['read', 'write'] },
  'iam.users': { label: 'Pengguna & penugasan', actions: ['read', 'write'] },
  'iam.roles': { label: 'Peran & matriks izin', actions: ['read', 'write'] },
  audit: { label: 'Jejak audit', actions: ['read', 'export', 'review'] },
  patient: { label: 'Data pasien (MPI)', actions: ['read', 'write', 'merge', 'export'] },
  'patient.identity': { label: 'Identitas lengkap (NIK tanpa samaran)', actions: ['read'] },
  'forms.definition': { label: 'Definisi formulir klinis', actions: ['read', 'write', 'publish'] },
  'forms.response': { label: 'Isian formulir klinis', actions: ['read', 'write', 'correct'] },
  ref: { label: 'Master rujukan (ICD, LOINC, wilayah)', actions: ['read', 'write'] },
  documents: { label: 'Dokumen & cetak', actions: ['read', 'write', 'print'] },
  break_glass: { label: 'Akses darurat', actions: ['use', 'review'] },
  // F01–F08 · Front office (fase 2)
  schedule: { label: 'Jadwal praktik & kuota (sinkron HFIS)', actions: ['read', 'write', 'sync'] },
  booking: { label: 'Booking & janji temu', actions: ['read', 'write', 'cancel'] },
  encounter: {
    label: 'Kunjungan (registrasi rawat jalan, IGD, rawat inap)',
    actions: ['read', 'write', 'cancel'],
  },
  coverage: { label: 'Penjaminan & SEP (SPRI, rencana kontrol)', actions: ['read', 'write'] },
  queue: { label: 'Antrean (panggil, kelola layanan & display)', actions: ['read', 'call', 'manage'] },
  referral: { label: 'Rujukan masuk, keluar, internal', actions: ['read', 'write'] },
  // K01–K15 · Klinis RME (fase 3, rencana §3.0a)
  clinical: {
    label: 'Catatan klinis (asesmen, CPPT, diagnosis, resume)',
    actions: ['read', 'write', 'correct', 'cosign', 'sign'],
  },
  order: {
    label: 'Order penunjang & resep (CPOE); kelola order set dan basis CDS',
    actions: ['read', 'write', 'cancel', 'manage'],
  },
  medication: { label: 'Pemberian obat (eMAR)', actions: ['administer'] },
  triage: { label: 'Triase IGD', actions: ['write'] },
  bed: { label: 'Tempat tidur & ADT (admisi, transfer, pulang)', actions: ['read', 'write'] },
  consent: { label: 'Persetujuan tindakan', actions: ['read', 'write', 'sign'] },
  result: { label: 'Hasil penunjang (observasi, laporan)', actions: ['read', 'write'] },
  // S01–S10 · Penunjang (fase 4, rencana §4.0a)
  'lab.worklist': { label: 'Worklist laboratorium', actions: ['read'] },
  'lab.specimen': {
    label: 'Spesimen laboratorium (ambil, terima, tolak)',
    actions: ['collect', 'receive', 'reject'],
  },
  'lab.result': {
    label: 'Hasil laboratorium (input, validasi teknis, rilis klinis, koreksi)',
    actions: ['write', 'verify', 'release', 'correct'],
  },
  'lab.qc': { label: 'Kontrol mutu (QC) laboratorium', actions: ['read', 'write'] },
  'lab.master': { label: 'Master pemeriksaan & rentang rujukan lab', actions: ['write'] },
  critical_result: {
    label: 'Nilai kritis (lapor dengan read-back, tinjau)',
    actions: ['read', 'report', 'review'],
  },
  radiology: {
    label: 'Radiologi (jadwal, pelaksanaan, ekspertise, TTE)',
    actions: ['read', 'schedule', 'perform', 'report', 'sign'],
  },
  'pharmacy.review': { label: 'Telaah resep & intervensi apoteker', actions: ['read', 'write'] },
  'pharmacy.dispense': {
    label: 'Penyiapan & penyerahan obat (cek ganda, retur)',
    actions: ['prepare', 'double_check', 'handover', 'return'],
  },
  stock: {
    label: 'Stok depo (penerimaan, mutasi, penyesuaian)',
    actions: ['read', 'receive', 'transfer', 'adjust'],
  },
  formulary: { label: 'Formularium & profil stok obat', actions: ['write'] },
  surgery: {
    label: 'Kamar operasi (jadwal, daftar tilik WHO, hitung kasa, laporan, override insisi)',
    actions: ['read', 'schedule', 'checklist', 'count', 'report', 'override'],
  },
  nutrition: { label: 'Gizi (order diet, layanan makan)', actions: ['read', 'write'] },
  blood_bank: {
    label: 'Bank darah (permintaan, crossmatch, pengeluaran)',
    actions: ['read', 'crossmatch', 'issue'],
  },
  diagnostics: {
    label: 'Diagnostik lain (EKG, USG, echo, endoskopi): laporan + TTE',
    actions: ['write', 'sign'],
  },
  // Khusus perangkat terdaftar (lihat DEVICE_ONLY_RESOURCES): tidak pernah bisa diberikan ke peran.
  kiosk: { label: 'Anjungan mandiri (khusus perangkat)', actions: ['use'] },
  'queue.display': { label: 'Display antrean (khusus perangkat)', actions: ['read'] },
  // S01 · Analyzer lab (fase 4): jenis perangkat `lab_analyzer` + `DEVICE_GRANTS` ditambahkan potongan 4.1a (ingest).
  'lab.analyzer': { label: 'Kirim hasil analyzer laboratorium (khusus perangkat)', actions: ['ingest'] },
  'dev.tools': { label: 'Alat pengembang (non-produksi)', actions: ['use'] },
  'platform.guide': { label: 'Panduan sistem (operator platform)', actions: ['read'] },
} as const;

export type PermissionResource = keyof typeof PERMISSION_CATALOG;
export type PermissionAction<R extends PermissionResource = PermissionResource> =
  (typeof PERMISSION_CATALOG)[R]['actions'][number];
export const PERMISSION_SCOPES = ['all', 'unit', 'relationship'] as const;
export type PermissionScope = (typeof PERMISSION_SCOPES)[number];

/** Urutan cakupan: all ⊃ unit ⊃ relationship. */
export const SCOPE_RANK: Record<PermissionScope, number> = { relationship: 1, unit: 2, all: 3 };

export function isPermission(resource: string, action: string): resource is PermissionResource {
  return (
    Object.hasOwn(PERMISSION_CATALOG, resource) &&
    (PERMISSION_CATALOG[resource as PermissionResource].actions as readonly string[]).includes(action)
  );
}

/**
 * Kunci izin katalog bertipe (`schedule.read`, `queue.display.read`, …): salah ketik di kode pemakai (mis. registri
 * layar web) tertangkap typecheck.
 */
export type PermissionKey = {
  [R in PermissionResource]: `${R}.${PermissionAction<R>}`;
}[PermissionResource];

/** Kunci `sumber.aksi` yang ada di katalog (aksi tidak pernah bertitik). */
export function isPermissionKey(key: string): key is PermissionKey {
  const dot = key.lastIndexOf('.');
  return dot > 0 && isPermission(key.slice(0, dot), key.slice(dot + 1));
}

/** Kunci satu izin: `sumber.aksi` (mis. `iam.users.write`). Aksi tidak pernah bertitik. */
export const permissionKey = (resource: string, action: string): string => `${resource}.${action}`;

/** Semua kunci izin di katalog saat ini, urut. */
export function catalogPermissionKeys(): string[] {
  return Object.entries(PERMISSION_CATALOG)
    .flatMap(([resource, def]) => def.actions.map((action) => permissionKey(resource, action)))
    .sort();
}

/**
 * Katalog saat sinkron izin (`pnpm db:sync-permissions`) diperkenalkan, 5 Okt 2026. RS yang belum punya
 * catatan katalog (`PERMISSION_CATALOG_RECORD_KEY`) dianggap sudah mengenal semua izin ini, sehingga hanya
 * izin yang ditambahkan ke katalog SESUDAHNYA yang dianggap baru. Jangan diubah: menambah izin cukup di
 * `PERMISSION_CATALOG` + matriks bawaan, lalu jalankan sinkron di setiap lingkungan.
 */
export const PERMISSION_CATALOG_BASELINE: readonly string[] = [
  'audit.export',
  'audit.read',
  'audit.review',
  'break_glass.review',
  'break_glass.use',
  'dev.tools.use',
  'documents.print',
  'documents.read',
  'documents.write',
  'facility.read',
  'facility.write',
  'forms.definition.publish',
  'forms.definition.read',
  'forms.definition.write',
  'forms.response.correct',
  'forms.response.read',
  'forms.response.write',
  'iam.roles.read',
  'iam.roles.write',
  'iam.users.read',
  'iam.users.write',
  'patient.export',
  'patient.identity.read',
  'patient.merge',
  'patient.read',
  'patient.write',
  'platform.guide.read',
  'ref.read',
  'ref.write',
  'tenant.settings.read',
  'tenant.settings.write',
];

/**
 * Kunci `tenant_settings` (internal, bukan pengaturan di `TENANT_SETTINGS`, jadi tidak tampil dan tidak bisa
 * diubah lewat API pengaturan) berisi izin katalog yang sudah dikenal RS: `{ v: 1, permissions: string[] }`.
 * Ditulis hanya oleh sinkron izin; setiap perubahannya diaudit.
 */
export const PERMISSION_CATALOG_RECORD_KEY = 'authz.permission_catalog';

/** Entri selisih matriks di audit (`details.added` / `details.removed`): `sumber.aksi:lingkup`. */
export const grantDiffEntry = (g: { resource: string; action: string; scope: string }): string =>
  `${permissionKey(g.resource, g.action)}:${g.scope}`;

/** Kebalikan `grantDiffEntry`: kunci izin + lingkup, atau null bila formatnya bukan entri selisih. */
export function parseGrantDiffEntry(entry: string): { permission: string; scope: string } | null {
  const at = entry.lastIndexOf(':');
  if (at <= 0 || at === entry.length - 1) return null;
  const permission = entry.slice(0, at);
  return permission.includes('.') ? { permission, scope: entry.slice(at + 1) } : null;
}

/** Peran bawaan (docs/05 §2). `superadmin_platform` hanya ada di tenant khusus PLATFORM (ADR-0010). */
export const SYSTEM_ROLES = {
  admin_tenant: 'Admin SIM RS',
  petugas_pendaftaran: 'Petugas pendaftaran',
  perawat: 'Perawat',
  bidan: 'Bidan',
  dokter: 'Dokter (DPJP)',
  dokter_residen: 'Dokter residen (wajib co-sign)',
  apoteker: 'Apoteker',
  analis_lab: 'Analis laboratorium',
  radiografer: 'Radiografer',
  /** S07 · PPA gizi (CPPT format ADIME); kode sama dengan peta PPA CPPT fase 3 (`PPA_OF_ROLE`). */
  ahli_gizi: 'Ahli gizi (nutrisionis)',
  kasir: 'Kasir',
  koder: 'Koder klinis',
  akuntan: 'Akuntan',
  petugas_rm: 'Petugas rekam medis',
  manajemen: 'Manajemen',
  auditor_mutu: 'Auditor mutu',
  petugas_privasi: 'Petugas privasi',
} as const;
export type SystemRoleCode = keyof typeof SYSTEM_ROLES;

export type RoleGrant = readonly [PermissionResource, string, PermissionScope];
type Grant = RoleGrant;

const CLINICAL_READ: Grant[] = [
  ['patient', 'read', 'relationship'],
  ['forms.definition', 'read', 'all'],
  ['forms.response', 'read', 'relationship'],
  ['ref', 'read', 'all'],
  ['facility', 'read', 'all'],
  ['documents', 'read', 'relationship'],
  ['break_glass', 'use', 'all'],
];

/** F01–F08 · Seluruh izin front office berlingkup `all` (petugas pendaftaran; rencana fase 2 §0a). */
const FRONT_OFFICE_ALL: Grant[] = [
  ['schedule', 'read', 'all'],
  ['schedule', 'write', 'all'],
  ['schedule', 'sync', 'all'],
  ['booking', 'read', 'all'],
  ['booking', 'write', 'all'],
  ['booking', 'cancel', 'all'],
  ['encounter', 'read', 'all'],
  ['encounter', 'write', 'all'],
  ['encounter', 'cancel', 'all'],
  ['coverage', 'read', 'all'],
  ['coverage', 'write', 'all'],
  ['queue', 'read', 'all'],
  ['queue', 'call', 'all'],
  ['queue', 'manage', 'all'],
  ['referral', 'read', 'all'],
  ['referral', 'write', 'all'],
];

/**
 * Klinisi poli (dokter, perawat, bidan): memanggil antrean unit penugasannya, melihat jadwal, dan membaca kunjungan
 * pasien berelasi. `queue.read` (unit) menyertai `queue.call`: memanggil butuh melihat daftar tunggu.
 */
const CLINICAL_FRONT_OFFICE: Grant[] = [
  ['schedule', 'read', 'all'],
  ['encounter', 'read', 'relationship'],
  ['queue', 'read', 'unit'],
  ['queue', 'call', 'unit'],
];

/** Kasir, koder, rekam medis: kunjungan dan penjaminannya (baca saja). */
const ENCOUNTER_COVERAGE_READ: Grant[] = [
  ['encounter', 'read', 'all'],
  ['coverage', 'read', 'all'],
];

/**
 * K01–K15 · Klinisi fase 3 (rencana §3.0a). Lingkup `unit` = kunjungan aktif pasien di unit penugasan ditambah semua
 * dasar lingkup `relationship` (ADR-0031; tingkat kamar/bed lewat `app_patient_location` di potongan 3.1). Co-sign dan
 * tanda tangan (TTE) dokumen legal hanya untuk DPJP/rawat bersama: lingkup `relationship`.
 */
const DOCTOR_CLINICAL: Grant[] = [
  ['clinical', 'read', 'unit'],
  ['clinical', 'write', 'unit'],
  ['clinical', 'correct', 'unit'],
  ['clinical', 'cosign', 'relationship'],
  ['clinical', 'sign', 'relationship'],
  ['order', 'read', 'unit'],
  ['order', 'write', 'unit'],
  ['order', 'cancel', 'unit'],
  ['consent', 'read', 'unit'],
  ['consent', 'write', 'unit'],
  ['consent', 'sign', 'relationship'],
  ['result', 'read', 'unit'],
  ['triage', 'write', 'unit'],
  ['bed', 'read', 'unit'],
];

/** Residen: menulis dan mengoreksi tanpa co-sign/TTE (CPPT menunggu co-sign DPJP); order langsung aktif, ditinjau DPJP. */
const RESIDENT_CLINICAL: Grant[] = [
  ['clinical', 'read', 'unit'],
  ['clinical', 'write', 'unit'],
  ['clinical', 'correct', 'unit'],
  ['order', 'read', 'unit'],
  ['order', 'write', 'unit'],
  ['consent', 'read', 'unit'],
  ['result', 'read', 'unit'],
  ['triage', 'write', 'unit'],
  ['bed', 'read', 'unit'],
];

/** Perawat dan bidan: semuanya lingkup unit (eMAR, triase, bed, saksi persetujuan). */
const NURSE_CLINICAL: Grant[] = [
  ['clinical', 'read', 'unit'],
  ['clinical', 'write', 'unit'],
  ['clinical', 'correct', 'unit'],
  ['medication', 'administer', 'unit'],
  ['triage', 'write', 'unit'],
  ['bed', 'read', 'unit'],
  ['bed', 'write', 'unit'],
  ['order', 'read', 'unit'],
  ['consent', 'read', 'unit'],
  ['consent', 'write', 'unit'],
  ['result', 'read', 'unit'],
];

/**
 * Analis lab dan radiografer: hasil penunjang diinput manual selama MVP (asumsi 1) untuk order dari unit mana pun,
 * jadi lingkup `all`; fase 4 menyempitkannya ke worklist penunjang.
 */
const RESULT_ENTRY: Grant[] = [
  ['result', 'read', 'all'],
  ['result', 'write', 'all'],
];

/**
 * S01–S10 · Penunjang (fase 4, rencana §4.0a). Lingkup `unit` = order yang ditujukan ke unit penugasan (keputusan fase
 * 4 no. 3). Rilis klinis lab, ekspertise radiologi, dan laporan diagnostik bagi dokter berlingkup `unit`: hanya
 * bermakna bila penugasannya di unit Lab/Radiologi/Diagnostik (keputusan no. 6).
 */
const LAB_ANALYST: Grant[] = [
  ['lab.worklist', 'read', 'unit'],
  ['lab.specimen', 'collect', 'unit'],
  ['lab.specimen', 'receive', 'unit'],
  ['lab.specimen', 'reject', 'unit'],
  ['lab.result', 'write', 'unit'],
  ['lab.result', 'verify', 'unit'],
  ['lab.result', 'correct', 'unit'],
  ['lab.qc', 'read', 'unit'],
  ['lab.qc', 'write', 'unit'],
  ['critical_result', 'read', 'unit'],
  ['critical_result', 'report', 'unit'],
  ['blood_bank', 'read', 'unit'],
  ['blood_bank', 'crossmatch', 'unit'],
  ['blood_bank', 'issue', 'unit'],
];

const RADIOGRAPHER: Grant[] = [
  ['radiology', 'read', 'unit'],
  ['radiology', 'schedule', 'unit'],
  ['radiology', 'perform', 'unit'],
  ['critical_result', 'read', 'unit'],
  ['critical_result', 'report', 'unit'],
];

const DOCTOR_SUPPORT: Grant[] = [
  // Layar Lab mode api untuk dokter Sp.PK pemegang `lab.result.release` (keputusan orkestrator, temuan 4.0c).
  ['lab.worklist', 'read', 'unit'],
  ['lab.result', 'release', 'unit'],
  ['radiology', 'read', 'unit'],
  ['radiology', 'report', 'unit'],
  ['radiology', 'sign', 'unit'],
  ['diagnostics', 'write', 'unit'],
  ['diagnostics', 'sign', 'unit'],
  ['critical_result', 'read', 'relationship'],
  ['surgery', 'read', 'relationship'],
  ['surgery', 'report', 'relationship'],
  ['surgery', 'checklist', 'relationship'],
  ['surgery', 'override', 'relationship'],
];

/** Apoteker: telaah, dispensing, stok depo penugasannya (penyesuaian hanya depo sendiri), formularium. */
const PHARMACIST: Grant[] = [
  ['pharmacy.review', 'read', 'unit'],
  ['pharmacy.review', 'write', 'unit'],
  ['pharmacy.dispense', 'prepare', 'unit'],
  ['pharmacy.dispense', 'double_check', 'unit'],
  ['pharmacy.dispense', 'handover', 'unit'],
  ['pharmacy.dispense', 'return', 'unit'],
  ['stock', 'read', 'unit'],
  ['stock', 'receive', 'unit'],
  ['stock', 'transfer', 'unit'],
  ['stock', 'adjust', 'unit'],
  ['formulary', 'write', 'unit'],
];

/** Perawat/bidan: ambil spesimen, terima nilai kritis, gizi, retur obat pasiennya; daftar tilik + hitung di unit OK. */
const NURSE_SUPPORT: Grant[] = [
  ['lab.specimen', 'collect', 'relationship'],
  ['critical_result', 'read', 'relationship'],
  ['nutrition', 'read', 'relationship'],
  ['nutrition', 'write', 'relationship'],
  ['pharmacy.dispense', 'return', 'relationship'],
  ['surgery', 'read', 'unit'],
  ['surgery', 'checklist', 'unit'],
  ['surgery', 'count', 'unit'],
  // 4.7 · Jadwal kamar operasi oleh perawat unit OK (kepala ruang/penjadwal IBS); lingkup unit = kamar unit OK.
  ['surgery', 'schedule', 'unit'],
];

/**
 * Matriks bawaan. Prinsip hak minimum: klinisi hanya pasien berelasi (+ akses darurat berjejak);
 * administrasi tanpa isi klinis; audit/privasi tanpa hak ubah data pasien.
 */
export const DEFAULT_ROLE_GRANTS: Record<SystemRoleCode, readonly Grant[]> = {
  admin_tenant: [
    ['tenant.settings', 'read', 'all'],
    ['tenant.settings', 'write', 'all'],
    ['facility', 'read', 'all'],
    ['facility', 'write', 'all'],
    ['iam.users', 'read', 'all'],
    ['iam.users', 'write', 'all'],
    ['iam.roles', 'read', 'all'],
    ['iam.roles', 'write', 'all'],
    ['audit', 'read', 'all'],
    ['forms.definition', 'read', 'all'],
    ['ref', 'read', 'all'],
    ['ref', 'write', 'all'],
    ['dev.tools', 'use', 'all'],
    // Jadwal/kuota dan layanan antrean; hak baca menyertai hak ubah.
    ['schedule', 'read', 'all'],
    ['schedule', 'write', 'all'],
    ['schedule', 'sync', 'all'],
    ['queue', 'read', 'all'],
    ['queue', 'manage', 'all'],
    // S01/S04 · Master lab dan formularium (fase 4).
    ['lab.master', 'write', 'all'],
    ['formulary', 'write', 'all'],
  ],
  petugas_pendaftaran: [
    ['patient', 'read', 'all'],
    ['patient', 'write', 'all'],
    ['patient.identity', 'read', 'all'],
    ['facility', 'read', 'all'],
    ['ref', 'read', 'all'],
    ['documents', 'print', 'all'],
    ...FRONT_OFFICE_ALL,
    // K04/K05 · Admisi dan papan bed seluruh RS.
    ['bed', 'read', 'all'],
    ['bed', 'write', 'all'],
    // K03 · Papan IGD dan triase awal di loket IGD (keputusan orkestrator 5 Okt 2026): lingkup unit penugasan IGD.
    ['clinical', 'read', 'unit'],
    ['triage', 'write', 'unit'],
  ],
  perawat: [
    ...CLINICAL_READ,
    // Isian formulir P07 (asesmen, skrining, edukasi) untuk pasien di unit penugasan, mengikuti `clinical.write`
    // (keputusan orkestrator 7 Okt 2026): perawat/bidan bangsal tidak perlu relasi per pasien.
    ['forms.response', 'write', 'unit'],
    ['forms.response', 'correct', 'unit'],
    ...CLINICAL_FRONT_OFFICE,
    ...NURSE_CLINICAL,
    ...NURSE_SUPPORT,
  ],
  bidan: [
    ...CLINICAL_READ,
    // Isian formulir P07 (asesmen, skrining, edukasi) untuk pasien di unit penugasan, mengikuti `clinical.write`
    // (keputusan orkestrator 7 Okt 2026): perawat/bidan bangsal tidak perlu relasi per pasien.
    ['forms.response', 'write', 'unit'],
    ['forms.response', 'correct', 'unit'],
    ...CLINICAL_FRONT_OFFICE,
    ...NURSE_CLINICAL,
    ...NURSE_SUPPORT,
  ],
  dokter: [
    ...CLINICAL_READ,
    ['forms.response', 'write', 'relationship'],
    ['forms.response', 'correct', 'relationship'],
    ['documents', 'write', 'relationship'],
    ...CLINICAL_FRONT_OFFICE,
    ...DOCTOR_CLINICAL,
    ...DOCTOR_SUPPORT,
  ],
  dokter_residen: [...CLINICAL_READ, ['forms.response', 'write', 'relationship'], ...RESIDENT_CLINICAL],
  apoteker: [...CLINICAL_READ, ...PHARMACIST],
  analis_lab: [
    ['patient', 'read', 'unit'],
    ['ref', 'read', 'all'],
    ['facility', 'read', 'all'],
    ...RESULT_ENTRY,
    ...LAB_ANALYST,
  ],
  radiografer: [
    ['patient', 'read', 'unit'],
    ['ref', 'read', 'all'],
    ['facility', 'read', 'all'],
    ...RESULT_ENTRY,
    ...RADIOGRAPHER,
  ],
  ahli_gizi: [
    ...CLINICAL_READ,
    ['forms.response', 'write', 'relationship'],
    ['clinical', 'read', 'unit'],
    ['clinical', 'write', 'unit'],
    ['clinical', 'correct', 'unit'],
    ['result', 'read', 'unit'],
    ['nutrition', 'read', 'unit'],
    ['nutrition', 'write', 'unit'],
  ],
  kasir: [
    ['patient', 'read', 'all'],
    ['facility', 'read', 'all'],
    ['documents', 'print', 'all'],
    ...ENCOUNTER_COVERAGE_READ,
  ],
  koder: [
    ['patient', 'read', 'all'],
    ['forms.response', 'read', 'all'],
    ['ref', 'read', 'all'],
    ['documents', 'read', 'all'],
    ...ENCOUNTER_COVERAGE_READ,
    ['clinical', 'read', 'all'],
  ],
  akuntan: [['facility', 'read', 'all']],
  petugas_rm: [
    ['patient', 'read', 'all'],
    ['patient', 'write', 'all'],
    ['patient', 'merge', 'all'],
    ['patient', 'export', 'all'],
    ['patient.identity', 'read', 'all'],
    ['forms.definition', 'read', 'all'],
    ['forms.definition', 'write', 'all'],
    ['forms.definition', 'publish', 'all'],
    ['forms.response', 'read', 'all'],
    ['documents', 'read', 'all'],
    ['documents', 'print', 'all'],
    ['ref', 'read', 'all'],
    ['facility', 'read', 'all'],
    ...ENCOUNTER_COVERAGE_READ,
    ['clinical', 'read', 'all'],
  ],
  manajemen: [
    ['facility', 'read', 'all'],
    ['audit', 'read', 'all'],
    ['tenant.settings', 'read', 'all'],
    // Layar Jadwal dokter (registri layar web: manajemen ikut memantau kuota).
    ['schedule', 'read', 'all'],
    // K05 · Papan bed (BOR, kapasitas).
    ['bed', 'read', 'all'],
    // S09/S05 · Metrik kepatuhan nilai kritis, stok.
    ['critical_result', 'review', 'all'],
    ['stock', 'read', 'all'],
  ],
  auditor_mutu: [
    ['audit', 'read', 'all'],
    ['audit', 'export', 'all'],
    ['facility', 'read', 'all'],
    // K09 · Laporan tinjauan override CDS.
    ['order', 'read', 'all'],
  ],
  petugas_privasi: [
    ['audit', 'read', 'all'],
    ['audit', 'export', 'all'],
    ['audit', 'review', 'all'],
    ['break_glass', 'review', 'all'],
    ['iam.users', 'read', 'all'],
  ],
};

/** Jenis tenant: RS, atau satu tenant khusus untuk operator platform (ADR-0010, ADR-0013). */
export const TENANT_KINDS = ['hospital', 'platform'] as const;
export type TenantKind = (typeof TENANT_KINDS)[number];

/** Peran tenant PLATFORM. Tidak punya akses data pasien RS mana pun (ADR-0010). */
export const PLATFORM_ROLES = { superadmin_platform: 'Superadmin platform' } as const;
export type PlatformRoleCode = keyof typeof PLATFORM_ROLES;

export const PLATFORM_ROLE_GRANTS: Record<PlatformRoleCode, readonly Grant[]> = {
  superadmin_platform: [
    ['platform.guide', 'read', 'all'],
    ['iam.users', 'read', 'all'],
    ['iam.users', 'write', 'all'],
    ['iam.roles', 'read', 'all'],
    ['iam.roles', 'write', 'all'],
    ['audit', 'read', 'all'],
  ],
};

/** Peran bawaan beserta matriks bawaannya untuk satu jenis tenant. */
export function defaultRolesFor(
  kind: TenantKind,
): Array<{ code: string; name: string; grants: readonly Grant[] }> {
  if (kind === 'platform') {
    return (Object.keys(PLATFORM_ROLES) as PlatformRoleCode[]).map((code) => ({
      code,
      name: PLATFORM_ROLES[code],
      grants: PLATFORM_ROLE_GRANTS[code],
    }));
  }
  return (Object.keys(SYSTEM_ROLES) as SystemRoleCode[]).map((code) => ({
    code,
    name: SYSTEM_ROLES[code],
    grants: DEFAULT_ROLE_GRANTS[code],
  }));
}

/**
 * Peran pelindung (admin RS di tenant RS, superadmin di tenant PLATFORM): selalu tersisa minimal satu
 * penugasan aktif, sehingga tenant tidak pernah terkunci dari pengaturan aksesnya sendiri.
 */
export const PROTECTED_ROLES = ['admin_tenant', 'superadmin_platform'] as const;

/**
 * Peran sensitif (docs/05 §1: admin, keuangan, rekam medis; ditambah koding, audit, privasi, manajemen, operator
 * platform). Bawaan pengaturan `login.totp_only_roles` (tanpa kode cadangan WhatsApp/email, ADR-0022) dan tidak
 * pernah boleh memakai PIN masuk cepat (ADR-0024).
 */
export const SENSITIVE_ROLES = [
  'admin_tenant',
  'kasir',
  'koder',
  'akuntan',
  'petugas_rm',
  'manajemen',
  'auditor_mutu',
  'petugas_privasi',
  'superadmin_platform',
] as const;

export function isProtectedRole(code: string | null | undefined): boolean {
  return (PROTECTED_ROLES as readonly (string | null | undefined)[]).includes(code);
}

/**
 * Izin khusus perangkat terdaftar (ADR-0027: anjungan, TV display antrean). Hanya dipegang prinsipal perangkat lewat
 * `DEVICE_GRANTS`; tidak pernah bisa diberikan ke peran manusia (RS maupun platform), sehingga akun staf tidak
 * bisa menyamar sebagai anjungan/TV dan sebaliknya.
 */
export const DEVICE_ONLY_RESOURCES = [
  'kiosk',
  'queue.display',
  'lab.analyzer',
] as const satisfies readonly PermissionResource[];

export function isDeviceOnlyResource(resource: string): boolean {
  return (DEVICE_ONLY_RESOURCES as readonly string[]).includes(resource);
}

/** Jenis perangkat terdaftar per unit (keputusan fase 2 no. 2). */
export const DEVICE_KINDS = {
  kiosk: 'Anjungan mandiri',
  queue_display: 'Display antrean (TV)',
} as const;
export type DeviceKind = keyof typeof DEVICE_KINDS;

/** Izin tetap per jenis perangkat (tidak bisa diubah per RS). Lingkup `unit` = unit tempat perangkat didaftarkan. */
export const DEVICE_GRANTS: Record<DeviceKind, readonly Grant[]> = {
  kiosk: [['kiosk', 'use', 'unit']],
  queue_display: [['queue.display', 'read', 'unit']],
};

/**
 * Izin yang boleh diberikan ke PERAN (manusia) di jenis tenant ini: sumber `platform.*` hanya bermakna di tenant
 * PLATFORM; izin khusus perangkat tidak pernah.
 */
export function permissionAllowedFor(kind: TenantKind, resource: string): boolean {
  if (isDeviceOnlyResource(resource)) return false;
  return kind === 'platform' || !resource.startsWith('platform.');
}

/**
 * Izin kelola akses. Peran yang memegang salah satunya setara admin: selalu dimiliki peran pelindung, dan
 * akun/peran yang memegangnya hanya boleh dikelola oleh peran pelindung (cegah eskalasi lewat delegasi).
 */
export const ACCESS_ADMIN_GRANTS = [
  ['iam.users', 'write'],
  ['iam.roles', 'write'],
] as const satisfies ReadonlyArray<readonly [PermissionResource, string]>;
