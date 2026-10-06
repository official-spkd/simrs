import { z } from 'zod';
import { jamSchema } from './backoffice-toko';
import { defineDomain, on } from './demo/store/define';
import { igdDomain } from './klinis-igd-toko';
import type { DischargeRecord } from './mutu-transaksi';
import { resumeDomain } from './rawat-inap-resume-toko';

/**
 * B06 · Domain toko demo `mutu` (ADR-0085, CX-3): penampung kejadian klinis yang menjadi pembilang/penyebut indikator.
 * Melanggan `resume-medis` (`resume.final`: pasien pulang + jam TTE resume → indikator resume ≤ 1×24 jam) dan
 * `klinis-igd` (`pasien.meninggal` → daftar kematian di IGD untuk telaah mutu). Indikator lain dibaca langsung dari
 * domain asalnya (`ppi` kebersihan tangan, `pengaduan` tanggap komplain). Kejadian sendiri hanya "hitung ulang"
 * (jejak siapa menjalankan mesin indikator).
 */

export const QUALITY_DOMAIN = 'mutu';

export const qualityEventSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('indikator.dihitung-ulang'), jam: jamSchema }),
]);
export type QualityEvent = z.infer<typeof qualityEventSchema>;

export interface QualityStoreState {
  discharges: Array<DischargeRecord & { encounterId: string; patientName: string }>;
  deaths: Array<{
    encounterId: string;
    patientName: string;
    diedAt: string;
    causeCode: string;
    causeLabel: string;
  }>;
  recomputed: { jam: string; by: string } | null;
}

export const qualityDomain = defineDomain<QualityStoreState, QualityEvent>(QUALITY_DOMAIN, {
  initial: () => ({ discharges: [], deaths: [], recomputed: null }),
  eventSchema: qualityEventSchema,
  screens: ['mutu', 'dasbor'],
  generic: true,
  subscriptions: [
    on(resumeDomain, (s, ev) => {
      const d = ev.data;
      if (d.type !== 'resume.final' || s.discharges.some((x) => x.encounterId === d.encounterId)) return s;
      return {
        ...s,
        discharges: [
          ...s.discharges,
          {
            encounterId: d.encounterId,
            patientName: d.patientName,
            dischargedAt: d.dischargeAt,
            resumeSignedAt: d.signedAt,
          },
        ],
      };
    }),
    on(igdDomain, (s, ev) => {
      const d = ev.data;
      if (d.type !== 'pasien.meninggal' || s.deaths.some((x) => x.encounterId === d.encounterId)) return s;
      return {
        ...s,
        deaths: [
          ...s.deaths,
          {
            encounterId: d.encounterId,
            patientName: d.patientName,
            diedAt: d.diedAt,
            causeCode: d.causeCode,
            causeLabel: d.causeLabel,
          },
        ],
      };
    }),
  ],
  reduce: (s, ev) => ({ ...s, recomputed: { jam: ev.data.jam, by: ev.actor.name } }),
});
