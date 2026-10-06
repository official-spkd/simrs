/**
 * I02 · Konektor SATUSEHAT per kunjungan (mode presentasi, ADR-0023). Urutan kirim (rencana fase 7 §7.3b):
 * Encounter → anak (Condition, Observation, Procedure, MedicationRequest, Composition) → Encounter selesai dengan
 * diagnosis. Anak ditahan (`held`) selama Encounter belum terkirim; Encounter selesai ditahan sampai semua anak
 * terkirim. Galat 4xx = permanen → langsung DLQ (tanpa retry); perbaiki data → kirim ulang berkonfirmasi dan diaudit.
 * Payload ditampilkan tersamar (tanpa NIK/nama).
 */

export type ResourceType =
  | 'Encounter'
  | 'Condition'
  | 'Observation'
  | 'Procedure'
  | 'MedicationRequest'
  | 'Composition'
  | 'Encounter selesai';

export type ResourceStatus = 'terkirim' | 'antre' | 'ditahan' | 'gagal';

export const STATUS_VIEW: Record<
  ResourceStatus,
  { label: string; tone: 'success' | 'info' | 'warning' | 'danger' }
> = {
  terkirim: { label: 'Terkirim', tone: 'success' },
  antre: { label: 'Antre kirim', tone: 'info' },
  ditahan: { label: 'Ditahan', tone: 'warning' },
  gagal: { label: 'Gagal · DLQ', tone: 'danger' },
};

/** Perbaikan data yang dibutuhkan sebelum kirim ulang. */
export type FixKind = 'ihs' | 'loinc' | 'kfa';

export interface FhirResource {
  id: string;
  type: ResourceType;
  label: string;
  /** Kode baku yang dikirim (mis. "ICD-10 E11.9", "LOINC 2345-7"). */
  code: string | null;
  at: string | null;
  /** Status kirim yang tersimpan (sebelum aturan urutan diterapkan). */
  sent: boolean;
  /** ID resource di SATUSEHAT setelah 201 (tersamar). */
  resourceId: string | null;
  error: {
    httpStatus: 400 | 422;
    code: string;
    message: string;
    dlqId: string;
    fix: FixKind;
    /** Ringkasan perbaikan yang dibutuhkan. */
    fixLabel: string;
    /** Perbaikan tidak bisa dilakukan dari layar integrasi (mis. menunggu farmasi). */
    blockedReason: string | null;
  } | null;
  /** Alasan ditahan bila bukan karena urutan (mis. resume belum TTE). */
  holdReason: string | null;
  payload: Readonly<Record<string, unknown>>;
}

export interface Visit {
  id: string;
  encounterNo: string;
  kind: 'Rawat jalan' | 'Rawat inap' | 'IGD';
  unit: string;
  patient: { name: string; rm: string; nikMasked: string; ihs: string | null; ihsFound: string };
  resources: readonly FhirResource[];
}

export interface AuditEntry {
  at: string;
  by: string;
  action: string;
}

/**
 * Status efektif tiap resource menurut aturan urutan: anak ditahan selama Encounter belum terkirim (atau gagal);
 * Encounter selesai ditahan sampai semua anak terkirim.
 */
export function effectiveStatus(v: Visit): Record<string, ResourceStatus> {
  const out: Record<string, ResourceStatus> = {};
  const enc = v.resources.find((r) => r.type === 'Encounter');
  const encSent = !!enc?.sent;
  const children = v.resources.filter((r) => r.type !== 'Encounter' && r.type !== 'Encounter selesai');
  for (const r of v.resources) {
    if (r.sent) out[r.id] = 'terkirim';
    else if (r.error) out[r.id] = 'gagal';
    else if (r.type === 'Encounter') out[r.id] = 'antre';
    else if (r.type === 'Encounter selesai') out[r.id] = 'ditahan';
    else if (!encSent || r.holdReason) out[r.id] = 'ditahan';
    else out[r.id] = 'antre';
  }
  const fin = v.resources.find((r) => r.type === 'Encounter selesai');
  if (fin && !fin.sent && encSent && children.every((c) => c.sent)) out[fin.id] = 'antre';
  return out;
}

/** Alasan ditahan yang ditampilkan ke petugas. */
export function holdText(v: Visit, r: FhirResource): string | null {
  const st = effectiveStatus(v)[r.id];
  if (st !== 'ditahan') return null;
  if (r.holdReason) return r.holdReason;
  if (r.type === 'Encounter selesai') return 'menunggu semua resource anak terkirim';
  return 'menunggu Encounter terkirim';
}

const SENSITIVE = /^(nik|name|nama|birthDate|telecom|address|alamat)$/i;

/** Samarkan payload: kunci identitas diganti "•••", ID panjang disisakan 4 karakter terakhir. */
export function maskPayload(value: unknown, key = ''): unknown {
  if (Array.isArray(value)) return value.map((v) => maskPayload(v, key));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, maskPayload(v, k)]));
  }
  if (typeof value === 'string') {
    if (SENSITIVE.test(key)) return '•••';
    const ref = /^(Patient|Practitioner)\/(\w+)$/.exec(value);
    if (ref?.[2]) return `${ref[1]}/${'•'.repeat(Math.max(0, ref[2].length - 4))}${ref[2].slice(-4)}`;
  }
  return value;
}

/** ID tersamar: hanya 4 karakter terakhir ("••••••••5538"). */
export function maskId(id: string): string {
  return `${'•'.repeat(Math.max(0, id.length - 4))}${id.slice(-4)}`;
}

export interface FixState {
  ihs: boolean;
  loinc: boolean;
  kfa: boolean;
}

export type ResendBlock = 'NOT_FAILED' | 'FIX_REQUIRED' | 'FIX_BLOCKED' | null;

export function resendGate(r: FhirResource, fixed: FixState): ResendBlock {
  if (!r.error) return 'NOT_FAILED';
  if (r.error.blockedReason) return 'FIX_BLOCKED';
  if (!fixed[r.error.fix]) return 'FIX_REQUIRED';
  return null;
}

/**
 * Kirim ulang (simulasi): resource gagal → terkirim, lalu antrean dilepas berurutan: anak yang menunggu Encounter
 * ikut terkirim, dan Encounter selesai terkirim bila semua anak sudah terkirim. Mengembalikan kunjungan baru dan
 * daftar resource yang ikut terkirim.
 */
export function resend(
  v: Visit,
  resourceId: string,
  nextId: (type: string) => string,
): { visit: Visit; released: string[] } {
  let resources = v.resources.map((r) =>
    r.id === resourceId ? { ...r, sent: true, error: null, resourceId: nextId(r.type) } : r,
  );
  const released: string[] = [];
  // Lepas berurutan: anak tanpa galat/tahan lain, lalu Encounter selesai.
  for (let guard = 0; guard < 3; guard++) {
    const st = effectiveStatus({ ...v, resources });
    resources = resources.map((r) => {
      if (st[r.id] === 'antre') {
        released.push(r.label);
        return { ...r, sent: true, resourceId: nextId(r.type) };
      }
      return r;
    });
  }
  return { visit: { ...v, resources }, released };
}

/** Ringkasan kunjungan: terkirim/total, gagal, ditahan. */
export function visitSummary(v: Visit) {
  const st = Object.values(effectiveStatus(v));
  return {
    total: st.length,
    sent: st.filter((s) => s === 'terkirim').length,
    failed: st.filter((s) => s === 'gagal').length,
    held: st.filter((s) => s === 'ditahan').length,
  };
}

/** Kepatuhan per jenis resource dari daftar kunjungan (persen terkirim). */
export function complianceByType(
  visits: readonly Visit[],
): Array<{ type: ResourceType; sent: number; total: number }> {
  const map = new Map<ResourceType, { sent: number; total: number }>();
  for (const v of visits) {
    const st = effectiveStatus(v);
    for (const r of v.resources) {
      const cur = map.get(r.type) ?? { sent: 0, total: 0 };
      map.set(r.type, { sent: cur.sent + (st[r.id] === 'terkirim' ? 1 : 0), total: cur.total + 1 });
    }
  }
  return [...map.entries()].map(([type, x]) => ({ type, ...x }));
}
