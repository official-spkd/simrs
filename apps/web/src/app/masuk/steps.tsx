'use client';

import type { BackupCodeChannel } from '@simrs/shared';
import { Button, cx, Field } from '@simrs/ui';
import { useActionState, useState, useTransition } from 'react';
import {
  changePasswordAction,
  confirmEnrollmentAction,
  type EnrollmentState,
  type FormState,
  loginAction,
  restartLoginAction,
  selectUnitAction,
  startEnrollmentAction,
  verifyMfaAction,
  type BackupCodeState,
  sendBackupCodeAction,
} from './actions';
import { FormError, OtpInput, SubmitButton } from './form-parts';
import { StepCard } from './login-shell';

const initial: FormState = {};

function Lanjut({ value }: { value: string }) {
  return <input type="hidden" name="lanjut" value={value} />;
}

/** "Kembali ke halaman masuk": membatalkan tantangan/sesi setengah jadi di server. */
export function RestartButton({
  lanjut,
  label = 'Kembali ke halaman masuk',
}: {
  lanjut: string;
  label?: string;
}) {
  return (
    <form action={restartLoginAction} className="text-center">
      <Lanjut value={lanjut} />
      <button
        type="submit"
        className="cursor-pointer border-0 bg-transparent p-0 text-small text-brand-600 underline"
      >
        {label}
      </button>
    </form>
  );
}

export function AkunStep({
  lanjut,
  tenantCodeField,
  defaultTenantCode = '',
}: {
  lanjut: string;
  tenantCodeField: boolean;
  defaultTenantCode?: string;
}) {
  const [state, action] = useActionState(loginAction, initial);
  return (
    <StepCard
      title="Masuk ke SIM RS"
      description="Gunakan NIP atau email RS dan kata sandi Anda. Setelah itu sistem meminta kode verifikasi."
    >
      <form action={action} className="flex flex-col gap-[18px]" noValidate>
        <Lanjut value={lanjut} />
        <FormError message={state.error} />
        {tenantCodeField && (
          <Field
            label="Kode RS"
            name="tenantCode"
            autoComplete="organization"
            autoCapitalize="characters"
            defaultValue={state.values?.tenantCode ?? defaultTenantCode}
            error={state.fields?.tenantCode}
            hint="Lingkungan lokal/staging. Di produksi RS dikenali dari alamat situs."
            hintTone="muted"
          />
        )}
        <Field
          label="NIP atau email RS"
          name="username"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          defaultValue={state.values?.username ?? ''}
          error={state.fields?.username}
        />
        <Field
          label="Kata sandi"
          name="password"
          type="password"
          autoComplete="current-password"
          error={state.fields?.password}
        />
        <SubmitButton pending="Memeriksa…">Masuk dan minta kode</SubmitButton>
        <span className="text-center text-caption text-ink-500">
          Lupa kata sandi? Hubungi admin SIM RS untuk reset akun.
        </span>
      </form>
    </StepCard>
  );
}

/** Tautan kode cadangan sesuai kanal yang diizinkan RS untuk akun ini (ADR-0022, pengaturan P12). */
function BackupCodeLinks({
  channels,
  sending,
  send,
}: {
  channels: BackupCodeChannel[];
  sending: boolean;
  send: (channel: BackupCodeChannel) => void;
}) {
  const linkClass =
    'cursor-pointer border-0 bg-transparent p-0 font-[inherit] text-brand-600 underline disabled:cursor-wait disabled:text-ink-400';
  const wa = channels.includes('whatsapp');
  const email = channels.includes('email');
  if (!wa && !email) {
    return (
      <span className="text-caption text-ink-500">
        Kode berlaku 30 detik. Tidak punya akses aplikasi? Akun ini wajib memakai aplikasi autentikator;
        hubungi admin SIM RS untuk mereset verifikasi dua langkah.
      </span>
    );
  }
  return (
    <span className="text-caption text-ink-500">
      Kode berlaku 30 detik. Tidak punya akses aplikasi?{' '}
      {wa && (
        <button type="button" className={linkClass} disabled={sending} onClick={() => send('whatsapp')}>
          Kirim kode lewat WhatsApp
        </button>
      )}
      {wa && email && ' atau '}
      {email && (
        <button type="button" className={linkClass} disabled={sending} onClick={() => send('email')}>
          {wa ? 'email' : 'Kirim kode lewat email'}
        </button>
      )}
      .
    </span>
  );
}

export function VerifikasiStep({
  lanjut,
  akun,
  backupChannels,
}: {
  lanjut: string;
  akun: string;
  backupChannels: BackupCodeChannel[];
}) {
  const [state, action] = useActionState(verifyMfaAction, initial);
  const [backup, setBackup] = useState<BackupCodeState>({});
  const [sending, startSending] = useTransition();
  const send = (channel: BackupCodeChannel) =>
    startSending(async () => setBackup(await sendBackupCodeAction(channel)));
  return (
    <StepCard
      title="Verifikasi dua langkah"
      description={
        <>
          Masukkan 6 digit kode dari aplikasi autentikator untuk akun{' '}
          <span className="font-semibold">{akun}</span>.
        </>
      }
    >
      <form action={action} className="flex flex-col gap-[18px]">
        <Lanjut value={lanjut} />
        <OtpInput error={state.fields?.code} />
        <BackupCodeLinks channels={backupChannels} sending={sending} send={send} />
        {backup.message && (
          <span role="status" className="text-caption text-success">
            {backup.message} Kode berlaku sampai langkah ini berakhir (5 menit).
          </span>
        )}
        {backup.error && (
          <span role="alert" className="text-caption font-semibold text-danger">
            {backup.error}
          </span>
        )}
        <label className="flex min-h-11 items-center gap-2.5 text-small text-ink-700">
          <input type="checkbox" name="trust" className="size-[18px] accent-brand-600" />
          Percayai perangkat ini selama 12 jam (hanya komputer milik RS)
        </label>
        <SubmitButton pending="Memverifikasi…">Verifikasi dan lanjut</SubmitButton>
      </form>
      <RestartButton lanjut={lanjut} />
    </StepCard>
  );
}

export function DaftarMfaStep({ lanjut, akun }: { lanjut: string; akun: string }) {
  const [enrollment, setEnrollment] = useState<EnrollmentState>({});
  const [starting, startTransition] = useTransition();
  const [state, action] = useActionState(confirmEnrollmentAction, initial);
  const begin = () => startTransition(async () => setEnrollment(await startEnrollmentAction()));

  return (
    <StepCard
      title="Aktifkan verifikasi dua langkah"
      description={
        <>
          Akun <span className="font-semibold">{akun}</span> wajib memakai aplikasi autentikator (mis. Google
          Authenticator, Microsoft Authenticator) sebelum bisa membuka data pasien.
        </>
      }
    >
      {!enrollment.secret ? (
        <div className="flex flex-col gap-3">
          <FormError message={enrollment.error} />
          <Button variant="primary" className="h-12 w-full" onClick={begin} disabled={starting}>
            {starting ? 'Menyiapkan…' : 'Tampilkan kode QR'}
          </Button>
        </div>
      ) : (
        <form action={action} className="flex flex-col gap-[18px]">
          <Lanjut value={lanjut} />
          <ol className="m-0 flex list-decimal flex-col gap-3 pl-5 text-small text-ink-700">
            <li>Buka aplikasi autentikator, pilih tambah akun, lalu pindai kode QR ini.</li>
            <li>Masukkan 6 digit kode yang muncul di aplikasi.</li>
          </ol>
          <div className="flex flex-wrap items-center gap-4">
            {/* data URI SVG sebagai gambar: tidak ada markup yang disisipkan ke halaman */}
            <img
              src={enrollment.qr}
              alt="Kode QR pendaftaran aplikasi autentikator"
              width={176}
              height={176}
              className="rounded-control border border-line bg-white"
            />
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="text-caption text-ink-500">Tidak bisa memindai? Ketik kunci ini:</span>
              <code data-testid="mfa-secret" className="font-mono text-small break-all text-ink-900">
                {enrollment.secret}
              </code>
            </div>
          </div>
          <OtpInput error={state.fields?.code} label="Kode dari aplikasi" />
          <SubmitButton pending="Memverifikasi…">Aktifkan dan lanjut</SubmitButton>
        </form>
      )}
      <RestartButton lanjut={lanjut} label="Batal dan kembali ke halaman masuk" />
    </StepCard>
  );
}

export function GantiSandiStep({ lanjut, minLength }: { lanjut: string; minLength: number }) {
  const [state, action] = useActionState(changePasswordAction, initial);
  return (
    <StepCard
      title="Buat kata sandi baru"
      description="Kata sandi sementara dari admin harus diganti sebelum Anda memakai sistem."
    >
      <form action={action} className="flex flex-col gap-[18px]" noValidate>
        <Lanjut value={lanjut} />
        <FormError message={state.error} />
        <Field
          label="Kata sandi saat ini"
          name="currentPassword"
          type="password"
          autoComplete="current-password"
          error={state.fields?.currentPassword}
        />
        <Field
          label="Kata sandi baru"
          name="newPassword"
          type="password"
          autoComplete="new-password"
          error={state.fields?.newPassword}
          hint={
            state.fields?.newPassword ? undefined : `Minimal ${minLength} karakter. Boleh berupa kalimat.`
          }
          hintTone="muted"
        />
        <Field
          label="Ulangi kata sandi baru"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          error={state.fields?.confirmPassword}
        />
        <SubmitButton pending="Menyimpan…">Simpan dan lanjut</SubmitButton>
      </form>
      <RestartButton lanjut={lanjut} label="Batal dan keluar" />
    </StepCard>
  );
}

export interface UnitOption {
  id: string;
  roleName: string;
  unitName: string | null;
  validUntil: string | null;
}

export function UnitStep({ lanjut, akun, options }: { lanjut: string; akun: string; options: UnitOption[] }) {
  const [state, action] = useActionState(selectUnitAction, initial);
  const [picked, setPicked] = useState<string>('');
  const chosen = options.find((o) => o.id === picked);
  return (
    <StepCard
      title="Pilih posisi dan unit kerja"
      description={
        <>
          Akun <span className="font-semibold">{akun}</span> terverifikasi. Hak akses mengikuti posisi (peran)
          dan unit yang dipilih; posisi bisa diganti nanti lewat menu Ganti posisi.
        </>
      }
    >
      <form action={action} className="flex flex-col gap-[18px]">
        <Lanjut value={lanjut} />
        <FormError message={state.error} />
        <fieldset className="m-0 grid grid-cols-1 gap-2 border-0 p-0 sm:grid-cols-2">
          <legend className="sr-only">Unit kerja</legend>
          {options.map((o) => {
            const on = o.id === picked;
            return (
              <label
                key={o.id}
                className={cx(
                  'flex min-h-14 cursor-pointer flex-col justify-center rounded-control border px-3 py-2.5 text-small has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-brand-600',
                  on ? 'border-brand-600 bg-selected' : 'border-line bg-white hover:bg-brand-50/60',
                )}
              >
                <input
                  type="radio"
                  name="assignmentId"
                  value={o.id}
                  checked={on}
                  onChange={() => setPicked(o.id)}
                  className="sr-only"
                />
                <span className={cx('font-semibold', on ? 'text-brand-700' : 'text-ink-900')}>
                  {o.roleName}
                </span>
                <span className="text-caption text-ink-500">{o.unitName ?? 'Semua unit'}</span>
              </label>
            );
          })}
        </fieldset>
        {chosen ? (
          <SubmitButton pending="Membuka…">{`Masuk sebagai ${chosen.roleName}`}</SubmitButton>
        ) : (
          <span className="text-caption text-ink-500">Pilih salah satu posisi untuk melanjutkan.</span>
        )}
      </form>
      <RestartButton lanjut={lanjut} label="Keluar" />
    </StepCard>
  );
}
