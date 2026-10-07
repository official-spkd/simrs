import {
  DOCUMENT_TYPES,
  detectDocumentType,
  MAX_DOCUMENT_BYTES,
  patientDocumentSchema,
  uploadDocumentSchema,
} from '@simrs/shared';
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { CLINICAL_UPLOAD_KINDS, UPLOAD_HEADER } from '@/lib/patient-documents';
import { apiUpload } from '@/lib/server/api';
import { ApiError } from '@/lib/server/api-core';
import { getSession } from '@/lib/server/session';
import { webEnv } from '@/lib/server/web-env';
import { can, nextLoginStep } from '@/lib/session-view';

const json = (status: number, body: { ok: boolean; message: string; code?: string }) =>
  Response.json(body, { status, headers: { 'cache-control': 'no-store' } });

/**
 * Baca body biner dengan batas ukuran tanpa menahan lebih dari `limit` byte di memori (pola `rawUpload` API): melebihi
 * batas → null (sisa aliran dibatalkan).
 */
async function readLimited(req: NextRequest, limit: number): Promise<Uint8Array<ArrayBuffer> | null> {
  if (!req.body) return new Uint8Array(0);
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out;
}

function header(req: NextRequest, name: string): string | null {
  const raw = req.headers.get(name);
  if (raw === null) return null;
  try {
    return decodeURIComponent(raw);
  } catch {
    return null;
  }
}

/**
 * P08 · Unggah dokumen pasien dari layar klinis lewat BFF (fase 3 · 3.8, keputusan keamanan DOC): Route Handler, bukan
 * Server Action, supaya sesi + izin + asal permintaan diperiksa SEBELUM body dibaca, dan batas body Server Action tetap
 * bawaan. Body = isi berkas (`application/octet-stream`), metadata lewat header ber-percent-encode; ukuran (10 MB) dan
 * jenis (PDF/PNG/JPEG dari isi) sama dengan API, yang tetap menegakkan izin `documents.write`, ABAC pasien, dan audit.
 */
export async function POST(req: NextRequest): Promise<Response> {
  // Hanya dari halaman SIM RS sendiri: header khusus memaksa preflight CORS (situs lain tidak bisa mengirimnya).
  const site = req.headers.get('sec-fetch-site');
  if ((site && site !== 'same-origin') || req.headers.get(UPLOAD_HEADER) !== '1') {
    return json(403, { ok: false, message: 'Unggahan harus dimulai dari layar SIM RS.' });
  }
  if (webEnv().dataSource !== 'api') {
    return json(404, { ok: false, message: 'Unggah dokumen hanya tersedia di mode api.' });
  }
  const s = await getSession();
  if (!s || nextLoginStep(s, false) !== 'selesai') {
    return json(401, { ok: false, code: 'UNAUTHENTICATED', message: 'Silakan masuk terlebih dahulu.' });
  }
  if (!can(s, 'documents', 'write')) {
    return json(403, {
      ok: false,
      code: 'FORBIDDEN',
      message: 'Peran Anda tidak berizin mengubah dokumen pasien.',
    });
  }
  const patientId = z.uuid().safeParse(req.nextUrl.searchParams.get('patientId'));
  if (!patientId.success) return json(400, { ok: false, message: 'Pasien tidak valid.' });
  const meta = uploadDocumentSchema.safeParse({
    kind: header(req, 'x-document-kind'),
    title: header(req, 'x-document-title'),
  });
  if (!meta.success || !(CLINICAL_UPLOAD_KINDS as readonly string[]).includes(meta.data.kind)) {
    return json(400, { ok: false, message: meta.error?.issues[0]?.message ?? 'Pilih jenis dokumen.' });
  }
  const type = (req.headers.get('content-type') ?? '').toLowerCase();
  if (!type.startsWith('application/octet-stream')) {
    return json(415, { ok: false, message: 'Kirim isi berkas sebagai application/octet-stream.' });
  }
  const tooLarge = {
    ok: false,
    code: 'PAYLOAD_TOO_LARGE',
    message: `Berkas maksimal ${MAX_DOCUMENT_BYTES / 1048576} MB.`,
  };
  const declared = Number(req.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_DOCUMENT_BYTES) return json(413, tooLarge);
  const bytes = await readLimited(req, MAX_DOCUMENT_BYTES);
  if (!bytes) return json(413, tooLarge);
  if (bytes.byteLength === 0) return json(400, { ok: false, message: 'Berkas kosong.' });
  if (!detectDocumentType(bytes)) {
    const kinds = Object.values(DOCUMENT_TYPES)
      .map((t) => t.label)
      .join(', ');
    return json(415, { ok: false, message: `Hanya berkas ${kinds} yang diterima.` });
  }
  const fileName = (header(req, 'x-document-filename') ?? meta.data.title).slice(0, 120);
  try {
    await apiUpload(`/api/v1/patients/${patientId.data}/documents`, {
      bytes,
      headers: {
        'x-document-kind': meta.data.kind,
        'x-document-title': meta.data.title,
        'x-document-filename': fileName,
      },
      schema: patientDocumentSchema,
    });
  } catch (err) {
    if (err instanceof ApiError) return json(err.status, { ok: false, code: err.code, message: err.message });
    return json(500, { ok: false, message: 'Unggahan gagal. Coba lagi.' });
  }
  return json(201, { ok: true, message: `Dokumen "${meta.data.title}" tersimpan.` });
}
