import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { submitPoAction } from '@/app/(staf)/manajemen/logistik/actions';
import { resendDeadLettersAction } from '@/app/(staf)/sistem/integrasi/actions';
import { DEAD_LETTERS, INVENTORY } from './demo/fixtures/manajemen';
import { DENIED_MESSAGE } from './manajemen-aksi';
import type { SessionView } from './session-view';

const current = vi.hoisted(() => ({ session: null as SessionView | null }));
vi.mock('@/lib/server/session', () => ({ getSession: async () => current.session }));
vi.mock('@/lib/server/demo-guard', () => ({ assertDemo: () => undefined }));
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`redirect ${url}`);
  },
}));

function as(role: string | null): SessionView {
  return {
    user: { id: 'u-1', username: 'uji', displayName: 'Akun uji', initials: 'AU' },
    tenant: { code: 'RSFA', name: 'RS uji', kind: 'hospital' },
    role: role ? { code: role, name: role } : null,
    unit: null,
    permissions: [],
    mfaEnrolled: true,
    mfaVerified: true,
    mustChangePassword: false,
  };
}

const resend = () => resendDeadLettersAction({ ids: [DEAD_LETTERS[0]?.id ?? ''] }, 0);
// Item di bawah ROP yang tidak sedang di PO terbuka (enoksaparin sudah di PO-2610-031).
const low = INVENTORY.find((i) => i.id === 'seftriakson-1g');
const submit = () => submitPoAction({ lines: [{ itemId: low?.id ?? '', qty: 2 }], jam: '10.50', rev: 0 });

const dir = mkdtempSync(join(tmpdir(), 'simrs-logistik-aksi-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('Server Action manajemen memeriksa posisi pemakai layar', () => {
  beforeEach(() => {
    current.session = null;
    vi.unstubAllEnvs();
    vi.stubEnv('APP_ENV', 'local');
    vi.stubEnv('DATA_SOURCE', 'demo');
    vi.stubEnv('DEMO_STATE_DIR', dir);
  });

  it('kirim ulang DLQ hanya untuk posisi layar integrasi', async () => {
    current.session = as('perawat');
    expect(await resend()).toEqual({ ok: false, message: DENIED_MESSAGE, ids: [] });
    current.session = as('manajemen');
    expect((await resend()).ok).toBe(false);
    current.session = as('admin_tenant');
    expect(await resend()).toMatchObject({ ok: true, ids: [DEAD_LETTERS[0]?.id] });
  });

  it('ajukan PO hanya untuk posisi layar logistik; tersimpan di toko (item lalu terkunci)', async () => {
    current.session = as('admin_tenant');
    expect(await submit()).toEqual({ ok: false, message: DENIED_MESSAGE });
    current.session = as('apoteker');
    const r = await submit();
    expect(r.ok, r.message).toBe(true);
    expect(r.message).toMatch(/PO-2610-032/);
    current.session = as('manajemen');
    // Item sudah di PO terbuka (keadaan toko dibaca server, bukan dari klien).
    expect(await submit()).toMatchObject({ ok: false, message: expect.stringMatching(/PO-2610-032/) });
  });

  it('tanpa sesi lengkap → ke halaman masuk', async () => {
    await expect(submit()).rejects.toThrow('redirect /masuk');
    current.session = as(null);
    await expect(resend()).rejects.toThrow('redirect /masuk');
  });
});
