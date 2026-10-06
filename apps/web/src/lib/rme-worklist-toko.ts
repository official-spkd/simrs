import { formatJam } from '@simrs/shared';
import { completionNote, type WorklistDone, type WorklistTask } from './rme-worklist';
import { emarKey } from './rawat-inap';
import type { RekamState } from './rme-toko';

/**
 * K01 · Worklist dari toko demo (ADR-0085): tugas selesai bila rekam sumbernya selesai di layar mana pun (co-sign dan
 * verifikasi CPPT, dosis eMAR, resume final, konsul dijawab, asesmen final, evaluasi askep) atau bila diselesaikan
 * langsung di worklist (`worklist.selesai`). Nilai kritis diberi status pelaporan lab dari domain `hasil-kritis`.
 * Logika murni, diuji vitest.
 */

export interface CriticalNotice {
  /** RM pasien. */
  rm: string;
  /** Nama pemeriksaan, mis. "Kalium · LOINC 2823-3". */
  test: string;
  valueText: string;
  report: { recipient: string; recipientRole: string; reportedBy: string; reportedAt: string } | null;
}

export interface WorklistSources {
  state: RekamState;
  /** Status co-sign/verifikasi entri CPPT yang dirujuk tugas (rekam awal + toko). */
  cosigned: Readonly<Record<string, { by: string; at: string }>>;
  verified: Readonly<Record<string, { by: string; at: string }>>;
  /** Resume final per kunjungan. */
  resumeFinal: Readonly<Record<string, { by: string; at: string }>>;
  /** Konsul dijawab per id konsul. */
  consultAnswered: Readonly<Record<string, { by: string; at: string }>>;
  /** Asesmen final terbaru per `<kunjungan>|<kode formulir>` sesudah tugas dibuat. */
  assessed: Readonly<Record<string, { by: string; at: string }>>;
  /** Evaluasi askep shift ini lengkap per kunjungan. */
  askepEvaluated: Readonly<Record<string, { by: string; at: string }>>;
  /** RM pasien per kunjungan (untuk mencocokkan nilai kritis). */
  rmOf: Readonly<Record<string, string>>;
  critical: readonly CriticalNotice[];
}

const done = (at: string, by: string, note: string): WorklistDone => ({ at, by, note });

/** Tugas yang sudah selesai (dari rekam sumber atau penyelesaian langsung di worklist). */
export function worklistDone(
  tasks: readonly WorklistTask[],
  src: WorklistSources,
): Record<string, WorklistDone> {
  const out: Record<string, WorklistDone> = {};
  for (const t of tasks) {
    const direct = src.state.worklist[t.id];
    if (direct) {
      out[t.id] = done(direct.at, direct.by, direct.note);
      continue;
    }
    const ref = t.ref;
    if (!ref) continue;
    switch (ref.kind) {
      case 'cppt': {
        if (t.action.kind === 'verifikasi') {
          const v = src.verified[ref.entryId];
          if (v) out[t.id] = done(v.at, v.by, completionNote(t));
        } else {
          const c = src.cosigned[ref.entryId];
          if (c)
            out[t.id] = done(
              c.at,
              c.by,
              t.action.kind === 'cosign' ? completionNote(t) : `Co-sign DPJP ${c.by} · CPPT final`,
            );
        }
        break;
      }
      case 'emar': {
        const g = src.state.doses.find(
          (x) =>
            x.encounterId === t.encounterId &&
            emarKey(x.medicationId, x.time) === emarKey(ref.medicationId, ref.time),
        );
        if (g) out[t.id] = done(g.givenAt, g.by, `Diberikan ${g.at}${g.late ? ' · terlambat beralasan' : ''}`);
        break;
      }
      case 'resume': {
        const r = src.resumeFinal[t.encounterId];
        if (r) out[t.id] = done(r.at, r.by, `Resume final · TTE ${formatJam(r.at)}`);
        break;
      }
      case 'konsul': {
        const a = src.consultAnswered[ref.consultId];
        if (a) out[t.id] = done(a.at, a.by, 'Konsul dijawab');
        break;
      }
      case 'asesmen': {
        const a = src.assessed[`${t.encounterId}|${ref.formCode}`];
        if (a && a.at >= t.createdAt) out[t.id] = done(a.at, a.by, 'Asesmen final');
        break;
      }
      case 'askep-evaluasi': {
        const a = src.askepEvaluated[t.encounterId];
        if (a) out[t.id] = done(a.at, a.by, 'Evaluasi shift lengkap');
        break;
      }
      case 'kritis':
      case 'edukasi':
        break;
    }
  }
  return out;
}

/** Laporan lab nilai kritis pasien tugas ini (domain `hasil-kritis`), bila ada. */
export function criticalFor(t: WorklistTask, src: Pick<WorklistSources, 'rmOf' | 'critical'>): CriticalNotice | null {
  if (t.ref?.kind !== 'kritis') return null;
  const rm = src.rmOf[t.encounterId];
  const test = t.ref.test.toLowerCase();
  return src.critical.find((c) => c.rm === rm && c.test.toLowerCase().startsWith(test)) ?? null;
}

/** Keterangan status pelaporan lab untuk kartu tugas nilai kritis. */
export function criticalStatusText(c: CriticalNotice): string {
  return c.report
    ? `Lab: dilaporkan ${c.report.reportedBy} ke ${c.report.recipient} (${c.report.recipientRole}) · ${formatJam(c.report.reportedAt)} · read-back terkonfirmasi`
    : 'Lab: belum dilaporkan ke penerima (timer batas lapor berjalan di Pusat hasil kritis)';
}
