'use client';

import {
  BPJS_VISIT_KIND_CODES,
  BPJS_VISIT_KINDS,
  type BpjsVisitKind,
  type EligibilityResult,
  formatJam,
  type Referral,
} from '@simrs/shared';
import { Alert, Button, Chip, cx, Field } from '@simrs/ui';
import { useId } from 'react';
import { referralExpired, referralMeta } from '@/lib/front-office';

export type PayerChoice = 'bpjs' | 'umum';

const PAYER_LABEL: Record<PayerChoice | 'asuransi', string> = {
  bpjs: 'BPJS Kesehatan',
  umum: 'Umum (bayar sendiri)',
  asuransi: 'Asuransi swasta',
};

const control =
  'h-11 w-full rounded-control border border-line-strong bg-white px-3 font-[inherit] text-ink-900 disabled:cursor-not-allowed disabled:bg-muted';

/**
 * F06 · Penjamin mode api: BPJS (cek kepesertaan VClaim dengan no. kartu/NIK yang diketik atau dipindai, pilih
 * rujukan aktif, diagnosa awal ICD-10) atau umum. VClaim tidak terjangkau → nomor rujukan diisi manual dan SEP tetap
 * dibuat `pending` saat pendaftaran (dikirim setelah BPJS pulih). Asuransi menyusul (master penjamin belum punya API).
 */
export function PayerPanel({
  enabled,
  payer,
  bpjsBlock,
  participant,
  canCheck,
  checking,
  eligibility,
  cardMismatch,
  bpjsDown,
  referrals,
  referralId,
  manual,
  manualMode,
  diagnosis,
  diagnosisError,
  today,
  onPayer,
  onParticipant,
  onCheck,
  onReferral,
  onManualMode,
  onManual,
  onDiagnosis,
}: {
  enabled: boolean;
  payer: PayerChoice;
  /** Alasan BPJS tidak bisa dipilih (mis. pasien belum punya no. kartu/NIK di MPI), null bila bisa. */
  bpjsBlock: string | null;
  participant: string;
  canCheck: boolean;
  checking: boolean;
  eligibility: EligibilityResult | null;
  cardMismatch: boolean;
  bpjsDown: boolean;
  referrals: Referral[] | null;
  referralId: string | null;
  manual: { visitKind: BpjsVisitKind; number: string };
  manualMode: boolean;
  diagnosis: string;
  diagnosisError: string;
  today: string;
  onPayer: (p: PayerChoice) => void;
  onParticipant: (v: string) => void;
  onCheck: () => void;
  onReferral: (id: string) => void;
  onManualMode: (on: boolean) => void;
  onManual: (m: { visitKind: BpjsVisitKind; number: string }) => void;
  onDiagnosis: (v: string) => void;
}) {
  const id = useId();
  const bpjs = payer === 'bpjs';
  const e = eligibility?.eligibility ?? null;
  const showReferrals = bpjs && (e?.status === 'aktif' || bpjsDown);
  return (
    <div className="flex flex-col gap-3 rounded-card border border-line bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="m-0 text-h2 font-semibold">Penjamin: {PAYER_LABEL[payer]}</h2>
        <div role="group" aria-label="Pilih penjamin" className="flex gap-1.5">
          {(['bpjs', 'umum', 'asuransi'] as const).map((p) => (
            <button
              key={p}
              type="button"
              aria-pressed={p === payer}
              disabled={!enabled || p === 'asuransi' || (p === 'bpjs' && !!bpjsBlock)}
              onClick={() => p !== 'asuransi' && onPayer(p)}
              className={cx(
                'h-11 cursor-pointer rounded-control border px-3.5 font-[inherit] text-small disabled:cursor-not-allowed disabled:opacity-60',
                p === payer
                  ? 'border-brand-600 bg-brand-50 font-semibold text-brand-700'
                  : 'border-line bg-white text-ink-900',
              )}
            >
              {p === 'bpjs' ? 'BPJS' : p === 'umum' ? 'Umum' : 'Asuransi'}
            </button>
          ))}
        </div>
      </div>
      {!enabled && <span className="text-small text-ink-500">Pilih pasien dulu.</span>}
      {enabled && bpjsBlock && <span className="text-caption text-ink-700">{bpjsBlock}</span>}
      <span className="text-caption text-ink-500">
        Asuransi swasta dan perusahaan menyusul (master penjamin belum tersedia di layar ini).
      </span>

      {enabled && !bpjs && (
        <div className="flex flex-col gap-1 rounded-control border border-line bg-subtle p-3">
          <span className="font-semibold">Pasien umum · tanpa SEP</span>
          <span className="text-small text-ink-700">
            Tarif sesuai kelas layanan, dibayar di kasir setelah pemeriksaan. Lanjut pilih poli dan dokter.
          </span>
        </div>
      )}

      {enabled && bpjs && (
        <>
          <div className="flex flex-wrap items-end gap-2">
            <Field
              label="No. kartu BPJS atau NIK"
              inputMode="numeric"
              autoComplete="off"
              className="flex-[1_1_220px]"
              value={participant}
              onChange={(ev) => onParticipant(ev.target.value.replace(/\D/g, '').slice(0, 16))}
              hint="Ketik atau pindai kartu (13 digit) / e-KTP (16 digit)"
              hintTone="muted"
            />
            <Button variant="primary" onClick={onCheck} disabled={!canCheck || checking}>
              {checking ? 'Memeriksa VClaim…' : 'Cek kepesertaan'}
            </Button>
          </div>
          {e && (
            <dl
              aria-label="Hasil cek kepesertaan"
              className={cx(
                'm-0 grid grid-cols-2 gap-2 rounded-control border p-3 sm:grid-cols-4',
                e.status === 'aktif'
                  ? 'border-success-border bg-success-bg/60'
                  : 'border-danger-border bg-danger-bg/60',
              )}
            >
              {[
                { k: 'Status peserta', v: e.status === 'aktif' ? 'AKTIF' : 'TIDAK AKTIF' },
                { k: 'No. kartu', v: e.cardMasked },
                { k: 'Hak kelas', v: `${e.kelas} · ${e.segment}` },
                { k: 'FKTP', v: e.fktp },
              ].map((x) => (
                <div key={x.k} className="flex flex-col">
                  <dt className="text-caption text-ink-500">{x.k}</dt>
                  <dd
                    className={cx(
                      'm-0 text-small font-semibold',
                      x.k === 'Status peserta' && (e.status === 'aktif' ? 'text-success' : 'text-danger'),
                    )}
                  >
                    {x.v}
                  </dd>
                </div>
              ))}
            </dl>
          )}
          {eligibility && (
            <span className="text-caption text-ink-500">Dicek {formatJam(eligibility.checkedAt)}</span>
          )}
          {e?.status === 'tidak-aktif' && (
            <Alert level="warning">
              Peserta tidak aktif: SEP tidak bisa diterbitkan. Arahkan pasien mengaktifkan kepesertaan, atau
              daftarkan sebagai pasien umum.
            </Alert>
          )}
          {cardMismatch && (
            <Alert level="warning">
              No. kartu hasil cek berbeda dengan no. BPJS di data pasien. Periksa kartu; SEP memakai no. kartu
              di data pasien.
            </Alert>
          )}
          {bpjsDown && (
            <Alert level="warning" title="VClaim tidak terjangkau">
              Pendaftaran tetap bisa dilanjutkan: isi nomor rujukan/surat kontrol dari dokumen pasien. SEP
              dibuat berstatus menunggu dan dikirim otomatis setelah BPJS pulih.
            </Alert>
          )}

          {showReferrals && (
            <div className="flex flex-col gap-2">
              <span className="text-small font-semibold text-ink-700">Pilih rujukan aktif</span>
              {referrals?.length === 0 && (
                <span className="text-small text-ink-500">
                  Tidak ada rujukan atau surat kontrol tercatat.
                </span>
              )}
              {!manualMode &&
                referrals?.map((r) => {
                  const expired = referralExpired(r, today);
                  const sel = r.id === referralId;
                  return (
                    <button
                      key={r.id}
                      type="button"
                      aria-pressed={sel}
                      disabled={expired}
                      onClick={() => onReferral(r.id)}
                      className={cx(
                        'flex min-h-14 cursor-pointer items-center justify-between gap-3 rounded-control px-3 py-2 text-left font-[inherit] disabled:cursor-not-allowed',
                        sel ? 'border-2 border-brand-600 bg-selected' : 'border border-line bg-white',
                        expired && 'bg-subtle',
                      )}
                    >
                      <span className="flex min-w-0 flex-col">
                        <span
                          className={cx(
                            'text-small font-semibold',
                            expired ? 'text-ink-500' : 'text-ink-900',
                          )}
                        >
                          {r.title} · <span className="font-mono">{r.number}</span>
                        </span>
                        <span className="text-caption text-ink-500">
                          {r.origin} · {referralMeta(r, today)}
                        </span>
                      </span>
                      <Chip tone={expired ? 'danger' : sel ? 'brand' : 'neutral'}>
                        {expired ? 'Kedaluwarsa' : sel ? 'Dipakai' : 'Aktif'}
                      </Chip>
                    </button>
                  );
                })}
              <label className="flex min-h-11 cursor-pointer items-center gap-2 text-small">
                <input
                  type="checkbox"
                  checked={manualMode}
                  onChange={(ev) => onManualMode(ev.target.checked)}
                  className="size-5 accent-brand-600"
                />
                Isi nomor rujukan / surat kontrol manual
              </label>
              {manualMode && (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor={`${id}-kind`} className="text-small font-semibold text-ink-700">
                      Jenis kunjungan
                    </label>
                    <select
                      id={`${id}-kind`}
                      value={manual.visitKind}
                      onChange={(ev) => onManual({ ...manual, visitKind: ev.target.value as BpjsVisitKind })}
                      className={control}
                    >
                      {BPJS_VISIT_KIND_CODES.map((k) => (
                        <option key={k} value={k}>
                          {BPJS_VISIT_KINDS[k].label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <Field
                    label="No. rujukan / surat kontrol"
                    value={manual.number}
                    onChange={(ev) => onManual({ ...manual, number: ev.target.value.toUpperCase() })}
                  />
                </div>
              )}
            </div>
          )}

          {showReferrals && (
            <Field
              label="Diagnosa awal (ICD-10)"
              required
              value={diagnosis}
              onChange={(ev) => onDiagnosis(ev.target.value)}
              error={diagnosisError || null}
              hint={diagnosisError ? undefined : 'Kode ICD-10 di depan, mis. I10 · Hipertensi esensial'}
              hintTone="muted"
            />
          )}
        </>
      )}
    </div>
  );
}
