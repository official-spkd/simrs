import type { Metadata } from 'next';
import { api } from '@/lib/server/api';
import { assignmentsSchema } from '@/lib/server/schemas';
import { requireSession } from '@/lib/server/session';
import { PositionForm } from './position-form';

export const metadata: Metadata = { title: 'Ganti posisi' };

/**
 * P03 · Ganti posisi (peran + unit) tanpa keluar-masuk, untuk staf dengan lebih dari satu penugasan (mis. akun
 * demo RSCM yang punya semua posisi). Pergantian tercatat di jejak audit.
 */
export default async function GantiPosisiPage() {
  const s = await requireSession();
  const options = await api('/api/v1/auth/assignments', { schema: assignmentsSchema });
  return (
    <div className="flex max-w-5xl flex-col gap-5">
      <header className="flex flex-col gap-0.5">
        <h1 className="m-0 text-h1 font-semibold">Ganti posisi</h1>
        <span className="text-small text-ink-700">
          Sekarang: {s.role?.name ?? 'belum memilih posisi'}
          {s.unit ? ` · ${s.unit.name}` : ''}. Menu dan hak akses mengikuti posisi yang dipilih.
        </span>
      </header>
      {options.length < 2 ? (
        <p className="m-0 rounded-card border border-line bg-card px-4 py-4 text-small text-ink-500">
          Akun ini hanya punya satu posisi.
        </p>
      ) : (
        <PositionForm options={options} />
      )}
    </div>
  );
}
