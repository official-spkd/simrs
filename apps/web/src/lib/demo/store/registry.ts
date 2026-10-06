import { queueDomain } from '../../front-office-antrean';
import { assetDomain } from '../../aset-toko';
import { datasetDomain } from '../../dataset-riset-toko';
import { scheduleDomain } from '../../front-office-jadwal';
import { registrationDomain } from '../../front-office-pendaftaran';
import { goLiveDomain } from '../../golive-toko';
import { igdDomain } from '../../klinis-igd-toko';
import { orderDomain } from '../../klinis-order-toko';
import { poliDomain } from '../../klinis-poli-toko';
import { oncologyDomain } from '../../onkologi-toko';
import { backupDomain } from '../../operasional-backup-toko';
import { downtimeDomain } from '../../operasional-downtime-toko';
import { credentialDomain } from '../../kredensial-toko';
import { logisticsDomain } from '../../logistik-toko';
import { complaintDomain } from '../../pengaduan-toko';
import { educationDomain } from '../../pendidikan-toko';
import { payrollDomain } from '../../penggajian-toko';
import { criticalDomain } from '../../penunjang-kritis';
import { ppiDomain } from '../../ppi-toko';
import { ppraDomain } from '../../ppra-toko';
import { recordsAdminDomain } from '../../rekam-medis-adm-toko';
import { hrDomain } from '../../sdm-toko';
import { regDocsDomain } from '../../dokumen-toko';
import { documentDomain } from '../../platform-dokumen-toko';
import { settingsDomain } from '../../platform-pengaturan-toko';
import { jobsDomain } from '../../platform-penjadwal-toko';
import { structureDomain } from '../../platform-struktur-toko';
import { terminologyDomain } from '../../platform-terminologi-toko';
import { bedDomain } from '../../rawat-inap-bed-toko';
import { consentDomain } from '../../rawat-inap-consent-toko';
import { resumeDomain } from '../../rawat-inap-resume-toko';
import { rekamDomain } from '../../rme-toko';
import { referralDomain } from '../../rujukan-toko';
import type { DomainDef, DomainSource } from './define';

/**
 * Registri domain toko demo (ADR-0085). Server memakai daftar ini untuk memetakan nama domain di Server Action generik
 * ke definisinya, dan untuk tahu layar mana yang harus dimuat ulang ketika domain sumber berubah (pelanggan).
 *
 * Aturan tambah: pemilik domain menambah SATU baris (urut abjad nama domain) yang mengimpor definisinya dari
 * `lib/<domain>.ts` miliknya. Jangan mengubah baris domain lain. Kunci harus sama dengan `name` definisi (diuji).
 */
export const DEMO_DOMAINS = {
  antrean: queueDomain,
  aset: assetDomain,
  cadangan: backupDomain,
  'dataset-riset': datasetDomain,
  dokumen: documentDomain,
  downtime: downtimeDomain,
  golive: goLiveDomain,
  'hasil-kritis': criticalDomain,
  jadwal: scheduleDomain,
  'klinis-igd': igdDomain,
  'klinis-order': orderDomain,
  'klinis-poli': poliDomain,
  kredensial: credentialDomain,
  logistik: logisticsDomain,
  onkologi: oncologyDomain,
  pendaftaran: registrationDomain,
  pendidikan: educationDomain,
  pengaduan: complaintDomain,
  pengaturan: settingsDomain,
  penggajian: payrollDomain,
  penjadwal: jobsDomain,
  persetujuan: consentDomain,
  ppi: ppiDomain,
  ppra: ppraDomain,
  regulasi: regDocsDomain,
  'rekam-medis': rekamDomain,
  'rekam-medis-adm': recordsAdminDomain,
  'resume-medis': resumeDomain,
  rujukan: referralDomain,
  sdm: hrDomain,
  struktur: structureDomain,
  'tempat-tidur': bedDomain,
  terminologi: terminologyDomain,
} as const;

export type DemoDomains = typeof DEMO_DOMAINS;
export type DomainName = keyof DemoDomains;
/** Keadaan domain `N`. */
export type StateOf<N extends DomainName> = ReturnType<DemoDomains[N]['initial']>;
/** Kejadian domain `N` (bentuk masukan Server Action). */
export type EventOf<N extends DomainName> = DemoDomains[N] extends DomainSource<infer E> ? E : never;

/** Definisi dengan tipe longgar, untuk kode generik (toko, Server Action generik). */
export type AnyDomainDef = DomainDef<unknown, { type: string }>;

export function isDomainName(name: string): name is DomainName {
  return Object.hasOwn(DEMO_DOMAINS, name);
}

export function domainDef(name: DomainName): AnyDomainDef {
  return DEMO_DOMAINS[name] as unknown as AnyDomainDef;
}

export function allDomains(): AnyDomainDef[] {
  return (Object.keys(DEMO_DOMAINS) as DomainName[]).map(domainDef);
}
