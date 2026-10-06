'use client';

import { formatJam, formatTanggalLahir, type OrSchedule } from '@simrs/shared';
import { Alert, Chip, PatientBanner } from '@simrs/ui';
import { usePathname, useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { OkChecklist } from '@/components/btn/ok-checklist';
import { OkCount } from '@/components/btn/ok-count';
import { OkGantt } from '@/components/btn/ok-gantt';
import { OkIncision } from '@/components/btn/ok-incision';
import { useDemoClock, useScenarioTask } from '@/components/btn/use-scenario-task';
import { OkAnesthesia } from '@/components/penunjang/ok-anestesi';
import {
  CASE_STATUS_LABEL,
  EMPTY_LOCAL,
  type OkLocal,
  PHASE_LABEL,
  scenarioCaseNote,
  withLocal,
} from '@/lib/btn-ok';
import type { ScenarioHook } from '@/lib/btn-skenario';
import { type OkEventInput, recordOkEventAction } from './actions';

/** S06 · Interaksi layar kamar operasi: pilih kasus, daftar tilik, hitung kasa, gerbang insisi. */
export function OkClient({
  schedule,
  hook,
  initialCaseId,
  userName,
}: {
  schedule: OrSchedule;
  hook: ScenarioHook | null;
  initialCaseId: string;
  userName: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const clock = useDemoClock(schedule.now);
  const scenario = useScenarioTask(hook);
  const [pending, startTransition] = useTransition();
  const [selectedId, setSelectedId] = useState(initialCaseId);
  const [locals, setLocals] = useState<Record<string, OkLocal>>({});
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const busy = pending || scenario.pending;

  const rooms = schedule.rooms.map((r) => ({
    ...r,
    cases: r.cases.map((c) => withLocal(c, locals[c.id] ?? EMPTY_LOCAL, userName)),
  }));
  const all = rooms.flatMap((room) => room.cases.map((c) => ({ room, c })));
  const sel = all.find((x) => x.c.id === selectedId) ?? all[0];
  if (!sel) return null;
  const { room, c } = sel;
  const local = locals[c.id] ?? EMPTY_LOCAL;
  const nowMin = Math.round(
    (Date.parse(schedule.now) - Date.parse(`${schedule.date}T00:00:00+07:00`)) / 60_000,
  );

  const patch = (fn: (l: OkLocal) => OkLocal) =>
    setLocals((cur) => ({ ...cur, [c.id]: fn(cur[c.id] ?? EMPTY_LOCAL) }));

  const record = (input: OkEventInput, label: string, apply: (at: string) => void, task?: string) =>
    startTransition(async () => {
      const r = await recordOkEventAction(input);
      if (r.error) {
        setMsg({ text: r.error, ok: false });
        return;
      }
      const at = clock();
      apply(at);
      const done = `${label} · ${formatJam(at)}`;
      setMsg({ text: `${done} (simulasi, tidak disimpan)`, ok: true });
      // Skenario baru dinyatakan maju setelah server menerima perintahnya (bukan saat perintah dikirim).
      if (task && c.scenario) {
        scenario.fire('operasi', task, true, (ok) => {
          if (ok) setMsg({ text: `${done} · simulasi skenario maju (simulasi, tidak disimpan)`, ok: true });
        });
      }
    });

  const select = (id: string) => {
    setSelectedId(id);
    setMsg(null);
    router.replace(`${pathname}?pilih=${id}`, { scroll: false });
  };

  const confirm = (index: number) => {
    const phase = c.checklist[index]?.phase;
    if (!phase) return;
    record(
      { kind: 'konfirmasi', caseId: c.id, phase },
      `${PHASE_LABEL[phase]} dikonfirmasi oleh ${userName}`,
      (at) => patch((l) => ({ ...l, confirmed: { ...l.confirmed, [phase]: at } })),
      phase === 'sign-out' ? 'tilik' : undefined,
    );
  };

  const focusTimeOut = () => {
    const el = document.querySelector<HTMLInputElement>(
      'input[data-phase="time-out"]:not(:checked):not(:disabled)',
    );
    el?.focus();
  };

  return (
    <>
      <OkGantt
        rooms={rooms}
        dayStart={schedule.dayStartMin}
        dayEnd={schedule.dayEndMin}
        nowMin={nowMin}
        selectedId={c.id}
        onSelect={select}
      />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.7fr)_minmax(300px,1fr)]">
        <section
          aria-label="Daftar tilik keselamatan"
          className="flex min-w-0 flex-col gap-3 rounded-card border border-line bg-white p-4"
        >
          <div className="flex flex-wrap items-start justify-between gap-2">
            <span className="flex min-w-0 flex-col">
              <h2 className="m-0 text-h2 font-semibold">
                {room.name} · {c.procedure}
              </h2>
              <span className="text-small text-ink-700">
                Operator {c.operator} · anestesi {c.anesthetist} ({c.anesthesia}) · instrumen {c.nurses.scrub}{' '}
                · sirkuler {c.nurses.circulating}
              </span>
            </span>
            <Chip tone={c.status === 'cito' ? 'danger' : c.status === 'selesai' ? 'success' : 'brand'}>
              {CASE_STATUS_LABEL[c.status]}
            </Chip>
          </div>
          <PatientBanner
            name={c.patient.name}
            sex={c.patient.sex}
            ageYears={c.patient.ageYears}
            birthDate={formatTanggalLahir(c.patient.birthDate)}
            mrn={c.patient.rm}
            allergies={c.patient.allergies}
            guarantor={c.patient.guarantor}
            attending={c.operator}
          />
          <div className="flex flex-wrap gap-2">
            <Chip tone="info" mono>
              {c.icd9cm ? `ICD-9-CM ${c.icd9cm} · ${c.procedure}` : 'ICD-9-CM dikode setelah laporan operasi'}
            </Chip>
            {c.diagnosis && (
              <Chip tone="neutral" mono>
                ICD-10 {c.diagnosis.icd10} · {c.diagnosis.label}
              </Chip>
            )}
            {c.scenario && <Chip tone="brand">{scenarioCaseNote(c)}</Chip>}
          </div>
          {msg && (
            <Alert level={msg.ok ? 'success' : 'critical'}>
              <span role="status">{msg.text}</span>
            </Alert>
          )}
          {scenario.error && <Alert level="critical">{scenario.error.message}</Alert>}
          <OkChecklist
            c={c}
            busy={busy}
            onToggle={(itemId) =>
              patch((l) => {
                const current =
                  c.checklist.flatMap((p) => p.items).find((i) => i.id === itemId)?.checked ?? false;
                return { ...l, checked: { ...l.checked, [itemId]: !current } };
              })
            }
            onConfirm={confirm}
          />
        </section>
        <div className="flex min-w-0 flex-col gap-4">
          <OkAnesthesia c={c} />
          <OkIncision
            c={c}
            local={local}
            busy={busy}
            onFocusTimeOut={focusTimeOut}
            onIncise={() =>
              record({ kind: 'insisi', caseId: c.id, checklist: c.checklist }, 'Insisi dicatat', (at) =>
                patch((l) => ({ ...l, incisionAt: at })),
              )
            }
            onOverride={(reason) =>
              record(
                { kind: 'override', caseId: c.id, reason },
                'Override time out tercatat, insisi dicatat',
                (at) => patch((l) => ({ ...l, incisionAt: at, overrideReason: reason.trim() })),
              )
            }
            onFinish={() =>
              record(
                { kind: 'selesai', caseId: c.id },
                'Operasi dicatat selesai',
                (at) => patch((l) => ({ ...l, finishedAt: at })),
                'op',
              )
            }
            onMove={() =>
              record(
                { kind: 'pulih', caseId: c.id },
                'Pasien dipindahkan ke ruang pulih',
                (at) => patch((l) => ({ ...l, movedAt: at })),
                'pulih',
              )
            }
          />
          <OkCount
            c={c}
            busy={busy}
            onChange={(countId, value) => patch((l) => ({ ...l, finals: { ...l.finals, [countId]: value } }))}
          />
          <section
            aria-label="Terhubung otomatis"
            className="flex flex-col gap-1.5 rounded-card border border-line bg-white p-4 text-small text-ink-700"
          >
            <span className="font-semibold text-ink-900">Terhubung otomatis</span>
            <span>• Laporan operasi dan laporan anestesi (K10)</span>
            <span>• BHP dan implan terpakai → stok depo OK dan tagihan</span>
            <span>• Kode ICD-9-CM {c.icd9cm ?? 'dari koder'} → klaim INA-CBG</span>
            <span>• Procedure ke SATUSEHAT</span>
          </section>
        </div>
      </div>
    </>
  );
}
