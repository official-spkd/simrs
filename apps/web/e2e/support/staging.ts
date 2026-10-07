import { inTenant, TENANTS } from './accounts';

/**
 * Fase 3 · verifikasi staging lintas fase (ADR-0032) untuk E2E rantai: pesan SATUSEHAT `held` (operasi
 * `satusehat.<resource>.upsert`, payload ID baris sumber; tidak diklaim dispatcher sampai fase 7) dan `billable_events`
 * tanpa harga (fase 5), dihimpun dari semua baris klinis kunjungan-kunjungan itu.
 */
export interface StagingView {
  /** Resource SATUSEHAT yang punya pesan `held`, mis. `encounter`, `observation`, `composition`. */
  held: string[];
  /** Pesan SATUSEHAT berstatus selain `held` (harus kosong: tidak ada yang terkirim sebelum fase 7). */
  notHeld: string[];
  /** Jenis peristiwa biaya (`admisi`, `igd`, `lab`, `obat`, `visite`, `pulang`, …). */
  billable: string[];
}

export function stagingOf(encounterIds: string[]): Promise<StagingView> {
  return inTenant(TENANTS.RSFA, async (tx) => {
    const where = { encounterId: { in: encounterIds } };
    const pick = { select: { id: true } } as const;
    const [obs, rep, cond, proc, sr, mr, ma, ds, tri] = await Promise.all([
      tx.observation.findMany({ where, ...pick }),
      tx.diagnosticReport.findMany({ where, ...pick }),
      tx.condition.findMany({ where, ...pick }),
      tx.procedure.findMany({ where, ...pick }),
      tx.serviceRequest.findMany({ where, ...pick }),
      tx.medicationRequest.findMany({ where, ...pick }),
      tx.medicationAdministration.findMany({ where, ...pick }),
      tx.dischargeSummary.findMany({ where, ...pick }),
      tx.triageAssessment.findMany({ where, ...pick }),
    ]);
    const sourceIds = [
      ...encounterIds,
      ...[obs, rep, cond, proc, sr, mr, ma, ds, tri].flat().map((r) => r.id),
    ];
    const messages = await tx.outboxMessage.findMany({
      where: {
        target: 'satusehat',
        OR: sourceIds.map((id) => ({ payload: { path: ['sourceId'], equals: id } })),
      },
      select: { operation: true, status: true },
    });
    const resource = (op: string) => op.replace(/^satusehat\./, '').replace(/\.upsert$/, '');
    const billable = await tx.billableEvent.findMany({ where, select: { kind: true } });
    return {
      held: [
        ...new Set(messages.filter((m) => m.status === 'held').map((m) => resource(m.operation))),
      ].sort(),
      notHeld: messages.filter((m) => m.status !== 'held').map((m) => `${m.operation}:${m.status}`),
      billable: [...new Set(billable.map((b) => b.kind))].sort(),
    };
  });
}
