import { newId, type TteSignRequest, tteSignResponseSchema } from '@simrs/shared';
import { z } from 'zod';
import { type OutboxOperation, PermanentOperationError } from './operation-types';

/** Payload pesan: hanya ID tanda tangan; hash dan penanda tangan dibaca saat dikirim. */
const payloadSchema = z.object({ signatureId: z.uuid() });

function readPayload(payload: unknown) {
  const p = payloadSchema.safeParse(payload);
  if (!p.success) throw new PermanentOperationError('Payload TTE tidak dikenali');
  return p.data;
}

/**
 * P08 → penyelenggara TTE (mock lokal `/tte/sign`): tanda tangani HASH dokumen (isi berkas tidak dikirim), simpan
 * sertifikat + tanda tangan secara atomik dengan pencatatan percobaan, dan catat di jejak audit sebagai `system`.
 * Tanda tangan yang sudah selesai dilewati (pengiriman ulang tidak menimpa).
 */
export const tteSignDocument: OutboxOperation = {
  async prepare(msg, ctx) {
    const { signatureId } = readPayload(msg.payload);
    const sig = await ctx.read((tx) =>
      tx.documentSignature.findUnique({
        where: { id: signatureId },
        select: { status: true, documentSha256: true, signerUserId: true },
      }),
    );
    if (!sig) return { skip: 'tanda tangan tidak ditemukan' };
    if (sig.status !== 'pending') return { skip: 'tanda tangan sudah selesai' };
    const body: TteSignRequest = { documentHash: sig.documentSha256, signerId: sig.signerUserId };
    return { method: 'POST', path: '/tte/sign', body };
  },

  async onSuccess(tx, msg, responseBody) {
    const { signatureId } = readPayload(msg.payload);
    let json: unknown;
    try {
      json = JSON.parse(responseBody);
    } catch {
      throw new PermanentOperationError('Respons TTE bukan JSON');
    }
    const res = tteSignResponseSchema.safeParse(json);
    if (!res.success) throw new PermanentOperationError('Respons TTE tidak dikenali');
    const updated = await tx.documentSignature.updateManyAndReturn({
      where: { id: signatureId, status: 'pending' },
      data: {
        status: 'signed',
        signedAt: new Date(res.data.signedAt),
        certificate: res.data.certificate,
        signature: res.data.signature,
        providerSignatureId: res.data.signatureId,
      },
      select: { documentId: true, document: { select: { patientId: true } } },
    });
    const row = updated[0];
    if (!row) return;
    await tx.auditEvent.create({
      data: {
        id: newId(),
        tenantId: msg.tenantId,
        actorUserId: null,
        actorRole: 'system',
        patientId: row.document.patientId,
        resourceType: 'document',
        resourceId: row.documentId,
        action: 'sign',
        details: { status: 'signed', signatureId, outboxMessageId: msg.id },
      },
    });
  },
};
