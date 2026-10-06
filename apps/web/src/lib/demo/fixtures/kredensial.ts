import type { GrantedPrivilege } from '../../kredensial';
import { employeeByName } from './pegawai';
import { PERSONA, STAF } from './staf';

/**
 * B04 · Data dummy kredensial (ADR-0023): pengajuan kewenangan klinis dan RKK berlaku. Praktisi dari `EMPLOYEES`
 * (izin praktiknya dipakai gerbang verifikasi); nama tindakan generik tanpa kode (kode ICD-9-CM ditautkan katalog
 * kewenangan kelak).
 */

export interface PrivilegeApplication {
  id: string;
  number: string;
  employeeId: string;
  practitioner: string;
  kind: 'Kewenangan baru' | 'Rekredensial';
  committee: 'Komite medik' | 'Komite keperawatan';
  items: readonly string[];
  submittedAt: string;
  /** 0 = menunggu verifikasi berkas, 1 = menunggu telaah mitra bestari. */
  stage: 0 | 1;
  /** Waktu verifikasi berkas bila `stage` = 1. */
  verifiedAt?: string;
  documents: ReadonlyArray<{ label: string; ok: boolean }>;
  reviewer: string;
}

function app(
  id: string,
  number: string,
  name: string,
  rest: Omit<PrivilegeApplication, 'id' | 'number' | 'employeeId' | 'practitioner'>,
): PrivilegeApplication {
  const e = employeeByName(name);
  if (!e) throw new Error(`pegawai fixture tidak ada: ${name}`);
  return { id, number, employeeId: e.id, practitioner: e.name, ...rest };
}

const docs = (extra: ReadonlyArray<{ label: string; ok: boolean }> = []) => [
  { label: 'STR dan SIP', ok: true },
  { label: 'Logbook tindakan 2 tahun terakhir', ok: true },
  ...extra,
];

export const PRIVILEGE_APPLICATIONS: readonly PrivilegeApplication[] = [
  app('krd-05', 'KRD-2610-005', 'dr. Sinta Maharani, Sp.PD-KGH', {
    kind: 'Kewenangan baru',
    committee: 'Komite medik',
    items: ['Pemasangan kateter dialisis femoral', 'Biopsi ginjal perkutan'],
    submittedAt: '2026-10-02T09:00:00+07:00',
    stage: 0,
    documents: docs([{ label: 'Sertifikat pelatihan biopsi ginjal', ok: false }]),
    reviewer: 'dr. Hadi Wirawan, Sp.PD-KGH (mitra bestari)',
  }),
  app('krd-04', 'KRD-2610-004', STAF.dpjpBedah, {
    kind: 'Rekredensial',
    committee: 'Komite medik',
    items: ['Kolesistektomi laparoskopik', 'Apendektomi laparoskopik', 'Herniorafi terbuka'],
    submittedAt: '2026-09-21T10:30:00+07:00',
    stage: 1,
    verifiedAt: '2026-09-25T14:00:00+07:00',
    documents: docs([{ label: 'Evaluasi praktik profesional berkelanjutan', ok: true }]),
    reviewer: 'dr. Bayu Adiputra, Sp.B-KBD (mitra bestari)',
  }),
  app('krd-06', 'KRD-2610-006', STAF.dokterJagaIgd, {
    kind: 'Kewenangan baru',
    committee: 'Komite medik',
    items: ['Intubasi endotrakeal di IGD'],
    submittedAt: '2026-10-04T13:15:00+07:00',
    stage: 0,
    documents: docs([{ label: 'Sertifikat pelatihan kegawatdaruratan', ok: true }]),
    reviewer: 'dr. Ferry Setiawan, Sp.An (mitra bestari)',
  }),
  app('krd-03', 'KRD-2610-003', PERSONA.perawat, {
    kind: 'Kewenangan baru',
    committee: 'Komite keperawatan',
    items: ['Perawatan kateter vena sentral'],
    submittedAt: '2026-10-01T08:00:00+07:00',
    stage: 0,
    documents: docs([{ label: 'Sertifikat pelatihan akses vaskular', ok: true }]),
    reviewer: 'Ns. Retno Wulandari, M.Kep (mitra bestari keperawatan)',
  }),
];

/** RKK yang sedang berlaku (sebelum pengajuan di atas diputus). */
export const GRANTED_PRIVILEGES: readonly GrantedPrivilege[] = [
  {
    practitioner: STAF.dpjpBedah,
    item: 'Kolesistektomi laparoskopik',
    decision: 'diberikan',
    expiry: '2026-11-15',
  },
  {
    practitioner: STAF.dpjpBedah,
    item: 'Apendektomi laparoskopik',
    decision: 'diberikan',
    expiry: '2026-11-15',
  },
  { practitioner: STAF.dpjpBedah, item: 'Herniorafi terbuka', decision: 'diberikan', expiry: '2026-11-15' },
  {
    practitioner: 'dr. Ferry Setiawan, Sp.An',
    item: 'Anestesi umum',
    decision: 'diberikan',
    expiry: '2028-05-04',
  },
  {
    practitioner: STAF.dpjpPenyakitDalam,
    item: 'Parasentesis abdomen',
    decision: 'diberikan',
    expiry: '2027-03-01',
  },
  {
    practitioner: STAF.dokterJagaIgd,
    item: 'Resusitasi jantung paru lanjut',
    decision: 'diberikan',
    expiry: '2027-02-01',
  },
  {
    practitioner: PERSONA.perawat,
    item: 'Pemasangan infus perifer',
    decision: 'diberikan',
    expiry: '2028-08-10',
  },
];

/** Order yang ditahan kait CPOE bulan ini (ditinjau komite medik). */
export const ORDER_GUARD_EVENTS: ReadonlyArray<{
  at: string;
  practitioner: string;
  item: string;
  code: 'PRIVILEGE_REQUIRED' | 'LICENSE_EXPIRED';
}> = [
  {
    at: '2026-10-01T21:40:00+07:00',
    practitioner: STAF.dokterJagaIgd,
    item: 'Intubasi endotrakeal di IGD',
    code: 'PRIVILEGE_REQUIRED',
  },
  {
    at: '2026-10-03T10:05:00+07:00',
    practitioner: 'dr. Sinta Maharani, Sp.PD-KGH',
    item: 'Pemasangan kateter dialisis femoral',
    code: 'PRIVILEGE_REQUIRED',
  },
  {
    at: '2026-10-05T07:20:00+07:00',
    practitioner: STAF.dokterJagaIgd,
    item: 'Resusitasi jantung paru lanjut',
    code: 'LICENSE_EXPIRED',
  },
];
