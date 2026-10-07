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
    const room = bed ? roomOf(bed) : null;
    if (!room) return;
    const tenantId = this.db.tenantId();
    await this.ensureRoom(room);
    // Baris ruang terkunci sampai commit: revisi naik berurutan walau dua perubahan bed bersamaan.
    const updated = await tx.aplicareRoom.update({
      where: { tenantId_unitId_careClass: { tenantId, unitId: room.unitId, careClass: room.careClass } },
      data: { revision: { increment: 1 } },
      select: { id: true, revision: true },
    });
    const op = BPJS_APLICARE_UPDATE_OPERATION;
    await enqueueOutbox(tx, tenantId, {
      target: CLINICAL_OPERATIONS[op].target,
      operation: op,
      idempotencyKey: clinicalOutboxKey(op, updated.id, updated.revision),
      payload: { roomId: updated.id, revision: updated.revision },
    });
  }

  /**
   * Kunci baris ruang Aplicare semua bed yang akan diubah satu langkah ADT, dalam urutan tetap (unit, kelas), SEBELUM
   * status bed mana pun diubah. Tanpa ini dua transfer berlawanan arah (Melati → Anggrek dan Anggrek → Melati)
   * mengunci kedua ruang dalam urutan terbalik (`touch` bed tujuan lalu bed asal) dan berakhir deadlock (utang 3.3).
   */
  async lockRooms(locationIds: readonly string[]): Promise<void> {
    const ids = [...new Set(locationIds)];
    if (ids.length === 0) return;
    const tx = this.db.tx();
    const beds = await tx.location.findMany({
      where: { id: { in: ids } },
      select: { careClass: true, unit: { select: { id: true, code: true, name: true, kind: true } } },
    });
    const rooms = new Map<string, Room>();
    for (const b of beds) {
      const room = roomOf(b);
      if (room) rooms.set(`${room.unitId}:${room.careClass}`, room);
    }
    const tenantId = this.db.tenantId();
    for (const key of [...rooms.keys()].sort()) {
      const room = rooms.get(key) as Room;
      await this.ensureRoom(room);
      await tx.$queryRaw`
        SELECT id FROM aplicare_rooms
        WHERE tenant_id = ${tenantId}::uuid AND unit_id = ${room.unitId}::uuid AND care_class = ${room.careClass}
        FOR UPDATE`;
    }
  }

  private async ensureRoom(room: Room): Promise<void> {
    await this.db.tx().aplicareRoom.createMany({
      data: [
        {
          id: newId(),
          tenantId: this.db.tenantId(),
          unitId: room.unitId,
          careClass: room.careClass,
          roomCode: room.roomCode,
          roomName: room.roomName,
        },
      ],
      skipDuplicates: true,
    });
  }
}

interface Room {
  unitId: string;
  careClass: string;
  roomCode: string;
  roomName: string;
}

/** Ruang Aplicare sebuah bed; null bila bed tanpa kelas (IGD) atau bukan unit rawat inap. */
function roomOf(bed: {
  careClass: string | null;
  unit: { id: string; code: string; name: string; kind: string };
}): Room | null {
  if (!bed.careClass || bed.unit.kind !== 'rawat_inap') return null;
  const roomCode = aplicareRoomCode(bed.unit.code, bed.careClass);
  if (!roomCode) return null;
  return {
    unitId: bed.unit.id,
    careClass: bed.careClass,
    roomCode,
    roomName: `${bed.unit.name} ${CARE_CLASS_LABEL[bed.careClass] ?? bed.careClass}`.slice(0, 100),
  };
}
