import { z } from 'zod';
import { actorRef, idSchema, must, whenSchema } from './backoffice-toko';
import { defineDomain } from './demo/store/define';
import { type Complaint, OPEN_COMPLAINTS, recentComplaints, surveyResponses } from './demo/fixtures/pengalaman';
import { answerBlock, type Grade, needsFollowUp, SURVEY_ASPECTS } from './pengalaman';

/**
 * B13 · Domain toko demo `pengaduan` (ADR-0085, CX-3): pengaduan diterima → grading → tindak lanjut unit → dijawab →
 * selesai (catatan append-only atas nama pengguna sesi), dan skor survei rendah dijadikan pengaduan. Pengaduan yang
 * dijawab masuk INM-12 (kecepatan tanggap komplain) di Mutu.
 */

export const COMPLAINT_DOMAIN = 'pengaduan';

export const complaintEventSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('aduan.digrading'), id: idSchema, grade: z.enum(['merah', 'kuning', 'hijau']), when: whenSchema }),
  z.strictObject({ type: z.literal('aduan.ditindaklanjuti'), id: idSchema, text: z.string().trim().min(10).max(500), when: whenSchema }),
  z.strictObject({ type: z.literal('aduan.dijawab'), id: idSchema, answer: z.string().trim().min(20).max(1000), when: whenSchema }),
  z.strictObject({ type: z.literal('aduan.ditutup'), id: idSchema, when: whenSchema }),
  z.strictObject({ type: z.literal('survei.dijadikan-aduan'), responseId: idSchema, when: whenSchema }),
]);
export type ComplaintEvent = z.infer<typeof complaintEventSchema>;

export interface StoredComplaint extends Complaint {
  stageNow: number;
  answeredAt: string | null;
  log: Array<{ at: string; by: string; text: string }>;
}

export interface ComplaintStoreState {
  complaints: StoredComplaint[];
  converted: Record<string, string>;
  seq: number;
}

export function initialComplaints(): ComplaintStoreState {
  return {
    complaints: OPEN_COMPLAINTS.map((c) => ({ ...c, stageNow: c.stage, answeredAt: null, log: [...c.actions] })),
    converted: {},
    seq: 25,
  };
}

/**
 * Pengaduan 30 hari untuk INM-12: riwayat fixture + pengaduan yang dijawab di layar (grading + jam jawab tersimpan).
 */
export function complaintRecords(
  s: ComplaintStoreState,
): Array<{ receivedAt: string; grade: Grade; answeredAt: string }> {
  return [
    ...recentComplaints(),
    ...s.complaints.flatMap((c) =>
      c.grade && c.answeredAt ? [{ receivedAt: c.receivedAt, grade: c.grade, answeredAt: c.answeredAt }] : [],
    ),
  ];
}

export const complaintNumber = (seq: number) => `ADU-2610-${String(seq).padStart(3, '0')}`;
const RESPONSES = surveyResponses();

function gate(s: ComplaintStoreState, ev: ComplaintEvent): string | null {
  if (ev.type === 'survei.dijadikan-aduan') {
    const r = RESPONSES.find((x) => x.id === ev.responseId);
    if (!r || !needsFollowUp(r)) return 'Respons survei tidak perlu ditindaklanjuti.';
    return s.converted[ev.responseId] ? 'Respons ini sudah dijadikan pengaduan.' : null;
  }
  const c = s.complaints.find((x) => x.id === ev.id);
  if (!c) return 'Pengaduan tidak ditemukan.';
  const need = { 'aduan.digrading': 0, 'aduan.ditindaklanjuti': 1, 'aduan.dijawab': 2, 'aduan.ditutup': 3 }[ev.type];
  if (c.stageNow !== need) return `${c.number} tidak di tahap ini.`;
  return ev.type === 'aduan.dijawab' ? answerBlock(ev.answer) : null;
}

export const complaintDomain = defineDomain<ComplaintStoreState, ComplaintEvent>(COMPLAINT_DOMAIN, {
  initial: initialComplaints,
  eventSchema: complaintEventSchema,
  // Mutu menghitung INM-12 dari pengaduan yang dijawab di sini.
  screens: ['pengaduan', 'mutu'],
  generic: true,
  validate: (s, ev) => gate(s, ev),
  reduce: (s, ev) => {
    const d = ev.data;
    must(gate(s, d));
    const by = actorRef(ev.actor).name;
    if (d.type === 'survei.dijadikan-aduan') {
      const r = RESPONSES.find((x) => x.id === d.responseId);
      if (!r) return s;
      const aspect = SURVEY_ASPECTS[r.scores.findIndex((x) => x <= 2)] ?? '';
      const number = complaintNumber(s.seq);
      return {
        ...s,
        seq: s.seq + 1,
        converted: { ...s.converted, [d.responseId]: number },
        complaints: [
          {
            id: `adu-${r.id}`,
            number,
            channel: 'Situs web',
            unit: r.unit,
            reporter: 'Responden survei (anonim)',
            contactMasked: 'tanpa kontak',
            text: r.comment ?? aspect,
            receivedAt: d.when,
            grade: null,
            stage: 0,
            actions: [],
            stageNow: 0,
            answeredAt: null,
            log: [{ at: d.when, by, text: `Dibuat dari survei ${r.id}` }],
          },
          ...s.complaints,
        ],
      };
    }
    const patch = (c: StoredComplaint): StoredComplaint => {
      switch (d.type) {
        case 'aduan.digrading':
          return { ...c, grade: d.grade as Grade, stageNow: 1, log: [...c.log, { at: d.when, by, text: `Digrading ${d.grade}, diteruskan ke ${c.unit}` }] };
        case 'aduan.ditindaklanjuti':
          return { ...c, stageNow: 2, log: [...c.log, { at: d.when, by, text: d.text.trim() }] };
        case 'aduan.dijawab':
          return { ...c, stageNow: 3, answeredAt: d.when, log: [...c.log, { at: d.when, by, text: 'Jawaban dikirim ke pelapor' }] };
        case 'aduan.ditutup':
          return { ...c, stageNow: 4, log: [...c.log, { at: d.when, by, text: 'Pelapor menerima jawaban; pengaduan ditutup' }] };
      }
    };
    return { ...s, complaints: s.complaints.map((c) => (c.id === d.id ? patch(c) : c)) };
  },
});
