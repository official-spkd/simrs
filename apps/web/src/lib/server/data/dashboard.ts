import 'server-only';
import { type DashboardPeriod, type ExecutiveDashboard, executiveDashboardSchema } from '@simrs/shared';
import { demoExecutiveDashboard } from '../../demo/fixtures/dasbor';
import { CRITICAL_COVER_DAYS } from '../../manajemen';
import type { SessionView } from '../../session-view';
import { readDomain } from '../demo/state';
import { assertDemo } from '../demo-guard';
import { webEnv } from '../web-env';
import { getLogisticsBoard } from './manajemen';
import { liveCapacity, liveComputedIndicators } from './manajemen-live';
import { notImplemented } from './not-implemented';

const pct = (used: number, total: number) => (total ? Math.round((used / total) * 100) : 0);

/**
 * I09 · Data dasbor eksekutif. Mode presentasi: profil dummy (pendapatan, ALOS, bauran penjamin) ditimpa keadaan
 * toko demo yang tersedia (ADR-0085, CX-3): kapasitas rawat inap kelas/ICU/isolasi dan BOR hari ini dari papan
 * Tempat tidur, pasien IGD menunggu bed dari papan IGD, kebersihan tangan dari PPI, dan stok enoksaparin + tahap PO
 * dari Logistik. Tanda tindak lanjut direksi tersimpan (domain `dasbor`). Mode api menunggu backend fase 9.
 */
export async function getExecutiveDashboard(period: DashboardPeriod, session: SessionView) {
  if (webEnv().dataSource !== 'demo') return notImplemented('dasbor eksekutif');
  assertDemo();
  const base = demoExecutiveDashboard(period);
  const [cap, computed, logistics, store] = await Promise.all([
    liveCapacity(session),
    liveComputedIndicators(),
    getLogisticsBoard(),
    readDomain('dasbor'),
  ]);
  const live = new Map(computed.items.map((c) => [c.id, c.value]));
  const capacity: ExecutiveDashboard['capacity'] = base.capacity.map((c) =>
    c.id === 'ranap-kelas'
      ? { ...c, used: cap.ranapKelas.used, total: cap.ranapKelas.total }
      : c.id === 'icu'
        ? { ...c, used: cap.icu.used, total: cap.icu.total }
        : c.id === 'isolasi'
          ? { ...c, used: cap.isolasi.used, total: cap.isolasi.total }
          : c,
  );
  const enox = logistics.overview.reorder.find((i) => i.id === 'enoksaparin-60');
  const enoxPo = logistics.rows.find((r) => r.id === 'PO-2610-031');
  const poText = !enoxPo
    ? 'PO darurat belum diajukan.'
    : enoxPo.stage <= 1
      ? 'PO darurat menunggu persetujuan.'
      : enoxPo.stage < 5
        ? 'PO darurat disetujui, menunggu barang.'
        : 'Barang PO darurat sudah diterima.';
  const alerts = base.alerts.flatMap((a) => {
    if (a.id === 'icu')
      return [
        {
          ...a,
          title: `ICU ${pct(cap.icu.used, cap.icu.total)}% · ${cap.boarding.length} pasien IGD menunggu`,
        },
      ];
    if (a.id === 'stok')
      return enox && enox.daysOfCover < CRITICAL_COVER_DAYS
        ? [{ ...a, title: `Stok enoksaparin ${String(enox.daysOfCover).replace('.', ',')} hari (< 7)`, detail: poText }]
        : [];
    return [a];
  });
  const dashboard = executiveDashboardSchema.parse({
    ...base,
    kpis: base.kpis.map((k) =>
      k.id === 'bor' && period === 'hari-ini'
        ? { ...k, value: pct(cap.ranapKelas.used, cap.ranapKelas.total) }
        : k,
    ),
    quality: base.quality.map((q) => {
      const v = live.get(q.id);
      return v === undefined ? q : { ...q, value: v };
    }),
    capacity,
    alerts,
  });
  return { dashboard, store };
}
