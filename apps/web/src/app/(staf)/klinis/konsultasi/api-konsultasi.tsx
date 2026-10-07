import { type EncounterContext, formatTanggalLahir } from '@simrs/shared';
import { Alert, Chip, cx, PatientBanner } from '@simrs/ui';
import Link from 'next/link';
import { ConsultPanel } from '@/components/klinis/consult-panel';
import { API_CONSULT_KIND_LABEL } from '@/lib/konsul-api';
import { formatTglJam } from '@/lib/rawat-inap';
import { ApiError } from '@/lib/server/api-core';
import { careTeam, consultInbox, encounterConsults, encounterContext } from '@/lib/server/data/klinis/konsul';
import { can, type SessionView } from '@/lib/session-view';

const SEX = { male: 'L', female: 'P', unknown: '–' } as const;
const ROUTE = '/klinis/konsultasi';
const CARD =
  'flex min-w-0 flex-col gap-3 rounded-card border border-white/95 bg-white/90 shadow-card px-4 py-3.5';

/** Konteks kunjungan untuk banner; 404/403 menjadi pesan halaman (bukan galat). */
async function contextOf(
  encounterId: string,
): Promise<
  { kind: 'ok'; context: EncounterContext } | { kind: 'not-found' } | { kind: 'denied'; message: string }
> {
  try {
    return { kind: 'ok', context: await encounterContext(encounterId) };
  } catch (err) {
    if (err instanceof ApiError && (err.status === 404 || err.status === 400)) return { kind: 'not-found' };
    if (err instanceof ApiError && err.status === 403) return { kind: 'denied', message: err.message };
    throw err;
  }
}

/**
 * K10 · Layar Konsultasi mode api (fase 3 · 3.8, ADR-0059): kotak masuk konsul untuk saya/unit saya, lalu konsul +
 * tim perawatan satu kunjungan (`?kunjungan=`) dengan kirim konsul, jawaban terstruktur (hanya konsultan tujuan),
 * rawat bersama/alih rawat, dan serah DPJP utama. Semua data dari API (ABAC + audit di API).
 */
export async function ApiKonsultasi({
  session,
  encounterId,
}: {
  session: SessionView;
  encounterId: string | null;
}) {
  const now = new Date().toISOString();
  const [inbox, found] = await Promise.all([consultInbox(), encounterId ? contextOf(encounterId) : null]);
  const canWrite = can(session, 'clinical', 'write');
  const detail =
    encounterId && found?.kind === 'ok'
      ? await Promise.all([encounterConsults(encounterId), careTeam(encounterId)])
      : null;

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-0.5">
        <span className="text-caption text-ink-500">Klinis / Konsultasi · {session.tenant.name}</span>
        <h1 className="m-0 text-h1 font-bold tracking-[-0.02em]">Konsultasi & rawat bersama</h1>
      </header>

      <section aria-label="Konsul masuk" className={CARD}>
        <h2 className="m-0 text-body font-semibold">Konsul masuk belum dijawab ({inbox.length})</h2>
        {inbox.length === 0 ? (
          <p className="m-0 text-small text-ink-500">Tidak ada konsul yang menunggu jawaban Anda.</p>
        ) : (
          <ul className="m-0 flex list-none flex-col p-0">
            {inbox.map((c) => {
              const late = Date.parse(c.dueAt) < Date.parse(now);
              const here = c.encounterId === encounterId;
              return (
                <li
                  key={c.requestId}
                  className="flex flex-wrap items-center justify-between gap-2 border-b border-line-soft py-2.5"
                >
                  <span className="flex min-w-0 flex-col">
                    <span className="font-semibold">
                      {c.patientName} · RM {c.mrn} · {c.urgency === 'segera' ? 'Cito' : 'Biasa'} ·{' '}
                      {API_CONSULT_KIND_LABEL[c.kind]} · dari {c.from.nama}
                    </span>
                    <span className={cx('text-caption font-semibold', late ? 'text-danger' : 'text-warning')}>
                      {late ? 'Lewat batas jawab' : 'Batas jawab'} {formatTglJam(c.dueAt)}
                    </span>
                  </span>
                  {here ? (
                    <Chip tone="brand">Sedang dibuka</Chip>
                  ) : (
                    <Link
                      href={`${ROUTE}?kunjungan=${c.encounterId}`}
                      className="inline-flex min-h-11 items-center rounded-control border border-line-strong bg-white/90 px-3.5 text-small font-semibold text-ink-900 no-underline hover:bg-brand-50/60"
                    >
                      Buka konsul {c.patientName}
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {!encounterId && (
        <Alert level="info" title="Pilih pasien">
          Buka konsul dari kotak masuk di atas, atau kirim konsul dari tab Dokumen & konsultasi di layar Rawat
          inap.
        </Alert>
      )}
      {found?.kind === 'not-found' && (
        <Alert level="warning" title="Kunjungan tidak ditemukan">
          Kunjungan ini tidak ada di rumah sakit Anda.
        </Alert>
      )}
      {found?.kind === 'denied' && (
        <Alert level="warning" title="Akses ke pasien ini ditolak">
          {found.message} Akses konsultan berlaku sejak konsul dikirim kepada Anda; percobaan ini tercatat di
          jejak audit.
        </Alert>
      )}
      {found?.kind === 'ok' && detail && encounterId && (
        <>
          <PatientBanner
            name={found.context.patient.name}
            sex={SEX[found.context.patient.sex]}
            ageYears={found.context.patient.ageYears}
            birthDate={
              found.context.patient.birthDate
                ? formatTanggalLahir(found.context.patient.birthDate)
                : 'tgl lahir tidak diketahui'
            }
            mrn={found.context.patient.mrn}
            allergies={
              found.context.allergy.status === 'ada'
                ? found.context.allergy.labels
                : found.context.allergy.status === 'belum_dikaji'
                  ? ['belum dikaji']
                  : []
            }
            guarantor={found.context.coverage?.name ?? 'Penjamin belum tercatat'}
            attending={found.context.dpjp?.name}
          />
          <ConsultPanel
            encounterId={encounterId}
            consults={detail[0]}
            team={detail[1]}
            me={{ id: session.user.id, role: session.role?.code ?? null, unitId: session.unit?.id ?? null }}
            now={now}
            canWrite={canWrite}
          />
        </>
      )}
    </div>
  );
}
