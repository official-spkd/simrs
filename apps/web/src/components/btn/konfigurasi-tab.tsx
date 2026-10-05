'use client';

import { type ConnectionMode, formatJam, type PaymentConfig } from '@simrs/shared';
import { Button, Chip, cx, RadioSegmented } from '@simrs/ui';
import { useId, useRef, useState } from 'react';
import type { PaymentEventInput } from '@/app/(staf)/keuangan/pembayaran/actions';
import { formatTanggalPendek } from '@/lib/btn';

type ChannelId = PaymentConfig['channels'][number]['id'];
interface Cfg {
  on: Record<ChannelId, boolean>;
  va: string;
  qris: string;
  mode: ConnectionMode;
}

function initial(c: PaymentConfig): Cfg {
  const on = { va: false, qris: false, edc: false, cicilan: false };
  for (const ch of c.channels) on[ch.id] = ch.enabled;
  const exp = (id: ChannelId) => c.channels.find((x) => x.id === id)?.expiry?.value ?? '';
  return { on, va: exp('va'), qris: exp('qris'), mode: c.mode };
}

const same = (a: Cfg, b: Cfg) => JSON.stringify(a) === JSON.stringify(b);

/** Tab Konfigurasi: kanal aktif dan masa berlaku, mode koneksi, webhook (HMAC + idempotensi), rotasi secret. */
export function KonfigurasiTab({
  config,
  busy,
  record,
  now,
  onSavedMode,
}: {
  config: PaymentConfig;
  busy: boolean;
  record: (input: PaymentEventInput, label: string) => Promise<boolean>;
  now: () => string;
  onSavedMode: (mode: ConnectionMode) => void;
}) {
  const [cfg, setCfg] = useState(() => initial(config));
  const [saved, setSaved] = useState(() => initial(config));
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [rotatedAt, setRotatedAt] = useState<string | null>(null);
  // Dialog modal asli: fokus masuk ke dialog saat dibuka dan kembali ke tombol pemicu saat ditutup.
  const dialog = useRef<HTMLDialogElement>(null);
  const id = useId();
  const dirty = !same(cfg, saved);
  const anyOn = Object.values(cfg.on).some(Boolean);
  const canSave = dirty && anyOn;
  const note = !anyOn
    ? 'Minimal satu kanal pembayaran harus aktif.'
    : dirty
      ? 'Ada perubahan yang belum disimpan.'
      : savedAt
        ? `Konfigurasi disimpan ${formatJam(savedAt)} · tercatat di jejak audit (simulasi, tidak disimpan).`
        : 'Tidak ada perubahan.';
  const save = async () => {
    if (!canSave) return;
    const ok = await record(
      {
        kind: 'konfigurasi',
        channels: cfg.on,
        vaExpiry: cfg.va as '12' | '24' | '48',
        qrisExpiry: cfg.qris as '5' | '10' | '15',
        mode: cfg.mode,
      },
      'Konfigurasi kanal disimpan',
    );
    if (!ok) return;
    setSaved(cfg);
    setSavedAt(now());
    onSavedMode(cfg.mode);
  };
  const rotate = async () => {
    const ok = await record({ kind: 'rotasi-secret' }, 'Secret webhook dirotasi');
    dialog.current?.close();
    if (ok) setRotatedAt(now());
  };
  const w = config.webhook;
  const rows: Array<[string, string]> = [
    ['Endpoint', w.url],
    [
      'Tanda tangan',
      `${w.algorithm}(timestamp + "." + body) · header ${w.signatureHeader}; diverifikasi sebelum diproses`,
    ],
    ['Idempotensi', `${w.eventIdHeader} unik per event · callback ganda dibalas 200 tanpa pelunasan ganda`],
    ['Toleransi waktu', `timestamp ditolak bila selisih > ${w.toleranceSec / 60} menit (anti-replay)`],
    ['Retry', w.retry],
  ];
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <section
          aria-label="Merchant dan kanal"
          className="flex min-w-0 flex-col gap-2.5 rounded-card border border-line bg-white p-4"
        >
          <span className="font-semibold">Merchant dan rekening tujuan</span>
          <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-small">
            <dt className="text-ink-500">Merchant ID TPDI</dt>
            <dd className="m-0 font-mono">{config.merchantId}</dd>
            <dt className="text-ink-500">Rekening tujuan</dt>
            <dd className="m-0">
              BTN <span className="font-mono">{config.operationalAccount}</span> · operasional (penerimaan
              pasien)
            </dd>
            <dt className="text-ink-500">Rekening klaim BPJS</dt>
            <dd className="m-0">
              BTN <span className="font-mono">{config.claimAccount}</span> · penampungan, tidak menerima kanal
              pasien
            </dd>
          </dl>
          <span className="flex justify-between gap-2 pt-1 text-small font-semibold">
            Kanal aktif dan biaya{' '}
            <span className="text-caption font-normal text-ink-500">biaya: simulasi</span>
          </span>
          {config.channels.map((k) => {
            const on = cfg.on[k.id];
            return (
              <div
                key={k.id}
                className={cx(
                  'flex flex-wrap items-center gap-3 rounded-control border p-2.5',
                  on ? 'border-[#BFE0D9] bg-[#F7FCFB]' : 'border-line bg-[#FAFBFC]',
                )}
              >
                <label className="flex min-h-11 min-w-0 flex-[1_1_220px] cursor-pointer items-center gap-2.5">
                  <input
                    type="checkbox"
                    role="switch"
                    className="size-5 flex-none accent-brand-600"
                    checked={on}
                    onChange={() => setCfg((c) => ({ ...c, on: { ...c.on, [k.id]: !c.on[k.id] } }))}
                  />
                  <span className="flex min-w-0 flex-col">
                    <span className="font-semibold">{k.name}</span>
                    <span className="text-caption text-ink-500">{k.sub}</span>
                  </span>
                </label>
                <span className="text-caption text-ink-700">{k.fee}</span>
                {k.expiry && (
                  <label className="flex items-center gap-1.5 text-small">
                    <span>
                      Masa berlaku<span className="sr-only"> {k.name}</span>
                    </span>
                    <select
                      value={k.id === 'va' ? cfg.va : cfg.qris}
                      onChange={(e) =>
                        setCfg((c) =>
                          k.id === 'va' ? { ...c, va: e.target.value } : { ...c, qris: e.target.value },
                        )
                      }
                      className="h-11 rounded-control border border-line-strong bg-white px-2 font-[inherit]"
                    >
                      {k.expiry.options.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <Chip tone={on ? 'success' : 'neutral'}>{on ? 'Aktif' : 'Nonaktif'}</Chip>
              </div>
            );
          })}
          <span className="text-caption text-ink-500">
            Biaya VA, MDR QRIS, dan EDC dikenakan BTN sesuai perjanjian. Fee TPDI Rp 1.500/transaksi
            (simulasi) ditagih lewat invoice bulanan, tidak dipotong dari dana.
          </span>
        </section>
        <section
          aria-label="Webhook dan mode"
          className="flex min-w-0 flex-col gap-2.5 rounded-card border border-line bg-white p-4"
        >
          <span className="font-semibold">Mode koneksi</span>
          <RadioSegmented
            label="Mode koneksi TPDI"
            value={cfg.mode}
            items={[
              { id: 'sandbox', label: 'Sandbox' },
              { id: 'produksi', label: 'Produksi' },
            ]}
            onChange={(id) => setCfg((c) => ({ ...c, mode: id === 'sandbox' ? 'sandbox' : 'produksi' }))}
          />
          <span
            className={cx(
              'text-small',
              cfg.mode === 'sandbox' ? 'font-semibold text-warning' : 'text-ink-700',
            )}
          >
            {cfg.mode === 'sandbox'
              ? 'Sandbox: tagihan memakai endpoint uji TPDI dan tidak memindahkan dana. Jangan dipakai di loket.'
              : `Produksi: tagihan nyata, dana masuk ke BTN ${config.operationalAccount}. Perubahan tercatat di jejak audit.`}
          </span>
          <span className="pt-1 font-semibold">Webhook TPDI → SIM RS</span>
          <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-small">
            {rows.map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-ink-500">{k}</dt>
                <dd className="m-0 break-words">{v}</dd>
              </div>
            ))}
            <dt className="text-ink-500">Secret</dt>
            <dd className="m-0">
              <span className="font-mono">{rotatedAt ? 'whsec_••••b71e' : w.secretMasked}</span> ·{' '}
              {rotatedAt
                ? `dirotasi hari ini ${formatJam(rotatedAt)}`
                : `dirotasi ${formatTanggalPendek(w.secretRotatedOn, true)}`}{' '}
              · hanya 4 karakter terakhir yang ditampilkan
            </dd>
          </dl>
          <Button
            className="self-start"
            disabled={busy}
            aria-haspopup="dialog"
            onClick={() => dialog.current?.showModal()}
          >
            Rotasi secret
          </Button>
          <dialog
            ref={dialog}
            role="alertdialog"
            aria-labelledby={`${id}-judul`}
            aria-describedby={`${id}-isi`}
            className="m-auto w-[min(520px,calc(100vw-32px))] rounded-card border border-warning-border p-0 text-ink-900 backdrop:bg-[rgba(20,33,43,0.45)]"
          >
            <div className="flex flex-col gap-3 bg-warning-bg p-5">
              <h2 id={`${id}-judul`} className="m-0 text-h2 font-semibold text-warning">
                Rotasi secret webhook sekarang?
              </h2>
              <p id={`${id}-isi`} className="m-0 text-small text-ink-700">
                Secret baru dibuat di TPDI dan SIM RS bersamaan. Secret lama tetap diterima 24 jam agar
                webhook yang sedang retry tidak gagal verifikasi. Tindakan tercatat di jejak audit.
              </p>
              <span className="flex flex-wrap gap-2">
                <Button onClick={() => dialog.current?.close()}>Batal</Button>
                <Button variant="primary" disabled={busy} onClick={rotate}>
                  Ya, rotasi sekarang
                </Button>
              </span>
            </div>
          </dialog>
          {rotatedAt && (
            <span role="status" className="text-small text-success">
              Secret dirotasi {formatJam(rotatedAt)}. Secret lama masih diterima sampai besok{' '}
              {formatJam(rotatedAt)}, lalu otomatis dicabut.
            </span>
          )}
        </section>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-3">
        <span
          aria-live="polite"
          className={cx(
            'text-small',
            !anyOn ? 'font-semibold text-danger' : dirty ? 'text-warning' : 'text-ink-700',
          )}
        >
          {note}
        </span>
        <Button variant="primary" disabled={!canSave || busy} onClick={save}>
          Simpan konfigurasi
        </Button>
      </div>
    </div>
  );
}
