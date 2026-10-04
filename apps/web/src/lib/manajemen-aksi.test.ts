import { beforeEach, describe, expect, it, vi } from 'vitest';
import { submitPoAction } from '@/app/(staf)/manajemen/logistik/actions';
import { resendDeadLettersAction } from '@/app/(staf)/sistem/integrasi/actions';
import { DEAD_LETTERS, INVENTORY } from './demo/fixtures/manajemen';
import { DENIED_MESSAGE } from './manajemen-aksi';
import type { SessionView } from './session-view';

const current = vi.hoisted(() => ({ session: null as SessionView | null }));
vi.mock('@/lib/server/session', () => ({ getSession: async () => current.session }));
vi.mock('@/lib/server/demo-guard', () => ({ assertDemo: () => undefined }));
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

const resend = () => resendDeadLettersAction({ ids: [DEAD_LETTERS[0]?.id ?? ''] });
const submit = () =>
  submitPoAction({ number: 'PO-2610-032', lines: [{ itemId: INVENTORY[0]?.id ?? '', qty: 2 }] });

describe('Server Action manajemen memeriksa posisi pemakai layar', () => {
  beforeEach(() => {
    current.session = null;
  });

  it('kirim ulang DLQ hanya untuk posisi layar integrasi', async () => {
    current.session = as('perawat');
    expect(await resend()).toEqual({ ok: false, message: DENIED_MESSAGE, ids: [] });
    current.session = as('manajemen');
    expect((await resend()).ok).toBe(false);
    current.session = as('admin_tenant');
    expect(await resend()).toMatchObject({ ok: true, ids: [DEAD_LETTERS[0]?.id] });
  });

  it('ajukan PO hanya untuk posisi layar logistik', async () => {
    current.session = as('admin_tenant');
    expect(await submit()).toEqual({ ok: false, message: DENIED_MESSAGE });
    for (const role of ['manajemen', 'apoteker']) {
      current.session = as(role);
      expect((await submit()).ok, role).toBe(true);
    }
  });

  it('tanpa sesi lengkap → ke halaman masuk', async () => {
    await expect(submit()).rejects.toThrow('redirect /masuk');
    current.session = as(null);
    await expect(resend()).rejects.toThrow('redirect /masuk');
  });
});
