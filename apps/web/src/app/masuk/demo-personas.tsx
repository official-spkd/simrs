'use client';

import { useState, useTransition } from 'react';
import type { PersonaView } from '@/lib/demo/personas';
import { demoLoginAction } from './actions';

/**
 * Mode presentasi: daftar akun presentasi per posisi; satu klik = masuk sebagai akun itu (login biasa dijalankan
 * server). Ditampilkan hanya bila web dalam mode presentasi dan berkas akun lokal tersedia.
 */
export function DemoPersonas({
  tenantName,
  groups,
}: {
  tenantName: string;
  groups: Array<{ title: string; personas: PersonaView[] }>;
}) {
  const [pending, startTransition] = useTransition();
  const [chosen, setChosen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  return (
    <section
      aria-labelledby="masuk-cepat"
      className="flex flex-col gap-3 rounded-[16px] border border-warning-border bg-[linear-gradient(160deg,#FFFFFF_55%,rgba(138,75,0,0.06))] p-5"
    >
      <div className="flex flex-col gap-0.5">
        <h2 id="masuk-cepat" className="m-0 text-[17px] font-bold">
          Masuk cepat · mode presentasi
        </h2>
        <p className="m-0 text-small text-ink-700">
          Pilih akun fiktif {tenantName} sesuai posisi yang ingin ditunjukkan. Data di dalamnya fiktif.
        </p>
      </div>
      {error && (
        <p role="alert" className="m-0 text-small font-semibold text-danger">
          {error}
        </p>
      )}
      {groups.map((g) => (
        <div key={g.title} className="flex flex-col gap-1.5">
          <span className="text-caption font-semibold tracking-wide text-ink-500 uppercase">{g.title}</span>
          <ul className="m-0 grid list-none grid-cols-1 gap-1.5 p-0 sm:grid-cols-2">
            {g.personas.map((p) => (
              <li key={p.username}>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => {
                    setChosen(p.username);
                    setError(null);
                    startTransition(async () => {
                      const r = await demoLoginAction(p.username);
                      if (r?.error) setError(r.error);
                    });
                  }}
                  className="flex min-h-12 w-full cursor-pointer flex-col justify-center rounded-control border border-line bg-white px-3 py-2 text-left font-[inherit] hover:border-brand-600 disabled:cursor-wait disabled:opacity-60"
                >
                  <span className="text-small font-semibold text-ink-900">
                    {pending && chosen === p.username ? 'Masuk…' : p.roleName}
                  </span>
                  <span className="text-caption text-ink-500">
                    {p.displayName}
                    {p.unitName ? ` · ${p.unitName}` : ''}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

/** Mode presentasi tanpa berkas akun: jelaskan cara membuatnya (perintah lokal). */
export function DemoPersonasMissing() {
  return (
    <section className="flex flex-col gap-1 rounded-[16px] border border-warning-border bg-warning-bg p-4 text-small text-warning">
      <span className="font-semibold">Akun presentasi belum dibuat</span>
      <span>
        Jalankan <code className="font-mono">pnpm db:akun-presentasi</code> di terminal proyek, lalu muat
        ulang halaman ini untuk memilih akun per posisi tanpa mengetik sandi.
      </span>
    </section>
  );
}
