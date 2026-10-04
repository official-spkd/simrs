import { Alert } from '@simrs/ui';
import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { groupPersonas } from '@/lib/demo/personas';
import { safeNextPath } from '@/lib/safe-path';
import { api } from '@/lib/server/api';
import { cookieNames } from '@/lib/server/cookies';
import { loadPresentationAccounts, publicPersonas } from '@/lib/server/demo/accounts';
import { assignmentsSchema } from '@/lib/server/schemas';
import { getSession } from '@/lib/server/session';
import { webEnv } from '@/lib/server/web-env';
import { nextLoginStep } from '@/lib/session-view';
import { DemoPersonas, DemoPersonasMissing } from './demo-personas';
import { LoginShell, StepCard } from './login-shell';
import { AkunStep, DaftarMfaStep, GantiSandiStep, RestartButton, UnitStep, VerifikasiStep } from './steps';

export const metadata: Metadata = { title: 'Masuk' };
export const dynamic = 'force-dynamic';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** Panjang minimum sandi bawaan kebijakan (P12 `password.min_length`); API tetap yang menegakkan. */
const PASSWORD_MIN_HINT = 12;

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

  if (step === 'akun' || step === 'verifikasi') {
    // Mode presentasi: akun per posisi bisa dipilih sekali klik (ADR-0023). Tidak pernah di staging/produksi.
    const presentation =
      step === 'akun' && env.dataSource === 'demo' ? await loadPresentationAccounts() : undefined;
    return (
      <LoginShell step={step === 'akun' ? 1 : 2}>
        {ended && <Alert level="info">Sesi Anda berakhir. Silakan masuk kembali.</Alert>}
        {presentation && (
          <DemoPersonas
            tenantName={presentation.tenantCode}
            groups={groupPersonas(publicPersonas(presentation))}
          />
        )}
        {presentation === null && <DemoPersonasMissing />}
        {step === 'akun' ? (
          <AkunStep
            lanjut={lanjut}
            tenantCodeField={env.tenantCodeField}
            defaultTenantCode={env.loginTenantCode}
          />
        ) : (
          <VerifikasiStep lanjut={lanjut} akun={akun} />
        )}
      </LoginShell>
    );
  }
  if (step === 'daftar-mfa') {
    return (
      <LoginShell step={2}>
        <DaftarMfaStep lanjut={lanjut} akun={akun} />
      </LoginShell>
    );
  }
  if (step === 'ganti-sandi') {
    return (
      <LoginShell step={2}>
        <GantiSandiStep lanjut={lanjut} minLength={PASSWORD_MIN_HINT} />
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
