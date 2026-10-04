import type { ScenarioId } from './demo/engine/types';

/**
 * Keadaan satu langkah skenario untuk tombol layar keuangan (murni dan ringan, aman diimpor komponen klien;
 * dihitung di server oleh `scenarioFlow` di `keuangan-skenario.ts`).
 */

export interface FlowTask {
  id: string;
  label: string;
  btn: string;
  done: boolean;
  /** Giliran sekarang (tugas terbuka pertama di langkah aktif): tombol layar boleh memajukan skenario. */
  enabled: boolean;
  /** Tampil menurut syarat skenario (mis. tenor hanya bila memilih cicilan). */
  visible: boolean;
  /** Nilai tugas selesai (id pilihan), "ya" untuk aksi. */
  value: string | null;
  /** Jam simulasi saat selesai, mis. "10.21". */
  at: string | null;
  options: Array<{ id: string; label: string; sub: string }>;
}

export interface ScenarioFlow {
  scenario: ScenarioId;
  step: number;
  /** Langkah ini sedang aktif. */
  active: boolean;
  /** Judul langkah aktif skenario (untuk alasan tombol nonaktif), null bila skenario selesai. */
  activeTitle: string | null;
  /** Tugas giliran berikutnya di langkah ini (bila aktif). */
  next: { id: string; label: string } | null;
  tasks: Record<string, FlowTask>;
}

/** Alasan tombol tugas `taskId` nonaktif (kosong bila aktif atau sudah selesai). */
export function flowReason(flow: ScenarioFlow, taskId: string): string {
  const t = flow.tasks[taskId];
  if (!t || t.enabled || t.done) return '';
  if (!flow.active) return `Menunggu langkah skenario: ${flow.activeTitle ?? 'skenario selesai'}.`;
  return flow.next ? `Selesaikan dulu: ${flow.next.label}.` : '';
}
