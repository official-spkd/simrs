'use client';

import type { RadiologyExam } from '@simrs/shared';
import { Button, cx } from '@simrs/ui';
import { useId, useState } from 'react';
import { EXPERTISE_TEMPLATES, reportError, templateFor } from '@/lib/penunjang-radiologi';

/**
 * Editor ekspertise dengan templat (temuan + kesan) dan tanda tangan elektronik radiolog. Tombol TTE nonaktif
 * dengan alasan tertulis sampai temuan dan kesan lengkap; setelah ditandatangani laporan terkunci (addendum).
 */
export function RadExpertise({
  role,
  exam,
  busy,
  serverError,
  onSign,
}: {
  role: string | null;
  exam: RadiologyExam;
  busy: boolean;
  serverError: string | null;
  onSign: (findings: string, impression: string) => void;
}) {
  const id = useId();
  const initial = templateFor(exam);
  const [template, setTemplate] = useState(initial.id);
  const [findings, setFindings] = useState(exam.report?.findings ?? '');
  const [impression, setImpression] = useState(exam.report?.impression ?? '');
  const reason =
    role !== 'dokter'
      ? 'TTE ekspertise wajib posisi Dokter; ganti posisi untuk melanjutkan.'
      : reportError(findings, impression);
  const apply = () => {
    const t = EXPERTISE_TEMPLATES.find((x) => x.id === template);
    if (!t) return;
    setFindings(t.findings);
    setImpression(t.impression);
  };
  const area = 'rounded-control border border-line-strong bg-white px-3 py-2 font-[inherit] text-ink-900';

  return (
    <section
      aria-label="Ekspertise"
      className="flex flex-col gap-2.5 rounded-card border border-white/95 bg-white/90 shadow-card px-4 py-3.5"
    >
      <h3 className="m-0 text-[15px] font-semibold">Ekspertise radiologi</h3>
      <div className="flex flex-wrap items-end gap-2">
        <span className="flex min-w-0 flex-[1_1_220px] flex-col gap-1">
          <label htmlFor={`${id}-tpl`} className="text-small font-semibold text-ink-700">
            Templat ekspertise
          </label>
          <select
            id={`${id}-tpl`}
            value={template}
            onChange={(e) => setTemplate(e.target.value)}
            className="h-11 rounded-control border border-line-strong bg-white px-3 font-[inherit]"
          >
            {EXPERTISE_TEMPLATES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </span>
        <Button onClick={apply} disabled={busy}>
          Terapkan templat
        </Button>
      </div>
      <label htmlFor={`${id}-temuan`} className="text-small font-semibold text-ink-700">
        Temuan
      </label>
      <textarea
        id={`${id}-temuan`}
        rows={5}
        maxLength={4000}
        value={findings}
        onChange={(e) => setFindings(e.target.value)}
        className={area}
      />
      <label htmlFor={`${id}-kesan`} className="text-small font-semibold text-ink-700">
        Kesan
      </label>
      <textarea
        id={`${id}-kesan`}
        rows={2}
        maxLength={1000}
        value={impression}
        onChange={(e) => setImpression(e.target.value)}
        className={area}
      />
      {serverError && (
        <span role="alert" className="text-caption font-semibold text-danger">
          {serverError}
        </span>
      )}
      <div className="flex flex-wrap items-center justify-end gap-2.5">
        {reason && (
          <span id={`${id}-alasan`} className={cx('text-[12.5px] font-semibold text-warning')}>
            {reason}
          </span>
        )}
        <Button
          variant="primary"
          disabled={busy || !!reason}
          aria-describedby={reason ? `${id}-alasan` : undefined}
          onClick={() => onSign(findings.trim(), impression.trim())}
        >
          Tandatangani (TTE)
        </Button>
      </div>
      <span className="text-caption text-ink-500">
        Ekspertise ditandatangani atas nama pengguna sesi dokter; setelah TTE laporan terkunci dan koreksi
        hanya lewat addendum.
      </span>
    </section>
  );
}
