import { describe, expect, it } from 'vitest';
import { BPJS_SERVICES, demoBedClasses, demoBookings, demoHfis } from './demo/fixtures/integrasi-bpjs';
import { INTERFACES } from './demo/fixtures/manajemen';
import {
  aplicareDiffs,
  downtimeGate,
  hfisMismatch,
  resendInOrder,
  serviceStatus,
  serviceTotals,
  syncOrder,
  taskOrderGate,
} from './integrasi-bpjs';

describe('konektor BPJS', () => {
  it('volume dan gagal VClaim/Antrean sama dengan kartu hub', () => {
    for (const [svc, hub] of [
      ['vclaim', 'bpjs-vclaim'],
      ['antrean', 'bpjs-antrean'],
    ] as const) {
      const s = BPJS_SERVICES.find((x) => x.id === svc);
      const h = INTERFACES.find((x) => x.id === hub);
      if (!s || !h) throw new Error(svc);
      expect(serviceTotals(s).volume).toBe(h.volumeToday);
      expect(serviceTotals(s).failed).toBe(h.failedToday);
    }
  });

  it('status kartu dari rasio gagal dan p95', () => {
    expect(serviceStatus({ ops: [{ name: 'a', count: 100, failed: 0, p95Ms: 300 }] })).toBe('normal');
    expect(serviceStatus({ ops: [{ name: 'a', count: 100, failed: 0, p95Ms: 1240 }] })).toBe('lambat');
    expect(serviceStatus({ ops: [{ name: 'a', count: 100, failed: 6, p95Ms: 300 }] })).toBe('gangguan');
  });

  it('task ID berurutan: task 5 tertahan task 4; kirim ulang berurutan mengirim 4 lalu 5', () => {
    const [b] = demoBookings();
    if (!b) throw new Error('booking');
    expect(taskOrderGate(b, 5)).toBe(4);
    expect(taskOrderGate(b, 4)).toBeNull();
    const r = resendInOrder(b, '2026-10-05T10:50:00+07:00');
    expect(r.sent).toEqual([4, 5]);
    expect(taskOrderGate(r.next, 6)).toBeNull();
  });

  it('Aplicare: hanya kelas yang berbeda perlu disinkronkan; HFIS: jadwal beda ditandai', () => {
    expect(aplicareDiffs(demoBedClasses()).map((r) => r.kelas)).toEqual(['Kelas 1']);
    expect(demoHfis().filter(hfisMismatch)).toHaveLength(1);
  });

  it('mode downtime wajib alasan; backlog disinkronkan menurut waktu kejadian', () => {
    expect(downtimeGate('putus')).not.toBeNull();
    expect(downtimeGate('Gangguan VClaim nasional sejak 10.50')).toBeNull();
    const order = syncOrder([
      { at: '10.55', kind: 'Task ID', label: 'b' },
      { at: '10.52', kind: 'Task ID', label: 'a' },
      { at: '10.55', kind: 'SEP', label: 'c' },
    ]);
    expect(order.map((x) => x.label)).toEqual(['a', 'c', 'b']);
  });
});
