/** Pengelompokan akun presentasi di layar masuk (urutan alur pasien: front office → klinis → penunjang → …). */

/**
 * Awalan nama pengguna akun presentasi (sama dengan `PRESENTATION_USERNAME_PREFIX` di `@simrs/db`, dijaga tes).
 * Semua akun presentasi berbagi satu keadaan simulasi per RS.
 */
export const PRESENTATION_USERNAME_PREFIX = 'presentasi.';

/**
 * Nama pengguna akun Superadmin demo (ADR-0023 keputusan 10; persona `superadmin-demo` di `@simrs/db`, dijaga tes).
 * Web hanya menganggap sesi "semua layar" bila nama pengguna dari API sama dengan ini DAN berkas kredensial lokal
 * menandai akun itu `allAccess` untuk RS yang sama, dan hanya di mode presentasi.
 */
export const ALL_ACCESS_USERNAME = `${PRESENTATION_USERNAME_PREFIX}superadmin-demo`;

/** Judul kelompok akun Superadmin demo di layar masuk (paling atas). */
export const ALL_ACCESS_GROUP_TITLE = 'Superadmin demo';

export interface PersonaView {
  username: string;
  displayName: string;
  role: string;
  roleName: string;
  unitName: string | null;
  /** Akun Superadmin demo (semua layar di mode presentasi). */
  allAccess?: true;
}

const GROUPS: ReadonlyArray<{ title: string; roles: readonly string[] }> = [
  { title: 'Front office', roles: ['petugas_pendaftaran'] },
  { title: 'Klinis', roles: ['dokter', 'dokter_residen', 'perawat', 'bidan'] },
  { title: 'Penunjang', roles: ['analis_lab', 'radiografer', 'apoteker', 'ahli_gizi'] },
  { title: 'Keuangan & rekam medis', roles: ['kasir', 'koder', 'akuntan', 'petugas_rm'] },
  { title: 'Manajemen & sistem', roles: ['manajemen', 'auditor_mutu', 'petugas_privasi', 'admin_tenant'] },
];

export function groupPersonas(
  list: readonly PersonaView[],
): Array<{ title: string; personas: PersonaView[] }> {
  const known = new Set(GROUPS.flatMap((g) => g.roles));
  // Superadmin demo paling atas; tidak diulang di kelompok peran aslinya.
  const all = list.filter((p) => p.allAccess);
  const positions = list.filter((p) => !p.allAccess);
  const groups = [
    { title: ALL_ACCESS_GROUP_TITLE, personas: all },
    ...GROUPS.map((g) => ({
      title: g.title,
      personas: g.roles.flatMap((r) => positions.filter((p) => p.role === r)),
    })),
  ];
  const other = positions.filter((p) => !known.has(p.role));
  if (other.length > 0) groups.push({ title: 'Lainnya', personas: other });
  return groups.filter((g) => g.personas.length > 0);
}
