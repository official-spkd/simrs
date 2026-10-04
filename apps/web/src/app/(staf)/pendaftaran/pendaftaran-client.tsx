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
import { demoNow } from '@/lib/demo/fixtures/waktu';
import {
  nextQueueNo,
  REGISTRATION_STEPS,
  type RegistrationFlow,
  registrationPrimary,
  registrationProgress,
} from '@/lib/front-office';
import { checkEligibilityAction, completeRegistrationAction, issueSepAction } from './actions';
import { type RegFixed, type RegScenarioView, useRegistration } from './use-registration';

/**
 * F03/F06 · Pendaftaran rawat jalan (mockup Registrasi). Tn. Suryo (skenario rawat jalan) dipanggil lewat
 * "Panggil berikutnya · A-031" dan langkah cek/SEP menjalankan tugas skenario; pasien lain berjalan lokal lewat
 * Server Action yang tidak menyimpan apa pun.
 */
export function PendaftaranClient({
  desk,
  scenarioPatient,
  scenario,
  fixed,
  today,
}: {
  desk: RegistrationDesk;
  scenarioPatient: RegistrationPatient;
  scenario: RegScenarioView;
  fixed: RegFixed;
  today: string;
}) {
  const patients = scenario.atCounter ? [scenarioPatient, ...desk.patients] : desk.patients;
  const f = useRegistration(
    desk,
    patients,
    scenario.atCounter ? fixed.patientId : (desk.patients[0]?.id ?? null),
    !scenario.atCounter ? 'showcase' : scenario.sepIssued ? 'preset' : 'fresh',
  );
  const { run, pending: running, error: runError } = useDemoRunner(scenario.rev);
  const [busy, startTransition] = useTransition();
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const walkIns = desk.counter.tickets.filter((t) => t.patientId === null).map((t) => t.ticket);
  const [called, setCalled] = useState<string[]>([]);
  const [waiting, setWaiting] = useState(desk.counter.waiting);
  const [pendingCall, setPendingCall] = useState(false);

  const p = f.patient;
  const isScenario = !!p && p.id === fixed.patientId;
  const bpjs = f.payer === 'BPJS';
  const checked = isScenario ? scenario.checked : f.checkedLocal;
  const sepNo = isScenario ? (scenario.sepIssued ? fixed.sep : null) : (f.sepLocal?.no ?? null);
  const sepAt = isScenario ? (scenario.sepAt ?? '') : (f.sepLocal?.at ?? '');
  const referral = p?.referrals.find((r) => r.id === f.referralId) ?? null;
  const quota = desk.quotas.find((q) => q.doctorId === f.doctorId) ?? null;
  const flow: RegistrationFlow = {
    found: !!p,
    payer: f.payer,
    checked,
    referralChosen: !!referral,
    diagnosisError: f.diagnosisError,
    sepIssued: !!sepNo,
    doctorChosen: !!quota,
    scheduleLocked: f.scheduleLocked,
    consent: f.consent,
    done: !!f.done,
  };
  const prog = registrationProgress(flow);
  const prim = registrationPrimary(flow);
  const working = busy || running;
  /** Cap waktu catatan (dipanggil di penangan aksi): Tn. Suryo mengikuti jam naskah, pasien lain jam hari demo. */
  const stamp = () => (isScenario ? scenario.clock : formatJam(demoNow()));

  // Antrean loket: A-031 (Tn. Suryo) didahulukan saat tiketnya tercetak; walk-in melewati nomor itu.
  const nextWalkIn =
    walkIns.find((t) => !called.includes(t)) ?? nextQueueNo('A', [...walkIns, ...called, fixed.ticket]);
  const headerTicket = scenario.callable ? fixed.ticket : nextWalkIn;

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
    setCalled((c) => [...c, nextWalkIn]);
    setWaiting((w) => Math.max(0, w - 1));
    setNotice({
      ok: true,
      text: `${nextWalkIn} dipanggil ke ${desk.counter.name} · ${formatJam(demoNow())}`,
    });
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
      startTransition(async () => {
        const r = await issueSepAction({ patientId: p.id, referralId: f.referralId, diagnosis: f.diagnosis });
        setNotice({ ok: r.ok, text: r.message });
        // Cap waktu catatan SEP mengikuti jam hari demo (bukan jam server di pesan umpan balik).
        if (r.ok && r.sepNo) f.setSepLocal({ no: r.sepNo, at: stamp() });
      });
    } else if (prim.kind === 'tujuan') {
      f.setScheduleLocked(true);
    } else if (prim.kind === 'selesai' && quota) {
      if (isScenario) {
        f.setDone({ at: stamp(), queueNo: fixed.queueNo });
        return;
      }
      startTransition(async () => {
        const r = await completeRegistrationAction({
          patientId: p.id,
          payer: f.payer,
          doctorId: quota.doctorId,
          consent: f.consent,
        });
        setNotice({ ok: r.ok, text: r.message });
        if (r.ok && r.queueNo) f.setDone({ at: stamp(), queueNo: r.queueNo });
      });
    }
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
    prog.done[2] && quota ? `${quota.poliName} · ${quota.start}–${quota.end}` : 'Poli, dokter, jadwal',
    f.done ? `Terdaftar ${f.done.at}` : 'SEP, antrean, cetak',
  ];
  const steps: RegStepView[] = REGISTRATION_STEPS.map((label, i) => ({
    label,
    note: notes[i] ?? '',
    state: prog.done[i] ? 'selesai' : i === prog.active ? 'aktif' : 'belum',
  }));
  const queueNo = f.done?.queueNo ?? (p && quota ? (isScenario ? fixed.queueNo : quota.nextQueueNo) : '—');
  const doneAt = f.done?.at ?? '';
  const scenarioWait = isScenario && prim.kind === 'sep' && !prim.reason && !scenario.enabled.sep;
  const reason = scenarioWait ? 'Menunggu giliran tugas skenario (lihat panel simulasi).' : prim.reason;

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <span className="text-caption text-ink-500">Front office / Pendaftaran / Rawat jalan</span>
          <h1 className="m-0 text-h1 font-semibold">Pendaftaran pasien rawat jalan</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="inline-flex h-9 items-center gap-1.5 rounded-full border border-line bg-white px-3 text-caption text-ink-700">
            <span aria-hidden="true" className="size-2 rounded-full bg-[#16A34A]" />
            VClaim {desk.vclaimLatencyMs} ms
          </span>
          <span className="text-small text-ink-700">Antrean loket: {waiting} menunggu</span>
          <Button variant="primary" disabled={working} onClick={callNext}>
            <Icon name="bell" size={16} />
            Panggil berikutnya · {headerTicket}
          </Button>
        </div>
      </header>

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
          locked={isScenario && !f.done}
          onQuery={f.setQuery}
          onSearch={f.search}
          onReadKtp={() => desk.patients[0] && f.load(desk.patients[0], desk.patients[0].nikMasked)}
          onScanCard={() => desk.patients[0] && f.load(desk.patients[0], desk.patients[0].bpjsMasked ?? '')}
        />
        <section aria-label="Penjaminan" className="flex min-w-0 flex-[999_1_420px] flex-col gap-4">
          <RegPayer
            payer={f.payer}
            payerLocked={!p || !!f.done || isScenario}
            payerNote={isScenario ? 'Penjamin mengikuti booking Mobile JKN pasien.' : ''}
            eligibility={p?.eligibility ?? null}
            checked={checked}
            checkDisabled={!p || (isScenario && !scenario.enabled.cek)}
            checking={working}
            referrals={p?.referrals ?? []}
            referralId={f.referralId}
            referralLocked={!p || !checked || !!sepNo || !!f.done}
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
            countSelected={!(isScenario && scenario.sepIssued)}
            onPick={f.setDoctorId}
          />
          <RegQueuePreview
            label={f.done ? 'NOMOR ANTREAN' : f.scheduleLocked ? 'ANTREAN TERBENTUK' : 'PRATINJAU ANTREAN'}
            queueNo={queueNo}
            line={
              p && quota
                ? `Poli ${quota.poliName} · ${quota.room} · perkiraan dipanggil ${quota.eta}`
                : 'Pilih pasien dan dokter untuk membentuk nomor antrean.'
            }
            note={
              f.done
                ? bpjs
                  ? `Task ID 1–3 Antrean BPJS terkirim ${doneAt}`
                  : `Antrean non-JKN tercatat ${doneAt}`
                : bpjs
                  ? 'Task ID 1–3 Antrean BPJS terkirim otomatis'
                  : 'Antrean non-JKN · tidak dikirim ke Antrean BPJS'
            }
          />
          <label className="flex min-h-11 cursor-pointer items-start gap-2.5 rounded-control border border-line bg-white p-3 text-small">
            <input
              type="checkbox"
              checked={f.consent}
              disabled={!!f.done || !p}
              onChange={(e) => f.setConsent(e.target.checked)}
              className="mt-0.5 size-5 flex-none accent-brand-600"
            />
            Persetujuan umum (general consent) sudah ditandatangani pasien di tablet
          </label>
          {!f.done && prim.kind !== 'none' && (
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
          {f.done && (
            <div className="flex flex-col gap-2">
              <Alert level="success">
                Terdaftar pukul {f.done.at} · antrean {f.done.queueNo}
                {bpjs && sepNo ? ` · SEP ${sepNo}` : ''}.
              </Alert>
              <Link href="/display/antrean" className="text-small font-semibold">
                Lihat antrean
              </Link>
            </div>
          )}
          <Button disabled={!f.done} onClick={() => f.print(stamp())}>
            <Icon name="printer" size={16} />
            {f.printedAt
              ? `Tercetak ${f.printedAt} · cetak ulang`
              : bpjs
                ? 'Cetak tiket, SEP, dan gelang'
                : 'Cetak tiket dan gelang'}
          </Button>
          {f.done && (
            <Button
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
