'use client';

import {
  CONTACT_RELATIONS,
  type ContactRelation,
  type PatientContact,
  type PractitionerQuota,
} from '@simrs/shared';
import { cx, Field } from '@simrs/ui';
import { useId } from 'react';
import { quotaUsage } from '@/lib/front-office';
import type { PayerChoice } from './payer-panel';

export type GuarantorChoice =
  | { mode: 'none' }
  | { mode: 'existing'; contactId: string }
  | { mode: 'new'; name: string; relation: ContactRelation; phone: string };

export interface ConsentDraft {
  checked: boolean;
  signer: 'pasien' | 'wali';
  signerName: string;
}

const RELATION_LABEL: Record<ContactRelation, string> = {
  suami: 'Suami',
  istri: 'Istri',
  anak: 'Anak',
  orang_tua: 'Orang tua',
  saudara: 'Saudara',
  wali: 'Wali',
  lainnya: 'Lainnya',
};

const control =
  'h-11 w-full rounded-control border border-line-strong bg-white px-3 font-[inherit] text-ink-900 disabled:cursor-not-allowed disabled:bg-muted';

/** Kuota kelompok penjamin (JKN untuk BPJS, non-JKN untuk lainnya) sudah habis. */
export function quotaFull(q: PractitionerQuota, payer: PayerChoice): boolean {
  const pool = payer === 'bpjs' ? q.jkn : q.nonJkn;
  return pool.booked >= pool.total;
}

/** F03 · Poli dan dokter hari ini (kuota JKN/non-JKN per sesi praktik). */
export function QuotaPanel({
  enabled,
  payer,
  quotas,
  poli,
  sessionId,
  onPoli,
  onSession,
}: {
  enabled: boolean;
  payer: PayerChoice;
  quotas: PractitionerQuota[];
  poli: string;
  sessionId: string | null;
  onPoli: (code: string) => void;
  onSession: (id: string) => void;
}) {
  const id = useId();
  const polis = [...new Map(quotas.map((q) => [q.poliCode, q.poliName])).entries()];
  const list = quotas.filter((q) => q.poliCode === poli);
  return (
    <section
      aria-label="Kuota dokter hari ini"
      className="flex flex-col gap-2 rounded-card border border-line bg-white p-4"
    >
      <span className="font-semibold">Tujuan dan kuota dokter hari ini</span>
      <label htmlFor={`${id}-poli`} className="text-small font-semibold text-ink-700">
        Poli tujuan
      </label>
      <select
        id={`${id}-poli`}
        value={poli}
        disabled={!enabled}
        onChange={(e) => onPoli(e.target.value)}
        className={control}
      >
        {polis.map(([code, name]) => (
          <option key={code} value={code}>
            {name} ({code})
          </option>
        ))}
      </select>
      {list.map((q) => {
        const sel = q.sessionId === sessionId;
        const full = quotaFull(q, payer);
        const u = quotaUsage(q.jkn.booked + q.nonJkn.booked, q.jkn.total + q.nonJkn.total);
        return (
          <button
            key={q.sessionId}
            type="button"
            aria-pressed={sel}
            disabled={!enabled || (full && !sel)}
            onClick={() => onSession(q.sessionId)}
            className={cx(
              'flex cursor-pointer flex-col gap-1.5 rounded-control px-3 py-2.5 text-left font-[inherit] disabled:cursor-not-allowed',
              sel ? 'border-2 border-brand-600 bg-selected' : 'border border-line bg-white',
              full && !sel && 'bg-subtle',
            )}
          >
            <span className="flex items-baseline justify-between gap-2">
              <span className="text-small font-semibold text-ink-900">{q.doctorName}</span>
              <span className="font-mono text-caption text-ink-700">
                {q.start}–{q.end}
              </span>
            </span>
            <span className="h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden="true">
              <span
                className={cx(
                  'block h-1.5',
                  u.level === 'penuh'
                    ? 'bg-danger'
                    : u.level === 'hampir-penuh'
                      ? 'bg-kunyit-500'
                      : 'bg-brand-600',
                )}
                style={{ width: `${u.percent}%` }}
              />
            </span>
            <span className="text-caption text-ink-700">
              JKN {q.jkn.booked}/{q.jkn.total} · non-JKN {q.nonJkn.booked}/{q.nonJkn.total} · {q.room} ·
              berikutnya {q.nextQueueNo} ± {q.eta}
            </span>
            {full && (
              <span className="text-caption font-semibold text-danger">
                Kuota {payer === 'bpjs' ? 'JKN' : 'non-JKN'} penuh
              </span>
            )}
          </button>
        );
      })}
      {list.length === 0 && (
        <span className="text-small text-ink-500">Tidak ada dokter praktik di poli ini hari ini.</span>
      )}
    </section>
  );
}

/** F03 · Penanggung jawab: kontak yang ada, kontak baru, atau tanpa penanggung jawab. */
export function GuarantorPanel({
  enabled,
  contacts,
  value,
  onChange,
}: {
  enabled: boolean;
  contacts: PatientContact[];
  value: GuarantorChoice;
  onChange: (v: GuarantorChoice) => void;
}) {
  const id = useId();
  const name = `${id}-g`;
  const radio = 'size-5 flex-none accent-brand-600';
  return (
    <fieldset
      disabled={!enabled}
      className="m-0 flex flex-col gap-2 rounded-card border border-line bg-white p-4"
    >
      <legend className="px-1 font-semibold">Penanggung jawab</legend>
      {contacts.map((c) => (
        <label key={c.id} className="flex min-h-11 cursor-pointer items-center gap-2.5 text-small">
          <input
            type="radio"
            name={name}
            className={radio}
            checked={value.mode === 'existing' && value.contactId === c.id}
            onChange={() => onChange({ mode: 'existing', contactId: c.id })}
          />
          <span>
            <span className="font-semibold">{c.name}</span> · {RELATION_LABEL[c.relation]}
            {c.phoneMasked ? ` · ${c.phoneMasked}` : ''}
          </span>
        </label>
      ))}
      <label className="flex min-h-11 cursor-pointer items-center gap-2.5 text-small">
        <input
          type="radio"
          name={name}
          className={radio}
          checked={value.mode === 'new'}
          onChange={() => onChange({ mode: 'new', name: '', relation: 'orang_tua', phone: '' })}
        />
        Tambah penanggung jawab baru
      </label>
      {value.mode === 'new' && (
        <div className="flex flex-col gap-2 pl-7">
          <Field
            label="Nama penanggung jawab"
            required
            value={value.name}
            onChange={(e) => onChange({ ...value, name: e.target.value })}
          />
          <label htmlFor={`${id}-rel`} className="text-small font-semibold text-ink-700">
            Hubungan dengan pasien
          </label>
          <select
            id={`${id}-rel`}
            value={value.relation}
            onChange={(e) => onChange({ ...value, relation: e.target.value as ContactRelation })}
            className={control}
          >
            {CONTACT_RELATIONS.map((r) => (
              <option key={r} value={r}>
                {RELATION_LABEL[r]}
              </option>
            ))}
          </select>
          <Field
            label="No. HP (opsional)"
            value={value.phone}
            onChange={(e) => onChange({ ...value, phone: e.target.value })}
          />
        </div>
      )}
      <label className="flex min-h-11 cursor-pointer items-center gap-2.5 text-small">
        <input
          type="radio"
          name={name}
          className={radio}
          checked={value.mode === 'none'}
          onChange={() => onChange({ mode: 'none' })}
        />
        Tanpa penanggung jawab (pasien sendiri)
      </label>
    </fieldset>
  );
}

/**
 * F03 · Persetujuan umum (keputusan fase 2 no. 9): rawat jalan berlaku sampai dicabut. Sudah ada → cukup ditampilkan;
 * belum ada → petugas menyatakan sudah ditandatangani pasien/wali (bukti scan opsional menyusul).
 */
export function ConsentPanel({
  enabled,
  activeSince,
  value,
  onChange,
}: {
  enabled: boolean;
  /** Tanggal persetujuan umum aktif (teks tampilan), null bila belum ada. */
  activeSince: string | null;
  value: ConsentDraft;
  onChange: (v: ConsentDraft) => void;
}) {
  const id = useId();
  if (activeSince) {
    return (
      <div className="flex flex-col gap-1 rounded-control border border-success-border bg-success-bg/60 p-3 text-small">
        <span className="font-semibold">Persetujuan umum rawat jalan berlaku</span>
        <span className="text-ink-700">Ditandatangani {activeSince}; berlaku sampai dicabut.</span>
      </div>
    );
  }
  return (
    <fieldset
      disabled={!enabled}
      className="m-0 flex flex-col gap-2 rounded-control border border-line bg-white p-3"
    >
      <legend className="px-1 text-small font-semibold">Persetujuan umum (general consent)</legend>
      <label className="flex min-h-11 cursor-pointer items-start gap-2.5 text-small">
        <input
          type="checkbox"
          checked={value.checked}
          onChange={(e) => onChange({ ...value, checked: e.target.checked })}
          className="mt-0.5 size-5 flex-none accent-brand-600"
        />
        Persetujuan umum sudah ditandatangani (berlaku untuk rawat jalan sampai dicabut)
      </label>
      <label htmlFor={`${id}-signer`} className="text-small font-semibold text-ink-700">
        Ditandatangani oleh
      </label>
      <select
        id={`${id}-signer`}
        value={value.signer}
        onChange={(e) => onChange({ ...value, signer: e.target.value as ConsentDraft['signer'] })}
        className={control}
      >
        <option value="pasien">Pasien</option>
        <option value="wali">Wali / keluarga</option>
      </select>
      {value.signer === 'wali' && (
        <Field
          label="Nama wali"
          required
          value={value.signerName}
          onChange={(e) => onChange({ ...value, signerName: e.target.value })}
        />
      )}
    </fieldset>
  );
}
