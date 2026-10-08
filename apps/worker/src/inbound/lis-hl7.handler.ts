import {
  type InboundEvent,
  insertLabResult,
  labOrderTests,
  labValueText,
  prepareLabResult,
  raiseCriticalResult,
  refreshLabOrderProgress,
} from '@simrs/db';
import { Hl7ParseError, parseOru } from '@simrs/shared';
import {
  type InboundHandler,
  type InboundHandlerContext,
  PermanentInboundError,
  RetryableInboundError,
} from './handlers';

/** Jam HL7 `YYYYMMDDHHMM[SS]` (WIB bila tanpa zona) → Date; null bila tidak sah. */
export function hl7Instant(v: string | null): Date | null {
  const m = v ? /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?([+-]\d{4})?/.exec(v) : null;
  if (!m) return null;
  const zone = m[7] ? `${m[7].slice(0, 3)}:${m[7].slice(3)}` : '+07:00';
  const d = new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6] ?? '00'}${zone}`);
  return Number.isNaN(d.getTime()) ? null : d;
}

const ORDER_LOCKED = new Set(['validasi_teknis', 'selesai', 'batal']);

/**
 * S01 · Penangan pesan analyzer `lis-hl7` (rencana fase 4 §4.2, ADR-0035): ORU^R01 yang sudah diredaksi (daftar izin
 * segmen) dicocokkan HANYA lewat pengenal order/spesimen (OBR-3/OBR-2, ORC-3/ORC-2, SPM-2), lalu tiap OBX yang kodenya dikenali (kode analyzer atau LOINC tes order itu)
 * menjadi hasil lab bersumber `analyzer` (merujuk pesan ini), berstatus awal sampai divalidasi manusia (tanpa
 * autoverifikasi). Flag/rentang/delta dihitung inti `@simrs/db` yang sama dengan input manual; hasil kritis memunculkan
 * nilai kritis + event `critical_result.raised` (event worker, reaksinya lewat SSE `support_critical`).
 *
 * - barcode tak dikenal / belum dibuat saat pesan diterima / order batal / tidak ada kode yang dikenali → `dead`
 *   (permanen, tampil di layar Lab),
 * - spesimen belum diterima lab → dicoba lagi (backoff) sampai diterima,
 * - OBX tertunda (`P`/tanpa nilai) dilewati; hasil yang sama persis dari analyzer tidak ditulis ulang; hasil berbeda
 *   menjadi versi baru (koreksi beralasan) selama order belum divalidasi; setelah validasi, hasil ulang alat ditolak
 *   (koreksi lewat layar, oleh manusia).
 */
export const lisHl7Handler: InboundHandler = {
  async handle(event: InboundEvent, ctx: InboundHandlerContext): Promise<void> {
    let msg;
    try {
      msg = parseOru(event.rawBody);
    } catch (err) {
      if (err instanceof Hl7ParseError)
        throw new PermanentInboundError(`Pesan HL7 tidak bisa diurai: ${err.message}`);
      throw err;
    }
    const { tx, tenantId } = ctx;
    let valued = 0;
    let matched = 0;
    for (const o of msg.orders) {
      // Cocok hanya lewat pengenal order/spesimen (OBR-3/OBR-2, ORC, SPM-2), tidak pernah lewat PID/PV1.
      const candidates = [...new Set(o.identifiers.map((id) => id.toUpperCase()))];
      const specimen = await tx.specimen.findFirst({
        where: { barcode: { in: candidates } },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          barcode: true,
          status: true,
          specimenType: true,
          receivedBy: true,
          createdAt: true,
          labOrder: { select: { id: true, status: true, patientId: true, encounterId: true } },
        },
      });
      if (!specimen) {
        throw new PermanentInboundError(
          `Barcode spesimen ${candidates.join('/').slice(0, 120)} tidak dikenal`,
        );
      }
      // Label belum dicetak saat pesan diterima = pesan lama/salah barcode (nomor lab harian bisa terpakai ulang).
      if (event.receivedAt.getTime() < specimen.createdAt.getTime()) {
        throw new PermanentInboundError(
          `Barcode spesimen ${specimen.barcode} belum dibuat saat pesan diterima`,
        );
      }
      const order = specimen.labOrder;
      if (order.status === 'batal')
        throw new PermanentInboundError(`Order lab untuk ${specimen.barcode} sudah batal`);
      if (specimen.status === 'ditolak') {
        throw new PermanentInboundError(`Spesimen ${specimen.barcode} ditolak lab; hasil alat diabaikan`);
      }
      if (specimen.status !== 'diterima' || !specimen.receivedBy) {
        throw new RetryableInboundError(`Spesimen ${specimen.barcode} belum diterima lab`);
      }
      const tests = (await labOrderTests(tx, order.id)).filter(
        (t) => t.specimenType === specimen.specimenType,
      );
      for (const obs of o.observations) {
        if (obs.resultStatus === 'P' || obs.value.trim() === '') continue;
        valued += 1;
        const def = tests.find((t) => t.analyzerCode === obs.code || t.loinc === obs.code);
        if (!def) continue;
        matched += 1;
        const numeric = def.resultType === 'numeric';
        if (numeric && obs.numeric === null) continue;
        const valueNumeric = numeric ? obs.numeric : null;
        const valueText = numeric ? null : obs.value.trim().slice(0, 200);
        const [current] = await tx.$queryRaw<
          Array<{
            id: string;
            root_id: string;
            version: number;
            value_numeric: string | null;
            value_text: string | null;
          }>
        >`
          SELECT id::text AS id, root_id::text AS root_id, version, value_numeric::text AS value_numeric, value_text
          FROM lab_results_current
          WHERE lab_order_id = ${order.id}::uuid AND test_definition_id = ${def.id}::uuid AND status = 'final'
          ORDER BY recorded_at DESC LIMIT 1`;
        if (current) {
          const same = numeric
            ? current.value_numeric !== null && Number(current.value_numeric) === valueNumeric
            : current.value_text === valueText;
          if (same) continue;
          if (ORDER_LOCKED.has(order.status)) {
            throw new PermanentInboundError(
              `Hasil ulang alat untuk ${specimen.barcode} ditolak: order sudah divalidasi (koreksi lewat layar Lab)`,
            );
          }
        }
        const observed = hl7Instant(obs.observedAt) ?? hl7Instant(msg.sentAt) ?? ctx.now;
        const occurredAt = observed.getTime() > ctx.now.getTime() ? ctx.now : observed;
        const fields = await prepareLabResult(tx, { order, def, valueNumeric, valueText, occurredAt });
        const labResultId = await insertLabResult(tx, tenantId, {
          ...fields,
          occurredAt,
          // Pencatat = petugas yang menerima spesimen (alat bukan pengguna); peran `analyzer` menandai sumbernya.
          authorUserId: specimen.receivedBy,
          authorRole: 'analyzer',
          source: 'analyzer',
          inboundEventId: event.id,
          comment: obs.notes.join(' ').slice(0, 500) || null,
          correction: current
            ? {
                supersedesId: current.id,
                rootId: current.root_id,
                version: current.version,
                reason: `Hasil ulang dari analyzer (pesan ${msg.controlId.slice(0, 60)})`,
              }
            : null,
        });
        if (fields.flag === 'KRITIS') {
          const c = await raiseCriticalResult(tx, tenantId, {
            source: 'lab',
            labResultId,
            analyte: def.name,
            valueText: labValueText(fields),
            raisedBy: null,
          });
          if (c.created) {
            await ctx.recordEvent('critical_result.raised', {
              criticalResultId: c.id,
              source: 'lab',
              sourceId: labResultId,
              encounterId: c.encounterId,
              patientId: c.patientId,
              unitId: c.unitId,
              limitMinutes: c.limitMinutes,
            });
          }
        }
      }
      await refreshLabOrderProgress(tx, tenantId, order.id, null);
    }
    if (valued > 0 && matched === 0) {
      // Ada hasil bernilai, tetapi tidak satu pun kodenya dipetakan ke tes order spesimen itu.
      throw new PermanentInboundError('Tidak ada kode tes analyzer yang cocok dengan order spesimen ini');
    }
  },
};
