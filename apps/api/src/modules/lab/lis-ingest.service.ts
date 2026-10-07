import { Inject, Injectable } from '@nestjs/common';
import { storeInboundEvent } from '@simrs/db';
import { AppError, buildAck, Hl7ParseError, parseOru, redactHl7 } from '@simrs/shared';
import { decryptField, verifyLisSignature } from '@simrs/shared/node';
import { requestContext } from '../../common/request-context';
import { API_ENV, type ApiEnv } from '../../config/env';
import { auditMetaOf, writeAudit } from '../../infra/audit-writer';
import { PrismaService } from '../../infra/prisma.service';
import { TenantDb } from '../../infra/tenant-db';

export interface LisIngestHeaders {
  timestamp: string | undefined;
  signature: string | undefined;
  contentType: string | undefined;
}

/** Jawaban ingest: status HTTP + ACK HL7 v2 (`MSA-1` AA/AR). */
export interface LisIngestReply {
  status: 200 | 400 | 409;
  ack: string;
  /** Id `inbound_events` (untuk audit; tidak dikirim ke perangkat). */
  inboundEventId: string | null;
  duplicate: boolean;
}

/** MSH-10 dipakai sebagai idempotency key (CHECK `inbound_events` maks. 200). */
const MAX_CONTROL_ID = 199;

/** Waktu HL7 `YYYYMMDDHHMMSS` dalam WIB untuk MSH-7 ACK. */
export function hl7Now(d = new Date()): string {
  return new Date(d.getTime() + 7 * 3_600_000).toISOString().slice(0, 19).replace(/[-T:]/g, '');
}

/**
 * S01 · Ingest hasil analyzer (rencana fase 4 §4.1a, keputusan no. 4). Endpoint perangkat `lab.analyzer.ingest`:
 * 1. HMAC perangkat atas `timestamp.body` (≤ 5 menit) dengan kunci HMAC perangkat (terenkripsi, `device_hmac`);
 *    salah/kedaluwarsa → 401 tanpa menyimpan pesan (penolakan diaudit dan di-commit),
 * 2. ORU^R01 diurai seperlunya (MSH-10 = idempotency key); bukan ORU/MSH-10 kosong → 400 + ACK AR,
 * 3. PID/NK1 diredaksi lalu disimpan ke `inbound_events` (`lis-hl7`) sekali per MSH-10; kiriman ulang yang sama →
 *    ACK AA lagi tanpa baris baru; MSH-10 sama dengan isi berbeda → 409 + ACK AR,
 * 4. ACK AA = DITERIMA (belum diproses): hasil dicocokkan ke spesimen oleh worker (penangan `lis-hl7`, potongan 4.2).
 */
@Injectable()
export class LisIngestService {
  constructor(
    @Inject(API_ENV) private readonly env: ApiEnv,
    private readonly db: TenantDb,
    private readonly prisma: PrismaService,
  ) {}

  async ingest(body: Buffer, h: LisIngestHeaders): Promise<LisIngestReply> {
    const device = this.db.actor().devicePrincipal;
    if (!device || device.kind !== 'lab_analyzer') {
      throw new AppError('FORBIDDEN', 'Hanya analyzer laboratorium terdaftar', 403);
    }
    const tenantId = this.db.tenantId();
    const raw = body.toString('utf8');
    await this.verifySignature(tenantId, device.id, raw, h);

    const sentAt = hl7Now();
    let controlId: string;
    try {
      controlId = parseOru(raw).controlId;
    } catch (err) {
      if (!(err instanceof Hl7ParseError)) throw err;
      return {
        status: 400,
        ack: buildAck('', 'AR', sentAt, err.message),
        inboundEventId: null,
        duplicate: false,
      };
    }
    if (controlId.length > MAX_CONTROL_ID) {
      return {
        status: 400,
        ack: buildAck(controlId.slice(0, 20), 'AR', sentAt, 'MSH-10 terlalu panjang'),
        inboundEventId: null,
        duplicate: false,
      };
    }
    const stored = await storeInboundEvent(this.db.tx(), tenantId, {
      source: 'lis-hl7',
      idempotencyKey: controlId,
      // Header aman saja: tanpa Authorization/tanda tangan.
      headers: {
        contentType: h.contentType?.slice(0, 100) ?? null,
        timestamp: h.timestamp?.slice(0, 40) ?? null,
      },
      rawBody: redactHl7(raw),
      deviceId: device.id,
    });
    this.db.audit({
      action: 'create',
      resourceType: 'inbound_event',
      resourceId: stored.id,
      outcome: stored.kind === 'conflict' ? 'denied' : 'success',
      details: { source: 'lis-hl7', result: stored.kind },
    });
    if (stored.kind === 'conflict') {
      return {
        status: 409,
        ack: buildAck(controlId, 'AR', sentAt, 'MSH-10 sudah dipakai pesan lain'),
        inboundEventId: stored.id,
        duplicate: false,
      };
    }
    return {
      status: 200,
      ack: buildAck(controlId, 'AA', sentAt),
      inboundEventId: stored.id,
      duplicate: stored.kind === 'duplicate',
    };
  }

  /** Tanda tangan salah/kedaluwarsa: catat penolakan (commit terpisah dari transaksi permintaan) lalu 401. */
  private async verifySignature(tenantId: string, deviceId: string, raw: string, h: LisIngestHeaders) {
    const row = await this.db.tx().registeredDevice.findUnique({
      where: { id: deviceId },
      select: { hmacKeyEnc: true },
    });
    const secret = row?.hmacKeyEnc
      ? decryptField(row.hmacKeyEnc, { ring: this.env.fieldKeys.enc, tenantId, purpose: 'device_hmac' })
      : null;
    const result =
      secret && h.timestamp && h.signature
        ? verifyLisSignature({ timestamp: h.timestamp, signature: h.signature, rawBody: raw, secret })
        : ({ ok: false, reason: 'SIGNATURE_INVALID' } as const);
    if (result.ok) return;
    const ctx = requestContext.getStore();
    if (ctx) {
      await this.prisma.forTenant(tenantId, (tx) =>
        writeAudit(tx, tenantId, auditMetaOf(ctx), [
          {
            action: 'access_denied',
            resourceType: 'inbound_event',
            outcome: 'denied',
            details: { source: 'lis-hl7', reason: result.reason },
          },
        ]),
      );
    }
    throw new AppError(
      'UNAUTHENTICATED',
      result.reason === 'TIMESTAMP_EXPIRED'
        ? 'Cap waktu perangkat di luar batas 5 menit'
        : 'Tanda tangan perangkat tidak sah',
      401,
      { reason: result.reason },
    );
  }
}
