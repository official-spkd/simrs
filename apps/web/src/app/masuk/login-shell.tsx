import { cx } from '@simrs/ui';
import type { ReactNode } from 'react';

const STEPS = ['1 Akun', '2 Verifikasi', '3 Unit kerja'] as const;

/** Kerangka layar masuk (design/mockups/Login.dc.html): panel identitas kiri + kartu langkah kanan. */
export function LoginShell({ step, children }: { step: 1 | 2 | 3; children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-wrap text-body text-ink-900">
      <section
        aria-label="Tentang sistem"
        className="relative flex flex-[1_1_480px] flex-col justify-between gap-8 overflow-hidden bg-fajar px-6 py-5 text-white md:min-h-[320px] md:p-14"
      >
        {/* Cahaya lembut satu rona di atas gradien merek (tanpa gradien lintas rona). */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(700px_420px_at_100%_0%,rgba(255,255,255,0.14),rgba(255,255,255,0)_70%)]"
        />
        <div className="relative flex items-center gap-3">
          <div className="flex size-11 items-center justify-center rounded-[12px] bg-white shadow-[0_6px_16px_rgba(23,32,46,0.18)]">
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="var(--color-samudra-700)"
              strokeWidth="2.2"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <path d="M12 5v14M5 12h14" />
            </svg>
          </div>
          <div className="flex flex-col">
            <span className="text-[16px] font-bold">SIM RS</span>
            <span className="text-small text-samudra-100">Sistem informasi rumah sakit terintegrasi</span>
          </div>
        </div>
        {/* Ponsel: hanya identitas ringkas, agar formulir langsung terlihat tanpa menggulir. */}
        <div className="relative hidden max-w-[460px] flex-col gap-4 md:flex">
          <h1 className="m-0 text-[28px] leading-[1.15] font-bold tracking-[-0.02em] md:text-[32px]">
            Satu rekam medis untuk setiap pasien, dari pendaftaran sampai pulang.
          </h1>
          <p className="m-0 text-samudra-100">
            Terhubung dengan SATUSEHAT, BPJS Kesehatan, dan sistem nasional. Setiap akses dicatat untuk
            melindungi kerahasiaan pasien.
          </p>
        </div>
        <ul className="relative m-0 hidden list-none flex-wrap gap-2.5 p-0 md:flex">
          {[
            'Rekam medis elektronik (Permenkes 24/2022)',
            'Pelindungan data pribadi (UU 27/2022)',
            'Setiap akses tercatat',
          ].map((label) => (
            <li
              key={label}
              className="rounded-full border border-white/25 bg-white/12 px-3 py-1.5 text-caption font-medium"
            >
              {label}
            </li>
          ))}
        </ul>
      </section>

      <section
        aria-label="Formulir masuk"
        className="flex flex-[1_1_480px] items-start justify-center px-4 py-6 sm:px-6 md:items-center md:py-12"
      >
        <div className="flex w-full max-w-[440px] flex-col gap-5">
          <ol aria-label="Langkah masuk" className="m-0 flex list-none gap-1.5 p-0">
            {STEPS.map((label, i) => {
              const done = i + 1 < step;
              const now = i + 1 === step;
              return (
                <li
                  key={label}
                  aria-current={now ? 'step' : undefined}
                  className={cx(
                    'flex-1 rounded-control px-3 py-2 text-caption',
                    now
                      ? 'bg-btn-primary font-semibold text-white shadow-[0_6px_16px_rgba(23,32,46,0.18)]'
                      : done
                        ? 'bg-zamrud-100 font-semibold text-zamrud-700'
                        : 'bg-ink-900/5 text-ink-700',
                  )}
                >
                  {label}
                </li>
              );
            })}
          </ol>
          {children}
          <p className="m-0 text-center text-caption text-ink-500">
            Akun bersifat pribadi dan tidak boleh dipakai bersama. Seluruh aktivitas tercatat di jejak audit
            sesuai MRMIK 2.1.
          </p>
        </div>
      </section>
    </div>
  );
}

/**
 * Pratinjau langkah 3 selama langkah 1–2 (mockup Login): pengguna tahu bahwa setelah verifikasi ia memilih unit.
 * Sebelum terverifikasi server belum boleh membuka penugasan akun, jadi isinya contoh bentuk pilihan, bukan data.
 */
export function NextStepPreview() {
  return (
    <section
      aria-labelledby="pratinjau-unit"
      className="hidden flex-col gap-2.5 rounded-card border border-white/95 bg-white/70 px-[18px] py-4 shadow-card sm:flex"
    >
      <h2 id="pratinjau-unit" className="m-0 text-small font-semibold">
        Langkah berikutnya: pilih unit kerja
      </h2>
      <div aria-hidden="true" className="grid grid-cols-2 gap-2">
        <span className="rounded-control border border-brand-600 bg-selected px-3 py-2.5 text-small">
          <span className="font-semibold text-brand-700">Posisi dan unit utama</span>
          <span className="block text-caption text-ink-500">Sesuai penugasan aktif</span>
        </span>
        <span className="rounded-control border border-line bg-white px-3 py-2.5 text-small">
          <span className="font-semibold">Tugas tambahan</span>
          <span className="block text-caption text-ink-500">Bila ada</span>
        </span>
      </div>
      <span className="text-caption text-ink-500">
        Hak akses mengikuti unit dan shift yang dipilih (RBAC + relasi pasien).
      </span>
    </section>
  );
}

/** Kartu putih satu langkah. */
export function StepCard({
  title,
  description,
  children,
}: {
  title: string;
  description: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-[18px] rounded-card border border-white/95 bg-white/90 p-7 shadow-card">
      <div className="flex flex-col gap-1">
        <h2 className="m-0 text-[22px] font-bold tracking-[-0.02em]">{title}</h2>
        <p className="m-0 text-ink-500">{description}</p>
      </div>
      {children}
    </div>
  );
}
