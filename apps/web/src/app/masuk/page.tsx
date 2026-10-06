import type { BackupCodeChannel } from '@simrs/shared';
import { Alert } from '@simrs/ui';
import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { groupPersonas } from '@/lib/demo/personas';
import { safeNextPath } from '@/lib/safe-path';
import { api } from '@/lib/server/api';
import { cookieNames, parsePinTokens } from '@/lib/server/cookies';
import { loadPresentationAccounts, publicPersonas } from '@/lib/server/demo/accounts';
import {
  assignmentsSchema,
  backupOptionsSchema,
  type PinAccount,
  pinAccountsSchema,
} from '@/lib/server/schemas';
import { getSession } from '@/lib/server/session';
import { webEnv } from '@/lib/server/web-env';
import { nextLoginStep } from '@/lib/session-view';
import { DemoPersonas, DemoPersonasMissing } from './demo-personas';
import { LoginShell, NextStepPreview, StepCard } from './login-shell';
import { PinLogin } from './pin-login';
import { AkunStep, DaftarMfaStep, GantiSandiStep, RestartButton, UnitStep, VerifikasiStep } from './steps';

export const metadata: Metadata = { title: 'Masuk' };
export const dynamic = 'force-dynamic';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** Panjang minimum sandi bawaan kebijakan (P12 `password.min_length`); API tetap yang menegakkan. */
const PASSWORD_MIN_HINT = 12;

/**
 * Kanal kode cadangan yang diizinkan RS untuk akun tantangan ini (ADR-0022, pengaturan P12). Gagal → tanpa tautan
 * (API tetap menegakkan saat kode diminta).
 */
async function loadBackupChannels(challengeToken: string | undefined): Promise<BackupCodeChannel[]> {
  if (!challengeToken) return [];
  try {
    const r = await api('/api/v1/auth/mfa/backup-options', {
      method: 'POST',
      auth: false,
      body: { challengeToken },
      schema: backupOptionsSchema,
    });
    return r.channels;
  } catch {
    return [];
  }
}

/**
 * Akun ber-PIN yang diingat peramban ini (ADR-0024): token dari cookie httpOnly dikirim server ke API, browser hanya
 * menerima nama + posisi. API tidak terjangkau → pilihan PIN tidak ditampilkan (masuk dengan sandi tetap bisa).
 */
async function loadPinAccounts(cookie: string | undefined): Promise<PinAccount[]> {
  const deviceTokens = parsePinTokens(cookie);
  if (deviceTokens.length === 0) return [];
  try {
    return await api('/api/v1/auth/pin/accounts', {
      method: 'POST',
      auth: false,
      body: { deviceTokens },
      schema: pinAccountsSchema,
    });
  } catch {
    return [];
  }
}

/**
 * /masuk (P02): langkah ditentukan dari keadaan di server (cookie tantangan MFA, sesi dari API), sehingga
 * memuat ulang halaman selalu menampilkan langkah yang benar dan langkah tidak bisa dilompati dari browser.
 */
export default async function MasukPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const lanjut = safeNextPath(typeof sp.lanjut === 'string' ? sp.lanjut : null);
  const env = webEnv();
  const store = await cookies();
  const names = cookieNames(env.secureCookies);
  const session = await getSession();
  const step = nextLoginStep(session, Boolean(store.get(names.challenge)?.value));
  if (step === 'selesai') redirect(lanjut);

  const akun = session?.user.username ?? store.get(names.challengeUser)?.value ?? '';
  const ended = sp.alasan === 'sesi-berakhir' && step === 'akun';
  const pinOff = sp.alasan === 'pin-nonaktif' && step === 'akun';

  if (step === 'akun' || step === 'verifikasi') {
    // Mode presentasi: akun per posisi bisa dipilih sekali klik (ADR-0023). Tidak pernah di staging/produksi.
    const presentation =
      step === 'akun' && env.dataSource === 'demo' ? await loadPresentationAccounts() : undefined;
    const pinAccounts = step === 'akun' ? await loadPinAccounts(store.get(names.pinDevices)?.value) : [];
    const backupChannels =
      step === 'verifikasi' ? await loadBackupChannels(store.get(names.challenge)?.value) : [];
    return (
      <LoginShell step={step === 'akun' ? 1 : 2}>
        {ended && <Alert level="info">Sesi Anda berakhir. Silakan masuk kembali.</Alert>}
        {pinOff && (
          <Alert level="warning">
            PIN di perangkat ini tidak berlaku lagi (salah 5 kali, dihapus, atau kedaluwarsa). Masuk dengan
            kata sandi dan kode verifikasi, lalu daftarkan PIN lagi bila perlu.
          </Alert>
        )}
        {presentation && (
          <DemoPersonas
            tenantName={presentation.tenantCode}
            groups={groupPersonas(publicPersonas(presentation))}
          />
        )}
        {presentation === null && <DemoPersonasMissing />}
        {pinAccounts.length > 0 && <PinLogin lanjut={lanjut} accounts={pinAccounts} />}
        {step === 'akun' ? (
          <AkunStep
            lanjut={lanjut}
            tenantCodeField={env.tenantCodeField}
            defaultTenantCode={env.loginTenantCode}
          />
        ) : (
          <VerifikasiStep lanjut={lanjut} akun={akun} backupChannels={backupChannels} />
        )}
        <NextStepPreview />
      </LoginShell>
    );
  }
  if (step === 'daftar-mfa') {
    return (
      <LoginShell step={2}>
        <DaftarMfaStep lanjut={lanjut} akun={akun} />
        <NextStepPreview />
      </LoginShell>
    );
  }
  if (step === 'ganti-sandi') {
    return (
      <LoginShell step={2}>
        <GantiSandiStep lanjut={lanjut} minLength={PASSWORD_MIN_HINT} />
        <NextStepPreview />
      </LoginShell>
    );
  }

  const options = await api('/api/v1/auth/assignments', { schema: assignmentsSchema });
  return (
    <LoginShell step={3}>
      {options.length === 0 ? (
        <StepCard
          title="Belum ada penugasan"
          description="Akun Anda terverifikasi, tetapi belum punya penugasan unit dan peran yang aktif. Hubungi admin SIM RS."
        >
          <RestartButton lanjut={lanjut} label="Keluar" />
        </StepCard>
      ) : (
        <UnitStep
          lanjut={lanjut}
          akun={akun}
          options={options.map((o) => ({
            id: o.id,
            roleName: o.roleName,
            unitName: o.unitName,
            validUntil: o.validUntil,
          }))}
        />
      )}
    </LoginShell>
  );
}
