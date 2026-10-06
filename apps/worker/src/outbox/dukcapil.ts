import type { Prisma } from '@simrs/db';
import {
  type DukcapilVerifyRequest,
  dukcapilVerifyResponseSchema,
  type IdentifierVerification,
  newId,
} from '@simrs/shared';
import { z } from 'zod';
import { type OutboxOperation, PermanentOperationError } from './operation-types';

/** Payload pesan: hanya ID (tanpa NIK/nama), NIK dibaca dan didekripsi saat dikirim. */
const payloadSchema = z.object({ patientId: z.uuid(), identifierId: z.uuid() });

/** Elemen Dukcapil → nama atribut MPI (untuk detail hasil, tanpa nilai). */
const FIELD: Record<'nama' | 'tanggalLahir' | 'jenisKelamin', string> = {
  nama: 'name',
  tanggalLahir: 'birthDate',
  jenisKelamin: 'sex',
};

function readPayload(payload: unknown) {
  const p = payloadSchema.safeParse(payload);
  if (!p.success) throw new PermanentOperationError('Payload verifikasi NIK tidak dikenali');
  return p.data;
}

/**
 * P05 → I05 · Verifikasi NIK pasien ke Dukcapil (mock lokal): cocokkan NIK + nama + tanggal lahir + jenis
 * kelamin, simpan hasil per elemen (tanpa nilai) di `patient_identifiers`, dan catat di jejak audit sebagai
 * pelaku `system`. NIK yang sudah diganti sebelum terkirim dilewati.
 */
export const dukcapilVerifyNik: OutboxOperation = {
  // Respons Dukcapil nyata (galat/elemen) bisa menggemakan NIK atau nama: potongannya tidak disimpan.
  sensitive: true,
  async prepare(msg, ctx) {
    const { patientId, identifierId } = readPayload(msg.payload);
    const ident = await ctx.read((tx) =>
      tx.patientIdentifier.findUnique({
        where: { id: identifierId },
        select: {
          system: true,
          active: true,
          patientId: true,
          valueEnc: true,
          patient: { select: { name: true, birthDate: true, sex: true } },
        },
      }),
    );
    if (!ident || ident.system !== 'nik' || ident.patientId !== patientId) {
      return { skip: 'identifier tidak ditemukan' };
    }
    if (!ident.active) return { skip: 'NIK sudah diganti' };
    const { patient } = ident;
    const body: DukcapilVerifyRequest = {
      nik: ctx.crypto.decryptIdentifier(ident.valueEnc),
      nama: patient.name,
      ...(patient.birthDate ? { tanggalLahir: patient.birthDate.toISOString().slice(0, 10) } : {}),
      ...(patient.sex === 'male' ? { jenisKelamin: 'L' as const } : {}),
      ...(patient.sex === 'female' ? { jenisKelamin: 'P' as const } : {}),
    };
    return { method: 'POST', path: '/dukcapil/verify-data', body };
  },

  async onSuccess(tx, msg, responseBody) {
    const { patientId, identifierId } = readPayload(msg.payload);
    let json: unknown;
    try {
      json = JSON.parse(responseBody);
    } catch {
      throw new PermanentOperationError('Respons Dukcapil bukan JSON');
    }
    const res = dukcapilVerifyResponseSchema.safeParse(json);
    if (!res.success) throw new PermanentOperationError('Respons Dukcapil tidak dikenali');
    const mismatched = res.data.match
      ? (Object.entries(res.data.match) as Array<[keyof typeof FIELD, boolean | null]>)
          .filter(([, ok]) => ok === false)
          .map(([k]) => FIELD[k])
      : [];
    const outcome: IdentifierVerification = !res.data.found
      ? 'not_found'
      : mismatched.length > 0
        ? 'mismatch'
        : 'verified';

    // Hanya NIK yang masih aktif dan masih menunggu hasil (permintaan lebih baru/NIK pengganti tidak ditimpa).
    const current = await tx.patientIdentifier.findFirst({
      where: { id: identifierId, active: true, verificationStatus: 'pending' },
      select: { verificationDetails: true },
    });
    if (!current) return;
    const previous = (current.verificationDetails ?? {}) as Prisma.JsonObject;
    const checkedAt = new Date();
    await tx.patientIdentifier.update({
      where: { id: identifierId },
      data: {
        verificationStatus: outcome,
        verifiedAt: checkedAt,
        verificationDetails: {
          ...previous,
          source: 'dukcapil',
          mismatched,
          checkedAt: checkedAt.toISOString(),
        },
      },
    });
    await tx.auditEvent.create({
      data: {
        id: newId(),
        tenantId: msg.tenantId,
        actorUserId: null,
        actorRole: 'system',
        patientId,
        resourceType: 'patient_identifier',
        resourceId: identifierId,
        action: 'verify',
        details: { source: 'dukcapil', outcome, mismatched, outboxMessageId: msg.id },
      },
    });
  },
};
