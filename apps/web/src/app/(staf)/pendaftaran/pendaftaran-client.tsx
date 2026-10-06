'use client';

import { formatJam, type RegistrationDesk, type RegistrationPatient } from '@simrs/shared';
import { Alert, Button, cx, Icon } from '@simrs/ui';
import Link from 'next/link';
import { useEffect, useState, useTransition } from 'react';
import { useDemoRunner } from '@/components/demo-sync';
import { RegPatient } from '@/components/front-office/reg-patient';
import { RegPayer } from '@/components/front-office/reg-payer';
import { RegQueuePreview, RegQuota } from '@/components/front-office/reg-quota';
import { RegSep } from '@/components/front-office/reg-sep';
import { RegStepper, type RegStepView } from '@/components/front-office/reg-stepper';
import { useStoreAction } from '@/lib/demo/store/client';
import { demoNow } from '@/lib/demo/fixtures/waktu';
import {
  REGISTRATION_STEPS,
  type RegistrationFlow,
  registrationPrimary,
  registrationProgress,
} from '@/lib/front-office';
import {
  callCounterAction,
  checkEligibilityAction,
  completeRegistrationAction,
  handleAssistAction,
  issueSepAction,
  printRegistrationAction,
} from './actions-demo';
import { type RegFixed, type RegScenarioView, type RegStored, useRegistration } from './use-registration';

/** Antrean loket + toko demo yang tampak di meja pendaftaran (dihitung server). */
export interface RegStoreView {
  /** Revisi domain `pendaftaran` (SEP, kunjungan, cetak). */
  regRev: number;
  /** Revisi domain `antrean` (panggilan loket, bantuan anjungan). */
  queueRev: number;
  stored: Record<string, RegStored>;
  loket: {
    next: string;
    waiting: number;
    current: { ticketNo: string; patientId: string | null; jam: string } | null;
  };
  /** Pasien tiket loket yang sedang dilayani (dipanggil dari anjungan), null bila walk-in/tanpa identitas. */
  counterPatientId: string | null;
  assist: { device: string; jam: string } | null;
}

const NOTHING: RegStored = { sep: null, visit: null };

/**
 * F03/F06 · Pendaftaran rawat jalan (mockup Registrasi). Tn. Suryo (skenario rawat jalan) dipanggil lewat
 * "Panggil berikutnya · A-031" dan langkah cek/SEP menjalankan tugas skenario; pasien lain tersimpan di toko demo
 * bersama (SEP, kunjungan, cetak, panggilan loket) atas nama pengguna sesi dan mengalir ke papan antrean, jadwal,
 * Poli, dan charge capture.
 */
export function PendaftaranClient({
  desk,
  deskPatients,
  vclaimLatencyMs,
  scenarioPatient,
  scenario,
  fixed,
  today,
  store,
}: {
  desk: RegistrationDesk;
  /** Pasien dummy yang bisa dicari (mode presentasi). */
  deskPatients: RegistrationPatient[];
  /** Chip latensi VClaim mockup (mode presentasi). */
  vclaimLatencyMs: number;
  scenarioPatient: RegistrationPatient;
  scenario: RegScenarioView;
  fixed: RegFixed;
  today: string;
  store: RegStoreView;
}) {
  const patients = scenario.atCounter ? [scenarioPatient, ...deskPatients] : deskPatients;
  const storedOf = (id: string): RegStored => store.stored[id] ?? NOTHING;
  const f = useRegistration(
    desk,
    patients,
    scenario.atCounter ? fixed.patientId : (store.counterPatientId ?? deskPatients[0]?.id ?? null),
    scenario.atCounter
      ? scenario.sepIssued
        ? 'preset'
        : 'fresh'
      : store.counterPatientId
        ? 'fresh'
        : 'showcase',
    storedOf,
  );
  const { run, pending: running, error: runError } = useDemoRunner(scenario.rev);
  const reg = useStoreAction(store.regRev);
  const queue = useStoreAction(store.queueRev);
  const [busy, startTransition] = useTransition();
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [pendingCall, setPendingCall] = useState(false);

  const p = f.patient;
  const isScenario = !!p && p.id === fixed.patientId;
  const saved = p && !isScenario ? storedOf(p.id) : NOTHING;
  const visit = saved.visit;
  const bpjs = f.payer === 'BPJS';
  const checked = isScenario ? scenario.checked : f.checkedLocal || !!saved.sep;
  const sepNo = isScenario ? (scenario.sepIssued ? fixed.sep : null) : (saved.sep?.sepNo ?? null);
  const sepAt = isScenario ? (scenario.sepAt ?? '') : (saved.sep?.jam ?? '');
  const done = isScenario ? f.done : visit ? { at: visit.jam, queueNo: visit.queueNo } : null;
  const printedAt = isScenario ? f.printedAt : (visit?.printedAt ?? null);
  const referral = p?.referrals.find((r) => r.id === f.referralId) ?? null;
  const quota = desk.quotas.find((q) => q.doctorId === f.doctorId) ?? null;
  const flow: RegistrationFlow = {
    found: !!p,
    payer: f.payer,
    checked,
    referralChosen: !!referral,
    diagnosisError: f.diagnosisError,
    sepIssued: !!sepNo,
    doctorChosen: !!quota || !!visit,
    scheduleLocked: f.scheduleLocked,
    consent: f.consent,
    done: !!done,
  };
  const prog = registrationProgress(flow);
  const prim = registrationPrimary(flow);
  const working = busy || running || reg.pending || queue.pending;
  /** Cap waktu catatan (dipanggil di penangan aksi): Tn. Suryo mengikuti jam naskah, pasien lain jam hari demo. */
  const stamp = () => (isScenario ? scenario.clock : formatJam(demoNow()));
  /** Umpan balik Server Action toko (basi = halaman dimuat ulang otomatis). */
  const feedback = (r: { ok: boolean; message: string; stale?: boolean }) =>
    setNotice({
      ok: r.ok,
      text: r.stale ? `${r.message} Tampilan diperbarui; ulangi aksi.` : r.message,
    });

  // Antrean loket: A-031 (Tn. Suryo) didahulukan saat tiketnya tercetak; lalu tiket booking anjungan, lalu walk-in.
  const headerTicket = scenario.callable ? fixed.ticket : store.loket.next;

  // Setelah langkah kedatangan dilanjutkan, panggil A-031 begitu tugas `panggil` aktif.
  useEffect(() => {
    if (!pendingCall || !scenario.enabled.panggil || scenario.stepIndex === null) return;
    setPendingCall(false);
    run({ type: 'task', step: scenario.stepIndex, task: 'panggil', value: true, scenario: 'rawat-jalan' });
  }, [pendingCall, scenario.enabled.panggil, scenario.stepIndex, run]);

  const callNext = () => {
    setNotice(null);
    if (scenario.callable) {
      if (scenario.enabled.panggil && scenario.stepIndex !== null) {
        run({
          type: 'task',
          step: scenario.stepIndex,
          task: 'panggil',
          value: true,
          scenario: 'rawat-jalan',
        });
      } else if (scenario.arrivalPending) {
        run({ type: 'next', scenario: 'rawat-jalan' }, (ok) => ok && setPendingCall(true));
      } else {
        setNotice({ ok: false, text: 'Selesaikan check-in Tn. Suryo di anjungan lebih dulu.' });
      }
      return;
    }
    const ticketNo = store.loket.next;
    queue.run((r) => callCounterAction({ ticketNo, rev: r, jam: formatJam(demoNow()) }), feedback);
  };

  const check = () => {
    if (!p) return;
    if (isScenario) {
      if (scenario.enabled.cek && scenario.stepIndex !== null) {
        run({ type: 'task', step: scenario.stepIndex, task: 'cek', value: true, scenario: 'rawat-jalan' });
      }
      return;
    }
    startTransition(async () => {
      const r = await checkEligibilityAction(p.id);
      setNotice({ ok: r.ok, text: r.message });
      if (r.ok) f.setCheckedLocal(true);
    });
  };

  const primary = () => {
    if (!p || prim.reason) return;
    setNotice(null);
    if (prim.kind === 'sep') {
      if (isScenario) {
        if (scenario.enabled.sep && scenario.stepIndex !== null) {
          run({ type: 'task', step: scenario.stepIndex, task: 'sep', value: true, scenario: 'rawat-jalan' });
        }
        return;
      }
      // Cap waktu catatan SEP mengikuti jam hari demo (bukan jam server).
      const input = { patientId: p.id, referralId: f.referralId, diagnosis: f.diagnosis, jam: stamp() };
      reg.run((r) => issueSepAction({ ...input, rev: r }), feedback);
    } else if (prim.kind === 'tujuan') {
      f.setScheduleLocked(true);
    } else if (prim.kind === 'selesai' && quota) {
      if (isScenario) {
        f.setDone({ at: stamp(), queueNo: fixed.queueNo });
        return;
      }
      const input = {
        patientId: p.id,
        payer: f.payer,
        doctorId: quota.doctorId,
        consent: f.consent,
        jam: stamp(),
      };
      reg.run((r) => completeRegistrationAction({ ...input, rev: r }), feedback);
    }
  };

  const print = () => {
    if (!p) return;
    if (isScenario) {
      f.print(stamp());
      return;
    }
    const input = { patientId: p.id, jam: stamp() };
    reg.run((r) => printRegistrationAction({ ...input, rev: r }), feedback);
  };

  const polis = [
    ...new Map(desk.quotas.map((q) => [q.poliCode, { code: q.poliCode, name: q.poliName }])).values(),
  ];
  const poliQuotas = desk.quotas.filter((q) => q.poliCode === f.poli);
  const notes = [
    p ? 'Pasien lama ditemukan' : 'Cari NIK, RM, atau BPJS',
    !p
      ? 'Penjamin dan rujukan'
      : !bpjs
        ? `${f.payer} · tanpa SEP`
        : sepNo
          ? `SEP terbit ${sepAt}`
          : !checked
            ? 'Cek kepesertaan BPJS'
            : referral
              ? 'BPJS aktif · rujukan dipilih'
              : 'BPJS aktif · pilih rujukan',
    visit
      ? `${visit.doctorName}`
      : prog.done[2] && quota
        ? `${quota.poliName} · ${quota.start}–${quota.end}`
        : 'Poli, dokter, jadwal',
    done ? `Terdaftar ${done.at}` : 'SEP, antrean, cetak',
  ];
  const steps: RegStepView[] = REGISTRATION_STEPS.map((label, i) => ({
    label,
    note: notes[i] ?? '',
    state: prog.done[i] ? 'selesai' : i === prog.active ? 'aktif' : 'belum',
  }));
  const queueNo = done?.queueNo ?? (p && quota ? (isScenario ? fixed.queueNo : quota.nextQueueNo) : '—');
  const doneAt = done?.at ?? '';
  const scenarioWait = isScenario && prim.kind === 'sep' && !prim.reason && !scenario.enabled.sep;
  const reason = scenarioWait ? 'Menunggu giliran tugas skenario (lihat panel simulasi).' : prim.reason;
  const serving = store.loket.current;
  const servingName = serving?.patientId
    ? (deskPatients.find((x) => x.id === serving.patientId)?.name ?? null)
    : null;

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <span className="text-caption text-ink-500">Front office / Pendaftaran / Rawat jalan</span>
          <h1 className="m-0 text-h1 font-bold tracking-[-0.02em]">Pendaftaran pasien rawat jalan</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="inline-flex h-9 items-center gap-1.5 rounded-full border border-white/90 bg-white/80 px-3 text-caption font-medium text-ink-700 shadow-[0_2px_8px_rgba(23,32,46,0.06)]">
            <span aria-hidden="true" className="size-2 rounded-full bg-zamrud-500" />
            VClaim {vclaimLatencyMs} ms
          </span>
          {serving && (
            <span
              role="status"
              aria-label="Sedang dilayani di loket"
              className="inline-flex h-9 items-center rounded-full bg-brand-100 px-3 text-caption font-semibold text-brand-800"
            >
              Dilayani {serving.ticketNo}
              {servingName ? ` · ${servingName}` : ''} · dipanggil {serving.jam}
            </span>
          )}
          <span className="inline-flex h-9 items-center rounded-full bg-batu-200 px-3 text-caption font-semibold text-batu-800">
            Antrean loket: {store.loket.waiting} menunggu
          </span>
          <Button disabled={working} onClick={callNext}>
            <Icon name="bell" size={16} />
            Panggil berikutnya · {headerTicket}
          </Button>
        </div>
      </header>

      {store.assist && (
        <Alert level="warning" title="Anjungan minta bantuan">
          <span className="flex flex-wrap items-center justify-between gap-2">
            <span>
              {store.assist.device} meminta petugas sejak {store.assist.jam}.
            </span>
            <Button
              size="sm"
              disabled={working}
              onClick={() =>
                queue.run((r) => handleAssistAction({ rev: r, jam: formatJam(demoNow()) }), feedback)
              }
            >
              Tandai ditangani
            </Button>
          </span>
        </Alert>
      )}

      {(notice || runError) && (
        <Alert level={notice?.ok && !runError ? 'success' : 'warning'}>
          {runError?.message ?? notice?.text}
        </Alert>
      )}

      <RegStepper steps={steps} />

      <div className="flex flex-wrap items-start gap-4">
        <RegPatient
          query={f.query}
          error={f.queryError}
          patient={p}
          locked={isScenario && !done}
          onQuery={f.setQuery}
          onSearch={f.search}
          onReadKtp={() => deskPatients[0] && f.load(deskPatients[0], deskPatients[0].nikMasked)}
          onScanCard={() => deskPatients[0] && f.load(deskPatients[0], deskPatients[0].bpjsMasked ?? '')}
        />
        <section aria-label="Penjaminan" className="flex min-w-0 flex-[999_1_420px] flex-col gap-4">
          <RegPayer
            payer={f.payer}
            payerLocked={!p || !!done || isScenario || !!sepNo}
            payerNote={
              isScenario
                ? 'Penjamin mengikuti booking Mobile JKN pasien.'
                : sepNo && !done
                  ? 'SEP sudah terbit: penjamin terkunci BPJS.'
                  : ''
            }
            eligibility={p?.eligibility ?? null}
            checked={checked}
            checkDisabled={!p || (isScenario && !scenario.enabled.cek) || !!sepNo}
            checking={working}
            referrals={p?.referrals ?? []}
            referralId={f.referralId}
            referralLocked={!p || !checked || !!sepNo || !!done}
            today={today}
            onPayer={f.setPayer}
            onCheck={check}
            onReferral={f.pickReferral}
          />
          <RegSep
            payer={f.payer}
            polis={polis}
            poli={f.poli}
            quotas={desk.quotas}
            doctorId={f.doctorId}
            tujuanLocked={!p || f.scheduleLocked}
            diagnosis={f.diagnosis}
            diagnosisError={f.diagnosisError}
            showDiagnosisError={f.diagTouched || (prog.active === 1 && !!referral)}
            sepLocked={!!sepNo || !p}
            referral={referral}
            sepNo={sepNo}
            sepAt={sepAt}
            infoText={
              !p
                ? 'Data SEP terisi setelah pasien ditemukan dan rujukan dipilih.'
                : !checked
                  ? 'Cek kepesertaan BPJS untuk menampilkan rujukan aktif.'
                  : 'Pilih rujukan aktif untuk mengisi data SEP otomatis.'
            }
            onPoli={f.setPoli}
            onDoctor={f.setDoctorId}
            onDiagnosis={f.setDiagnosis}
          />
        </section>
        <aside
          aria-label="Tujuan dan konfirmasi"
          className="flex min-w-0 flex-[1_1_280px] flex-col gap-4 lg:max-w-[340px]"
        >
          <RegQuota
            quotas={poliQuotas}
            payer={f.payer}
            doctorId={f.doctorId}
            locked={!p || f.scheduleLocked}
            hint={
              !p
                ? 'Cari pasien dulu untuk memilih dokter.'
                : f.scheduleLocked
                  ? 'Jadwal dikunci untuk pendaftaran ini.'
                  : ''
            }
            countSelected={!(isScenario && scenario.sepIssued) && !visit}
            onPick={f.setDoctorId}
          />
          <RegQueuePreview
            label={done ? 'NOMOR ANTREAN' : f.scheduleLocked ? 'ANTREAN TERBENTUK' : 'PRATINJAU ANTREAN'}
            queueNo={queueNo}
            line={
              p && quota
                ? `Poli ${quota.poliName} · ${quota.room} · perkiraan dipanggil ${quota.eta}`
                : visit
                  ? `${visit.doctorName}`
                  : 'Pilih pasien dan dokter untuk membentuk nomor antrean.'
            }
            note={
              done
                ? bpjs
                  ? `Task ID 1–3 Antrean BPJS terkirim ${doneAt}`
                  : `Antrean non-JKN tercatat ${doneAt}`
                : bpjs
                  ? 'Task ID 1–3 Antrean BPJS terkirim otomatis'
                  : 'Antrean non-JKN · tidak dikirim ke Antrean BPJS'
            }
          />
          <label className="flex min-h-11 cursor-pointer items-start gap-2.5 rounded-control border border-white/95 bg-white/90 p-3 text-small shadow-card">
            <input
              type="checkbox"
              checked={f.consent || !!visit}
              disabled={!!done || !p}
              onChange={(e) => f.setConsent(e.target.checked)}
              className="mt-0.5 size-5 flex-none accent-brand-600"
            />
            Persetujuan umum (general consent) sudah ditandatangani pasien di tablet
          </label>
          {!done && prim.kind !== 'none' && (
            <div className="flex flex-col gap-1.5">
              <Button variant="primary" disabled={!!reason || working} onClick={primary}>
                {working ? 'Memproses…' : prim.label}
              </Button>
              {reason && (
                <span role="status" className="flex items-start gap-1.5 text-caption text-ink-700">
                  <Icon name="info" size={14} className="mt-px flex-none" />
                  {reason}
                </span>
              )}
            </div>
          )}
          {done && (
            <div className="flex flex-col gap-2">
              <Alert level="success">
                Terdaftar pukul {done.at} · antrean {done.queueNo}
                {bpjs && sepNo ? ` · SEP ${sepNo}` : ''}
                {visit ? ` · ${visit.doctorName}` : ''}.
              </Alert>
              <Link
                href="/display/antrean"
                className="inline-flex min-h-12 items-center justify-center rounded-control border border-brand-800 bg-btn-primary px-4 font-semibold text-white no-underline shadow-button"
              >
                Lihat antrean
              </Link>
            </div>
          )}
          <Button disabled={!done || working} onClick={print}>
            <Icon name="printer" size={16} />
            {printedAt
              ? `Tercetak ${printedAt} · cetak ulang`
              : bpjs
                ? 'Cetak tiket, SEP, dan gelang'
                : 'Cetak tiket dan gelang'}
          </Button>
          {done && (
            <Button
              variant="ghost"
              onClick={() => {
                setNotice(null);
                f.load(null, '');
              }}
            >
              Pasien berikutnya
            </Button>
          )}
          <span className={cx('text-caption text-ink-500', !isScenario && 'sr-only')}>
            {isScenario ? `Pasien simulasi · tiket ${fixed.ticket} · ${fixed.diagnosis}` : ''}
          </span>
        </aside>
      </div>
    </div>
  );
}
