import { Alert } from '@simrs/ui';
import Link from 'next/link';
import { ApiError } from '@/lib/server/api-core';
import { getConsentDraftApi, getEncounterConsentsApi } from '@/lib/server/data/klinis/consent';
import { getEncounterContextApi } from '@/lib/server/data/klinis/encounters-api';
import { can, type SessionView } from '@/lib/session-view';
import { TabletShell } from '../tablet-shell';
import { ConsentTabletApi } from './consent-tablet-api';

/**
 * K11 · Tablet persetujuan satu draf, mode api (layar W5a, sesi staf di tablet): draf + banner pasien dari API, dan
 * persetujuan final terkait (status TTE) bila draf sudah ditutup. Langkah tanda tangan, saksi, TTE, penolakan, dan
 * pembatalan lewat Server Action `../actions.ts`.
 */
export async function ApiPersetujuan({ session, draftId }: { session: SessionView; draftId: string }) {
  let data;
  try {
    const draft = await getConsentDraftApi(draftId);
    const [ctx, consents] = await Promise.all([
      getEncounterContextApi(draft.encounterId),
      draft.consentId ? getEncounterConsentsApi(draft.encounterId) : Promise.resolve([]),
    ]);
    data = { draft, ctx, consent: consents.find((c) => c.id === draft.consentId) ?? null };
  } catch (err) {
    if (err instanceof ApiError && (err.status === 403 || err.status === 404)) {
      return (
        <TabletShell context="Persetujuan tindakan kedokteran · K11" title="Persetujuan tindakan">
          <Alert level="warning" title={err.status === 404 ? 'Draf tidak ditemukan' : 'Akses ditolak'}>
            {err.status === 404
              ? 'Periksa tautan, lalu buka draf dari daftar persetujuan pasien.'
              : err.message}
          </Alert>
          <Link
            href="/tablet/persetujuan"
            className="inline-flex min-h-12 w-fit items-center rounded-control border border-line-strong bg-white/90 px-4 font-semibold text-ink-900 no-underline"
          >
            Kembali ke daftar kunjungan
          </Link>
        </TabletShell>
      );
    }
    throw err;
  }
  const { draft, ctx, consent } = data;
  return (
    <ConsentTabletApi
      key={draft.id}
      draft={draft}
      consent={consent}
      patient={{ name: ctx.patient.name, mrn: ctx.patient.mrn }}
      me={{ userId: session.user.id, name: session.user.displayName }}
      canSign={can(session, 'consent', 'sign')}
    />
  );
}
