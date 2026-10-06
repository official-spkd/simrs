import 'server-only';
import { boarding, type CcWard, wardRows } from '../../command-center';
import { dischargeRecords } from '../../demo/fixtures/mutu-transaksi';
import { surveyResponses } from '../../demo/fixtures/pengalaman';
import { ppeAudits } from '../../demo/fixtures/ppi';
import { DEMO_NOW } from '../../demo/fixtures/waktu';
import { computeIndicators } from '../../mutu-transaksi';
import { complaintRecords } from '../../pengaduan-toko';
import type { SessionView } from '../../session-view';
import { readDomain } from '../demo/state';
import { getBedBoard } from './klinis/bed';
import { getEdBoard } from './klinis/igd';

/**
 * Bacaan bersama layar manajemen (Mutu, Dasbor, Command center) dari toko demo (ADR-0085, CX-3): indikator dari data
 * transaksi dan kapasitas bed/IGD saat ini. Satu jalur agar angka yang sama di layar berbeda tidak bertentangan.
 */

/** Lima indikator mesin indikator dari keadaan toko: PPI, pengaduan, dan resume final (domain `mutu`). */
export async function liveComputedIndicators() {
  const [ppi, complaints, quality] = await Promise.all([
    readDomain('ppi'),
    readDomain('pengaduan'),
    readDomain('mutu'),
  ]);
  const items = computeIndicators({
    handHygiene: ppi.state.handHygiene,
    ppe: ppeAudits(),
    complaints: complaintRecords(complaints.state),
    survey: surveyResponses(),
    discharges: [...dischargeRecords(), ...quality.state.discharges],
    now: DEMO_NOW,
  });
  return { items, quality };
}

/** Ruang rawat inap kelas (tanpa ICU/HCU/isolasi), sama dengan profil Dasbor (260 bed). */
const CRITICAL_WARDS = new Set(['ICU', 'HCU', 'ISOLASI']);

/** Kapasitas bed per ruang (papan Tempat tidur) dan pasien IGD (papan IGD) saat ini. */
export async function liveCapacity(session: SessionView) {
  const [bed, ed] = await Promise.all([getBedBoard(session), getEdBoard(session)]);
  const wards: CcWard[] = bed.wards.map((w) => ({
    code: w.code,
    name: w.name,
    beds: bed.beds.filter((b) => b.wardCode === w.code).length,
  }));
  const beds = bed.beds.map((b) => ({ code: b.code, wardCode: b.wardCode, status: b.status }));
  const rows = wardRows(wards, beds);
  const sum = (pred: (code: string) => boolean) =>
    rows.filter((r) => pred(r.code)).reduce((t, r) => ({ used: t.used + r.occupied, total: t.total + r.total }), {
      used: 0,
      total: 0,
    });
  const ed2 = ed.items.map((i) => ({
    id: i.encounterId,
    label: `${i.bed ?? 'triase'} · ${i.chiefComplaint}`,
    status: i.status,
    losMinutes: i.losMinutes,
    triageLevel: i.triageLevel,
  }));
  return {
    wards,
    beds,
    rows,
    ed: ed2,
    ambulances: ed.ambulancesIncoming,
    boarding: boarding(ed2),
    ranapKelas: sum((c) => !CRITICAL_WARDS.has(c)),
    icu: sum((c) => c === 'ICU'),
    isolasi: sum((c) => c === 'ISOLASI'),
  };
}
