import { formatTanggalLahir, isoDateJakarta } from '@simrs/shared';
import { Alert, Chip, PatientBanner } from '@simrs/ui';
import Link from 'next/link';
import { ewsLevel } from '@/lib/rawat-inap';
import { screenById } from '@/lib/screens';
import { getInpatientRecord } from '@/lib/server/data/klinis/ranap-api';
import { can, type SessionView } from '@/lib/session-view';
import { EwsLive } from '../ews-live';
import { ApiInpatientWorkspace } from './api-workspace';
import { dischargeLabel } from './paperwork';
import { type ApiTab, API_TABS } from './tabs';

const SEX = { male: 'L', female: 'P', unknown: '–' } as const;

function routeOf(id: string): string | null {
  const s = screenById(id);
  return s && s.status !== 'belum' ? s.route : null;
}

/** Hari rawat ke-n (hari masuk = 1, tanggal WIB). */
function hospitalDay(startedAt: string | null): number {
  if (!startedAt) return 1;
  const days = (Date.parse(isoDateJakarta()) - Date.parse(isoDateJakarta(startedAt))) / 86_400_000;
  return Math.max(1, Math.round(days) + 1);
}

function Shell({ title, crumb, children }: { title: string; crumb: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-0.5">
        <span className="text-caption text-ink-500">{crumb}</span>
        <h1 className="m-0 text-h1 font-bold tracking-[-0.02em]">{title}</h1>
      </header>
      {children}
    </div>
  );
}

/**
 * K04/K07/K12 · Rekam rawat inap satu pasien mode api (fase 3 layar W4, mockup `Ranap.dc.html`): banner dari
 * `/encounters/:id/context`, lalu tab ringkasan, CPPT + SBAR, eMAR (gelang → dosis satu per satu), observasi + EWS,
 * askep + balans cairan, dan hasil. Semua penulisan lewat Server Action (`actions-api.ts`) yang ditegakkan ulang API.
 */
export async function ApiRawatInapDetail({
  session,
  encounterId,
  tab: wantedTab,
}: {
  session: SessionView;
  encounterId: string;
  tab: string | null;
}) {
  const crumbBase = `Klinis / Rawat inap · ${session.tenant.name}`;
  const back = (
    <Link
      href="/klinis/rawat-inap"
      className="inline-flex min-h-11 items-center self-start rounded-control border border-line-strong bg-white/90 px-3.5 text-small font-semibold text-ink-900 no-underline hover:bg-brand-50/60"
    >
      Kembali ke daftar pasien rawat inap
    </Link>
  );
  const found = await getInpatientRecord(session, encounterId);
  if (found.kind === 'not-found') {
    return (
      <Shell title="Rawat inap" crumb={crumbBase}>
        <Alert level="warning" title="Kunjungan tidak ditemukan">
          Kunjungan ini tidak ada di rumah sakit Anda. Buka pasien dari daftar rawat inap.
        </Alert>
        {back}
      </Shell>
    );
  }
  if (found.kind === 'denied') {
    return (
      <Shell title="Rawat inap" crumb={crumbBase}>
        <Alert level="warning" title="Akses ke pasien ini ditolak">
          {found.message} Akses mengikuti unit penugasan dan relasi Anda dengan pasien; percobaan ini tercatat
          di jejak audit.
        </Alert>
        {back}
      </Shell>
    );
  }
  const r = found.record;
  const c = r.context;
  if (c.encounter.class !== 'IMP') {
    return (
      <Shell title="Rawat inap" crumb={crumbBase}>
        <Alert level="info" title="Bukan kunjungan rawat inap">
          Kunjungan {c.encounter.number} adalah kunjungan{' '}
          {c.encounter.class === 'EMER' ? 'IGD' : 'rawat jalan'}. Rekam rawat inap tersedia setelah pasien
          diadmisi ke bangsal.
        </Alert>
        {back}
      </Shell>
    );
  }

  const place = `${c.encounter.unit.name}${c.encounter.bed ? ` ${c.encounter.bed.code}` : ''}`;
  const day = hospitalDay(c.encounter.startedAt);
  const guarantor = c.coverage ? c.coverage.name : 'Penjamin belum tercatat';
  const lv = c.latestEws ? ewsLevel(c.latestEws.score, c.latestEws.maxParam) : null;
  const active = c.encounter.status === 'in_progress';
  const order = routeOf('order');
  const resume = routeOf('resume');
  const consent = routeOf('consent');
  const education = routeOf('edukasi');
  const konsul = routeOf('konsul');
  const tab: ApiTab = API_TABS.find((t) => t === wantedTab) ?? 'cppt';
  const pendingCosign = r.cppt.filter((e) => e.status === 'menunggu_cosign').length;

  return (
    <Shell title={`Rawat inap · ${place}`} crumb={`Klinis / Rawat inap / ${place} · ${session.tenant.name}`}>
      <PatientBanner
        name={c.patient.name}
        sex={SEX[c.patient.sex]}
        ageYears={c.patient.ageYears}
        birthDate={
          c.patient.birthDate ? formatTanggalLahir(c.patient.birthDate) : 'tgl lahir tidak diketahui'
        }
        mrn={c.patient.mrn}
        allergies={
          c.allergy.status === 'ada'
            ? c.allergy.labels
            : c.allergy.status === 'belum_dikaji'
              ? ['belum dikaji']
              : []
        }
        guarantor={guarantor}
        attending={c.dpjp?.name}
      />
      <div className="flex flex-wrap gap-2" aria-label="Status rawat">
        <Chip tone="brand">Hari rawat ke-{day}</Chip>
        {c.primaryDiagnosis ? (
          <Chip tone="neutral">
            {c.primaryDiagnosis.code} {c.primaryDiagnosis.display}
          </Chip>
        ) : (
          <Chip tone="neutral">Diagnosis utama belum dicatat</Chip>
        )}
        {c.allergy.status === 'belum_dikaji' && <Chip tone="warning">Alergi belum dikaji</Chip>}
        {c.allergy.status === 'nkda' && <Chip tone="success">Tidak ada alergi obat (NKDA)</Chip>}
        {c.latestEws && lv ? (
          <Chip tone={lv.level === 'rendah' ? 'success' : 'danger'}>
            EWS {c.latestEws.score} · {lv.level}
          </Chip>
        ) : (
          <Chip tone="neutral">Belum ada observasi TTV</Chip>
        )}
        {pendingCosign > 0 && <Chip tone="warning">{pendingCosign} CPPT menunggu co-sign DPJP</Chip>}
        {!active && (
          <Chip tone="neutral">
            Kunjungan {c.encounter.status === 'finished' ? 'selesai' : c.encounter.status}
          </Chip>
        )}
      </div>
      {!active && (
        <Alert level="info" title="Kunjungan tidak sedang berjalan">
          Pemberian obat hanya untuk kunjungan yang sedang berjalan. Catatan susulan tetap bisa ditulis dan
          ditandai entri terlambat.
        </Alert>
      )}
      <nav aria-label="Tautan cepat pasien" className="flex flex-wrap gap-2">
        {[
          { label: 'Order & resep (CPOE)', href: order ? `${order}/${encounterId}` : null },
          {
            label: `Resume medis${dischargeLabel(r.discharge) ? ` · ${dischargeLabel(r.discharge)}` : ''}`,
            href: resume ? `${resume}/${encounterId}` : null,
          },
          { label: 'Edukasi pasien', href: education ? `${education}?kunjungan=${encounterId}` : null },
          { label: 'Konsultasi', href: konsul ? `${konsul}?kunjungan=${encounterId}` : null },
          {
            label: `Persetujuan tindakan · ${r.consents ? `${r.consents.length} dokumen` : 'lihat daftar'}`,
            // Tablet mode api memuat draf + persetujuan kunjungan dari `?kunjungan=` (tanpa itu: pilih ulang kunjungan).
            href: consent && r.consents !== null ? `${consent}?kunjungan=${encounterId}` : null,
          },
        ].flatMap((l) =>
          l.href
            ? [
                <Link
                  key={l.label}
                  href={l.href}
                  className="inline-flex min-h-11 items-center rounded-control border border-line-strong bg-white/90 px-3.5 text-small font-semibold text-ink-900 no-underline hover:bg-brand-50/60"
                >
                  {l.label}
                </Link>,
              ]
            : [],
        )}
      </nav>
      <EwsLive patients={{ [encounterId]: c.patient.name }} encounterId={encounterId} />
      <ApiInpatientWorkspace
        record={r}
        initialTab={tab}
        day={day}
        me={{ id: session.user.id, name: session.user.displayName, role: session.role?.name ?? null }}
        perms={{
          write: can(session, 'clinical', 'write'),
          correct: can(session, 'clinical', 'correct'),
          cosign: can(session, 'clinical', 'cosign'),
          administer: can(session, 'medication', 'administer'),
          replaceBand: can(session, 'medication', 'administer') && can(session, 'bed', 'write'),
        }}
        active={active}
        ext38={{
          me: { id: session.user.id, role: session.role?.code ?? null, unitId: session.unit?.id ?? null },
          documentsWrite: can(session, 'documents', 'write'),
          now: new Date().toISOString(),
        }}
      />
    </Shell>
  );
}
