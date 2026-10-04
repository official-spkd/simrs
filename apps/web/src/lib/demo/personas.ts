/** Pengelompokan akun presentasi di layar masuk (urutan alur pasien: front office → klinis → penunjang → …). */

/**
 * Awalan nama pengguna akun presentasi (sama dengan `PRESENTATION_USERNAME_PREFIX` di `@simrs/db`, dijaga tes).
 * Semua akun presentasi berbagi satu keadaan simulasi per RS.
 */
export const PRESENTATION_USERNAME_PREFIX = 'presentasi.';

export interface PersonaView {
  username: string;
  displayName: string;
  role: string;
  roleName: string;
  unitName: string | null;
}

const GROUPS: ReadonlyArray<{ title: string; roles: readonly string[] }> = [
  { title: 'Front office', roles: ['petugas_pendaftaran'] },
  { title: 'Klinis', roles: ['dokter', 'dokter_residen', 'perawat', 'bidan'] },
  { title: 'Penunjang', roles: ['analis_lab', 'radiografer', 'apoteker'] },
  { title: 'Keuangan & rekam medis', roles: ['kasir', 'koder', 'akuntan', 'petugas_rm'] },
  { title: 'Manajemen & sistem', roles: ['manajemen', 'auditor_mutu', 'petugas_privasi', 'admin_tenant'] },
];

export function groupPersonas(
  list: readonly PersonaView[],
): Array<{ title: string; personas: PersonaView[] }> {
  const known = new Set(GROUPS.flatMap((g) => g.roles));
  const groups = GROUPS.map((g) => ({
    title: g.title,
    personas: g.roles.flatMap((r) => list.filter((p) => p.role === r)),
  }));
  const other = list.filter((p) => !known.has(p.role));
  if (other.length > 0) groups.push({ title: 'Lainnya', personas: other });
  return groups.filter((g) => g.personas.length > 0);
}
