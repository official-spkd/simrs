'use client';

import { formatJam, formatTanggal, formatTanggalWaktu } from '@simrs/shared';
import { Alert, Button, Chip, cx } from '@simrs/ui';
import { useId, useState } from 'react';
import { apiClientAction } from '@/app/(staf)/sistem/integrasi/api-publik/actions';
import {
  type AccessLog,
  type ApiClient,
  CLINICAL_SCOPES,
  FHIR_SCOPES,
  type FhirScope,
  keyState,
  registerGate,
  suspendGate,
} from '@/lib/integrasi-api-publik';

import { useStoreAction } from '@/lib/demo/store/client';

const inputCls = 'h-11 rounded-control border border-line-strong bg-white px-3 font-[inherit] font-normal';
const labelCls = 'flex flex-col gap-1 text-small font-semibold text-ink-700';
const day = (iso: string) => formatTanggal(`${iso.slice(0, 10)}T00:00:00+07:00`);

/**
 * I12 · API publik dan FHIR server baca-saja: klien mitra terdaftar, cakupan resource, kunci dengan rotasi
 * berkonfirmasi, penangguhan beralasan, pendaftaran klien baru (cakupan klinis wajib dasar persetujuan), log akses.
 */
export function ApiPublicView({
  clients,
  rev,
  log,
  today,
}: {
  clients: ApiClient[];
  rev: number;
  log: AccessLog[];
  today: string;
}) {
  const id = useId();
  const [confirmRotate, setConfirmRotate] = useState<string | null>(null);
  const [suspending, setSuspending] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [form, setForm] = useState({ name: '', purpose: '', basis: '', scopes: [] as FhirScope[] });
  const [errors, setErrors] = useState<string[]>([]);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const { run: save, pending } = useStoreAction(rev);

  const act = (payload: Parameters<typeof apiClientAction>[0]) =>
    save(
      (rev) => apiClientAction(payload, rev),
      (result) => {
        setMsg({ ok: result.ok, text: result.message });
        if (result.ok) {
          setConfirmRotate(null);
          setSuspending(null);
          setReason('');
          setForm({ name: '', purpose: '', basis: '', scopes: [] });
        }
      },
    );

  return (
    <div className="flex flex-col gap-4">
      <Alert level="info" title="Modul I12 (flag tenant)">
        FHIR R4 baca-saja untuk mitra. Bawaan mati; aktif untuk RS ini di mode presentasi. Identifier pasien
        hanya RM + IHS (NIK tidak pernah disertakan), setiap baca data pasien diaudit.
      </Alert>
      {msg && <Alert level={msg.ok ? 'success' : 'critical'}>{msg.text}</Alert>}
      <section aria-label="Klien terdaftar" className="flex flex-col gap-3">
        {clients.map((c) => {
          const ks = keyState(c, today);
          return (
            <article
              key={c.id}
              aria-label={`Klien ${c.name}`}
              className="flex flex-col gap-2 rounded-card border border-white/95 bg-white/90 shadow-card p-4"
            >
              <span className="flex flex-wrap items-start justify-between gap-2">
                <span className="flex flex-col">
                  <h2 className="m-0 text-[15px] font-semibold">{c.name}</h2>
                  <span className="text-small text-ink-700">{c.purpose}</span>
                </span>
                <span className="flex flex-wrap gap-2">
                  <Chip tone={c.status === 'aktif' ? 'success' : 'danger'}>
                    {c.status === 'aktif' ? 'Aktif' : 'Ditangguhkan'}
                  </Chip>
                  <Chip tone={ks.state === 'aman' ? 'neutral' : ks.state === 'rotasi' ? 'warning' : 'danger'}>
                    {ks.state === 'kedaluwarsa'
                      ? 'Kunci kedaluwarsa'
                      : ks.state === 'rotasi'
                        ? `Rotasi dalam ${ks.days} hari`
                        : `Kunci berlaku ${ks.days} hari`}
                  </Chip>
                </span>
              </span>
              <span className="flex flex-wrap gap-1.5">
                {c.scopes.map((s) => (
                  <Chip key={s} tone={CLINICAL_SCOPES.has(s) ? 'info' : 'brand'} mono>
                    {s}
                  </Chip>
                ))}
              </span>
              <span className="text-caption text-ink-500">
                Kunci <span className="font-mono">fhir-demo-••••{c.keySuffix}</span> · dibuat{' '}
                {day(c.keyCreated)} · berakhir {day(c.keyExpires)} · terakhir dipakai{' '}
                {c.lastUsed ? formatTanggalWaktu(c.lastUsed) : '—'}
                {c.basis ? ` · dasar: ${c.basis}` : ''}
                {c.suspendedReason ? ` · ditangguhkan: ${c.suspendedReason}` : ''}
              </span>
              {confirmRotate === c.id ? (
                <div
                  role="group"
                  aria-label={`Konfirmasi rotasi kunci ${c.name}`}
                  className="flex flex-col gap-2 rounded-[12px] border border-brand-200 bg-[linear-gradient(135deg,var(--color-brand-50),var(--color-batu-50))] p-3 text-small"
                >
                  Rotasi kunci {c.name}? Kunci lama dicabut seketika; mitra harus memasang kunci baru.
                  <span className="flex gap-2">
                    <Button
                      variant="primary"
                      disabled={pending}
                      onClick={() => act({ kind: 'rotasi', clientId: c.id, confirmed: true })}
                    >
                      Ya, rotasi kunci
                    </Button>
                    <Button variant="ghost" onClick={() => setConfirmRotate(null)}>
                      Batal
                    </Button>
                  </span>
                </div>
              ) : suspending === c.id ? (
                <form
                  className="flex flex-col gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const err = suspendGate(reason);
                    if (err) return setMsg({ ok: false, text: err });
                    act({ kind: 'tangguhkan', clientId: c.id, reason });
                  }}
                >
                  <label className={labelCls}>
                    Alasan penangguhan (wajib)
                    <input
                      value={reason}
                      maxLength={300}
                      onChange={(e) => setReason(e.target.value)}
                      className={inputCls}
                    />
                  </label>
                  <span className="flex gap-2">
                    <Button type="submit" variant="danger" disabled={pending}>
                      Tangguhkan
                    </Button>
                    <Button variant="ghost" onClick={() => setSuspending(null)}>
                      Batal
                    </Button>
                  </span>
                </form>
              ) : (
                <span className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    disabled={pending || c.status !== 'aktif'}
                    onClick={() => setConfirmRotate(c.id)}
                  >
                    Rotasi kunci
                  </Button>
                  {c.status === 'aktif' ? (
                    <Button size="sm" variant="ghost" onClick={() => setSuspending(c.id)}>
                      Tangguhkan
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={pending}
                      onClick={() => act({ kind: 'aktifkan', clientId: c.id })}
                    >
                      Aktifkan kembali
                    </Button>
                  )}
                </span>
              )}
            </article>
          );
        })}
      </section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <form
          aria-label="Daftarkan klien baru"
          className="flex min-w-0 flex-col gap-2 rounded-card border border-white/95 bg-white/90 shadow-card p-4"
          onSubmit={(e) => {
            e.preventDefault();
            const errs = registerGate(form);
            setErrors(errs);
            if (errs.length) return;
            act({ kind: 'daftar', ...form });
          }}
        >
          <h2 className="m-0 text-[15px] font-semibold">Daftarkan klien baru</h2>
          <label className={labelCls}>
            Nama klien
            <input
              value={form.name}
              maxLength={120}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              className={inputCls}
            />
          </label>
          <label className={labelCls}>
            Tujuan pemakaian
            <input
              value={form.purpose}
              maxLength={300}
              onChange={(e) => setForm((f) => ({ ...f, purpose: e.target.value }))}
              className={inputCls}
            />
          </label>
          <fieldset className="m-0 flex flex-wrap gap-x-4 border-0 p-0">
            <legend className="mb-1 text-small font-semibold text-ink-700">Cakupan (baca-saja)</legend>
            {FHIR_SCOPES.map((s) => (
              <label
                key={s}
                htmlFor={`${id}-${s}`}
                className="flex min-h-11 cursor-pointer items-center gap-2 text-small"
              >
                <input
                  id={`${id}-${s}`}
                  type="checkbox"
                  checked={form.scopes.includes(s)}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      scopes: e.target.checked ? [...f.scopes, s] : f.scopes.filter((x) => x !== s),
                    }))
                  }
                  className="size-4 accent-brand-600"
                />
                <span className={cx('font-mono', CLINICAL_SCOPES.has(s) && 'text-info')}>{s}</span>
              </label>
            ))}
          </fieldset>
          <label className={labelCls}>
            Dasar persetujuan pasien / perjanjian kerja sama (wajib untuk data klinis)
            <input
              value={form.basis}
              maxLength={300}
              onChange={(e) => setForm((f) => ({ ...f, basis: e.target.value }))}
              className={inputCls}
            />
          </label>
          {errors.length > 0 && (
            <ul role="alert" className="m-0 list-disc pl-5 text-small text-danger">
              {errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          )}
          <Button type="submit" variant="primary" className="self-start" disabled={pending}>
            Daftarkan klien
          </Button>
        </form>
        <section
          aria-label="Log akses API"
          className="flex min-w-0 flex-col gap-2 rounded-card border border-white/95 bg-white/90 shadow-card p-4"
        >
          <h2 className="m-0 text-[15px] font-semibold">Log akses terbaru</h2>
          <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-small">
            {log.map((l) => (
              <li key={`${l.at}-${l.request}`} className="flex flex-col">
                <span>
                  <span className="font-mono">{formatJam(l.at)}</span> ·{' '}
                  {clients.find((c) => c.id === l.clientId)?.name} ·{' '}
                  <Chip tone={l.status < 300 ? 'success' : 'danger'} mono>
                    {l.status}
                  </Chip>
                </span>
                <span className="break-all font-mono text-caption">{l.request}</span>
                <span className="text-caption text-ink-500">{l.note}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
