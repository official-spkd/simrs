import { dbDateFromIso } from '@simrs/db';
import type { TenantTx } from '@simrs/db';

/**
 * F08 · Bacaan gateway informasi publik langsung dari tabel 0b (`schedule_sessions`, `queue_services`,
 * `queue_tickets`, `queue_calls`, `appointments`) di transaksi tenant yang dibuka service (permintaan tanpa login, jadi
 * tanpa `TenantDb`). Hanya kolom yang dibutuhkan; nama/identitas pasien tidak pernah dipilih.
 *
 * GANTI KELAK: setelah modul `scheduling` (potongan 2), `queue` (4a), dan `booking` (3) mengekspor service bacaan publik,
 * fungsi di sini diganti panggilan ke service publik modul itu (aturan docs/01 §2: tidak mengimpor repository modul
 * lain), tanpa mengubah kontrak `@simrs/shared` public-info.
 */
export const PublicInfoRepository = {
  sessions(tx: TenantTx, date: string) {
    return tx.scheduleSession.findMany({
      where: { sessionDate: dbDateFromIso(date), service: { active: true } },
      orderBy: [{ service: { name: 'asc' } }, { startTime: 'asc' }],
      take: 500,
      select: {
        startTime: true,
        endTime: true,
        kind: true,
        quotaJkn: true,
        quotaNonJkn: true,
        bookedJkn: true,
        bookedNonJkn: true,
        service: { select: { name: true } },
        practitioner: { select: { name: true } },
        substitute: { select: { name: true } },
      },
    });
  },

  services(tx: TenantTx, code?: string) {
    return tx.queueService.findMany({
      where: { active: true, ...(code ? { code } : {}) },
      orderBy: { code: 'asc' },
      take: 100,
      select: { id: true, code: true, name: true },
    });
  },

  waitingCounts(tx: TenantTx, serviceIds: string[], date: string) {
    return tx.queueTicket.groupBy({
      by: ['serviceId'],
      where: { serviceId: { in: serviceIds }, serviceDate: dbDateFromIso(date), status: 'waiting' },
      _count: { _all: true },
    });
  },

  /** Panggilan terbaru per layanan untuk tiket yang sedang dipanggil/dilayani hari itu (urut terbaru dulu). */
  latestCalls(tx: TenantTx, serviceIds: string[], date: string) {
    return tx.queueCall.findMany({
      where: {
        action: { in: ['call', 'recall', 'start'] },
        ticket: {
          serviceId: { in: serviceIds },
          serviceDate: dbDateFromIso(date),
          status: { in: ['called', 'serving'] },
        },
      },
      orderBy: { calledAt: 'desc' },
      take: 500,
      select: { ticket: { select: { serviceId: true, ticketNo: true } } },
    });
  },

  /** Booking per kode + tanggal lahir pasiennya (hanya untuk dicocokkan, tidak pernah dikirim). */
  bookingByCode(tx: TenantTx, bookingCode: string) {
    return tx.appointment.findFirst({
      where: { bookingCode },
      select: {
        id: true,
        patientId: true,
        bookingCode: true,
        status: true,
        appointmentDate: true,
        estimatedAt: true,
        serviceId: true,
        patient: { select: { birthDate: true } },
        session: { select: { startTime: true } },
        service: { select: { name: true } },
        practitioner: { select: { name: true } },
        tickets: {
          where: { status: { not: 'cancelled' } },
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { ticketNo: true },
        },
      },
    });
  },
};
