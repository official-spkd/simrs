import {
  CONSENT_DECISIONS,
  cpptRecordSchema,
  deathCertificateSchema,
  DISPOSITION_LABEL,
} from '@simrs/shared';
import { Chip } from '@simrs/ui';
import Link from 'next/link';
import { z } from 'zod';
import { CloseEncounterApi } from '@/components/klinis/close-encounter-api';
import { CompletenessCard } from '@/components/klinis/completeness-card';
import { ApiScreenShell, EncounterBanner, EncounterGate } from '@/components/klinis/encounter-screen';
import { signatureState } from '@/lib/patient-documents';
import { api } from '@/lib/server/api';
import { patientDocuments } from '@/lib/server/data/klinis/dokumen';
import { resolveEncounter } from '@/lib/server/data/klinis/encounter-screen';
import { completeness, optional } from '@/lib/server/data/klinis/konsul';
import { can, type SessionView } from '@/lib/session-view';

const ROUTE = '/klinis/kelengkapan';
const CARD =
  'flex min-w-0 flex-col gap-3 rounded-card border border-white/95 bg-white/90 px-4 py-3.5 shadow-card';

const dischargeStatusSchema = z.object({
  state: z.enum(['belum', 'draf', 'final']),
  final: z
    .object({
      document: z.object({ signatureStatus: z.enum(['pending', 'signed', 'failed']).nullable() }).nullable(),
    })
    .nullable(),
});
const consentStatusSchema = z.object({
  id: z.uuid(),
  procedure: z.string(),
  effectiveDecision: z.enum(CONSENT_DECISIONS),
  document: z.object({ signatureStatus: z.enum(['pending', 'signed', 'failed']).nullable() }).nullable(),
});

type Check = { label: string; ok: boolean; detail: string; href: string | null };

/**
 * K13 · Kelengkapan rekam medis mode api: daftar periksa dari data sungguhan (asesmen paket formulir, CPPT residen
 * menunggu co-sign, resume medis + TTE, persetujuan tindakan + TTE, dokumen ber-TTE gagal, surat kematian), tautan ke
 * layar perbaikan, lalu tutup kunjungan lewat `DischargeGate` (API menolak bila syarat pulang belum lengkap).
 */
export async function ApiKelengkapan({
  session,
  searchParams,
}: {
  session: SessionView;
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const res = await resolveEncounter(searchParams.kunjungan);
  const crumb = `Klinis / Kelengkapan rekam medis · ${session.tenant.name}`;
  if (res.kind !== 'ok') {
    return (
      <ApiScreenShell crumb={crumb} title="Kelengkapan rekam medis">
        <EncounterGate res={res} route={ROUTE} />
      </ApiScreenShell>
    );
  }
  const c = res.context;
  const id = c.encounter.id;
  const enc = `/api/v1/encounters/${id}`;
  const [pkg, cppt, discharge, consents, docs, death] = await Promise.all([
    optional(() => completeness(id)),
    api(`${enc}/cppt`, { schema: cpptRecordSchema.array() }),
    optional(() => api(`${enc}/discharge-summary`, { schema: dischargeStatusSchema })),
    can(session, 'consent', 'read')
      ? optional(() => api(`${enc}/consents`, { schema: consentStatusSchema.array() }))
      : null,
    can(session, 'documents', 'read') ? optional(() => patientDocuments(c.patient.id)) : null,
    optional(() => api(`${enc}/death-certificate`, { schema: deathCertificateSchema })),
  ]);
  const pendingCosign = cppt.filter((e) => e.status === 'menunggu_cosign').length;
  const failedDocs = (docs ?? []).filter((d) => !d.voided && signatureState(d) === 'gagal');
  const failedConsents = (consents ?? []).filter((x) => x.document?.signatureStatus === 'failed');
  const checks: Check[] = [
    ...(pkg
      ? [
          {
            label: 'Asesmen wajib paket formulir',
            ok: pkg.complete,
            detail: `${pkg.requiredFilled} dari ${pkg.requiredTotal} formulir wajib terisi`,
            href: `/klinis/asesmen?kunjungan=${id}`,
          },
        ]
      : []),
    {
      label: 'CPPT residen ter-co-sign',
      ok: pendingCosign === 0,
      detail:
        pendingCosign === 0
          ? 'Tidak ada CPPT menunggu co-sign'
          : `${pendingCosign} CPPT menunggu co-sign DPJP`,
      href: `/klinis/cppt?kunjungan=${id}`,
    },
    ...(discharge
      ? [
          {
            label: 'Resume medis final ber-TTE',
            ok: discharge.state === 'final' && discharge.final?.document?.signatureStatus !== 'failed',
            detail:
              discharge.state === 'final'
                ? discharge.final?.document?.signatureStatus === 'failed'
                  ? 'Resume final, TTE gagal (kirim ulang di layar Resume)'
                  : 'Resume final'
                : discharge.state === 'draf'
                  ? 'Resume masih draf'
                  : 'Resume belum dibuat',
            href: `/klinis/resume/${id}`,
          },
        ]
      : []),
    ...(consents
      ? [
          {
            label: 'Persetujuan tindakan ber-TTE',
            ok: failedConsents.length === 0,
            detail:
              consents.length === 0
                ? 'Tidak ada persetujuan tindakan pada kunjungan ini'
                : failedConsents.length > 0
                  ? `${failedConsents.length} dokumen persetujuan TTE gagal`
                  : `${consents.length} persetujuan tercatat`,
            href: `/tablet/persetujuan?kunjungan=${id}`,
          },
        ]
      : []),
    ...(docs
      ? [
          {
            label: 'Dokumen pasien ber-TTE',
            ok: failedDocs.length === 0,
            detail:
              failedDocs.length === 0 ? 'Tidak ada TTE gagal' : `${failedDocs.length} dokumen TTE gagal`,
            href: c.encounter.class === 'IMP' ? `/klinis/rawat-inap/${id}?tab=dokumen` : null,
          },
        ]
      : []),
  ];
  const open = c.encounter.status !== 'finished' && c.encounter.status !== 'cancelled';
  return (
    <ApiScreenShell crumb={crumb} title="Kelengkapan rekam medis">
      <EncounterBanner context={c} />
      <section aria-label="Kelengkapan rekam medis" className={CARD}>
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="m-0 text-body font-semibold">Daftar periksa kunjungan {c.encounter.number}</h2>
          <Chip tone={checks.every((x) => x.ok) ? 'success' : 'warning'}>
            {checks.filter((x) => x.ok).length} dari {checks.length} lengkap
          </Chip>
        </div>
        <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
          {checks.map((x) => (
            <li
              key={x.label}
              className="flex flex-wrap items-center justify-between gap-2 rounded-control border border-line px-3 py-2 text-small"
            >
              <span className="flex min-w-0 flex-col">
                <span className="font-semibold">
                  {x.ok ? '✓ ' : '✗ '}
                  {x.label}
                </span>
                <span className="text-caption text-ink-500">{x.detail}</span>
              </span>
              <span className="flex items-center gap-2">
                <Chip tone={x.ok ? 'success' : 'warning'}>{x.ok ? 'Lengkap' : 'Belum lengkap'}</Chip>
                {!x.ok && x.href && (
                  <Link href={x.href} className="text-small font-semibold text-brand-700">
                    Lengkapi
                  </Link>
                )}
              </span>
            </li>
          ))}
        </ul>
        {death && (
          <p className="m-0 text-small">
            Surat keterangan kematian: {death.cause.code} {death.cause.display} · TTE{' '}
            {death.document?.signatureStatus === 'signed'
              ? 'sah'
              : death.document?.signatureStatus === 'failed'
                ? 'gagal'
                : 'diproses'}
          </p>
        )}
      </section>
      {pkg && <CompletenessCard data={pkg} />}
      {open ? (
        <CloseEncounterApi
          encounterId={id}
          canClose={can(session, 'clinical', 'write')}
          canCertify={can(session, 'clinical', 'sign')}
          deathCertified={death !== null}
        />
      ) : (
        <section aria-label="Tutup kunjungan" className={CARD}>
          <p role="status" className="m-0 text-small font-semibold">
            Kunjungan {c.encounter.status === 'finished' ? 'selesai' : 'dibatalkan'}
            {death ? ` · ${DISPOSITION_LABEL.meninggal}` : ''}; rekam medis kunjungan ini terkunci (perubahan
            lewat addendum).
          </p>
        </section>
      )}
    </ApiScreenShell>
  );
}
