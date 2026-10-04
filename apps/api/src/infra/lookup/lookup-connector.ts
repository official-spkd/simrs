import type { AuditAction } from '@simrs/shared';

/** Batas waktu satu lookup sinkron ke sistem luar (ADR-0025). Konektor boleh lebih pendek, tidak boleh lebih lama. */
export const LOOKUP_TIMEOUT_MS = 5_000;

/** Sistem luar yang boleh di-lookup sinkron. Penulisan ke sistem mana pun tetap lewat outbox. */
export const LOOKUP_TARGETS = ['bpjs', 'dukcapil'] as const;
export type LookupTarget = (typeof LOOKUP_TARGETS)[number];

/** Ringkasan hasil untuk audit: hanya fakta tanpa PHI (mis. `{ found: true, active: false }`). */
export type LookupSummary = Record<string, string | number | boolean | null>;

/**
 * Satu operasi baca-saja ke sistem luar (mis. VClaim peserta, VClaim rujukan, Dukcapil demografi).
 * Implementasi nyata (klien BPJS bersama di `@simrs/shared/node`, potongan 5a) dibungkus jadi konektor ini dan
 * disuntikkan ke service domain lewat token DI milik modulnya; tes memakai konektor palsu.
 *
 * Aturan:
 * - `call` WAJIB menghormati `signal` (dibatalkan saat batas waktu) dan tidak menulis apa pun ke sistem luar.
 * - Penolakan bisnis yang perlu tampil ke pengguna dilempar sebagai `AppError` berkode stabil; galat lain (jaringan,
 *   5xx, respons rusak) dianggap "layanan tidak tersedia" → 503.
 * - Masukan dan keluaran boleh memuat PHI (NIK, no. kartu): gateway tidak pernah mencatatnya ke log atau audit.
 */
export interface LookupConnector<I, O> {
  /** Nama stabil `<sistem>.<layanan>.<operasi>`, mis. `bpjs.vclaim.peserta`. Jadi `resource_type` audit. */
  readonly name: string;
  readonly target: LookupTarget;
  /** Aksi audit; bawaan `read`. */
  readonly auditAction?: Extract<AuditAction, 'read' | 'search' | 'verify'>;
  /** Batas waktu khusus (ms), dipotong ke `LOOKUP_TIMEOUT_MS`. */
  readonly timeoutMs?: number;
  call(input: I, signal: AbortSignal): Promise<O>;
  /** Fakta hasil tanpa PHI untuk audit "selesai". */
  summarize?(output: O): LookupSummary;
}

/** Nama konektor yang sah (huruf kecil, angka, titik, garis bawah). */
export const LOOKUP_NAME = /^[a-z][a-z0-9_]*(?:\.[a-z0-9_]+){1,4}$/;
