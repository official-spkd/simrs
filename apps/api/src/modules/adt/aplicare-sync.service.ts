import { Injectable } from '@nestjs/common';
import { enqueueOutbox } from '@simrs/db';
import { BPJS_APLICARE_UPDATE_OPERATION, CLINICAL_OPERATIONS, clinicalOutboxKey, newId } from '@simrs/shared';
import { TenantDb } from '../../infra/tenant-db';
import { aplicareRoomCode, CARE_CLASS_LABEL } from './adt-helpers';

/**
 * K05 · Aplicare dari papan bed (utang fase 2, keputusan fase 3 butir 3.3): setiap perubahan status bed rawat inap
 * menaikkan revisi ruang Aplicare (bangsal × kelas, `aplicare_rooms`) dan mengantrekan `bpjs.aplicare.update` di
 * transaksi yang sama. Pesan hanya `{ roomId, revision }`; worker menghitung kapasitas/tersedia terbaru saat mengirim,
 * membaca kode kelas resmi dari referensi Aplicare, dan mendaftarkan ruang bila belum ada. Bed tanpa kelas (IGD) dan
 * unit bukan rawat inap tidak dilaporkan.
 */
@Injectable()
export class AplicareSyncService {
  constructor(private readonly db: TenantDb) {}

  async touch(locationId: string): Promise<void> {
    const tx = this.db.tx();
    const bed = await tx.location.findUnique({
      where: { id: locationId },
      select: { careClass: true, unit: { select: { id: true, code: true, name: true, kind: true } } },
    });
    if (!bed?.careClass || bed.unit.kind !== 'rawat_inap') return;
    const roomCode = aplicareRoomCode(bed.unit.code, bed.careClass);
    if (!roomCode) return;
    const tenantId = this.db.tenantId();
    await tx.aplicareRoom.createMany({
      data: [
        {
          id: newId(),
          tenantId,
          unitId: bed.unit.id,
          careClass: bed.careClass,
          roomCode,
          roomName: `${bed.unit.name} ${CARE_CLASS_LABEL[bed.careClass] ?? bed.careClass}`.slice(0, 100),
        },
      ],
      skipDuplicates: true,
    });
    // Baris ruang terkunci sampai commit: revisi naik berurutan walau dua perubahan bed bersamaan.
    const room = await tx.aplicareRoom.update({
      where: { tenantId_unitId_careClass: { tenantId, unitId: bed.unit.id, careClass: bed.careClass } },
      data: { revision: { increment: 1 } },
      select: { id: true, revision: true },
    });
    const op = BPJS_APLICARE_UPDATE_OPERATION;
    await enqueueOutbox(tx, tenantId, {
      target: CLINICAL_OPERATIONS[op].target,
      operation: op,
      idempotencyKey: clinicalOutboxKey(op, room.id, room.revision),
      payload: { roomId: room.id, revision: room.revision },
    });
  }
}
