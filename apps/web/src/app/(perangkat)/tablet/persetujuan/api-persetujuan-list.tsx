import { formatTanggalWaktu } from '@simrs/shared';
import { Alert, Icon } from '@simrs/ui';
import Link from 'next/link';
import { EncounterBanner } from '@/components/klinis/encounter-banner';
import { ApiError } from '@/lib/server/api-core';
import {
  getConsentTemplatesApi,
  getEncounterConsentDraftsApi,
  getEncounterConsentsApi,
} from '@/lib/server/data/klinis/consent';
import { getEncounterContextApi, getRunningEncountersApi } from '@/lib/server/data/klinis/encounters-api';
import { can, type SessionView } from '@/lib/session-view';
import { ConsentDraftForm, ConsentRecords } from './api-persetujuan-forms';
import { DraftStatusChip } from './consent-status';
import { TABLET_CARD, TabletShell } from './tablet-shell';

const CLASS_LABEL = { AMB: 'Rawat jalan', EMER: 'IGD', IMP: 'Rawat inap' } as const;

function Denied({ title, message }: { title: string; message: string }) {
  return (
    <TabletShell context="Persetujuan tindakan kedokteran · K11" title="Persetujuan tindakan">
      <Alert level="warning" title={title}>
        {message}
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

/**
 * K11 · Pintu tablet persetujuan mode api (layar W5a, sesi staf di tablet). Tanpa `kunjungan`: kunjungan berjalan dari
 * worklist K01 (pasien saya + unit saya). Dengan `kunjungan`: banner pasien, draf di tablet, persetujuan tercatat
 * (status TTE, pencabutan oleh dokter berelasi), dan draf baru dari templat P07.
 */
export async function ApiPersetujuanIndex({
  session,
  encounterId,
}: {
  session: SessionView;
  encounterId: string | null;
}) {
  try {
    if (!encounterId) return await EncounterList({ session });
    return await EncounterConsents({ session, encounterId });
  } catch (err) {
    if (err instanceof ApiError && (err.status === 403 || err.status === 404)) {
      return (
        <Denied
          title={err.status === 404 ? 'Kunjungan tidak ditemukan' : 'Akses ditolak'}
          message={err.status === 404 ? 'Periksa tautan, lalu pilih kunjungan dari daftar.' : err.message}
        />
      );
    }
    throw err;
  }
}

async function EncounterList({ session }: { session: SessionView }) {
  const { patients } = await getRunningEncountersApi();
  const sorted = [...patients].sort((a, b) => a.name.localeCompare(b.name, 'id'));
  return (
    <TabletShell
      context={`Persetujuan tindakan kedokteran · ${session.tenant.name}`}
      title="Pilih kunjungan pasien"
    >
      <section aria-label="Kunjungan berjalan" className="flex flex-col gap-3">
        {sorted.length === 0 && (
          <p className={`m-0 p-5 text-ink-700 ${TABLET_CARD}`}>
            Belum ada kunjungan berjalan di unit Anda atau pasien tempat Anda DPJP.
          </p>
        )}
        <ul className="m-0 flex list-none flex-col gap-3 p-0 text-[17px]">
          {sorted.map((p) => (
            <li key={p.encounterId}>
              <Link
                href={`/tablet/persetujuan?kunjungan=${p.encounterId}`}
                className={`flex min-h-20 items-center justify-between gap-4 px-5 py-4 text-ink-900 no-underline hover:bg-white ${TABLET_CARD}`}
              >
                <span className="flex flex-col">
                  <span className="font-semibold">{p.name}</span>
                  <span className="text-[14px] text-ink-700">
                    RM {p.mrn} · {p.encounterNumber} · {CLASS_LABEL[p.class]} · {p.unitName}
                    {p.bed ? ` · ${p.bed}` : ''}
                  </span>
                </span>
                <Icon name="chevronRight" size={18} />
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </TabletShell>
  );
}

async function EncounterConsents({ session, encounterId }: { session: SessionView; encounterId: string }) {
  const [ctx, drafts, consents, templates] = await Promise.all([
    getEncounterContextApi(encounterId),
    getEncounterConsentDraftsApi(encounterId),
    getEncounterConsentsApi(encounterId),
    getConsentTemplatesApi(),
  ]);
  const canWrite = can(session, 'consent', 'write');
  const active = ctx.encounter.status === 'arrived' || ctx.encounter.status === 'in_progress';
  return (
    <TabletShell
      context={`Persetujuan tindakan kedokteran · ${ctx.encounter.unit.name} · ${session.tenant.name}`}
      title="Persetujuan tindakan"
      aside={
        <Link
          href="/tablet/persetujuan"
          className="inline-flex min-h-12 items-center rounded-control border border-line-strong bg-white px-4 text-[15px] font-semibold text-ink-900 no-underline"
        >
          Ganti pasien
        </Link>
      }
    >
      <EncounterBanner ctx={ctx} />
      <section aria-label="Draf di tablet" className={`flex flex-col gap-2 p-4 ${TABLET_CARD}`}>
        <h2 className="m-0 text-[1.1em] font-semibold">Draf di tablet</h2>
        {drafts.length === 0 ? (
          <p className="m-0 text-ink-700">Belum ada draf persetujuan untuk kunjungan ini.</p>
        ) : (
          <ul className="m-0 flex list-none flex-col p-0">
            {drafts.map((d) => (
              <li key={d.id} className="border-b border-line-soft last:border-b-0">
                <Link
                  href={`/tablet/persetujuan/${d.id}`}
                  className="flex min-h-14 items-center justify-between gap-3 py-2 text-ink-900 no-underline"
                >
                  <span className="flex flex-col">
                    <span className="font-semibold">{d.procedure}</span>
                    <span className="text-[14px] text-ink-700">
                      {d.templateTitle} · dibuat {d.createdBy.nama} · {formatTanggalWaktu(d.createdAt)}
                    </span>
                  </span>
                  <span className="flex items-center gap-2">
                    <DraftStatusChip draft={d} />
                    <Icon name="chevronRight" size={16} />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
      <ConsentRecords
        consents={consents}
        canRevoke={can(session, 'consent', 'sign')}
        patientName={ctx.patient.name}
      />
      {canWrite && active && templates.length > 0 && (
        <ConsentDraftForm encounterId={encounterId} templates={templates} patientName={ctx.patient.name} />
      )}
      {canWrite && active && templates.length === 0 && (
        <Alert level="warning" title="Templat belum ada">
          Belum ada templat persetujuan terbit. Admin RS menerbitkannya di layar Formulir.
        </Alert>
      )}
      {!active && (
        <p className={`m-0 p-4 text-ink-700 ${TABLET_CARD}`}>
          Kunjungan tidak sedang berjalan; draf persetujuan baru tidak bisa dibuat.
        </p>
      )}
    </TabletShell>
  );
}
