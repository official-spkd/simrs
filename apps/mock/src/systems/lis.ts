import { randomBytes } from 'node:crypto';
import { buildOru, type OruBuildInput } from '@simrs/shared';
import { lisSignature, LIS_SIGNATURE_HEADER, LIS_TIMESTAMP_HEADER } from '@simrs/shared/node';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { MockConfig } from '../config';
import type { MockState } from '../state';

/**
 * S01 · Mock analyzer laboratorium (rencana fase 4 §4.1b, keputusan no. 4): analyzer "tanpa merek" yang MENGIRIM hasil
 * HL7 v2.5 ORU^R01 lewat HTTP ke endpoint perangkat SIM RS (`LIS_HL7_TARGET`, bawaan `/api/v1/devices/lis/hl7`),
 * pola webhook TPDI: token prinsipal perangkat (ADR-0027, `Authorization: Bearer dv1…`) + HMAC perangkat
 * (`X-Device-Timestamp`, `X-Device-Signature` = HMAC-SHA256(timestamp.body), `@simrs/shared/node`). Pesan dibangun
 * dengan serializer shared (`buildOru`): tanpa segmen PID, pencocokan hanya lewat barcode spesimen di OBR-3.
 *
 * Templat memakai kode LOINC dari `SEED_REF_SAMPLES` saja (CLAUDE.md §4.10; nilai fiktif). Skenario: normal, kritis
 * (kalium 6,8), delta kreatinin (2,4 mg/dL), sebagian tertunda (separuh hasil `P` tanpa nilai). Gangguan: kirim ganda
 * (MSH-10 sama), tanda tangan salah, barcode tak dikenal, latensi sebelum kirim.
 */

export const LIS_TEMPLATES = ['dl', 'kimia', 'elektrolit', 'lipid'] as const;
export type LisTemplate = (typeof LIS_TEMPLATES)[number];
export const LIS_SCENARIOS = ['normal', 'kritis', 'delta-kreatinin', 'sebagian-tertunda'] as const;
export type LisScenario = (typeof LIS_SCENARIOS)[number];

type Obs = OruBuildInput['observations'][number];

const KALIUM: Obs = {
  code: '2823-3',
  text: 'Kalium',
  value: '4.2',
  unit: 'mmol/L',
  referenceRange: '3.5-5.0',
};
const KREATININ: Obs = {
  code: '2160-0',
  text: 'Kreatinin',
  value: '0.9',
  unit: 'mg/dL',
  referenceRange: '0.6-1.2',
};

export const LIS_TEMPLATE_LABEL: Record<LisTemplate, string> = {
  dl: 'Darah lengkap',
  kimia: 'Kimia klinik',
  elektrolit: 'Elektrolit',
  lipid: 'Profil lipid',
};

/** Hasil normal fiktif per templat (LOINC dari `SEED_REF_SAMPLES`). */
export const LIS_TEMPLATE_OBSERVATIONS: Record<LisTemplate, readonly Obs[]> = {
  dl: [
    { code: '718-7', text: 'Hemoglobin', value: '13.4', unit: 'g/dL', referenceRange: '12.0-16.0' },
    { code: '6690-2', text: 'Leukosit', value: '7.8', unit: '10*3/uL', referenceRange: '4.0-10.0' },
    { code: '777-3', text: 'Trombosit', value: '250', unit: '10*3/uL', referenceRange: '150-400' },
  ],
  kimia: [
    { code: '2345-7', text: 'Glukosa sewaktu', value: '112', unit: 'mg/dL', referenceRange: '70-140' },
    { code: '3094-0', text: 'Ureum', value: '28', unit: 'mg/dL', referenceRange: '15-40' },
    KREATININ,
    { code: '1988-5', text: 'CRP', value: '3', unit: 'mg/L', referenceRange: '<5' },
  ],
  elektrolit: [
    { code: '2951-2', text: 'Natrium', value: '140', unit: 'mmol/L', referenceRange: '135-145' },
    KALIUM,
    { code: '2075-0', text: 'Klorida', value: '102', unit: 'mmol/L', referenceRange: '98-107' },
  ],
  lipid: [
    { code: '2093-3', text: 'Kolesterol total', value: '186', unit: 'mg/dL', referenceRange: '<200' },
    { code: '2085-9', text: 'HDL', value: '52', unit: 'mg/dL', referenceRange: '>40' },
    { code: '13457-7', text: 'LDL', value: '112', unit: 'mg/dL', referenceRange: '<130' },
    { code: '2571-8', text: 'Trigliserida', value: '138', unit: 'mg/dL', referenceRange: '<150' },
  ],
};

/** Hasil templat setelah skenario. Kritis/delta menambah kalium/kreatinin bila templat tidak memuatnya. */
export function lisObservations(template: LisTemplate, scenario: LisScenario): Obs[] {
  const obs = LIS_TEMPLATE_OBSERVATIONS[template].map((o) => ({ ...o }));
  const force = (base: Obs, value: string) => {
    const hit = obs.find((o) => o.code === base.code);
    if (hit) hit.value = value;
    else obs.push({ ...base, value });
  };
  if (scenario === 'kritis') force(KALIUM, '6.8');
  if (scenario === 'delta-kreatinin') force(KREATININ, '2.4');
  if (scenario === 'sebagian-tertunda') {
    // Separuh hasil terakhir belum keluar dari alat: status P tanpa nilai (menyusul di pesan berikutnya).
    const done = Math.ceil(obs.length / 2);
    obs.forEach((o, i) => {
      if (i >= done) {
        o.value = '';
        o.status = 'P';
      }
    });
  }
  return obs;
}

export interface LisDelivery {
  id: string;
  at: string;
  controlId: string;
  barcode: string;
  template: LisTemplate;
  scenario: LisScenario;
  /** Nomor kirim untuk pesan ganda (1, 2). */
  attempt: number;
  signatureValid: boolean;
  status: number | 'error';
  /** Kode MSA-1 dari balasan ACK (AA/AE/AR), null bila balasan bukan ACK HL7. */
  ack: string | null;
}

export class LisState {
  deliveries: LisDelivery[] = [];
  private seq = 0;

  reset(): void {
    this.deliveries = [];
    this.seq = 0;
  }

  nextSeq(): number {
    this.seq += 1;
    return this.seq;
  }

  record(d: LisDelivery): void {
    this.deliveries.unshift(d);
    if (this.deliveries.length > 50) this.deliveries.length = 50;
  }
}

export const lisSendSchema = z.strictObject({
  barcode: z
    .string()
    .trim()
    .regex(/^[0-9A-Za-z-]{4,30}$/, 'Barcode spesimen 4–30 karakter huruf/angka/-'),
  template: z.enum(LIS_TEMPLATES),
  scenario: z.enum(LIS_SCENARIOS).default('normal'),
  /** Kirim pesan yang sama dua kali (MSH-10 sama): SIM RS wajib menyimpan satu event. */
  duplicate: z.boolean().default(false),
  /** Tanda tangan dengan kunci yang salah: SIM RS wajib 401 tanpa menyimpan apa pun. */
  badSignature: z.boolean().default(false),
  /** Ganti barcode dengan barcode yang tidak pernah dibuat SIM RS: hasil `failed`, tampil di layar. */
  unknownBarcode: z.boolean().default(false),
  /** Jeda sebelum kirim (ms). */
  latencyMs: z.int().min(0).max(60_000).default(0),
});
export type LisSendInput = z.input<typeof lisSendSchema>;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Waktu HL7 `YYYYMMDDHHMMSS` dalam WIB. */
export function hl7Time(d: Date): string {
  const wib = new Date(d.getTime() + 7 * 3_600_000).toISOString();
  return wib.slice(0, 19).replace(/[-T:]/g, '');
}

function ackCode(body: string | undefined): string | null {
  if (!body) return null;
  const msa = body.split(/\r\n|\r|\n/).find((s) => s.startsWith('MSA|'));
  return msa?.split('|')[1] || null;
}

/** Bangun lalu kirim ORU^R01 (sekali, atau dua kali bila `duplicate`). Dipakai panel dan helper E2E. */
export async function sendLisResult(
  config: MockConfig,
  state: MockState,
  raw: LisSendInput,
): Promise<{ controlId: string; barcode: string; message: string; deliveries: LisDelivery[] }> {
  const input = lisSendSchema.parse(raw);
  const seq = state.lis.nextSeq();
  const now = config.now();
  const controlId = `MOCKLIS${hl7Time(now)}${String(seq).padStart(4, '0')}`;
  const barcode = input.unknownBarcode
    ? `XX${randomBytes(4).toString('hex').toUpperCase()}`
    : input.barcode.toUpperCase();
  const message = buildOru({
    controlId,
    sendingApplication: config.lis.sendingApplication,
    sendingFacility: config.lis.sendingFacility,
    sentAt: hl7Time(now),
    specimenBarcode: barcode,
    observations: lisObservations(input.template, input.scenario),
  });
  if (input.latencyMs > 0) await sleep(input.latencyMs);
  const deliveries: LisDelivery[] = [];
  for (let attempt = 1; attempt <= (input.duplicate ? 2 : 1); attempt++) {
    const timestamp = String(Math.floor(config.now().getTime() / 1000));
    const secret = input.badSignature ? `${config.lis.deviceSecret}-salah` : config.lis.deviceSecret;
    const res = await config.sendWebhook(
      config.lis.target,
      {
        'content-type': 'application/hl7-v2; charset=utf-8',
        authorization: `Bearer ${config.lis.deviceToken}`,
        [LIS_TIMESTAMP_HEADER]: timestamp,
        [LIS_SIGNATURE_HEADER]: lisSignature(timestamp, message, secret),
      },
      message,
    );
    const d: LisDelivery = {
      id: `LIS-${String(seq).padStart(4, '0')}-${attempt}`,
      at: config.now().toISOString(),
      controlId,
      barcode,
      template: input.template,
      scenario: input.scenario,
      attempt,
      signatureValid: !input.badSignature,
      status: res.status,
      ack: ackCode(res.body),
    };
    state.lis.record(d);
    deliveries.push(d);
  }
  return { controlId, barcode, message, deliveries };
}

/**
 * Panel analyzer LIS:
 * - `POST /_panel/api/lis/send` → `{ barcode, template: dl|kimia|elektrolit|lipid, scenario?, duplicate?,
 *   badSignature?, unknownBarcode?, latencyMs? }` → `{ controlId, barcode, message, deliveries }`
 * - `POST /_panel/api/lis/reset` → riwayat kirim dikosongkan
 * Riwayat kirim + target tampil di `GET /_panel/api/state` (`lis`).
 */
export function registerLisPanel(app: FastifyInstance, config: MockConfig, state: MockState): void {
  app.post('/_panel/api/lis/send', async (req, reply) => {
    const parsed = lisSendSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({
        code: 'VALIDATION_FAILED',
        message: parsed.error.issues[0]?.message ?? 'Isian kirim ORU tidak valid',
      });
    }
    return sendLisResult(config, state, parsed.data);
  });

  app.post('/_panel/api/lis/reset', async () => {
    state.lis.reset();
    return { ok: true };
  });
}

export function lisPanelSummary(config: MockConfig, state: MockState) {
  return {
    target: config.lis.target,
    templates: LIS_TEMPLATES.map((t) => ({ id: t, label: LIS_TEMPLATE_LABEL[t] })),
    scenarios: LIS_SCENARIOS,
    deliveries: state.lis.deliveries.slice(0, 20),
  };
}
