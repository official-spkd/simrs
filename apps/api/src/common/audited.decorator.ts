import { SetMetadata } from '@nestjs/common';
import type { AuditAction } from '@simrs/shared';
import type { Request } from 'express';

export const AUDITED_KEY = 'simrs:audited';

export interface AuditSource {
  params: Request['params'];
  /** Query string mentah (sudah lolos validasi pipe sebelum handler berjalan). */
  query: Request['query'];
  result: unknown;
}

export interface AuditedOptions {
  action: AuditAction;
  /** Jenis sumber, mis. `unit`, `patient`, `audit_chain`. */
  resource: string;
  /** Id sumber dari parameter rute atau hasil handler. */
  resourceId?: (src: AuditSource) => string | null | undefined;
  /** Id pasien bila aksi menyentuh data pasien (wajib untuk data klinis). */
  patientId?: (src: AuditSource) => string | null | undefined;
  /** Metadata tanpa PHI, mis. jumlah hasil. */
  details?: (src: AuditSource) => Record<string, unknown> | undefined;
}

/**
 * Catat aksi ini di jejak audit, dalam transaksi yang sama dengan datanya (CLAUDE.md §4.3).
 * Hanya berlaku pada controller ber-`@TenantScoped()`. Bila penulisan audit gagal, respons tidak dikirim.
 */
export const Audited = (options: AuditedOptions) => SetMetadata(AUDITED_KEY, options);

/** Ambil `id` dari hasil handler bila ada (mis. entitas yang baru dibuat). */
export const resultId = ({ result }: AuditSource): string | undefined =>
  typeof result === 'object' && result !== null && typeof (result as { id?: unknown }).id === 'string'
    ? (result as { id: string }).id
    : undefined;

/** Ambil parameter query `patientId` (mis. filter jejak audit per pasien). */
export const queryPatientId = ({ query }: AuditSource): string | undefined =>
  typeof query.patientId === 'string' ? query.patientId : undefined;

/** Ambil parameter rute `:id`. */
export const paramId = ({ params }: AuditSource): string | undefined =>
  typeof params.id === 'string' ? params.id : undefined;
