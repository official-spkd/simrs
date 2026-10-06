'use client';

import { formatJam, formatTanggalWaktu } from '@simrs/shared';
import { Alert, Button, Chip, cx, RadioSegmented, SafetyGate, Tabs } from '@simrs/ui';
import { useState } from 'react';
import { recordGiziAction } from '@/app/(staf)/penunjang/gizi/actions';
import { useStoreAction } from '@/lib/demo/store/client';
import {
  allergyConflict,
  averageLeftover,
  type Delivery,
  deliveryGate,
  type DietOrder,
  GIZI_GATE_TEXT,
  MEAL_TIMES,
  mealOf,
  type MealTime,
  mstScore,
  trayLabel,
  WEIGHT_LOSS_OPTIONS,
  type WeightLoss,
  wardSummary,
} from '@/lib/penunjang-gizi';
import type { NutritionData } from '@/lib/server/data/penunjang-lanjut';

const key = (orderId: string, meal: MealTime) => `${orderId}|${meal}`;
const EMPTY: Delivery = {
  status: 'disiapkan',
  substituted: false,
  overrideReason: null,
  at: null,
  leftover: null,
};
const LEFTOVERS = [0, 25, 50, 75, 100] as const;

/**
 * S07 · Gizi: distribusi makan per bangsal × jam makan (gerbang alergi makanan dan puasa), verifikasi order diet
 * dari DPJP, dan skrining gizi MST. Keadaan tersimpan di toko demo bersama; setiap aksi lewat Server Action.
 */
export function NutritionWorkspace({ data }: { data: NutritionData; userName: string }) {
  const orders = data.orders;
  const deliveries = data.deliveries;
  const [meal, setMeal] = useState<MealTime>(data.meal);
  const [tab, setTab] = useState('distribusi');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const { run: save, pending } = useStoreAction(data.rev);

  const call = (payload: Parameters<typeof recordGiziAction>[0]) =>
    save(
      (rev) => recordGiziAction(payload, rev),
      (result) => setMsg({ ok: result.ok, text: result.message }),
    );
  const deliver = (o: DietOrder, overrideReason: string | null, substituted: boolean) => {
    const gate = deliveryGate(o, meal, { substituted, overrideReason });
    if (gate) return setMsg({ ok: false, text: GIZI_GATE_TEXT[gate] });
    call({
      kind: 'antar',
      orderId: o.id,
      meal,
      substituted,
      overrideReason,
      verified: o.status === 'diverifikasi',
    });
  };

  const summary = wardSummary(orders, meal);
  const wards = [...new Set(orders.map((o) => o.ward))];
  const leftover = averageLeftover(
    orders.map((o) => deliveries[key(o.id, meal)] ?? EMPTY).filter((d) => d.status === 'diterima'),
  );

  const distribution = (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <RadioSegmented
          label="Jam makan"
          value={meal}
          onChange={(v) => {
            setMeal(v as MealTime);
            setMsg(null);
          }}
          items={MEAL_TIMES.map((m) => ({ id: m.id, label: `${m.label} · ${m.at}` }))}
        />
        <span className="flex flex-wrap gap-2">
          <Chip tone="brand">{summary.trays} baki</Chip>
          <Chip tone={summary.npo ? 'warning' : 'neutral'}>{summary.npo} puasa</Chip>
          <Chip tone={summary.allergy ? 'danger' : 'neutral'}>{summary.allergy} konflik alergi</Chip>
          <Chip tone={summary.unverified ? 'warning' : 'neutral'}>
            {summary.unverified} order belum diverifikasi
          </Chip>
          <Chip tone="neutral">Sisa makan rata-rata {leftover === null ? '—' : `${leftover}%`}</Chip>
        </span>
      </div>
      {wards.map((w) => {
        const list = orders.filter((o) => o.ward === w);
        return (
          <section
            key={w}
            aria-label={`Distribusi ${w}`}
            className="flex flex-col gap-2 rounded-card border border-line bg-white p-4"
          >
            <span className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="m-0 text-base font-semibold">{w}</h3>
              <details className="text-small">
                <summary className="min-h-11 cursor-pointer py-2 font-semibold text-brand-700">
                  Label baki ({list.filter((o) => !o.npo).length})
                </summary>
                <ul className="m-0 flex list-disc flex-col gap-1 pl-5 font-mono text-caption">
                  {list
                    .filter((o) => !o.npo)
                    .map((o) => (
                      <li key={o.id}>
                        {trayLabel(o, meal, (deliveries[key(o.id, meal)] ?? EMPTY).substituted)}
                      </li>
                    ))}
                </ul>
              </details>
            </span>
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {list.map((o) => (
                <TrayRow
                  key={o.id}
                  o={o}
                  meal={meal}
                  d={deliveries[key(o.id, meal)] ?? EMPTY}
                  busy={pending}
                  onDeliver={(reason, sub) => deliver(o, reason, sub)}
                  onReceive={(left) => call({ kind: 'terima', orderId: o.id, meal, leftover: left })}
                  onVerify={() => setTab('order')}
                />
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );

  return (
    <div className="flex flex-col gap-3">
      {msg && <Alert level={msg.ok ? 'success' : 'critical'}>{msg.text}</Alert>}
      <Tabs
        label="Kegiatan gizi"
        value={tab}
        onChange={(t) => {
          setTab(t);
          setMsg(null);
        }}
        items={[
          { id: 'distribusi', label: 'Distribusi makan', content: distribution },
          {
            id: 'order',
            label: 'Order diet',
            badge: orders.some((o) => o.status === 'baru')
              ? String(orders.filter((o) => o.status === 'baru').length)
              : undefined,
            content: (
              <OrderList
                orders={orders}
                busy={pending}
                onVerify={(o) => call({ kind: 'verifikasi', orderId: o.id, screened: !!o.screening })}
              />
            ),
          },
          {
            id: 'skrining',
            label: 'Skrining gizi',
            badge: orders.some((o) => !o.screening)
              ? String(orders.filter((o) => !o.screening).length)
              : undefined,
            content: (
              <ScreeningList
                orders={orders}
                busy={pending}
                onScreen={(o, weightLoss, poorAppetite) =>
                  call({ kind: 'skrining', orderId: o.id, weightLoss, poorAppetite })
                }
              />
            ),
          },
        ]}
      />
    </div>
  );
}

function TrayRow({
  o,
  meal,
  d,
  busy,
  onDeliver,
  onReceive,
  onVerify,
}: {
  o: DietOrder;
  meal: MealTime;
  d: Delivery;
  busy: boolean;
  onDeliver: (overrideReason: string | null, substituted: boolean) => void;
  onReceive: (leftover: (typeof LEFTOVERS)[number]) => void;
  onVerify: () => void;
}) {
  const [left, setLeft] = useState<(typeof LEFTOVERS)[number]>(0);
  const menu = mealOf(o, meal, d.substituted);
  const conflict = allergyConflict(o.menus[meal], o.foodAllergies);
  const blocked = o.npo ? 'NPO' : o.status !== 'diverifikasi' ? 'ORDER_UNVERIFIED' : null;
  return (
    <li
      className={cx(
        'flex flex-col gap-2 rounded-[12px] border p-3',
        o.npo ? 'border-warning-border bg-warning-bg' : 'border-line',
      )}
    >
      <span className="flex flex-wrap items-start justify-between gap-2">
        <span className="flex min-w-0 flex-col">
          <span className="font-semibold">
            {o.patient.name} · {o.bed}
          </span>
          <span className="text-small text-ink-700">
            {o.diet} · tekstur {o.texture} · {o.route === 'sonde' ? 'via sonde' : 'oral'}
            {o.foodAllergies.length > 0 && (
              <span className="font-semibold text-danger">
                {' '}
                · alergi makanan: {o.foodAllergies.join(', ')}
              </span>
            )}
          </span>
          <span className="text-small">
            Menu: {o.npo ? '—' : menu.name}
            {d.substituted && (
              <Chip tone="success" className="ml-2">
                menu pengganti
              </Chip>
            )}
          </span>
        </span>
        <Chip
          tone={
            d.status === 'diterima'
              ? 'success'
              : d.status === 'diantar'
                ? 'info'
                : o.npo
                  ? 'warning'
                  : 'neutral'
          }
        >
          {o.npo
            ? `Puasa · ${o.npo.reason}`
            : d.status === 'diterima'
              ? `Diterima${d.leftover !== null ? ` · sisa ${d.leftover}%` : ''}`
              : d.status === 'diantar'
                ? `Diantar ${d.at ? formatJam(d.at) : ''}`
                : 'Disiapkan'}
        </Chip>
      </span>
      {blocked && (
        <span className="flex flex-wrap items-center gap-2 text-small">
          <Button size="sm" disabled>
            Antar ke bangsal
          </Button>
          <span className={cx('font-medium', blocked === 'NPO' ? 'text-warning' : 'text-ink-700')}>
            {GIZI_GATE_TEXT[blocked]}
          </span>
          {blocked === 'ORDER_UNVERIFIED' && (
            <Button size="sm" variant="ghost" onClick={onVerify}>
              Buka order diet
            </Button>
          )}
        </span>
      )}
      {!blocked && d.status === 'disiapkan' && conflict.length > 0 && !d.substituted && (
        <SafetyGate
          title={`Menu ${MEAL_TIMES.find((m) => m.id === meal)?.label.toLowerCase()} mengandung alergen: ${conflict.join(', ')}`}
          recommendation={`Ganti menu pengganti (${o.substitute.name})`}
          overrideLabel="Tetap antar dengan alasan"
          onFollow={() => onDeliver(null, true)}
          onOverride={(reason) => onDeliver(reason, false)}
          disabled={busy}
        >
          Alergi makanan tercatat di asesmen gizi. Menu utama tidak diantar tanpa tindak lanjut.
        </SafetyGate>
      )}
      {!blocked && d.status === 'disiapkan' && (conflict.length === 0 || d.substituted) && (
        <Button
          size="sm"
          variant="primary"
          className="self-start"
          disabled={busy}
          onClick={() => onDeliver(null, d.substituted)}
        >
          Antar ke bangsal
        </Button>
      )}
      {d.overrideReason && (
        <span className="text-caption text-warning">Override alergi tercatat: “{d.overrideReason}”</span>
      )}
      {d.status === 'diantar' && (
        <span className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-small font-semibold text-ink-700">
            Sisa makanan
            <select
              value={left}
              onChange={(e) => setLeft(Number(e.target.value) as (typeof LEFTOVERS)[number])}
              className="h-11 rounded-control border border-line-strong bg-white px-3 font-[inherit]"
            >
              {LEFTOVERS.map((l) => (
                <option key={l} value={l}>
                  {l}%
                </option>
              ))}
            </select>
          </label>
          <Button size="sm" disabled={busy} onClick={() => onReceive(left)}>
            Konfirmasi diterima pasien
          </Button>
        </span>
      )}
    </li>
  );
}

function OrderList({
  orders,
  busy,
  onVerify,
}: {
  orders: readonly DietOrder[];
  busy: boolean;
  onVerify: (o: DietOrder) => void;
}) {
  return (
    <ul aria-label="Order diet dari DPJP" className="m-0 flex list-none flex-col gap-2 p-0">
      {orders.map((o) => (
        <li
          key={o.id}
          className="flex flex-wrap items-start justify-between gap-3 rounded-card border border-line bg-white p-3"
        >
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="font-semibold">
              {o.patient.name} · {o.ward} {o.bed}
            </span>
            <span className="text-small">
              {o.diet} · tekstur {o.texture} · {o.route}
            </span>
            <span className="text-caption text-ink-500">
              Order {o.dpjp} · {formatTanggalWaktu(o.orderedAt)} · {o.notes}
            </span>
          </span>
          {o.status === 'diverifikasi' ? (
            <Chip tone="success">Diverifikasi {o.verifiedBy}</Chip>
          ) : (
            <span className="flex flex-col items-end gap-1">
              <Button size="sm" variant="primary" disabled={busy || !o.screening} onClick={() => onVerify(o)}>
                Verifikasi order
              </Button>
              {!o.screening && (
                <span className="text-caption text-ink-500">Skrining gizi dulu (tab Skrining gizi).</span>
              )}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

function ScreeningList({
  orders,
  busy,
  onScreen,
}: {
  orders: readonly DietOrder[];
  busy: boolean;
  onScreen: (o: DietOrder, weightLoss: WeightLoss, poorAppetite: boolean) => void;
}) {
  return (
    <ul aria-label="Skrining gizi pasien" className="m-0 flex list-none flex-col gap-2 p-0">
      {orders.map((o) => (
        <li key={o.id} className="flex flex-col gap-2 rounded-card border border-line bg-white p-3">
          <span className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-semibold">
              {o.patient.name} · {o.ward} {o.bed}
            </span>
            {o.screening ? (
              <Chip tone={o.screening.score >= 2 ? 'warning' : 'success'}>
                MST {o.screening.score} ·{' '}
                {o.screening.score >= 2 ? 'berisiko, asuhan gizi' : 'tidak berisiko'}
              </Chip>
            ) : (
              <Chip tone="warning">Belum diskrining</Chip>
            )}
          </span>
          {!o.screening && <ScreeningForm busy={busy} onSubmit={(w, a) => onScreen(o, w, a)} />}
        </li>
      ))}
    </ul>
  );
}

function ScreeningForm({
  busy,
  onSubmit,
}: {
  busy: boolean;
  onSubmit: (w: WeightLoss, appetite: boolean) => void;
}) {
  const [w, setW] = useState<WeightLoss>('tidak');
  const [appetite, setAppetite] = useState(false);
  const r = mstScore(w, appetite);
  return (
    <form
      aria-label="Formulir skrining MST"
      className="flex flex-wrap items-end gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(w, appetite);
      }}
    >
      <label className="flex min-w-[220px] flex-col gap-1 text-small font-semibold text-ink-700">
        Penurunan berat badan tanpa disengaja (6 bulan)
        <select
          value={w}
          onChange={(e) => setW(e.target.value as WeightLoss)}
          className="h-11 rounded-control border border-line-strong bg-white px-3 font-[inherit]"
        >
          {WEIGHT_LOSS_OPTIONS.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label} ({o.score})
            </option>
          ))}
        </select>
      </label>
      <label className="flex min-h-11 cursor-pointer items-center gap-2 text-small">
        <input
          type="checkbox"
          checked={appetite}
          onChange={(e) => setAppetite(e.target.checked)}
          className="size-4 accent-brand-600"
        />
        Asupan makan berkurang karena nafsu makan turun (1)
      </label>
      <span className="text-small font-semibold" aria-live="polite">
        Skor {r.score} · {r.atRisk ? 'berisiko' : 'tidak berisiko'}
      </span>
      <Button type="submit" variant="primary" disabled={busy}>
        Simpan skrining
      </Button>
    </form>
  );
}
