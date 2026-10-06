import {
  CPOE_COVERAGES,
  CPOE_ORDER_KINDS,
  CPOE_PRIORITIES,
  signatureSchema,
  SAFETY_REASON_MIN,
} from '@simrs/shared';
import { z } from 'zod';
import type { DomainEvent } from './demo/store/define';
import { CPOE_CATALOG } from './demo/fixtures/klinis';
import { LAB_TESTS, pendingResult, supportPatient } from './demo/fixtures/penunjang';
import type { SupportState } from './penunjang-demo';

/** Kontrak keluar CD-2, 6 Okt 2026. Hanya pelanggan; publikasi dan validasi CPOE tetap milik klinis.
 * Bentuk lokal menghindari ketergantungan pada branch CD-2 yang belum digabung. ADR-0090.
 */
const id = z.string().min(1).max(160);
const orderLine = z.strictObject({
  lineId: id,
  catalogId: z.string().regex(/^[a-z0-9-]+$/),
  kind: z.enum(CPOE_ORDER_KINDS),
  name: z.string().min(1).max(120),
  detail: z.string().min(1).max(200),
  code: z
    .strictObject({ system: z.enum(['LOINC', 'KFA', 'ICD-9-CM']), code: z.string().min(1).max(20) })
    .nullable(),
  coverage: z.enum(CPOE_COVERAGES),
  priority: z.enum(CPOE_PRIORITIES),
  tariff: z
    .string()
    .regex(/^\d{1,15}$/)
    .nullable(),
  override: z.string().trim().min(10).max(500).nullable(),
  dest: z.enum(['lab', 'radiologi', 'farmasi', 'tindakan', 'kontrol']),
});
export const clinicalOrderSource = {
  name: 'klinis-order',
  eventSchema: z.strictObject({
    type: z.literal('order.ditandatangani'),
    encounterId: z.string().min(1).max(60),
    patientId: z.string().min(1).max(60),
    rm: z.string().regex(/^\d{2}-\d{2}-\d{2}-\d{2}$/),
    patientName: z.string().min(1).max(80),
    setting: z.enum(['rawat-jalan', 'igd']),
    payer: z.string().min(1).max(40),
    signedAt: z.iso.datetime({ offset: true }),
    lines: z.array(orderLine).min(1).max(40),
  }),
};
export type IncomingOrder = {
  lineId: string;
  encounterId: string;
  patientId: string;
  patientName: string;
  rm: string;
  name: string;
  detail: string;
  dest: string;
  at: string;
  by: string;
  reason: string | null;
};
export const clinicalConsentSource = {
  name: 'persetujuan',
  eventSchema: z.discriminatedUnion('type', [
    z.strictObject({
      type: z.literal('consent.final'),
      consentId: z.string().min(1).max(60),
      encounterId: z.string().min(1).max(60),
      patientId: z.string().min(1).max(60),
      procedure: z.string().min(1).max(80),
      doctor: z.string().min(1).max(80),
      patient: signatureSchema,
      witness: signatureSchema,
      staffWitness: z.string().min(1).max(80),
      finalAt: z.iso.datetime({ offset: true }),
    }),
    z.strictObject({
      type: z.literal('consent.ditolak'),
      consentId: z.string().min(1).max(60),
      encounterId: z.string().min(1).max(60),
      patientId: z.string().min(1).max(60),
      procedure: z.string().min(1).max(80),
      reason: z.string().trim().min(SAFETY_REASON_MIN).max(500),
      at: z.iso.datetime({ offset: true }),
    }),
  ]),
};
export type SupportConsent = {
  consentId: string;
  patientId: string;
  procedure: string;
  status: 'final' | 'ditolak';
  at: string;
  by: string;
  reason: string | null;
};

/** Id baris yang sama tidak pernah menggandakan worklist. Kode hasil hanya dari katalog yang sudah tersedia. */
export function receiveClinicalOrder(
  s: SupportState,
  ev: DomainEvent<z.infer<typeof clinicalOrderSource.eventSchema>>,
): SupportState {
  const d = ev.data;
  const patient = { ...supportPatient(d.patientId), name: d.patientName, rm: d.rm, guarantor: d.payer };
  let next = s;
  for (const line of d.lines) {
    if (line.dest === 'kontrol' || next.incomingOrders.some((x) => x.lineId === line.lineId)) continue;
    const catalog = CPOE_CATALOG.find((x) => x.id === line.catalogId);
    let reason: string | null = null;
    const location = d.setting === 'igd' ? 'IGD' : 'Rawat jalan';
    if (line.dest === 'lab') {
      // Panel CPOE mempunyai semua LOINC dalam metadata katalog; jangan mengarang kode untuk Vitamin D.
      const codes =
        catalog?.meta.match(/\d{1,7}-\d/g) ?? (line.code?.system === 'LOINC' ? [line.code.code] : []);
      const keys = codes.map(
        (code) =>
          Object.entries(LAB_TESTS).find(
            ([key, test]) =>
              test.loinc === code &&
              (code !== '718-7' || key === (patient.sex === 'P' ? 'hbP' : 'hbL')) &&
              (code !== '2160-0' || key === (patient.sex === 'P' ? 'kreatininP' : 'kreatininL')),
          )?.[0] as keyof typeof LAB_TESTS | undefined,
      );
      if (!codes.length || keys.some((x) => !x))
        reason = 'Pemetaan LOINC/rentang pemeriksaan belum lengkap. Lengkapi katalog sebelum hasil diproses.';
      else {
        const no = Math.max(0, ...next.samples.map((x) => Number(x.labNo.slice(-4)))) + 1;
        if (no > 9999) reason = 'Nomor sampel demo penuh; mulai ulang data demo.';
        else
          next = {
            ...next,
            samples: [
              ...next.samples,
              {
                id: `00000000-0000-4000-8000-${ev.seq.toString(16).padStart(8, '0')}${d.lines.indexOf(line).toString(16).padStart(4, '0')}`,
                labNo: `L${d.signedAt.slice(2, 10).replaceAll('-', '')}${String(no).padStart(4, '0')}`,
                patient,
                location,
                sender: ev.actor.name,
                priority: line.priority,
                status: 'order',
                tests: line.name,
                specimen: 'Menunggu penerimaan spesimen',
                orderedAt: d.signedAt,
                receivedAt: null,
                tatMinutes: null,
                results: keys.map((key) => pendingResult(key!)),
                qcNote: 'Menunggu hasil alat dan pemeriksaan QC oleh analis.',
                technical: null,
                clinical: null,
                critical: null,
              },
            ],
          };
      }
    } else if (line.dest === 'radiologi') {
      const modality =
        line.catalogId === 'foto-toraks' ? 'DR' : line.catalogId === 'usg-abdomen' ? 'USG' : null;
      if (!modality) reason = 'Modalitas order belum dipetakan; petugas perlu melengkapi katalog.';
      else {
        const no = Math.max(0, ...next.exams.map((x) => Number(x.accession.slice(-4)))) + 1;
        if (no > 9999) reason = 'Nomor radiologi demo penuh; mulai ulang data demo.';
        else
          next = {
            ...next,
            exams: [
              ...next.exams,
              {
                id: line.lineId,
                accession: `RAD-${d.signedAt.slice(2, 4)}${d.signedAt.slice(5, 7)}-${String(no).padStart(4, '0')}`,
                patient,
                location,
                sender: ev.actor.name,
                modality,
                procedure: line.name,
                procedureCode: line.code?.system === 'ICD-9-CM' ? line.code.code : null,
                priority: line.priority,
                status: 'terjadwal',
                room: modality === 'USG' ? 'Ruang USG' : 'Radiografi digital',
                scheduledAt: d.signedAt,
                startedAt: null,
                indication: line.detail,
                contrast: false,
                dose: null,
                report: null,
              },
            ],
          };
      }
    } else if (line.dest === 'tindakan' && ['ekg', 'ekokardiografi'].includes(line.catalogId)) {
      next = {
        ...next,
        diagnostics: [
          ...next.diagnostics,
          {
            id: line.lineId,
            kind: line.catalogId === 'ekg' ? 'ekg' : 'echo',
            patient,
            location,
            orderedBy: ev.actor.name,
            orderedAt: d.signedAt,
            priority: line.priority,
            indication: line.detail,
            slot: null,
            performedAt: null,
            performedBy: null,
            findings: {},
            critical: false,
            signed: null,
          },
        ],
      };
    } else
      reason =
        line.dest === 'farmasi'
          ? 'Menunggu rincian resep terstruktur dari dokter: dosis, rute, frekuensi, jumlah, dan satuan. Obat belum boleh disiapkan.'
          : 'Unit pelaksana tindakan belum dipetakan; order tetap tercatat untuk tindak lanjut.';
    next = {
      ...next,
      incomingOrders: [
        ...next.incomingOrders,
        {
          lineId: line.lineId,
          encounterId: d.encounterId,
          patientId: d.patientId,
          patientName: d.patientName,
          rm: d.rm,
          name: line.name,
          detail: line.detail,
          dest: line.dest,
          at: d.signedAt,
          by: ev.actor.name,
          reason,
        },
      ],
    };
  }
  return next;
}
export function receiveClinicalConsent(
  s: SupportState,
  ev: DomainEvent<z.infer<typeof clinicalConsentSource.eventSchema>>,
): SupportState {
  const d = ev.data;
  if (s.consents.some((x) => x.consentId === d.consentId)) return s;
  return {
    ...s,
    consents: [
      ...s.consents,
      {
        consentId: d.consentId,
        patientId: d.patientId,
        procedure: d.procedure,
        status: d.type === 'consent.final' ? 'final' : 'ditolak',
        at: d.type === 'consent.final' ? d.finalAt : d.at,
        by: ev.actor.name,
        reason: d.type === 'consent.final' ? null : d.reason,
      },
    ],
  };
}
export function consentFor(s: Pick<SupportState, 'consents'>, patientId: string, procedure: string) {
  const normalize = (text: string) => text.trim().toLowerCase().replace(/\s+/g, ' ');
  return s.consents.findLast(
    (x) => x.patientId === patientId && normalize(x.procedure) === normalize(procedure),
  );
}
