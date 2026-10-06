'use client';

import {
  bpjsReferenceNumberSchema,
  type BpjsVisitKind,
  type CoverageInput,
  type EligibilityResult,
  formatTanggal,
  type OutpatientRegistrationInput,
  type Referral,
  type RegistrationDesk,
} from '@simrs/shared';
import { Alert, Button, Icon } from '@simrs/ui';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';
import { RegQueuePreview } from '@/components/front-office/reg-quota';
import { RegStepper, type RegStepView } from '@/components/front-office/reg-stepper';
import { counterOptions } from '@/lib/queue-board';
import {
  diagnosisText,
  idempotencyFor,
  maskedIdentifier,
  parseDiagnosis,
  participantFromQuery,
  type PatientSummaryView,
  sameMaskedTail,
  visitKindOf,
} from '@/lib/registration-api';
import {
  type CalledTicket,
  callNextCounterAction,
  checkEligibilityAction,
  loadReferralsAction,
  type OpenedPatient,
  openPatientAction,
  registerOutpatientAction,
  searchPatientsAction,
} from './actions-api';
import { NewPatientForm } from './new-patient-form';
import { PatientPanel } from './patient-panel';
import { type PayerChoice, PayerPanel } from './payer-panel';
import {
  type ConsentDraft,
  ConsentPanel,
  type GuarantorChoice,
  GuarantorPanel,
  QuotaPanel,
  quotaFull,
} from './visit-panel';

const STEPS = ['Pasien', 'Penjamin', 'Tujuan', 'Konfirmasi'] as const;
const counterKey = (serviceId: string) => `simrs.antrean.loket.${serviceId}`;
const NO_CONSENT: ConsentDraft = { checked: false, signer: 'pasien', signerName: '' };

/**
 * F03/F06 · Meja pendaftaran rawat jalan mode api (fase 2 potongan 5b, mockup Registrasi): panggil nomor loket,
 * cari/daftarkan pasien (MPI + cek duplikat + Dukcapil), penjamin (cek kepesertaan, rujukan, diagnosa awal), tujuan +
 * kuota, penanggung jawab, persetujuan umum, lalu daftarkan dengan Idempotency-Key. Setelah terdaftar halaman pindah ke
 * hasil (`?kunjungan=`) yang menampilkan SEP dan task 1–3 secara langsung.
 */
export function PendaftaranApiClient({
  desk,
  counterService,
  today,
  canCreatePatient,
  canCheckCoverage,
}: {
  desk: RegistrationDesk;
  counterService: { id: string; name: string } | null;
  today: string;
  canCreatePatient: boolean;
  canCheckCoverage: boolean;
}) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  // Loket
  const counters = counterOptions({ kind: 'loket', room: null, name: desk.counter.name });
  const [counter, setCounter] = useState(counters[0] ?? 'Loket 1');
  const [ticket, setTicket] = useState<CalledTicket | null>(null);

  // Pasien
  const [query, setQuery] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [searchError, setSearchError] = useState('');
  const [results, setResults] = useState<PatientSummaryView[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [opened, setOpened] = useState<OpenedPatient | null>(null);

  // Penjamin
  const [payer, setPayer] = useState<PayerChoice>('bpjs');
  const [participant, setParticipant] = useState('');
  const [eligibility, setEligibility] = useState<EligibilityResult | null>(null);
  const [bpjsDown, setBpjsDown] = useState(false);
  const [referrals, setReferrals] = useState<Referral[] | null>(null);
  const [referralId, setReferralId] = useState<string | null>(null);
  const [manualMode, setManualMode] = useState(false);
  const [manual, setManual] = useState<{ visitKind: BpjsVisitKind; number: string }>({
    visitKind: 'rujukan_fktp',
    number: '',
  });
  const [diagnosis, setDiagnosis] = useState('');
  const [diagTouched, setDiagTouched] = useState(false);

  // Tujuan + konfirmasi
  const [poli, setPoli] = useState(desk.quotas[0]?.poliCode ?? '');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [guarantor, setGuarantor] = useState<GuarantorChoice>({ mode: 'none' });
  const [consent, setConsent] = useState<ConsentDraft>(NO_CONSENT);
  const idem = useRef<{ key: string; fingerprint: string } | null>(null);

  useEffect(() => {
    if (!counterService) return;
    try {
      const saved = window.localStorage.getItem(counterKey(counterService.id));
      if (saved && counters.includes(saved)) setCounter(saved);
    } catch {
      // Penyimpanan lokal tidak tersedia: pakai loket pertama.
    }
    // `counters` tetap untuk layanan loket ini.
  }, [counterService?.id]);

  const p = opened?.patient ?? null;
  const hasNik = !!p && maskedIdentifier(p, 'nik') !== null;
  const hasCard = !!p && maskedIdentifier(p, 'bpjs') !== null;
  const bpjsBlock = !p
    ? null
    : !hasCard || !hasNik
      ? 'Penjamin BPJS butuh NIK dan no. kartu BPJS di data pasien. Lengkapi lewat "Perbarui data pasien".'
      : null;
  const referral = referrals?.find((r) => r.id === referralId) ?? null;
  const e = eligibility?.eligibility ?? null;
  const eligibleOk = e?.status === 'aktif' || (bpjsDown && e === null);
  const manualNumber = bpjsReferenceNumberSchema.safeParse(manual.number);
  const reference: { visitKind: BpjsVisitKind; referenceNumber: string } | null = manualMode
    ? manualNumber.success
      ? { visitKind: manual.visitKind, referenceNumber: manualNumber.data }
      : null
    : referral
      ? { visitKind: visitKindOf(referral), referenceNumber: referral.number }
      : null;
  const dx = parseDiagnosis(diagnosis, referral);
  const diagnosisError =
    diagTouched || diagnosis
      ? !diagnosis.trim()
        ? 'Diagnosa awal wajib diisi untuk SEP (kode ICD-10).'
        : !dx
          ? 'Awali dengan kode ICD-10 yang sah, mis. I10 atau E11.9.'
          : ''
      : '';
  const payerDone = !!p && (payer === 'umum' || (!bpjsBlock && eligibleOk && !!reference && !!dx));
  const quota = desk.quotas.find((q) => q.sessionId === sessionId) ?? null;
  const quotaOk = !!quota && !quotaFull(quota, payer);
  const consentOk =
    !!opened?.consent ||
    (consent.checked && (consent.signer === 'pasien' || consent.signerName.trim().length >= 2));
  const guarantorOk = guarantor.mode !== 'new' || guarantor.name.trim().length >= 2;
  const done = [!!p, payerDone, payerDone && quotaOk, false];
  const active = done.findIndex((d) => !d);
  // Teks alasan mengikuti mockup Registrasi; gerbang tambahan api (blok BPJS, kuota penuh, penanggung jawab) tetap.
  const reason = !p
    ? 'Langkah 1 belum selesai: cari pasien dulu.'
    : !payerDone
      ? payer === 'bpjs'
        ? bpjsBlock
          ? bpjsBlock
          : !eligibleOk
            ? 'Cek kepesertaan BPJS dulu.'
            : !reference
              ? manualMode
                ? 'Isi nomor rujukan atau surat kontrol dulu.'
                : 'Pilih rujukan aktif dulu.'
              : 'Isi diagnosa awal dulu.'
        : 'Lengkapi penjamin.'
      : !quota
        ? 'Pilih dokter dengan kuota tersedia.'
        : !quotaOk
          ? 'Kuota dokter ini penuh; pilih dokter lain.'
          : !guarantorOk
            ? 'Lengkapi nama penanggung jawab.'
            : !consentOk
              ? 'Persetujuan umum belum ditandatangani pasien.'
              : '';

  const steps: RegStepView[] = STEPS.map((label, i) => ({
    label,
    note:
      [
        p ? `${p.name} · RM ${p.mrn}` : 'Cari NIK, RM, BPJS, atau nama',
        !p
          ? 'Penjamin dan rujukan'
          : payer === 'umum'
            ? 'Umum · tanpa SEP'
            : payerDone
              ? `BPJS · ${reference?.referenceNumber ?? ''}`
              : 'Cek kepesertaan + rujukan',
        quota ? `${quota.poliName} · ${quota.doctorName}` : 'Poli, dokter, kuota',
        'Persetujuan umum, daftarkan',
      ][i] ?? '',
    state: done[i] ? 'selesai' : i === active ? 'aktif' : 'belum',
  }));

  // ---------------------------------------------------------------------------------------------------------
  // Aksi
  // ---------------------------------------------------------------------------------------------------------

  const resetCoverage = (o: OpenedPatient | null, rawParticipant: string) => {
    const card = !!o && maskedIdentifier(o.patient, 'bpjs') !== null;
    const nik = !!o && maskedIdentifier(o.patient, 'nik') !== null;
    setPayer(card && nik ? 'bpjs' : 'umum');
    setParticipant(rawParticipant);
    setEligibility(null);
    setBpjsDown(false);
    setReferrals(null);
    setReferralId(null);
    setManualMode(false);
    setManual({ visitKind: 'rujukan_fktp', number: '' });
    setDiagnosis('');
    setDiagTouched(false);
    setSessionId(null);
    setConsent(NO_CONSENT);
    const g = o?.contacts.find((c) => c.isGuarantor);
    setGuarantor(g ? { mode: 'existing', contactId: g.id } : { mode: 'none' });
    idem.current = null;
  };

  const open = (id: string, rawParticipant = participantFromQuery(query)?.value ?? '') =>
    start(async () => {
      setNotice(null);
      const r = await openPatientAction(id);
      if (!r.ok) return setNotice({ ok: false, text: r.message });
      setOpened(r.data);
      setCreating(false);
      setResults(null);
      resetCoverage(r.data, rawParticipant);
    });

  const clearPatient = () => {
    setOpened(null);
    setResults(null);
    resetCoverage(null, '');
  };

  const search = () => {
    const q = query.trim();
    if (q.length < 3) {
      return setSearchError('Masukkan minimal 3 karakter: NIK, No. RM, No. BPJS, atau nama.');
    }
    start(async () => {
      setSearchError('');
      const r = await searchPatientsAction({ q, ...(birthDate ? { birthDate } : {}) });
      if (!r.ok) return setSearchError(r.message);
      const active = r.data.filter((x) => x.status === 'active');
      // Nomor identitas cocok tepat satu pasien → langsung dibuka.
      if (participantFromQuery(q) && active.length === 1 && active[0]) return open(active[0].id);
      setResults(r.data);
    });
  };

  const callNext = () => {
    if (!counterService) return;
    start(async () => {
      setNotice(null);
      const r = await callNextCounterAction({ serviceId: counterService.id, counter });
      if (!r.ok) {
        setNotice({ ok: false, text: r.message });
        return;
      }
      setTicket(r.data);
      clearPatient();
      setNotice({
        ok: true,
        text: `${r.data.queueNo} dipanggil ke ${counter}.${r.data.patientId ? ' Data pasien dari anjungan dimuat.' : ' Cari atau daftarkan pasien.'}`,
      });
      router.refresh();
      if (r.data.patientId) {
        const o = await openPatientAction(r.data.patientId);
        if (o.ok) {
          setOpened(o.data);
          resetCoverage(o.data, '');
        }
      }
    });
  };

  const loadReferrals = async (patientId: string) => {
    const r = await loadReferralsAction(patientId);
    if (r.ok) {
      setReferrals(r.data);
      if (r.data.length === 0) setManualMode(true);
      return;
    }
    if (r.code === 'BPJS_UNAVAILABLE') {
      setBpjsDown(true);
      setReferrals([]);
      setManualMode(true);
    }
    setNotice({ ok: false, text: r.message });
  };

  const check = () => {
    if (!p) return;
    const v = participant.replace(/\D/g, '');
    const participantInput = participantFromQuery(v);
    if (!participantInput) {
      return setNotice({ ok: false, text: 'Masukkan no. kartu BPJS (13 digit) atau NIK (16 digit) pasien.' });
    }
    start(async () => {
      setNotice(null);
      const r = await checkEligibilityAction({ patientId: p.id, participant: participantInput });
      if (!r.ok) {
        if (r.code === 'BPJS_UNAVAILABLE') {
          setBpjsDown(true);
          setEligibility(null);
          await loadReferrals(p.id);
        }
        return setNotice({ ok: false, text: r.message });
      }
      setBpjsDown(false);
      setEligibility(r.data);
      if (r.data.eligibility.status === 'aktif') await loadReferrals(p.id);
    });
  };

  const pickReferral = (id: string) => {
    const r = referrals?.find((x) => x.id === id);
    if (!r) return;
    setReferralId(id);
    if (!diagTouched) setDiagnosis(diagnosisText(r));
    if (desk.quotas.some((q) => q.poliCode === r.poliCode)) {
      setPoli(r.poliCode);
      const doctor = r.doctorId
        ? desk.quotas.find((q) => q.doctorId === r.doctorId && q.poliCode === r.poliCode)
        : null;
      setSessionId(doctor?.sessionId ?? null);
    }
  };

  const submit = () => {
    if (!p || !quota || reason) return;
    let coverage: CoverageInput;
    if (payer === 'bpjs') {
      if (!reference || !dx) return;
      coverage = { payer: 'bpjs', ...reference, initialDiagnosis: dx };
    } else {
      coverage = { payer: 'umum' };
    }
    const registration: OutpatientRegistrationInput = {
      patientId: p.id,
      sessionId: quota.sessionId,
      ...(ticket ? { counterTicketId: ticket.ticketId } : {}),
      coverage,
      ...(opened?.consent
        ? {}
        : {
            generalConsent: {
              confirmedByStaff: true as const,
              signer: consent.signer,
              ...(consent.signer === 'wali' ? { signerName: consent.signerName.trim() } : {}),
            },
          }),
      ...(guarantor.mode === 'existing'
        ? { guarantor: { contactId: guarantor.contactId } }
        : guarantor.mode === 'new'
          ? {
              guarantor: {
                name: guarantor.name.trim(),
                relation: guarantor.relation,
                ...(guarantor.phone.trim() ? { phone: guarantor.phone.trim() } : {}),
                isGuarantor: true,
              },
            }
          : {}),
    };
    idem.current = idempotencyFor(idem.current, registration, () => crypto.randomUUID());
    const key = idem.current.key;
    start(async () => {
      setNotice(null);
      const r = await registerOutpatientAction({ key, registration });
      if (!r.ok) {
        if (r.code === 'GENERAL_CONSENT_REQUIRED' && opened) setOpened({ ...opened, consent: null });
        return setNotice({ ok: false, text: r.message });
      }
      router.push(`/pendaftaran?kunjungan=${r.data.encounterId}`);
    });
  };

  // ---------------------------------------------------------------------------------------------------------
  // Tampilan
  // ---------------------------------------------------------------------------------------------------------

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <span className="text-caption text-ink-500">Front office / Pendaftaran / Rawat jalan</span>
          <h1 className="m-0 text-h1 font-semibold">Pendaftaran pasien rawat jalan</h1>
        </div>
        {counterService && (
          <div role="group" aria-label="Antrean loket" className="flex flex-wrap items-center gap-2.5">
            <span className="text-small text-ink-700">
              {desk.counter.name}: {desk.counter.waiting} menunggu
              {ticket ? ` · melayani ${ticket.queueNo}` : ''}
            </span>
            <label className="sr-only" htmlFor="loket-pemanggil">
              Loket pemanggil
            </label>
            <select
              id="loket-pemanggil"
              value={counter}
              onChange={(ev) => {
                setCounter(ev.target.value);
                try {
                  window.localStorage.setItem(counterKey(counterService.id), ev.target.value);
                } catch {
                  // abaikan
                }
              }}
              className="h-11 rounded-control border border-line-strong bg-white px-3 font-[inherit]"
            >
              {counters.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
            <Button variant="primary" disabled={busy || desk.counter.waiting === 0} onClick={callNext}>
              <Icon name="bell" size={16} />
              Panggil berikutnya{desk.counter.tickets[0] ? ` · ${desk.counter.tickets[0].ticket}` : ''}
            </Button>
          </div>
        )}
      </header>

      {notice && (
        <Alert level={notice.ok ? 'success' : 'warning'}>
          <span role="status">{notice.text}</span>
        </Alert>
      )}

      <RegStepper steps={steps} />

      <div className="flex flex-wrap items-start gap-4">
        {creating ? (
          <NewPatientForm
            today={today}
            initialNik={
              participantFromQuery(query)?.by === 'nik' ? (participantFromQuery(query)?.value ?? '') : ''
            }
            onCreated={(id, raw) => open(id, raw.bpjs || raw.nik)}
            onUseExisting={(id) => open(id)}
            onCancel={() => setCreating(false)}
          />
        ) : (
          <PatientPanel
            query={query}
            birthDate={birthDate}
            error={searchError}
            results={results}
            opened={opened}
            today={today}
            busy={busy}
            canCreate={canCreatePatient}
            onQuery={(v) => {
              setQuery(v);
              setSearchError('');
            }}
            onBirthDate={setBirthDate}
            onSearch={search}
            onPick={(id) => open(id)}
            onClear={clearPatient}
            onNew={() => {
              setCreating(true);
              setResults(null);
            }}
          />
        )}

        <section aria-label="Penjaminan" className="flex min-w-0 flex-[999_1_420px] flex-col gap-4">
          <PayerPanel
            enabled={!!p}
            payer={payer}
            bpjsBlock={bpjsBlock}
            participant={participant}
            canCheck={canCheckCoverage && !!p && !bpjsBlock}
            checking={busy}
            eligibility={eligibility}
            cardMismatch={!!e && !!p && !sameMaskedTail(e.cardMasked, maskedIdentifier(p, 'bpjs'))}
            bpjsDown={bpjsDown}
            referrals={referrals}
            referralId={referralId}
            manual={manual}
            manualMode={manualMode}
            diagnosis={diagnosis}
            diagnosisError={diagnosisError}
            today={today}
            onPayer={(v) => {
              setPayer(v);
              setSessionId(null);
            }}
            onParticipant={setParticipant}
            onCheck={check}
            onReferral={pickReferral}
            onManualMode={setManualMode}
            onManual={setManual}
            onDiagnosis={(v) => {
              setDiagnosis(v);
              setDiagTouched(true);
            }}
          />
          <GuarantorPanel
            enabled={!!p}
            contacts={opened?.contacts ?? []}
            value={guarantor}
            onChange={setGuarantor}
          />
        </section>

        <aside
          aria-label="Tujuan dan konfirmasi"
          className="flex min-w-0 flex-[1_1_280px] flex-col gap-4 lg:max-w-[360px]"
        >
          <QuotaPanel
            enabled={!!p}
            payer={payer}
            quotas={desk.quotas}
            poli={poli}
            sessionId={sessionId}
            onPoli={(code) => {
              setPoli(code);
              setSessionId(null);
            }}
            onSession={setSessionId}
          />
          {/* Mockup Registrasi: pratinjau nomor antrean dari kuota dokter terpilih (nomor final dibentuk API). */}
          <RegQueuePreview
            label="PRATINJAU ANTREAN"
            queueNo={p && quota ? quota.nextQueueNo : '—'}
            line={
              p && quota
                ? `${/^Poli /.test(quota.poliName) ? '' : 'Poli '}${quota.poliName} · ${quota.room} · perkiraan dipanggil ${quota.eta}`
                : 'Pilih pasien dan dokter untuk membentuk nomor antrean.'
            }
            note={
              payer === 'bpjs'
                ? 'Task ID 1–3 Antrean BPJS terkirim otomatis'
                : 'Antrean non-JKN · tidak dikirim ke Antrean BPJS'
            }
          />
          <ConsentPanel
            enabled={!!p}
            activeSince={opened?.consent ? formatTanggal(opened.consent.givenAt) : null}
            value={consent}
            onChange={setConsent}
          />
          <div className="flex flex-col gap-1.5">
            <Button variant="primary" disabled={!!reason || busy} onClick={submit}>
              {busy ? 'Memproses…' : payer === 'bpjs' ? 'Daftarkan dan terbitkan SEP' : 'Daftarkan'}
            </Button>
            {reason && (
              <span role="status" className="flex items-start gap-1.5 text-caption text-ink-700">
                <Icon name="info" size={14} className="mt-px flex-none" />
                {reason}
              </span>
            )}
            {!reason && payer === 'bpjs' && (
              <span className="text-caption text-ink-500">
                SEP dikirim ke BPJS setelah pendaftaran tersimpan; gangguan BPJS tidak menahan pendaftaran.
              </span>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
