/**
 * S01 · HL7 v2.5 minimal untuk hasil analyzer laboratorium (rencana fase 4 §4.0a, keputusan no. 4): ORU^R01 lewat
 * HTTP ke endpoint perangkat ber-HMAC. Hanya segmen MSH, PID, NK1, OBR, OBX, NTE yang dikenali. Pencocokan pasien
 * HANYA lewat barcode spesimen (OBR-3, fallback OBR-2); segmen PID/NK1 diredaksi sebelum pesan disimpan
 * (`redactHl7`), jadi PHI dari analyzer tidak pernah masuk `inbound_events`. Modul murni (tanpa crypto; tanda
 * tangan perangkat di `./signature`, entri Node).
 */

export const HL7_SEGMENT_SEPARATOR = '\r';
/** Segmen ber-PHI yang diredaksi sebelum disimpan. */
export const HL7_REDACTED_SEGMENTS = ['PID', 'NK1'] as const;
/** Batas ukuran pesan ingest (byte, UTF-8). */
export const HL7_MAX_BYTES = 256 * 1024;

export interface Hl7Encoding {
  field: string;
  component: string;
  repetition: string;
  escape: string;
  subcomponent: string;
}

export interface Hl7Observation {
  setId: number;
  /** OBX-2: NM (angka), ST/TX (teks), CE/CWE (berkode). */
  valueType: string;
  /** OBX-3 komponen 1 (kode alat atau LOINC) dan komponen 3 (sistem pengkodean, mis. `LN`). */
  code: string;
  codeText: string | null;
  codeSystem: string | null;
  value: string;
  /** Nilai angka bila `valueType` NM dan dapat dibaca; selain itu null. */
  numeric: number | null;
  unit: string | null;
  referenceRange: string | null;
  /** OBX-8: H, L, HH, LL, N, A (diabaikan server: flag dihitung ulang dari rentang RS). */
  abnormalFlag: string | null;
  /** OBX-11: F final, P preliminary, C correction, X tidak bisa dikerjakan. */
  resultStatus: string | null;
  observedAt: string | null;
  notes: string[];
}

export interface Hl7OruMessage {
  encoding: Hl7Encoding;
  /** MSH-10: idempotency key ingest. */
  controlId: string;
  messageType: string;
  sendingApplication: string;
  sendingFacility: string;
  /** MSH-7 mentah (YYYYMMDDHHMMSS[+ZZZZ]). */
  sentAt: string | null;
  orders: Array<{
    specimenBarcode: string;
    universalServiceId: string | null;
    observations: Hl7Observation[];
  }>;
}

export class Hl7ParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'Hl7ParseError';
  }
}

function splitSegments(raw: string): string[] {
  return raw
    .split(/\r\n|\r|\n/)
    .map((s) => s.trimEnd())
    .filter((s) => s.length > 0);
}

function encodingOf(msh: string): Hl7Encoding {
  if (!msh.startsWith('MSH') || msh.length < 8) throw new Hl7ParseError('Pesan HL7 harus diawali segmen MSH');
  const field = msh.charAt(3);
  const chars = msh.slice(4, 8);
  return {
    field,
    component: chars.charAt(0) || '^',
    repetition: chars.charAt(1) || '~',
    escape: chars.charAt(2) || '\\',
    subcomponent: chars.charAt(3) || '&',
  };
}

/** Field ke-n (penomoran HL7; untuk MSH, MSH-1 = pemisah field). */
function field(segment: string, n: number, enc: Hl7Encoding): string {
  const parts = segment.split(enc.field);
  if (parts[0] === 'MSH') {
    if (n === 1) return enc.field;
    return parts[n - 1] ?? '';
  }
  return parts[n] ?? '';
}

function component(value: string, n: number, enc: Hl7Encoding): string {
  return value.split(enc.component)[n - 1] ?? '';
}

const orNull = (v: string): string | null => (v === '' ? null : v);

/** Urai escape HL7 dasar (\F\ \S\ \T\ \R\ \E\) pada nilai teks. */
export function unescapeHl7(value: string, enc: Hl7Encoding): string {
  const e = enc.escape;
  return value
    .split(`${e}F${e}`)
    .join(enc.field)
    .split(`${e}S${e}`)
    .join(enc.component)
    .split(`${e}T${e}`)
    .join(enc.subcomponent)
    .split(`${e}R${e}`)
    .join(enc.repetition)
    .split(`${e}E${e}`)
    .join(e);
}

export function escapeHl7(value: string, enc: Hl7Encoding = DEFAULT_ENCODING): string {
  const e = enc.escape;
  return value
    .split(e)
    .join(`${e}E${e}`)
    .split(enc.field)
    .join(`${e}F${e}`)
    .split(enc.component)
    .join(`${e}S${e}`)
    .split(enc.subcomponent)
    .join(`${e}T${e}`)
    .split(enc.repetition)
    .join(`${e}R${e}`);
}

export const DEFAULT_ENCODING: Hl7Encoding = {
  field: '|',
  component: '^',
  repetition: '~',
  escape: '\\',
  subcomponent: '&',
};

/**
 * Parse ORU^R01. Melempar `Hl7ParseError` bila MSH hilang, tipe bukan ORU^R01, MSH-10 kosong, atau OBX/NTE muncul
 * tanpa OBR. PID/NK1 dilewati (tidak pernah dibaca).
 */
export function parseOru(raw: string): Hl7OruMessage {
  const segments = splitSegments(raw);
  const msh = segments[0];
  if (!msh) throw new Hl7ParseError('Pesan HL7 kosong');
  const enc = encodingOf(msh);
  const messageType = field(msh, 9, enc);
  if (component(messageType, 1, enc) !== 'ORU' || component(messageType, 2, enc) !== 'R01') {
    throw new Hl7ParseError(`Tipe pesan bukan ORU^R01: ${messageType || '(kosong)'}`);
  }
  const controlId = field(msh, 10, enc).trim();
  if (!controlId) throw new Hl7ParseError('MSH-10 (message control ID) wajib');
  const message: Hl7OruMessage = {
    encoding: enc,
    controlId,
    messageType: 'ORU^R01',
    sendingApplication: component(field(msh, 3, enc), 1, enc),
    sendingFacility: component(field(msh, 4, enc), 1, enc),
    sentAt: orNull(field(msh, 7, enc)),
    orders: [],
  };
  let lastObs: Hl7Observation | null = null;
  for (const seg of segments.slice(1)) {
    const type = seg.slice(0, 3);
    if (type === 'OBR') {
      const filler = component(field(seg, 3, enc), 1, enc);
      const placer = component(field(seg, 2, enc), 1, enc);
      const barcode = (filler || placer).trim();
      if (!barcode) throw new Hl7ParseError('OBR tanpa barcode spesimen (OBR-3/OBR-2)');
      message.orders.push({
        specimenBarcode: barcode,
        universalServiceId: orNull(component(field(seg, 4, enc), 1, enc)),
        observations: [],
      });
      lastObs = null;
    } else if (type === 'OBX') {
      const order = message.orders.at(-1);
      if (!order) throw new Hl7ParseError('OBX muncul sebelum OBR');
      const valueType = field(seg, 2, enc);
      const id = field(seg, 3, enc);
      const value = unescapeHl7(field(seg, 5, enc), enc);
      const num = valueType === 'NM' ? Number(value.replace(',', '.')) : Number.NaN;
      lastObs = {
        setId: Number(field(seg, 1, enc)) || order.observations.length + 1,
        valueType,
        code: component(id, 1, enc),
        codeText: orNull(component(id, 2, enc)),
        codeSystem: orNull(component(id, 3, enc)),
        value,
        numeric: Number.isFinite(num) && value.trim() !== '' ? num : null,
        unit: orNull(component(field(seg, 6, enc), 1, enc)),
        referenceRange: orNull(field(seg, 7, enc)),
        abnormalFlag: orNull(field(seg, 8, enc)),
        resultStatus: orNull(field(seg, 11, enc)),
        observedAt: orNull(field(seg, 14, enc)),
        notes: [],
      };
      order.observations.push(lastObs);
    } else if (type === 'NTE') {
      if (!message.orders.at(-1)) throw new Hl7ParseError('NTE muncul sebelum OBR');
      lastObs?.notes.push(unescapeHl7(field(seg, 3, enc), enc));
    }
  }
  return message;
}

/** Ganti segmen PID/NK1 dengan bentuk tanpa isi (`PID|1`), segmen lain apa adanya; pemisah segmen `\r`. */
export function redactHl7(raw: string): string {
  const segments = splitSegments(raw);
  const enc = segments[0]?.startsWith('MSH') ? encodingOf(segments[0]) : DEFAULT_ENCODING;
  return segments
    .map((seg) =>
      (HL7_REDACTED_SEGMENTS as readonly string[]).includes(seg.slice(0, 3))
        ? `${seg.slice(0, 3)}${enc.field}1`
        : seg,
    )
    .join(HL7_SEGMENT_SEPARATOR);
}

export interface OruBuildInput {
  controlId: string;
  sendingApplication: string;
  sendingFacility: string;
  /** Waktu HL7 `YYYYMMDDHHMMSS`. */
  sentAt: string;
  specimenBarcode: string;
  observations: Array<{
    code: string;
    text: string;
    system?: string;
    value: string;
    valueType?: 'NM' | 'ST';
    unit?: string;
    referenceRange?: string;
    status?: 'F' | 'P' | 'C';
  }>;
}

/** Bangun ORU^R01 minimal (mock analyzer, tes). Tanpa PID: pencocokan lewat barcode. */
export function buildOru(input: OruBuildInput): string {
  const f = DEFAULT_ENCODING.field;
  const esc = (v: string) => escapeHl7(v);
  const lines = [
    `MSH${f}^~\\&${f}${esc(input.sendingApplication)}${f}${esc(input.sendingFacility)}${f}SIMRS${f}RS${f}${input.sentAt}${f}${f}ORU^R01${f}${esc(input.controlId)}${f}P${f}2.5`,
    `OBR${f}1${f}${f}${esc(input.specimenBarcode)}`,
    ...input.observations.map(
      (o, i) =>
        `OBX${f}${i + 1}${f}${o.valueType ?? 'NM'}${f}${esc(o.code)}^${esc(o.text)}^${o.system ?? 'LN'}${f}${f}${esc(o.value)}${f}${esc(o.unit ?? '')}${f}${esc(o.referenceRange ?? '')}${f}${f}${f}${f}${o.status ?? 'F'}`,
    ),
  ];
  return lines.join(HL7_SEGMENT_SEPARATOR);
}

/** Balasan ACK (AA = diterima untuk diproses async, AR/AE = ditolak). */
export function buildAck(controlId: string, code: 'AA' | 'AE' | 'AR', sentAt: string, text = ''): string {
  const f = DEFAULT_ENCODING.field;
  return [
    `MSH${f}^~\\&${f}SIMRS${f}RS${f}${f}${f}${sentAt}${f}${f}ACK^R01${f}ACK${escapeHl7(controlId)}${f}P${f}2.5`,
    `MSA${f}${code}${f}${escapeHl7(controlId)}${text ? `${f}${escapeHl7(text)}` : ''}`,
  ].join(HL7_SEGMENT_SEPARATOR);
}
