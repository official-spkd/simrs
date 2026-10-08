'use client';

import {
  formatTanggalWaktu,
  MEDICATION_FREQUENCIES,
  type PharmacyAlertView,
  type PharmacyIncoming,
  type PharmacyPrescriptionView,
  type PharmacyQueueRow,
  type PrescriptionStatus,
  type StockBalance,
} from '@simrs/shared';
import { Alert, Button, Chip, type ChipTone } from '@simrs/ui';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  acceptPrescriptionAction,
  cdsDecisionAction,
  evaluateCdsAction,
  interventionAction,
  reviewAction,
} from '@/app/(staf)/penunjang/farmasi/actions';

type Notice = { ok: boolean; text: string } | null;
type Done = { ok: true; prescription: PharmacyPrescriptionView } | { ok: false; message: string };

const CARD = 'rounded-card border border-white/95 bg-white/90 shadow-card';
const TABLE = 'w-full border-collapse text-small';
const TH = 'border-b border-line px-3 py-2 text-left text-caption font-semibold text-ink-700';
const TD = 'border-b border-line-soft px-3 py-2 align-top';
const INPUT =
  'rounded-control border border-line-strong bg-white px-3 py-2 font-[inherit] text-small font-normal';
const LABEL = 'flex flex-col gap-1 text-caption font-semibold text-ink-700';

const STATUS: Record<PrescriptionStatus, { label: string; tone: ChipTone }> = {
  telaah: { label: 'Telaah', tone: 'info' },
  ditahan: { label: 'Ditahan', tone: 'warning' },
  penyiapan: { label: 'Penyiapan', tone: 'brand' },
  serah: { label: 'Serah terima', tone: 'brand' },
  selesai: { label: 'Selesai', tone: 'success' },
  batal: { label: 'Batal', tone: 'neutral' },
};
const LEVEL: Record<PharmacyAlertView['level'], { label: string; tone: ChipTone }> = {
  mayor: { label: 'Mayor', tone: 'danger' },
  sedang: { label: 'Sedang', tone: 'warning' },
  info: { label: 'Info', tone: 'info' },
};
const ALERT_STATUS: Record<PharmacyAlertView['status'], string> = {
  terbuka: 'Perlu tindak lanjut',
  override: 'Dokter melanjutkan di CPOE · wajib ditinjau',
  teratasi: 'Teratasi',
};
const DECISION_LABEL = { konfirmasi: 'dikonfirmasi', override: 'di-override', usul: 'diusulkan ke dokter' };
const INTERVENTION_KIND = {
  ganti_obat: 'Ganti obat',
  ubah_dosis: 'Ubah dosis',
  hentikan: 'Hentikan',
  tambah: 'Tambah obat',
  lainnya: 'Lainnya',
} as const;
const RESPONSE_LABEL = { diterima: 'diterima', ditolak: 'ditolak', diubah: 'diubah dokter' };

const reviewable = (s: PrescriptionStatus) => s === 'telaah' || s === 'ditahan';

function Incoming({
  rows,
  canWrite,
  onNotice,
}: {
  rows: readonly PharmacyIncoming[];
  canWrite: boolean;
  onNotice: (n: Notice) => void;
}) {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  if (rows.length === 0) return <p className="m-0 text-small text-ink-500">Tidak ada kiriman baru.</p>;
  return (
    <ul aria-label="Kiriman resep masuk" className="m-0 flex list-none flex-col gap-2 p-0">
      {rows.map((r) => (
        <li key={r.orderGroupId} className={`flex flex-col gap-1.5 p-3 ${CARD}`}>
          <span className="text-small font-semibold">
            {r.patient.name} · <span className="font-mono">{r.patient.mrn}</span>
          </span>
          <span className="text-caption text-ink-700">{r.items.map((i) => i.name).join('; ')}</span>
          <span className="text-caption text-ink-500">
            {r.encounter.number} · {r.encounter.unitName} · {r.orderedBy.nama} ·{' '}
            {formatTanggalWaktu(r.orderedAt)} · ke {r.stockLocation.name}
          </span>
          {r.needsReview && <Chip tone="warning">Order residen, belum ditinjau DPJP</Chip>}
          {canWrite && (
            <Button
              variant="primary"
              size="sm"
              className="w-fit"
              disabled={pending !== null}
              onClick={async () => {
                setPending(r.orderGroupId);
                const res = await acceptPrescriptionAction({
                  orderGroupId: r.orderGroupId,
                  stockLocationId: r.stockLocation.id,
                });
                setPending(null);
                if (!res.ok) {
                  onNotice({ ok: false, text: res.message });
                  return;
                }
                onNotice({ ok: true, text: `${res.prescription.prescriptionNo} diterima untuk telaah.` });
                router.push(`/penunjang/farmasi?resep=${res.prescription.id}`);
              }}
            >
              {pending === r.orderGroupId ? 'Menerima…' : `Terima resep ${r.patient.name}`}
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
}

function Queue({ rows, current }: { rows: readonly PharmacyQueueRow[]; current: string | null }) {
  if (rows.length === 0) return <p className="m-0 text-small text-ink-500">Antrean resep kosong.</p>;
  return (
    <nav aria-label="Antrean resep">
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {rows.map((r) => (
          <li key={r.id}>
            <Link
              href={`/penunjang/farmasi?resep=${r.id}`}
              aria-current={r.id === current ? 'page' : undefined}
              className={`flex flex-col gap-1 p-3 text-ink-900 no-underline ${CARD} ${
                r.id === current ? 'ring-2 ring-brand-500' : 'hover:bg-brand-50/60'
              }`}
            >
              <span className="flex flex-wrap items-center justify-between gap-2 text-small">
                <span className="font-mono font-semibold">{r.prescriptionNo}</span>
                <Chip tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Chip>
              </span>
              <span className="text-small">{r.patient.name}</span>
              <span className="text-caption text-ink-500">
                {r.items} item · {r.stockLocation.name}
                {r.highAlert ? ' · kewaspadaan tinggi' : ''}
                {r.blockingAlerts > 0 ? ` · ${r.blockingAlerts} temuan CDS terbuka` : ''}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** Stok layak (tidak kedaluwarsa) per obat di depo resep, dari API stok. */
function usableByDrug(balances: readonly StockBalance[] | null): Map<string, number> | null {
  if (!balances) return null;
  const m = new Map<string, number>();
  for (const b of balances) if (!b.expired) m.set(b.drugId, (m.get(b.drugId) ?? 0) + b.quantity);
  return m;
}

function Items({ rx, balances }: { rx: PharmacyPrescriptionView; balances: readonly StockBalance[] | null }) {
  const usable = usableByDrug(balances);
  return (
    <div className={`overflow-x-auto ${CARD}`}>
      <table className={TABLE} aria-label="Item resep">
        <thead>
          <tr>
            <th className={TH}>Obat</th>
            <th className={TH}>Aturan pakai</th>
            <th className={TH}>Status order</th>
            <th className={`${TH} text-right`}>Stok {rx.stockLocation.name}</th>
          </tr>
        </thead>
        <tbody>
          {rx.items.map((i) => {
            const qty = i.drugId ? (usable?.get(i.drugId) ?? (usable ? 0 : i.stock.usable)) : null;
            const min = i.stock.minQuantity;
            return (
              <tr key={i.id}>
                <td className={TD}>
                  <span className="font-semibold">{i.name}</span>
                  <span className="block text-caption text-ink-500">
                    {i.kfa ? `KFA ${i.kfa}` : 'KFA belum dipetakan'}
                    {i.fornas ? ' · Fornas' : ''}
                    {i.highAlert ? ' · kewaspadaan tinggi' : ''}
                  </span>
                </td>
                <td className={TD}>
                  {i.dose} · {i.route} · {MEDICATION_FREQUENCIES[i.frequency].label}
                  {i.durationDays ? ` · ${i.durationDays} hari` : ''}
                  {i.instructions && (
                    <span className="block text-caption text-ink-500">{i.instructions}</span>
                  )}
                </td>
                <td className={TD}>
                  <Chip tone={i.status === 'aktif' ? 'success' : 'neutral'}>{i.status}</Chip>
                </td>
                <td className={`${TD} text-right`}>
                  {qty === null ? (
                    <span className="text-caption text-ink-500">Racikan</span>
                  ) : (
                    <span className="flex flex-col items-end gap-1">
                      <span className="font-mono">{qty}</span>
                      {qty === 0 ? (
                        <Chip tone="danger">Habis</Chip>
                      ) : min !== null && qty < min ? (
                        <Chip tone="warning">Di bawah minimum {min}</Chip>
                      ) : null}
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function AlertCard({
  rx,
  alert,
  canAct,
  onDone,
}: {
  rx: PharmacyPrescriptionView;
  alert: PharmacyAlertView;
  canAct: boolean;
  onDone: (r: Done, ok: string) => void;
}) {
  const [overriding, setOverriding] = useState(false);
  const [reason, setReason] = useState('');
  const [pending, setPending] = useState(false);
  const decide = async (decision: 'konfirmasi' | 'usul' | 'override', why: string | null) => {
    setPending(true);
    const r = await cdsDecisionAction({
      prescriptionId: rx.id,
      alertId: alert.id,
      decision: { decision, reason: why },
    });
    setPending(false);
    if (r.ok) setOverriding(false);
    onDone(r, `Temuan "${alert.title}" ${DECISION_LABEL[decision]}.`);
  };
  return (
    <li className={`flex flex-col gap-2 p-3 ${CARD}`}>
      <span className="flex flex-wrap items-center gap-2">
        <Chip tone={LEVEL[alert.level].tone}>{LEVEL[alert.level].label}</Chip>
        <span className="text-small font-semibold">{alert.title}</span>
        <Chip tone={alert.blocking ? 'danger' : 'success'}>{ALERT_STATUS[alert.status]}</Chip>
      </span>
      <span className="text-small text-ink-700">{alert.detail}</span>
      {alert.decision && (
        <span className="text-caption text-ink-500">
          {DECISION_LABEL[alert.decision.decision]} oleh {alert.decision.by.nama} ·{' '}
          {formatTanggalWaktu(alert.decision.at)}
          {alert.decision.reason ? ` · alasan: ${alert.decision.reason}` : ''}
        </span>
      )}
      {canAct && !alert.decision && alert.level !== 'info' && !overriding && (
        <span className="flex flex-wrap gap-2">
          <Button size="sm" disabled={pending} onClick={() => decide('konfirmasi', null)}>
            Konfirmasi aman
          </Button>
          <Button size="sm" disabled={pending} onClick={() => decide('usul', null)}>
            Usulkan ke dokter
          </Button>
          <Button size="sm" variant="danger" disabled={pending} onClick={() => setOverriding(true)}>
            Override
          </Button>
        </span>
      )}
      {overriding && (
        <form
          aria-label={`Override ${alert.title}`}
          className="flex flex-col gap-2 rounded-control border border-line bg-card-header p-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (reason.trim().length >= 10) void decide('override', reason.trim());
          }}
        >
          <label className={LABEL}>
            Alasan klinis override (wajib, minimal 10 karakter)
            <textarea
              rows={2}
              maxLength={500}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className={INPUT}
            />
          </label>
          <span className="flex flex-wrap gap-2">
            <Button type="submit" variant="danger" size="sm" disabled={reason.trim().length < 10 || pending}>
              Simpan override
            </Button>
            <Button size="sm" disabled={pending} onClick={() => setOverriding(false)}>
              Tutup
            </Button>
          </span>
        </form>
      )}
    </li>
  );
}

function InterventionForm({
  rx,
  onDone,
}: {
  rx: PharmacyPrescriptionView;
  onDone: (r: Done, ok: string) => void;
}) {
  const [kind, setKind] = useState<keyof typeof INTERVENTION_KIND>('ubah_dosis');
  const [items, setItems] = useState<string[]>([]);
  const [text, setText] = useState('');
  const [pending, setPending] = useState(false);
  const ready = items.length > 0 && text.trim().length >= 10;
  return (
    <form
      aria-label="Intervensi apoteker"
      className={`flex flex-col gap-2 p-3 ${CARD}`}
      onSubmit={async (e) => {
        e.preventDefault();
        if (!ready) return;
        setPending(true);
        const r = await interventionAction(rx.id, {
          kind,
          medicationRequestIds: items,
          recommendation: text.trim(),
        });
        setPending(false);
        if (r.ok) {
          setItems([]);
          setText('');
        }
        onDone(
          r,
          `Usulan terkirim ke ${rx.prescriber.nama}. Resep tidak diubah sampai dokter mengubah order.`,
        );
      }}
    >
      <span className="text-small font-semibold">Usulan ke dokter penulis ({rx.prescriber.nama})</span>
      <label className={LABEL}>
        Jenis usulan
        <select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} className={INPUT}>
          {Object.entries(INTERVENTION_KIND).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </label>
      <fieldset className="m-0 flex flex-col gap-1 border-0 p-0">
        <legend className="text-caption font-semibold text-ink-700">Item</legend>
        {rx.items.map((i) => (
          <label key={i.id} className="flex items-center gap-2 text-small">
            <input
              type="checkbox"
              checked={items.includes(i.id)}
              onChange={(e) =>
                setItems((s) => (e.target.checked ? [...s, i.id] : s.filter((x) => x !== i.id)))
              }
            />
            {i.name}
          </label>
        ))}
      </fieldset>
      <label className={LABEL}>
        Usulan (minimal 10 karakter)
        <textarea
          rows={2}
          maxLength={1000}
          value={text}
          onChange={(e) => setText(e.target.value)}
          className={INPUT}
        />
      </label>
      <Button type="submit" size="sm" className="w-fit" disabled={!ready || pending}>
        {pending ? 'Mengirim…' : 'Kirim usulan'}
      </Button>
    </form>
  );
}

function ReviewForm({ rx, onDone }: { rx: PharmacyPrescriptionView; onDone: (r: Done, ok: string) => void }) {
  const [aspects, setAspects] = useState({ administratif: false, farmasetik: false, klinis: false });
  const [decision, setDecision] = useState<'setujui' | 'sebagian' | 'tahan'>('setujui');
  const [items, setItems] = useState<string[]>([]);
  const [reason, setReason] = useState('');
  const [pending, setPending] = useState(false);
  const blocking = rx.alerts.filter((a) => a.blocking).length;
  const ready =
    decision === 'setujui'
      ? aspects.administratif && aspects.farmasetik && aspects.klinis
      : reason.trim().length >= 10 && (decision !== 'sebagian' || items.length > 0);
  return (
    <form
      aria-label="Telaah resep"
      className={`flex flex-col gap-2 p-3 ${CARD}`}
      onSubmit={async (e) => {
        e.preventDefault();
        if (!ready) return;
        setPending(true);
        const r = await reviewAction(rx.id, {
          aspects,
          decision,
          reason: reason.trim() || null,
          medicationRequestIds: decision === 'sebagian' ? items : [],
        });
        setPending(false);
        onDone(
          r,
          decision === 'tahan'
            ? `${rx.prescriptionNo} ditahan.`
            : `${rx.prescriptionNo} lolos telaah; lanjut penyiapan.`,
        );
      }}
    >
      <span className="text-small font-semibold">Telaah tiga aspek</span>
      {(['administratif', 'farmasetik', 'klinis'] as const).map((k) => (
        <label key={k} className="flex items-center gap-2 text-small">
          <input
            type="checkbox"
            checked={aspects[k]}
            onChange={(e) => setAspects((s) => ({ ...s, [k]: e.target.checked }))}
          />
          Aspek {k} sesuai
        </label>
      ))}
      <label className={LABEL}>
        Keputusan
        <select
          value={decision}
          onChange={(e) => setDecision(e.target.value as typeof decision)}
          className={INPUT}
        >
          <option value="setujui">Setujui</option>
          <option value="sebagian">Setujui sebagian</option>
          <option value="tahan">Tahan</option>
        </select>
      </label>
      {decision === 'sebagian' && (
        <fieldset className="m-0 flex flex-col gap-1 border-0 p-0">
          <legend className="text-caption font-semibold text-ink-700">Item yang disetujui</legend>
          {rx.items
            .filter((i) => i.status === 'aktif')
            .map((i) => (
              <label key={i.id} className="flex items-center gap-2 text-small">
                <input
                  type="checkbox"
                  checked={items.includes(i.id)}
                  onChange={(e) =>
                    setItems((s) => (e.target.checked ? [...s, i.id] : s.filter((x) => x !== i.id)))
                  }
                />
                {i.name}
              </label>
            ))}
        </fieldset>
      )}
      {decision !== 'setujui' && (
        <label className={LABEL}>
          Alasan (wajib, minimal 10 karakter)
          <textarea
            rows={2}
            maxLength={500}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className={INPUT}
          />
        </label>
      )}
      {decision === 'setujui' && blocking > 0 && (
        <p className="m-0 text-caption text-koral-800">
          {blocking} temuan CDS masih terbuka; server menolak persetujuan sampai semuanya ditindaklanjuti.
        </p>
      )}
      <Button type="submit" variant="primary" size="sm" className="w-fit" disabled={!ready || pending}>
        {pending ? 'Menyimpan…' : 'Simpan telaah'}
      </Button>
    </form>
  );
}

function Detail({
  rx,
  balances,
  canWrite,
  onNotice,
}: {
  rx: PharmacyPrescriptionView;
  balances: readonly StockBalance[] | null;
  canWrite: boolean;
  onNotice: (n: Notice) => void;
}) {
  const [pending, setPending] = useState(false);
  const canAct = canWrite && reviewable(rx.status);
  const onDone = (r: Done, ok: string) =>
    onNotice(r.ok ? { ok: true, text: ok } : { ok: false, text: r.message });
  return (
    <section aria-label={`Resep ${rx.prescriptionNo}`} className="flex flex-col gap-3">
      <div className={`flex flex-col gap-1 p-3.5 ${CARD}`}>
        <span className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="m-0 text-h2 font-bold">
            <span className="font-mono">{rx.prescriptionNo}</span> · {rx.patient.name}
          </h2>
          <Chip tone={STATUS[rx.status].tone}>{STATUS[rx.status].label}</Chip>
        </span>
        <span className="text-small text-ink-700">
          <span className="font-mono">{rx.patient.mrn}</span> · {rx.encounter.number} ·{' '}
          {rx.encounter.unitName} · {rx.stockLocation.name}
        </span>
        <span className="text-small">
          Alergi: {rx.allergies.length > 0 ? rx.allergies.join(', ') : 'tidak ada tercatat'} · eGFR:{' '}
          {rx.egfr === null ? 'belum ada' : `${rx.egfr} mL/menit/1,73 m²`}
        </span>
        <span className="text-caption text-ink-500">
          Penulis {rx.prescriber.nama} · {formatTanggalWaktu(rx.orderedAt)} · diterima {rx.acceptedBy.nama} ·{' '}
          {formatTanggalWaktu(rx.acceptedAt)}
        </span>
        {rx.needsReview && <Chip tone="warning">Order residen, belum ditinjau DPJP</Chip>}
      </div>

      <Items rx={rx} balances={balances} />

      <div className="flex flex-col gap-2">
        <span className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="m-0 text-h3 font-semibold">Temuan CDS saat telaah</h3>
          {canAct && (
            <Button
              size="sm"
              disabled={pending}
              onClick={async () => {
                setPending(true);
                const r = await evaluateCdsAction(rx.id);
                setPending(false);
                onDone(r, 'CDS dievaluasi ulang dengan data pasien terkini.');
              }}
            >
              {pending ? 'Mengevaluasi…' : 'Evaluasi ulang CDS'}
            </Button>
          )}
        </span>
        {rx.alerts.length === 0 ? (
          <p className="m-0 text-small text-ink-500">Belum ada evaluasi CDS.</p>
        ) : (
          <ul aria-label="Temuan CDS" className="m-0 flex list-none flex-col gap-2 p-0">
            {rx.alerts.map((a) => (
              <AlertCard key={a.id} rx={rx} alert={a} canAct={canAct} onDone={onDone} />
            ))}
          </ul>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="m-0 text-h3 font-semibold">Intervensi apoteker</h3>
        {rx.interventions.length > 0 && (
          <ul aria-label="Daftar intervensi" className="m-0 flex list-none flex-col gap-2 p-0">
            {rx.interventions.map((i) => (
              <li key={i.id} className={`flex flex-col gap-1 p-3 text-small ${CARD}`}>
                <span className="font-semibold">
                  {INTERVENTION_KIND[i.kind]} · {i.by.nama} · {formatTanggalWaktu(i.at)}
                </span>
                <span>{i.recommendation}</span>
                <span className="text-caption text-ink-500">
                  {i.response
                    ? `Dijawab ${i.response.by.nama}: ${RESPONSE_LABEL[i.response.response]}${i.response.note ? ` · ${i.response.note}` : ''}`
                    : `Menunggu jawaban ${i.prescriber.nama}`}
                </span>
              </li>
            ))}
          </ul>
        )}
        {canAct && <InterventionForm rx={rx} onDone={onDone} />}
      </div>

      {rx.reviews.length > 0 && (
        <ul aria-label="Riwayat telaah" className="m-0 flex list-none flex-col gap-1 p-0 text-small">
          {rx.reviews.map((r) => (
            <li key={r.id}>
              Telaah {r.decision} · {r.by.nama} · {formatTanggalWaktu(r.at)}
              {r.reason ? ` · ${r.reason}` : ''}
            </li>
          ))}
        </ul>
      )}
      {canAct && <ReviewForm rx={rx} onDone={onDone} />}
    </section>
  );
}

/**
 * S04 · Farmasi mode api (potongan 4.5): kiriman masuk → terima resep, antrean resep, dan panel telaah (item + stok
 * depo dari API stok, temuan CDS dan tindak lanjutnya, intervensi, telaah tiga aspek). Tombol mengikuti izin
 * `pharmacy.review.write`; API menegakkan ulang gerbang CDS dan lingkup depo.
 */
export function FarmasiApiWorkspace({
  incoming,
  queue,
  detail,
  balances,
  canWrite,
}: {
  incoming: readonly PharmacyIncoming[];
  queue: readonly PharmacyQueueRow[];
  detail: PharmacyPrescriptionView | null;
  balances: readonly StockBalance[] | null;
  canWrite: boolean;
}) {
  const [notice, setNotice] = useState<Notice>(null);
  return (
    <div className="flex flex-col gap-4">
      {notice &&
        (notice.ok ? (
          <p
            role="status"
            className="m-0 rounded-control bg-alert-success px-3.5 py-2.5 text-small text-zamrud-700"
          >
            {notice.text}
          </p>
        ) : (
          <Alert level="warning" title="Belum tersimpan">
            {notice.text}
          </Alert>
        ))}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(260px,1fr)_2fr]">
        <aside className="flex flex-col gap-4">
          <section className="flex flex-col gap-2">
            <h2 className="m-0 text-h3 font-semibold">
              Kiriman masuk <span className="text-ink-500">({incoming.length})</span>
            </h2>
            <Incoming rows={incoming} canWrite={canWrite} onNotice={setNotice} />
          </section>
          <section className="flex flex-col gap-2">
            <h2 className="m-0 text-h3 font-semibold">Antrean resep</h2>
            <Queue rows={queue} current={detail?.id ?? null} />
          </section>
        </aside>
        {detail ? (
          <Detail rx={detail} balances={balances} canWrite={canWrite} onNotice={setNotice} />
        ) : (
          <p className="m-0 text-small text-ink-500">Pilih resep di antrean atau terima kiriman baru.</p>
        )}
      </div>
    </div>
  );
}
