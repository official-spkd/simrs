'use client';

import {
  formatTanggalWaktu,
  type LabInboundIssue,
  type LabOrderDetail,
  type LabOrderStatus,
  type LabQcRun,
  type LabResultRecord,
  type LabTestDefinition,
  type LabWorklistItem,
  SPECIMEN_REJECT_REASONS,
} from '@simrs/shared';
import { Alert, Button, Chip, type ChipTone, KpiCard } from '@simrs/ui';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';
import {
  acceptLabOrderAction,
  correctLabResultAction,
  enterLabResultsAction,
  type LabActionResult,
  qcRunAction,
  specimenAction,
  validateLabAction,
} from '@/app/(staf)/penunjang/lab/actions';

export interface LabApiCan {
  accept: boolean;
  collect: boolean;
  receive: boolean;
  reject: boolean;
  write: boolean;
  verify: boolean;
  release: boolean;
  correct: boolean;
  qcWrite: boolean;
  qcRead: boolean;
  critical: boolean;
}

type Notice = { ok: boolean; text: string } | null;

const CARD = 'rounded-card border border-white/95 bg-white/90 shadow-card';
const TABLE = 'w-full border-collapse text-small';
const TH = 'border-b border-line px-3 py-2 text-left text-caption font-semibold text-ink-700';
const TD = 'border-b border-line-soft px-3 py-2 align-top';
const INPUT =
  'h-11 rounded-control border border-line-strong bg-white px-3 text-body text-ink-900 focus-visible:outline-2 focus-visible:outline-brand-600';

export const LAB_STATUS_LABEL: Record<LabOrderStatus, string> = {
  diterima: 'Diterima lab',
  sampel: 'Sampel diambil',
  proses: 'Diproses',
  hasil: 'Hasil masuk',
  validasi_teknis: 'Tervalidasi teknis',
  selesai: 'Dirilis',
  batal: 'Batal',
};
const STATUS_TONE: Record<LabOrderStatus, ChipTone> = {
  diterima: 'info',
  sampel: 'info',
  proses: 'brand',
  hasil: 'warning',
  validasi_teknis: 'warning',
  selesai: 'success',
  batal: 'neutral',
};
const SPECIMEN_LABEL: Record<string, string> = {
  serum: 'Serum',
  darah_edta: 'Darah EDTA',
  plasma_sitrat: 'Plasma sitrat',
  urin: 'Urin',
};
const SPECIMEN_STATUS: Record<string, [string, ChipTone]> = {
  menunggu: ['Menunggu diambil', 'neutral'],
  diambil: ['Diambil', 'info'],
  diterima: ['Diterima lab', 'success'],
  ditolak: ['Ditolak', 'danger'],
};
const REJECT_LABEL: Record<(typeof SPECIMEN_REJECT_REASONS)[number], string> = {
  hemolisis: 'Hemolisis',
  volume_kurang: 'Volume kurang',
  label_tidak_sesuai: 'Label tidak sesuai',
  beku: 'Beku',
  wadah_salah: 'Wadah salah',
  terlambat: 'Terlambat dikirim',
  lainnya: 'Lainnya',
};
const FLAG_TONE: Record<string, ChipTone> = { N: 'success', H: 'warning', L: 'warning', KRITIS: 'danger' };
const FLAG_LABEL: Record<string, string> = { N: 'Normal', H: 'Tinggi', L: 'Rendah', KRITIS: 'Kritis' };

function valueOf(r: Pick<LabResultRecord, 'valueNumeric' | 'valueText' | 'decimals' | 'unit'>): string {
  const v =
    r.valueNumeric === null ? (r.valueText ?? '') : r.valueNumeric.toFixed(r.decimals).replace('.', ',');
  return r.unit ? `${v} ${r.unit}` : v;
}

function rangeOf(r: LabResultRecord): string {
  const f = (n: number) => String(n).replace('.', ',');
  const low = r.ref?.low ?? null;
  const high = r.ref?.high ?? null;
  if (low !== null && high !== null) return `${f(low)}–${f(high)}`;
  if (high !== null) return `≤ ${f(high)}`;
  if (low !== null) return `≥ ${f(low)}`;
  return '-';
}

const newKey = () => crypto.randomUUID();

/**
 * S01 · Ruang kerja Laboratorium mode api (potongan 4.2): KPI dari worklist, daftar kerja unit lab, kiriman CPOE baru
 * (terima → label), detail order (spesimen, hasil, validasi), pesan analyzer bermasalah, dan QC. Tombol mengikuti izin
 * sesi; API tetap menegakkan semua gerbang (nilai kritis terbuka, QC ditolak, urutan validasi, unit lab).
 */
export function LabApiWorkspace({
  view,
  worklist,
  pending,
  detail,
  issues,
  tests,
  qc,
  can,
}: {
  view: 'aktif' | 'selesai';
  worklist: LabWorklistItem[];
  pending: LabWorklistItem | null;
  detail: LabOrderDetail | null;
  issues: LabInboundIssue[];
  tests: LabTestDefinition[];
  qc: LabQcRun[];
  can: LabApiCan;
}) {
  const router = useRouter();
  const [notice, setNotice] = useState<Notice>(null);
  const [busy, start] = useTransition();
  const run = (
    fn: () => Promise<LabActionResult | { ok: boolean; message: string }>,
    go?: (id: string) => void,
  ) =>
    start(async () => {
      const r = await fn();
      setNotice({ ok: r.ok, text: r.message });
      if (r.ok && 'orderId' in r && go) go(r.orderId);
    });

  const kpi = useMemo(() => {
    const accepted = worklist.filter((w) => w.labOrderId);
    return {
      fresh: worklist.filter((w) => !w.labOrderId).length,
      running: accepted.length,
      validation: accepted.filter((w) => w.status === 'hasil' || w.status === 'validasi_teknis').length,
      critical: accepted.filter((w) => w.criticalOpen).length,
    };
  }, [worklist]);

  return (
    <>
      <div
        role="region"
        aria-label="Indikator laboratorium"
        className="grid grid-cols-2 gap-3.5 xl:grid-cols-4"
      >
        <KpiCard label="Order baru" value={String(kpi.fresh)} detail="belum diterima lab" tinted />
        <KpiCard
          label="Order berjalan"
          value={String(kpi.running)}
          detail={`${kpi.validation} menunggu validasi`}
          tinted
        />
        <KpiCard
          label="Nilai kritis terbuka"
          value={String(kpi.critical)}
          hint={kpi.critical ? 'laporkan dengan read-back' : 'tidak ada'}
          tone={kpi.critical ? 'danger' : 'success'}
          tinted
        />
        <KpiCard
          label="Pesan analyzer bermasalah"
          value={String(issues.length)}
          hint={issues.length ? 'perlu ditinjau' : 'semua diproses'}
          tone={issues.length ? 'warning' : 'success'}
          tinted
        />
      </div>

      {notice && (
        <Alert level={notice.ok ? 'success' : 'warning'} title={notice.ok ? 'Berhasil' : 'Belum bisa'}>
          {notice.text}
        </Alert>
      )}

      <div className="flex flex-wrap items-start gap-5">
        <Worklist view={view} items={worklist} pending={pending} detail={detail} />
        <div className="flex min-w-0 flex-[999_1_480px] flex-col gap-4">
          {pending && (
            <PendingOrder
              item={pending}
              canAccept={can.accept}
              busy={busy}
              onAccept={(ids, key) =>
                run(
                  () => acceptLabOrderAction({ serviceRequestIds: ids }, key),
                  (id) => router.push(`/penunjang/lab?order=${id}`),
                )
              }
            />
          )}
          {detail && <OrderDetail key={detail.id} detail={detail} can={can} busy={busy} run={run} />}
          {!pending && !detail && (
            <p className={`m-0 p-4 text-small text-ink-500 ${CARD}`}>
              {worklist.length === 0
                ? 'Belum ada order untuk unit laboratorium Anda.'
                : 'Pilih order di daftar kerja.'}
            </p>
          )}
          {issues.length > 0 && <Issues issues={issues} />}
          {can.qcRead && <QcPanel tests={tests} runs={qc} canWrite={can.qcWrite} busy={busy} run={run} />}
        </div>
      </div>
    </>
  );
}

function Worklist({
  view,
  items,
  pending,
  detail,
}: {
  view: 'aktif' | 'selesai';
  items: LabWorklistItem[];
  pending: LabWorklistItem | null;
  detail: LabOrderDetail | null;
}) {
  return (
    <section aria-labelledby="lab-worklist" className={`flex flex-[1_1_320px] flex-col gap-2 p-3.5 ${CARD}`}>
      <h2 id="lab-worklist" className="m-0 text-h3 font-semibold">
        Daftar kerja
      </h2>
      {items.length === 0 ? (
        <p className="m-0 text-small text-ink-500">Kosong.</p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
          {items.map((w) => {
            const groupId = w.orders[0]?.orderGroupId ?? '';
            const href = w.labOrderId
              ? `/penunjang/lab?view=${view}&order=${w.labOrderId}`
              : `/penunjang/lab?view=${view}&kiriman=${groupId}`;
            const current = w.labOrderId
              ? detail?.id === w.labOrderId
              : !detail && pending?.orders[0]?.orderGroupId === groupId;
            return (
              <li key={w.labOrderId ?? groupId}>
                <Link
                  href={href}
                  aria-current={current ? 'true' : undefined}
                  className={`flex min-h-11 flex-col gap-1 rounded-control border px-3 py-2 text-small text-ink-900 no-underline ${
                    current
                      ? 'border-brand-600 bg-brand-50'
                      : 'border-line-soft bg-white hover:bg-brand-50/60'
                  }`}
                >
                  <span className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold">{w.patient.name}</span>
                    <span className="flex gap-1.5">
                      {w.priority === 'cito' && <Chip tone="danger">Cito</Chip>}
                      {w.criticalOpen && <Chip tone="danger">Kritis</Chip>}
                      {w.status ? (
                        <Chip tone={STATUS_TONE[w.status]}>{LAB_STATUS_LABEL[w.status]}</Chip>
                      ) : (
                        <Chip tone="brand">Order baru</Chip>
                      )}
                    </span>
                  </span>
                  <span className="text-caption text-ink-500">
                    {w.labNo ? <span className="font-mono">{w.labNo} · </span> : null}
                    RM {w.patient.mrn} · {w.location}
                  </span>
                  <span className="text-caption text-ink-700">{w.orders.map((o) => o.name).join(', ')}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function PendingOrder({
  item,
  canAccept,
  busy,
  onAccept,
}: {
  item: LabWorklistItem;
  canAccept: boolean;
  busy: boolean;
  onAccept: (ids: string[], key: string) => void;
}) {
  // Satu kunci per tindakan: klik ganda / kirim ulang = order yang sama (Idempotency-Key).
  const [key] = useState(newKey);
  return (
    <section aria-labelledby="kiriman-baru" className={`flex flex-col gap-3 p-4 ${CARD}`}>
      <h2 id="kiriman-baru" className="m-0 text-h3 font-semibold">
        Order baru · {item.patient.name}
      </h2>
      <p className="m-0 text-small text-ink-700">
        RM {item.patient.mrn} · {item.location} · {item.priority === 'cito' ? 'Cito' : 'Rutin'}
      </p>
      <ul className="m-0 flex flex-col gap-1 pl-5 text-small">
        {item.orders.map((o) => (
          <li key={o.serviceRequestId}>
            {o.name}{' '}
            <span className="text-caption text-ink-500">
              · {o.orderedBy} · {formatTanggalWaktu(o.orderedAt)}
            </span>
            {o.indication && (
              <span className="block text-caption text-ink-500">Indikasi: {o.indication}</span>
            )}
          </li>
        ))}
      </ul>
      {canAccept ? (
        <div>
          <Button
            variant="primary"
            disabled={busy}
            onClick={() =>
              onAccept(
                item.orders.map((o) => o.serviceRequestId),
                key,
              )
            }
          >
            {busy ? 'Memproses…' : 'Terima order & buat label'}
          </Button>
        </div>
      ) : (
        <p className="m-0 text-caption text-ink-500">Penerimaan order oleh analis laboratorium.</p>
      )}
    </section>
  );
}

type Run = (
  fn: () => Promise<LabActionResult | { ok: boolean; message: string }>,
  go?: (id: string) => void,
) => void;

function OrderDetail({
  detail: d,
  can,
  busy,
  run,
}: {
  detail: LabOrderDetail;
  can: LabApiCan;
  busy: boolean;
  run: Run;
}) {
  const p = d.patient.banner;
  const locked = d.status === 'validasi_teknis' || d.status === 'selesai' || d.status === 'batal';
  const [values, setValues] = useState<Record<string, string>>({});
  const [reject, setReject] = useState<Record<string, string>>({});
  const [qcReason, setQcReason] = useState('');
  const resultOf = (testId: string) =>
    d.results.find((r) => r.testDefinitionId === testId && r.status === 'final');
  const received = (type: string) =>
    d.specimens.some((s) => s.specimenType === type && s.status === 'diterima');
  const editable = d.tests.filter((t) => received(t.specimenType));
  const technicalDone = d.validations.some((v) => v.level === 'teknis') && d.status === 'validasi_teknis';

  const save = () => {
    type Item = { testDefinitionId: string; valueNumeric: number | null; valueText: string | null };
    const items = editable.flatMap((t): Item[] => {
      const raw = (values[t.testDefinitionId] ?? '').trim();
      if (!raw) return [];
      if (t.resultType === 'numeric') {
        const n = Number(raw.replace(',', '.'));
        return [
          {
            testDefinitionId: t.testDefinitionId,
            valueNumeric: Number.isFinite(n) ? n : Number.NaN,
            valueText: null,
          },
        ];
      }
      return [{ testDefinitionId: t.testDefinitionId, valueNumeric: null, valueText: raw }];
    });
    run(() => enterLabResultsAction(d.id, { items }));
  };

  return (
    <section aria-labelledby="order-lab" className={`flex flex-col gap-4 p-4 ${CARD}`}>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h2 id="order-lab" className="m-0 text-h3 font-semibold">
            {p.name} <span className="font-mono text-small font-normal text-ink-500">{d.labNo}</span>
          </h2>
          <span className="text-small text-ink-700">
            RM {p.mrn} ·{' '}
            {p.sex === 'male' ? 'Laki-laki' : p.sex === 'female' ? 'Perempuan' : 'JK tidak diketahui'}
            {p.ageYears !== null ? ` · ${p.ageYears} th` : ''}
            {d.patient.egfr !== null ? ` · eGFR ${d.patient.egfr}` : ''}
          </span>
          <span className="text-caption text-ink-500">
            Alergi: {d.patient.allergies.length ? d.patient.allergies.join('; ') : 'belum dikaji'}
          </span>
        </div>
        <span className="flex flex-wrap items-center gap-2">
          {d.priority === 'cito' && <Chip tone="danger">Cito</Chip>}
          <Chip tone={STATUS_TONE[d.status]}>{LAB_STATUS_LABEL[d.status]}</Chip>
          <a
            href={`/penunjang/lab/cetak/${d.id}`}
            target="_blank"
            rel="noopener"
            className="inline-flex h-11 items-center rounded-control px-3 text-small font-semibold text-brand-700 hover:bg-brand-50"
          >
            Cetak
          </a>
        </span>
      </header>

      {d.criticalResultIds.length > 0 && d.status !== 'selesai' && (
        <Alert level="critical" title="Ada nilai kritis">
          Laporkan ke dokter/perawat dengan read-back sebelum validasi.{' '}
          {can.critical && <Link href="/penunjang/hasil-kritis">Buka Hasil kritis</Link>}
        </Alert>
      )}

      <div className="overflow-x-auto">
        <table className={TABLE} aria-label="Spesimen">
          <thead>
            <tr>
              <th className={TH}>Barcode</th>
              <th className={TH}>Spesimen</th>
              <th className={TH}>Status</th>
              <th className={TH}>Tindakan</th>
            </tr>
          </thead>
          <tbody>
            {d.specimens.map((s) => {
              const [label, tone] = SPECIMEN_STATUS[s.status] ?? [s.status, 'neutral' as ChipTone];
              const open = !locked && s.status !== 'ditolak';
              return (
                <tr key={s.id}>
                  <td className={`${TD} font-mono`}>{s.barcode}</td>
                  <td className={TD}>{SPECIMEN_LABEL[s.specimenType] ?? s.specimenType}</td>
                  <td className={TD}>
                    <Chip tone={tone}>{label}</Chip>
                    {s.rejectedReason && (
                      <span className="block text-caption text-ink-500">
                        {REJECT_LABEL[s.rejectedReason]}
                      </span>
                    )}
                  </td>
                  <td className={TD}>
                    {open && (
                      <span className="flex flex-wrap items-center gap-2">
                        {can.collect && s.status === 'menunggu' && (
                          <Button
                            size="sm"
                            disabled={busy}
                            onClick={() => run(() => specimenAction(s.id, 'collect', null))}
                          >
                            Ambil
                          </Button>
                        )}
                        {can.receive && (s.status === 'menunggu' || s.status === 'diambil') && (
                          <Button
                            size="sm"
                            disabled={busy}
                            onClick={() => run(() => specimenAction(s.id, 'receive', null))}
                          >
                            Terima
                          </Button>
                        )}
                        {can.reject && (
                          <span className="flex items-center gap-1.5">
                            <label className="sr-only" htmlFor={`tolak-${s.id}`}>
                              Alasan tolak {s.barcode}
                            </label>
                            <select
                              id={`tolak-${s.id}`}
                              className={INPUT}
                              value={reject[s.id] ?? ''}
                              onChange={(e) => setReject((r) => ({ ...r, [s.id]: e.target.value }))}
                            >
                              <option value="">Tolak karena…</option>
                              {SPECIMEN_REJECT_REASONS.filter((x) => x !== 'lainnya').map((x) => (
                                <option key={x} value={x}>
                                  {REJECT_LABEL[x]}
                                </option>
                              ))}
                            </select>
                            <Button
                              size="sm"
                              variant="danger"
                              disabled={busy || !reject[s.id]}
                              onClick={() =>
                                run(() => specimenAction(s.id, 'reject', { reason: reject[s.id] }))
                              }
                            >
                              Tolak
                            </Button>
                          </span>
                        )}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="overflow-x-auto">
        <table className={TABLE} aria-label="Hasil">
          <thead>
            <tr>
              <th className={TH}>Pemeriksaan</th>
              <th className={TH}>Hasil</th>
              <th className={TH}>Rujukan</th>
              <th className={TH}>Flag</th>
              <th className={TH}>Status</th>
            </tr>
          </thead>
          <tbody>
            {d.tests.map((t) => {
              const r = resultOf(t.testDefinitionId);
              const prev = t.loinc ? d.previous[t.loinc] : undefined;
              return (
                <tr key={t.testDefinitionId}>
                  <td className={TD}>
                    <span className="font-semibold">{t.name}</span>
                    {prev && prev.length > 0 && (
                      <span className="block text-caption text-ink-500">
                        Sebelumnya: {prev.map((x) => String(x.valueNumeric).replace('.', ',')).join(' → ')}
                      </span>
                    )}
                  </td>
                  <td className={TD}>
                    {r && <span className="font-mono">{valueOf(r)}</span>}
                    {r?.delta && <Chip tone="warning">Delta</Chip>}
                    {!locked && can.write && received(t.specimenType) && (
                      <span className="mt-1 flex items-center gap-1.5">
                        <label className="sr-only" htmlFor={`nilai-${t.testDefinitionId}`}>
                          Nilai {t.name}
                        </label>
                        <input
                          id={`nilai-${t.testDefinitionId}`}
                          className={`${INPUT} w-32`}
                          inputMode={t.resultType === 'numeric' ? 'decimal' : 'text'}
                          placeholder={r ? 'ubah' : t.unit || 'nilai'}
                          value={values[t.testDefinitionId] ?? ''}
                          onChange={(e) => setValues((v) => ({ ...v, [t.testDefinitionId]: e.target.value }))}
                        />
                      </span>
                    )}
                    {locked && r && can.correct && d.status !== 'batal' && (
                      <Correction result={r} busy={busy} run={run} />
                    )}
                  </td>
                  <td className={TD}>{r ? rangeOf(r) : '-'}</td>
                  <td className={TD}>
                    {r && <Chip tone={FLAG_TONE[r.flag] ?? 'neutral'}>{FLAG_LABEL[r.flag]}</Chip>}
                  </td>
                  <td className={TD}>
                    {r ? (
                      <span className="text-caption">
                        {r.resultStatus === 'final' ? 'Final' : 'Sementara'} ·{' '}
                        {r.source === 'analyzer' ? 'analyzer' : r.author.nama}
                        {r.version > 1 ? ` · v${r.version}` : ''}
                      </span>
                    ) : (
                      <span className="text-caption text-ink-500">
                        {received(t.specimenType) ? 'Belum ada hasil' : 'Spesimen belum diterima'}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        {!locked && can.write && editable.length > 0 && (
          <Button disabled={busy || Object.values(values).every((v) => !v.trim())} onClick={save}>
            Simpan hasil
          </Button>
        )}
        {can.verify && d.status === 'hasil' && (
          <>
            <label className="flex min-w-[260px] flex-1 flex-col gap-1 text-small font-semibold text-ink-700">
              Alasan override QC (bila QC hari ini ditolak)
              <input
                className={INPUT}
                value={qcReason}
                onChange={(e) => setQcReason(e.target.value)}
                maxLength={500}
              />
            </label>
            <Button
              variant="primary"
              disabled={busy}
              onClick={() => run(() => validateLabAction(d.id, 'teknis', qcReason))}
            >
              Validasi teknis
            </Button>
          </>
        )}
        {can.release && technicalDone && (
          <Button
            variant="primary"
            disabled={busy}
            onClick={() => run(() => validateLabAction(d.id, 'klinis', null))}
          >
            Validasi klinis &amp; rilis (TTE)
          </Button>
        )}
      </div>

      {d.validations.length > 0 && (
        <ul aria-label="Riwayat validasi" className="m-0 flex flex-col gap-1 pl-5 text-small text-ink-700">
          {d.validations.map((v, i) => (
            <li key={`${v.level}-${i}`}>
              Validasi {v.level} · {v.by} · {formatTanggalWaktu(v.at)}
              {v.signatureStatus &&
                ` · TTE ${v.signatureStatus === 'signed' ? 'tertandatangani' : v.signatureStatus === 'failed' ? 'gagal' : 'diproses'}`}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Correction({ result, busy, run }: { result: LabResultRecord; busy: boolean; run: Run }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const [reason, setReason] = useState('');
  if (!open) {
    return (
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)} aria-label={`Koreksi ${result.name}`}>
        Koreksi
      </Button>
    );
  }
  const numeric = result.valueNumeric !== null;
  return (
    <span className="mt-1 flex flex-wrap items-center gap-1.5">
      <input
        aria-label={`Nilai koreksi ${result.name}`}
        className={`${INPUT} w-28`}
        inputMode={numeric ? 'decimal' : 'text'}
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      <input
        aria-label={`Alasan koreksi ${result.name}`}
        className={`${INPUT} min-w-[200px]`}
        placeholder="Alasan (min. 10 karakter)"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
      />
      <Button
        size="sm"
        disabled={busy || !value.trim() || reason.trim().length < 10}
        onClick={() =>
          run(() =>
            correctLabResultAction(result.id, {
              valueNumeric: numeric ? Number(value.replace(',', '.')) : null,
              valueText: numeric ? null : value.trim(),
              reason,
            }),
          )
        }
      >
        Simpan koreksi
      </Button>
    </span>
  );
}

function Issues({ issues }: { issues: LabInboundIssue[] }) {
  return (
    <section aria-labelledby="lab-issues" className={`flex flex-col gap-2 p-4 ${CARD}`}>
      <h2 id="lab-issues" className="m-0 text-h3 font-semibold">
        Pesan analyzer bermasalah
      </h2>
      <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-small">
        {issues.map((i) => (
          <li key={i.id} className="flex flex-wrap items-center gap-2">
            <Chip tone={i.status === 'dead' ? 'danger' : 'warning'}>
              {i.status === 'dead' ? 'Berhenti' : `Dicoba lagi (${i.attempts})`}
            </Chip>
            <span className="font-mono">{i.controlId}</span>
            <span className="text-ink-700">{i.error ?? '-'}</span>
            <span className="text-caption text-ink-500">{formatTanggalWaktu(i.receivedAt)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function QcPanel({
  tests,
  runs,
  canWrite,
  busy,
  run,
}: {
  tests: LabTestDefinition[];
  runs: LabQcRun[];
  canWrite: boolean;
  busy: boolean;
  run: Run;
}) {
  const numeric = tests.filter((t) => t.resultType === 'numeric');
  const [form, setForm] = useState({
    testDefinitionId: numeric[0]?.id ?? '',
    controlLevel: '1',
    value: '',
    mean: '',
    sd: '',
  });
  const name = (id: string) => tests.find((t) => t.id === id)?.name ?? '-';
  const num = (s: string) => Number(s.replace(',', '.'));
  return (
    <section aria-labelledby="lab-qc" className={`flex flex-col gap-3 p-4 ${CARD}`}>
      <h2 id="lab-qc" className="m-0 text-h3 font-semibold">
        Kontrol mutu (QC)
      </h2>
      {canWrite && (
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-small font-semibold text-ink-700">
            Tes
            <select
              className={INPUT}
              value={form.testDefinitionId}
              onChange={(e) => setForm((f) => ({ ...f, testDefinitionId: e.target.value }))}
            >
              {numeric.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-small font-semibold text-ink-700">
            Level
            <select
              className={INPUT}
              value={form.controlLevel}
              onChange={(e) => setForm((f) => ({ ...f, controlLevel: e.target.value }))}
            >
              {['1', '2', '3'].map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          {(['value', 'mean', 'sd'] as const).map((k) => (
            <label key={k} className="flex flex-col gap-1 text-small font-semibold text-ink-700">
              {k === 'value' ? 'Nilai kontrol' : k === 'mean' ? 'Mean' : 'SD'}
              <input
                className={`${INPUT} w-28`}
                inputMode="decimal"
                value={form[k]}
                onChange={(e) => setForm((f) => ({ ...f, [k]: e.target.value }))}
              />
            </label>
          ))}
          <Button
            disabled={busy || !form.value || !form.mean || !form.sd}
            onClick={() =>
              run(() =>
                qcRunAction({
                  analyzerId: null,
                  testDefinitionId: form.testDefinitionId,
                  controlLevel: Number(form.controlLevel),
                  value: num(form.value),
                  mean: num(form.mean),
                  sd: num(form.sd),
                }),
              )
            }
          >
            Catat QC
          </Button>
        </div>
      )}
      {runs.length === 0 ? (
        <p className="m-0 text-small text-ink-500">Belum ada run QC.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className={TABLE} aria-label="Riwayat QC">
            <thead>
              <tr>
                <th className={TH}>Waktu</th>
                <th className={TH}>Tes · level</th>
                <th className={TH}>Nilai</th>
                <th className={TH}>Hasil</th>
                <th className={TH}>Petugas</th>
              </tr>
            </thead>
            <tbody>
              {runs.slice(0, 20).map((r) => (
                <tr key={r.id}>
                  <td className={TD}>{formatTanggalWaktu(r.runAt)}</td>
                  <td className={TD}>
                    {name(r.testDefinitionId)} · L{r.controlLevel}
                  </td>
                  <td className={`${TD} font-mono`}>
                    {r.value} (mean {r.mean}, SD {r.sd})
                  </td>
                  <td className={TD}>
                    <Chip tone={r.outcome === 'ok' ? 'success' : r.outcome === 'warn' ? 'warning' : 'danger'}>
                      {r.outcome === 'ok'
                        ? 'OK'
                        : r.outcome === 'warn'
                          ? '1-2s'
                          : `Ditolak ${r.violations.join(', ')}`}
                    </Chip>
                  </td>
                  <td className={TD}>{r.by}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
