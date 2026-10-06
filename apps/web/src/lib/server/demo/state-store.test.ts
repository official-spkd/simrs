import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { type DemoActor, defineDomain, project } from '../../demo/store/define';
import { LOG_LIMITS } from '../../demo/store/log';
import type { AnyDomainDef } from '../../demo/store/registry';
import { criticalDomain } from '../../penunjang-kritis';
import { DemoStateStore, STALE_MESSAGE, tenantFileKey } from './state-store';

const dir = mkdtempSync(join(tmpdir(), 'simrs-demo-toko-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const actor: DemoActor = { userId: 'u-1', name: 'Analis Sesi', role: 'analis_lab', baseRole: null };
const AT = '2026-10-05T03:50:00.000Z';
const kritis = criticalDomain as unknown as AnyDomainDef;

const report = (itemId: string) => ({
  type: 'laporan.dicatat',
  itemId,
  recipient: 'dr. Penerima Uji',
  recipientRole: 'DPJP',
  channel: 'telepon',
  reportedAt: '2026-10-05T03:52:00.000Z',
  via: 'lab',
});

const counter = defineDomain('penghitung', {
  initial: () => ({ n: 0 }),
  eventSchema: z.strictObject({ type: z.literal('tambah'), pad: z.string().max(20_000).optional() }),
  screens: [],
  generic: true,
  reduce: (s) => ({ n: s.n + 1 }),
}) as unknown as AnyDomainDef;

describe('toko demo bersama (berkas per RS)', () => {
  it('kosong bila belum ada; kejadian tersimpan dan bertahan di instans baru (muat ulang)', async () => {
    const store = new DemoStateStore(dir);
    const before = await store.load('RSCM');
    expect(project(kritis, before).rev).toBe(0);
    const r = await store.commit('RSCM', kritis, report('kr-L1'), { rev: 0, actor, at: AT });
    expect(r).toEqual({ ok: true, rev: 1, seq: 1 });
    const again = await new DemoStateStore(dir).load('RSCM');
    const p = project(criticalDomain, again);
    expect(p.rev).toBe(1);
    expect(p.state.reports['kr-L1']?.reportedBy).toBe('Analis Sesi');
    expect(again.events[0]?.actor).toEqual(actor);
  });

  it('penulisan atomik: berkas selalu JSON utuh, tanpa berkas sementara tertinggal', async () => {
    const store = new DemoStateStore(dir);
    await Promise.all(
      Array.from({ length: 8 }, () =>
        store.update('RSATOM', (log) => ({ next: { ...log, seq: log.seq + 1 }, result: null })),
      ),
    );
    const files = readdirSync(join(dir, 'toko'));
    expect(files.filter((f) => f.endsWith('.tmp'))).toEqual([]);
    const raw = readFileSync(join(dir, 'toko', 'RSATOM.json'), 'utf8');
    expect(JSON.parse(raw).seq).toBe(8);
  });

  it('rev basi ditolak tanpa menulis; perubahan paralel diserialkan', async () => {
    const store = new DemoStateStore(dir);
    const results = await Promise.all(
      ['kr-A', 'kr-B', 'kr-C'].map((id) =>
        store.commit('RSPAR', kritis, report(id), { rev: 0, actor, at: AT }),
      ),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toEqual([
      { ok: false, error: STALE_MESSAGE, stale: true },
      { ok: false, error: STALE_MESSAGE, stale: true },
    ]);
    expect((await store.load('RSPAR')).events).toHaveLength(1);
  });

  it('skema dan validate domain menolak sebelum menulis', async () => {
    const store = new DemoStateStore(dir);
    expect(
      await store.commit('RSVAL', kritis, { type: 'laporan.dicatat' }, { rev: 0, actor, at: AT }),
    ).toMatchObject({ ok: false, error: expect.stringMatching(/tidak dikenal/) });
    await store.commit('RSVAL', kritis, report('kr-A'), { rev: 0, actor, at: AT });
    expect(await store.commit('RSVAL', kritis, report('kr-A'), { rev: 1, actor, at: AT })).toMatchObject({
      ok: false,
      error: expect.stringMatching(/sudah dilaporkan/),
    });
    expect((await store.load('RSVAL')).seq).toBe(1);
  });

  it('batas ukuran: toko penuh menolak aksi berikutnya tanpa menulis', async () => {
    const store = new DemoStateStore(dir);
    const n = LOG_LIMITS.maxEvents;
    const full = {
      format: 1,
      tenant: 'RSPENUH',
      seq: n,
      resetSeq: 0,
      lastReset: null,
      events: Array.from({ length: n }, (_, i) => ({
        seq: i + 1,
        domain: 'penghitung',
        at: AT,
        actor,
        data: { type: 'tambah' },
      })),
    };
    mkdirSync(join(dir, 'toko'), { recursive: true });
    writeFileSync(join(dir, 'toko', 'RSPENUH.json'), JSON.stringify(full));
    const r = await store.commit('RSPENUH', counter, { type: 'tambah' }, { rev: n, actor, at: AT });
    expect(r).toMatchObject({ ok: false, full: true, error: expect.stringMatching(/Mulai ulang data demo/) });
    expect((await store.load('RSPENUH')).seq).toBe(n);
    const big = await store.commit(
      'RSPENUH',
      counter,
      { type: 'tambah', pad: 'x'.repeat(19_000) },
      {
        rev: n,
        actor,
        at: AT,
      },
    );
    expect(big).toMatchObject({ ok: false, error: expect.stringMatching(/terlalu besar/) });
  });

  it('mulai ulang: semua domain kembali ke awal; tampilan sebelum mulai ulang basi', async () => {
    const store = new DemoStateStore(dir);
    await store.commit('RSRESET', kritis, report('kr-A'), { rev: 0, actor, at: AT });
    const after = await store.reset('RSRESET', actor, AT);
    expect(after.events).toEqual([]);
    expect(after.lastReset?.actor.name).toBe('Analis Sesi');
    const p = project(criticalDomain, await store.load('RSRESET'));
    expect(p.state.reports).toEqual({});
    expect(p.rev).toBe(2);
    expect((await store.commit('RSRESET', kritis, report('kr-A'), { rev: 1, actor, at: AT })).ok).toBe(false);
    expect((await store.commit('RSRESET', kritis, report('kr-A'), { rev: 2, actor, at: AT })).ok).toBe(true);
  });

  it('berkas rusak dianggap kosong; kode RS tidak bisa keluar dari folder', async () => {
    const store = new DemoStateStore(dir);
    writeFileSync(join(dir, 'toko', 'RSRUSAK.json'), '{rusak');
    expect((await store.load('RSRUSAK')).events).toEqual([]);
    expect(() => tenantFileKey('../..')).toThrow();
    expect(() => tenantFileKey('RS/CM')).toThrow();
    expect(tenantFileKey('rscm')).toBe('RSCM');
    expect(existsSync(join(dir, 'RSCM.json'))).toBe(false);
  });
});
