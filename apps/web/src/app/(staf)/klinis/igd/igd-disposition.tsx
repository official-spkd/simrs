'use client';

import { type EdTrackingItem, WARD_CLASSES } from '@simrs/shared';
import { Button, cx } from '@simrs/ui';
import Link from 'next/link';
import { useId, useState } from 'react';
import { useStoreAction } from '@/lib/demo/store/client';
import { DEATH_CAUSES } from '@/lib/klinis-igd-toko';
import { assignDoctorAction, declareDeathAction, requestAdmissionAction } from './actions-demo';

export interface IgdDispositionView {
  item: EdTrackingItem;
  /** Permintaan bed sudah ada (papan tempat tidur). */
  bedRequested: boolean;
  /** Bed yang sudah dialokasikan, mis. "M-205 · Bangsal Melati · dipesan". */
  placement: string | null;
}

const INPUT = 'h-11 rounded-control border border-line-strong bg-white px-3 font-[inherit]';

/**
 * K03 · Disposisi pasien IGD: dokter penanggung jawab (relasi dari sesi), rawat inap (permintaan bed ke papan tempat
 * tidur), atau meninggal (usulan K-1, menunggu konfirmasi pemilik produk: hanya dokter penanggung jawab, jam
 * kematian, sebab ICD-10, surat keterangan kematian ber-TTE). Semua tersimpan di toko demo `klinis-igd`.
 */
export function IgdDispositionPanel({
  view,
  rev,
  role,
  user,
  bedHref,
}: {
  view: IgdDispositionView;
  rev: number;
  role: string | null;
  user: string;
  bedHref: string | null;
}) {
  const id = useId();
  const { item } = view;
  const { run, pending } = useStoreAction(rev);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [kelas, setKelas] = useState<(typeof WARD_CLASSES)[number]>('Kelas 1');
  const [need, setNeed] = useState('');
  const [death, setDeath] = useState<{ open: boolean; hm: string; cause: string; signed: boolean }>({
    open: false,
    hm: '',
    cause: '',
    signed: false,
  });
  const isDoctor = role === 'dokter';
  const canAdmit = role === 'dokter' || role === 'dokter_residen';
  const responsible = item.doctor === user;
  const say = (res: { ok: boolean; message: string }) => setMsg({ ok: res.ok, text: res.message });

  return (
    <section
      aria-label="Disposisi pasien IGD"
      className="flex flex-col gap-3 rounded-card border border-line bg-white px-4 py-3.5"
    >
      <h2 className="m-0 text-body font-semibold">Disposisi · {item.patientName}</h2>
      <div className="flex flex-col gap-1.5 text-small">
        <span>
          <span className="text-ink-500">Dokter penanggung jawab: </span>
          <span className="font-semibold">{item.doctor ?? 'belum ditetapkan'}</span>
        </span>
        {isDoctor && !responsible && (
          <Button
            size="sm"
            className="self-start"
            disabled={pending}
            onClick={() => run((r) => assignDoctorAction({ encounterId: item.encounterId }, r), say)}
          >
            Tangani sebagai dokter penanggung jawab
          </Button>
        )}
      </div>

      <div className="flex flex-col gap-2 border-t border-line-soft pt-2.5">
        <h3 className="m-0 text-small font-semibold">Rawat inap</h3>
        {view.placement ? (
          <p className="m-0 rounded-control border border-success-border bg-success-bg px-3 py-2 text-small font-semibold text-success">
            Bed {view.placement} · menunggu transfer ke bangsal
          </p>
        ) : view.bedRequested ? (
          <p className="m-0 text-small text-ink-700">
            Permintaan bed sudah di papan tempat tidur · menunggu alokasi.{' '}
            {bedHref && (
              <Link href={bedHref} className="font-semibold">
                Buka papan tempat tidur
              </Link>
            )}
          </p>
        ) : item.triageLevel === null ? (
          <p className="m-0 text-caption text-ink-500">Triase pasien dulu sebelum disposisi rawat inap.</p>
        ) : canAdmit ? (
          <form
            aria-label="Minta bed rawat inap"
            className="flex flex-col gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              run((r) => requestAdmissionAction({ encounterId: item.encounterId, kelas, need }, r), say);
            }}
          >
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <div className="flex flex-col gap-1">
                <label htmlFor={`${id}-kelas`} className="text-small font-semibold">
                  Kelas ruang
                </label>
                <select
                  id={`${id}-kelas`}
                  value={kelas}
                  onChange={(e) => setKelas(e.target.value as (typeof WARD_CLASSES)[number])}
                  className={INPUT}
                >
                  {WARD_CLASSES.map((k) => (
                    <option key={k} value={k}>
                      {k}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor={`${id}-need`} className="text-small font-semibold">
                  Kebutuhan ruang
                </label>
                <input
                  id={`${id}-need`}
                  value={need}
                  maxLength={80}
                  placeholder="Mis. Penyakit dalam · pantau EWS"
                  onChange={(e) => setNeed(e.target.value)}
                  className={INPUT}
                />
              </div>
            </div>
            <Button
              type="submit"
              variant="primary"
              className="self-start"
              disabled={pending || need.trim().length < 3}
            >
              Minta bed rawat inap
            </Button>
          </form>
        ) : (
          <p className="m-0 text-caption text-ink-500">
            Keputusan rawat inap oleh dokter (posisi dokter/residen).
          </p>
        )}
      </div>

      {isDoctor && (
        <div className="flex flex-col gap-2 border-t border-line-soft pt-2.5">
          <h3 className="m-0 text-small font-semibold">Meninggal</h3>
          {!responsible ? (
            <p className="m-0 text-caption text-ink-500">
              Hanya dokter penanggung jawab pasien ini yang dapat menyatakan meninggal.
            </p>
          ) : !death.open ? (
            <Button
              size="sm"
              variant="danger"
              className="self-start"
              onClick={() => setDeath((d) => ({ ...d, open: true }))}
            >
              Nyatakan meninggal
            </Button>
          ) : (
            <form
              aria-label="Pernyataan meninggal"
              className="flex flex-col gap-2 rounded-control border border-danger-border bg-koral-50 p-3"
              onSubmit={(e) => {
                e.preventDefault();
                run(
                  (r) =>
                    declareDeathAction(
                      {
                        encounterId: item.encounterId,
                        diedAt: death.hm,
                        causeCode: death.cause,
                        certificateSigned: death.signed,
                      },
                      r,
                    ),
                  say,
                );
              }}
            >
              <span className="text-caption text-ink-700">
                Aturan K-1 (usulan, menunggu konfirmasi pemilik produk): dokter penanggung jawab, jam
                kematian, sebab ICD-10, surat keterangan kematian ber-TTE; admisi pasien ini ditolak
                setelahnya.
              </span>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <div className="flex flex-col gap-1">
                  <label htmlFor={`${id}-jam`} className="text-small font-semibold">
                    Jam kematian (HH.MM)
                  </label>
                  <input
                    id={`${id}-jam`}
                    value={death.hm}
                    inputMode="numeric"
                    placeholder="10.40"
                    maxLength={5}
                    onChange={(e) => setDeath((d) => ({ ...d, hm: e.target.value }))}
                    className={cx(INPUT, 'font-mono')}
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label htmlFor={`${id}-sebab`} className="text-small font-semibold">
                    Sebab kematian (ICD-10)
                  </label>
                  <select
                    id={`${id}-sebab`}
                    value={death.cause}
                    onChange={(e) => setDeath((d) => ({ ...d, cause: e.target.value }))}
                    className={INPUT}
                  >
                    <option value="">Pilih…</option>
                    {DEATH_CAUSES.map((c) => (
                      <option key={c.code} value={c.code}>
                        {c.code} · {c.display}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <label className="flex min-h-11 items-center gap-2 text-small">
                <input
                  type="checkbox"
                  checked={death.signed}
                  onChange={(e) => setDeath((d) => ({ ...d, signed: e.target.checked }))}
                  className="size-[18px] accent-brand-600"
                />
                Tanda tangani surat keterangan kematian (TTE {user})
              </label>
              <span className="flex flex-wrap gap-2">
                <Button
                  type="submit"
                  variant="danger"
                  disabled={pending || !death.hm || !death.cause || !death.signed}
                >
                  Simpan pernyataan meninggal
                </Button>
                <Button variant="ghost" onClick={() => setDeath((d) => ({ ...d, open: false }))}>
                  Batal
                </Button>
              </span>
            </form>
          )}
        </div>
      )}
      {msg && (
        <p
          role={msg.ok ? 'status' : 'alert'}
          className={cx('m-0 text-small font-semibold', msg.ok ? 'text-success' : 'text-danger')}
        >
          {msg.text}
        </p>
      )}
    </section>
  );
}
