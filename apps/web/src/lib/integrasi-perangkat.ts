/**
 * I06 · Device gateway (simulasi, mode presentasi ADR-0023): pesan HL7 v2 ORU^R01 dari analyzer → disimpan dengan
 * PID tersamar → cocokkan nomor lab (accession) dengan spesimen yang sudah diterima → hasil masuk sebagai DRAF
 * (validasi analis S01; nilai kritis S09 setelah validasi). ACK: AA diterima, AE galat data (accession tak dikenal,
 * spesimen belum diterima), AR ditolak (bukan ORU/format rusak). `control_id` ganda idempoten. Rencana fase 7 §7.7.
 */

export interface Observation {
  loinc: string;
  name: string;
  value: string;
  unit: string;
  ref: string;
  flag: string;
}

export interface ParsedOru {
  controlId: string;
  device: string;
  accession: string;
  observations: Observation[];
}

export type ParseResult = { ok: true; msg: ParsedOru } | { ok: false; reason: string };

/** Parser ORU^R01 sederhana (segmen dipisah baris baru atau CR; field `|`; komponen `^`). */
export function parseOru(raw: string): ParseResult {
  const segs = raw
    .split(/\r?\n|\r/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => s.split('|'));
  const msh = segs.find((s) => s[0] === 'MSH');
  if (!msh) return { ok: false, reason: 'Segmen MSH tidak ada' };
  // MSH-1 adalah pemisah field itu sendiri, jadi indeks field MSH bergeser satu.
  const type = msh[8] ?? '';
  if (!type.startsWith('ORU^R01'))
    return { ok: false, reason: `Jenis pesan ${type || '(kosong)'} bukan ORU^R01` };
  const controlId = msh[9] ?? '';
  if (!controlId) return { ok: false, reason: 'MSH-10 (control ID) kosong' };
  const obr = segs.find((s) => s[0] === 'OBR');
  const accession = obr?.[2] ?? '';
  if (!accession) return { ok: false, reason: 'OBR-2 (nomor lab) kosong' };
  const observations = segs
    .filter((s) => s[0] === 'OBX')
    .map((s) => {
      const [loinc = '', name = ''] = (s[3] ?? '').split('^');
      return { loinc, name, value: s[5] ?? '', unit: s[6] ?? '', ref: s[7] ?? '', flag: s[8] ?? '' };
    });
  if (observations.length === 0) return { ok: false, reason: 'Tidak ada segmen OBX' };
  return { ok: true, msg: { controlId, device: msh[2] ?? '', accession, observations } };
}

/** Samarkan PID: hanya nama segmen yang tersisa (identitas pasien tidak disimpan di log gateway). */
export function redactPid(raw: string): string {
  return raw
    .split(/\r?\n|\r/)
    .map((line) => (line.startsWith('PID|') ? 'PID|||•••' : line))
    .join('\n');
}

export interface Specimen {
  labNo: string;
  patientName: string;
  received: boolean;
}

export type Ack = 'AA' | 'AE' | 'AR';

export interface InboundResult {
  ack: Ack;
  status: 'dicocokkan' | 'duplikat' | 'ditolak';
  text: string;
  accession: string | null;
  controlId: string | null;
  observations: Observation[];
}

/** Proses satu pesan masuk terhadap spesimen yang dikenal dan control ID yang sudah diproses. */
export function processInbound(
  raw: string,
  specimens: readonly Specimen[],
  processed: ReadonlySet<string>,
  allowedLoinc: ReadonlySet<string>,
): InboundResult {
  const p = parseOru(raw);
  if (!p.ok)
    return {
      ack: 'AR',
      status: 'ditolak',
      text: `Ditolak: ${p.reason}`,
      accession: null,
      controlId: null,
      observations: [],
    };
  const { msg } = p;
  const base = { accession: msg.accession, controlId: msg.controlId, observations: msg.observations };
  if (processed.has(msg.controlId))
    return {
      ...base,
      ack: 'AA',
      status: 'duplikat',
      text: `Duplikat ${msg.controlId}: ACK ulang tanpa memproses ulang (idempoten)`,
    };
  const sp = specimens.find((s) => s.labNo === msg.accession);
  if (!sp) return { ...base, ack: 'AE', status: 'ditolak', text: `Nomor lab ${msg.accession} tidak dikenal` };
  if (!sp.received)
    return {
      ...base,
      ack: 'AE',
      status: 'ditolak',
      text: `Spesimen ${msg.accession} belum diterima laboratorium`,
    };
  const unmapped = msg.observations.filter((o) => !allowedLoinc.has(o.loinc));
  if (unmapped.length)
    return {
      ...base,
      ack: 'AE',
      status: 'ditolak',
      text: `Kode ${unmapped.map((o) => o.loinc).join(', ')} belum dipetakan ke katalog lab`,
    };
  return {
    ...base,
    ack: 'AA',
    status: 'dicocokkan',
    text: `${msg.observations.length} hasil masuk ke ${msg.accession} (${sp.patientName}) sebagai draf · menunggu validasi analis`,
  };
}
