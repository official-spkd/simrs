import { queueDomain } from '../../front-office-antrean';
import { scheduleDomain } from '../../front-office-jadwal';
import { registrationDomain } from '../../front-office-pendaftaran';
import { goLiveDomain } from '../../golive-toko';
import { pembayaranDomain } from '../../btn-pembayaran-toko';
import { pembiayaanDomain } from '../../btn-pembiayaan-toko';
import { akuntansiDomain } from '../../keuangan-akuntansi-toko';
import { kasbankDomain } from '../../keuangan-kasbank-toko';
import { klaimDomain } from '../../keuangan-klaim-toko';
import { piutangDomain } from '../../keuangan-piutang-toko';
import { tagihanDomain } from '../../keuangan-tagihan-toko';
import { igdDomain } from '../../klinis-igd-toko';
import { orderDomain } from '../../klinis-order-toko';
import { poliDomain } from '../../klinis-poli-toko';
import { oncologyDomain } from '../../onkologi-toko';
import { backupDomain } from '../../operasional-backup-toko';
import { downtimeDomain } from '../../operasional-downtime-toko';
import { criticalDomain } from '../../penunjang-kritis';
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
  akuntansi: akuntansiDomain,
  antrean: queueDomain,
  cadangan: backupDomain,
  dokumen: documentDomain,
  downtime: downtimeDomain,
  golive: goLiveDomain,
  'hasil-kritis': criticalDomain,
  jadwal: scheduleDomain,
  'kas-bank': kasbankDomain,
  klaim: klaimDomain,
  'klinis-igd': igdDomain,
  'klinis-order': orderDomain,
  'klinis-poli': poliDomain,
  onkologi: oncologyDomain,
  'pembayaran-btn': pembayaranDomain,
  'pembiayaan-btn': pembiayaanDomain,
  pendaftaran: registrationDomain,
  pengaturan: settingsDomain,
  penjadwal: jobsDomain,
  persetujuan: consentDomain,
  piutang: piutangDomain,
  'rekam-medis': rekamDomain,
  'resume-medis': resumeDomain,
  rujukan: referralDomain,
  struktur: structureDomain,
  tagihan: tagihanDomain,
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
