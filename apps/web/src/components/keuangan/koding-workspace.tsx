'use client';

import { formatJam, formatTanggalWaktu } from '@simrs/shared';
import { Alert, Button, Chip, type ChipTone, cx, KpiCard } from '@simrs/ui';
import Link from 'next/link';
import { useId, useState } from 'react';
import { demoNow } from '@/lib/demo/fixtures/waktu';
import { persen } from '@/lib/keuangan-jurnal';
import {
  applyAnswer,
  type BerkasKoding,
  type Bukti,
  codeStatus,
  effectiveCode,
  KEEP_REASON_MIN,
  type KodeBerkas,
  STATUS_BERKAS_LABEL,
  type StatusBerkas,
  type StatusKode,
  SUMBER_KODE_LABEL,
  validateBerkas,
  versionProblem,
} from '@/lib/keuangan-koding';
import type { CodingBoard } from '@/lib/server/data/keuangan-lanjut';
import { AlasanForm } from './alasan-form';

const BERKAS_TONE: Record<StatusBerkas, ChipTone> = {
  'perlu-koding': 'warning',
  'query-dpjp': 'info',
  'siap-grouping': 'success',
  pending: 'danger',
  'tanggapan-siap': 'success',
};
const KODE_VIEW: Record<StatusKode, { label: string; tone: ChipTone }> = {
  valid: { label: 'Valid', tone: 'success' },
  'perlu-bukti': { label: 'Perlu bukti', tone: 'warning' },
  'ada-saran': { label: 'Ada saran', tone: 'info' },
  dihapus: { label: 'Dihapus di versi baru', tone: 'neutral' },
};

/**
 * U06 · Workbench koder: kode ditarik dari RME dengan sumbernya, saran kode spesifik, validasi bukti per kode, query
 * ke DPJP, dan versi koding beralasan untuk berkas yang sudah terkirim. Grouping dan kirim E-Klaim tetap di layar
 * Klaim & koding. Koder tidak mengubah RME. Simulasi lokal.
 */
export function KodingWorkspace({ board, viewer }: { board: CodingBoard; viewer: string }) {
  const [list, setList] = useState<readonly BerkasKoding[]>(board.berkas);
  const [sel, setSel] = useState(board.berkas[0]?.id ?? '');
  const [flash, setFlash] = useState<string | null>(null);
  const b = list.find((x) => x.id === sel) ?? list[0];
  const update = (next: BerkasKoding) => setList((l) => l.map((x) => (x.id === next.id ? next : x)));
  const count = (s: StatusBerkas) => list.filter((x) => x.status === s).length;
  const audit = board.audit;

  return (
    <div className="flex flex-col gap-4">
      <div role="region" aria-label="Indikator koding" className="grid grid-cols-2 gap-3.5 xl:grid-cols-4">
        <KpiCard label="Perlu koding" value={count('perlu-koding')} tone="warning" tinted hint="hari ini" />
        <KpiCard label="Menunggu jawaban DPJP" value={count('query-dpjp')} detail="query klinis terbuka" />
        <KpiCard
          label="Pending verifikator"
          value={count('pending')}
          tone="danger"
          tinted
          hint="perlu tanggapan"
        />
        <KpiCard
          label={`Kesesuaian audit · ${audit.period}`}
          value={persen(BigInt(audit.agreed), BigInt(audit.sampled))}
          detail={`${audit.agreed}/${audit.sampled} berkas sampel`}
          tone="success"
        />
      </div>
      {flash && (
        <div
          role="status"
          className="rounded-control border border-[#B7DEC0] bg-[#EAF5EC] px-3 py-2 text-small text-success"
        >
          ✓ {flash} (simulasi, tidak disimpan)
        </div>
      )}
      <div className="flex flex-wrap items-start gap-4">
        <nav
          aria-label="Worklist koder"
          className="flex min-w-0 flex-[1_1_240px] flex-col gap-2 xl:max-w-[300px]"
        >
          {list.map((x) => (
            <button
              key={x.id}
              type="button"
              aria-current={x.id === b?.id ? 'true' : undefined}
              onClick={() => setSel(x.id)}
              className={cx(
                'flex min-h-11 cursor-pointer flex-col gap-1 rounded-control border px-3 py-2 text-left font-[inherit]',
                x.id === b?.id ? 'border-brand-600 bg-brand-50' : 'border-line bg-white',
              )}
            >
              <span className="font-semibold text-ink-900">{x.patient.name}</span>
              <span className="text-caption text-ink-500">{x.episode}</span>
              <span>
                <Chip tone={BERKAS_TONE[x.status]}>{STATUS_BERKAS_LABEL[x.status]}</Chip>
              </span>
            </button>
          ))}
          <section
            aria-label="Audit koding"
            className="flex flex-col gap-1.5 rounded-card border border-line bg-white p-3 text-small"
          >
            <span className="font-semibold">Audit koding sampel</span>
            <span className="text-caption text-ink-500">
              Auditor {audit.auditor} (bukan koder berkas) · {audit.period}
            </span>
            <ul className="m-0 flex flex-col gap-1 pl-4 text-caption text-ink-700">
              {audit.findings.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          </section>
        </nav>
        {b && (
          <BerkasDetail
            key={b.id}
            berkas={b}
            evidence={board.evidence[b.id] ?? []}
            viewer={viewer}
            onChange={update}
            onFlash={setFlash}
          />
        )}
      </div>
    </div>
  );
}

function BerkasDetail({
  berkas: b,
  evidence,
  viewer,
  onChange,
  onFlash,
}: {
  berkas: BerkasKoding;
  evidence: readonly Bukti[];
  viewer: string;
  onChange: (b: BerkasKoding) => void;
  onFlash: (s: string) => void;
}) {
  const id = useId();
  const [versionReason, setVersionReason] = useState('');
  const [asking, setAsking] = useState(false);
  const issues = validateBerkas(b);
  const vProblem = versionProblem(b, versionReason);
  const done = b.status === 'siap-grouping' || b.status === 'tanggapan-siap';
  const changed = b.codes.some((c) => c.removed || c.evidence?.source === 'lab' || c.keepReason);
  const setCode = (cid: string, patch: Partial<KodeBerkas>) =>
    onChange({ ...b, codes: b.codes.map((c) => (c.id === cid ? { ...c, ...patch } : c)) });
  const now = () => formatJam(demoNow());

  const finish = () => {
    const t = demoNow();
    if (b.sent) {
      const version = (b.versions.at(-1)?.version ?? 1) + 1;
      onChange({
        ...b,
        status: 'tanggapan-siap',
        versions: [...b.versions, { version, at: t.toISOString(), by: viewer, note: versionReason.trim() }],
      });
      onFlash(
        `Versi koding ${version} ${b.patient.name} disimpan · ${formatJam(t)} · tanggapan siap dikirim dari Klaim & koding`,
      );
    } else {
      onChange({ ...b, status: 'siap-grouping' });
      onFlash(
        `Koding ${b.patient.name} tervalidasi · ${formatJam(t)} · diteruskan ke grouper di Klaim & koding`,
      );
    }
  };

  return (
    <section
      aria-label="Berkas koding"
      className="flex min-w-0 flex-[999_1_520px] flex-col gap-3 rounded-card border border-line bg-white p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <span className="flex flex-col">
          <h2 className="m-0 text-h2 font-semibold">
            {b.patient.name}{' '}
            <span className="font-mono text-caption font-normal text-ink-500">{b.patient.rm}</span>
          </h2>
          <span className="text-small text-ink-700">
            {b.episode} · {b.patient.payer} · DPJP {b.dpjp}
          </span>
        </span>
        <Chip tone={BERKAS_TONE[b.status]}>{STATUS_BERKAS_LABEL[b.status]}</Chip>
      </div>
      {b.verifierNote && (
        <Alert level="warning" title="Pertanyaan verifikator">
          {b.verifierNote}
        </Alert>
      )}
      {b.query && (
        <div className="flex flex-col gap-2 rounded-control border border-[#C9D3EE] bg-[#F6F8FD] p-3 text-small">
          <span className="font-semibold">Query klinis ke {b.query.to}</span>
          <span className="text-ink-700">“{b.query.question}”</span>
          <span className="text-caption text-ink-500">
            Dikirim {formatTanggalWaktu(b.query.askedAt)} lewat notifikasi DPJP
          </span>
          {b.query.answer ? (
            <span className="text-success">
              ✓ Dijawab {b.query.answeredAt ? formatJam(b.query.answeredAt) : ''}: “{b.query.answer}” ·
              koreksi dilakukan DPJP di RME (addendum), bukan oleh koder
            </span>
          ) : (
            <span className="flex flex-wrap gap-2">
              <Button
                size="sm"
                onClick={() => onFlash(`Pengingat query dikirim ke ${b.query?.to} · ${now()}`)}
              >
                Kirim pengingat
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  const t = demoNow();
                  onChange(
                    applyAnswer(
                      b,
                      'Ya, syok septik; norepinefrin 2 hari. Addendum resume ditandatangani.',
                      t.toISOString(),
                    ),
                  );
                  onFlash(
                    `DPJP menjawab query ${b.patient.name} · ${formatJam(t)} · bukti addendum tertaut ke ${b.query?.confirms}`,
                  );
                }}
              >
                Simulasikan jawaban DPJP
              </Button>
            </span>
          )}
        </div>
      )}

      <ul aria-label="Kode diagnosis dan prosedur" className="m-0 flex list-none flex-col p-0">
        {b.codes.map((c) => (
          <KodeRow
            key={c.id}
            c={c}
            evidence={evidence}
            sent={b.sent}
            locked={done}
            onPatch={(patch, msg) => {
              setCode(c.id, patch);
              onFlash(`${msg} · ${now()}`);
            }}
            onQuery={() => setAsking(true)}
          />
        ))}
      </ul>
      {asking && !b.query && (
        <AlasanForm
          label="Pertanyaan ke DPJP (wajib, tanpa mengarahkan jawaban)"
          submitLabel="Kirim query ke DPJP"
          min={20}
          placeholder="mis. Mohon konfirmasi diagnosis gagal ginjal akut; kreatinin naik 1,1 → 2,4 mg/dL"
          onCancel={() => setAsking(false)}
          onSubmit={(q) => {
            const t = demoNow();
            const target = b.codes.find((c) => codeStatus(c) === 'perlu-bukti');
            setAsking(false);
            onChange({
              ...b,
              status: 'query-dpjp',
              query: {
                question: q,
                to: b.dpjp,
                askedAt: t.toISOString(),
                answer: null,
                answeredAt: null,
                confirms: target?.code ?? '',
              },
            });
            onFlash(`Query dikirim ke ${b.dpjp} · ${formatJam(t)}`);
          }}
        />
      )}

      {b.versions.length > 0 && (
        <div className="flex flex-col gap-1 text-small">
          <span className="font-semibold">Riwayat versi koding</span>
          {b.versions.map((v) => (
            <span key={v.version} className="text-caption text-ink-700">
              Versi {v.version} · {formatTanggalWaktu(v.at)} · {v.by} · {v.note}
            </span>
          ))}
        </div>
      )}

      {done ? (
        <p
          role="status"
          className="m-0 rounded-control border border-[#B7DEC0] bg-[#F2FAF4] px-3 py-2 text-small text-ink-700"
        >
          ✓{' '}
          {b.status === 'tanggapan-siap'
            ? 'Tanggapan verifikator siap dikirim.'
            : 'Koding tervalidasi; siap grouping.'}{' '}
          <Link href="/keuangan/klaim" className="font-semibold">
            Lanjut di Klaim & koding
          </Link>
        </p>
      ) : (
        <div className="flex flex-col gap-2 border-t border-line pt-3">
          {b.sent && (
            <>
              <label htmlFor={`${id}-versi`} className="text-small font-semibold text-ink-700">
                Alasan versi koding baru (berkas sudah terkirim; wajib)
              </label>
              <textarea
                id={`${id}-versi`}
                rows={2}
                maxLength={300}
                value={versionReason}
                onChange={(e) => setVersionReason(e.target.value)}
                placeholder="mis. Bukti kalium dilampirkan sesuai pertanyaan verifikator"
                className="rounded-control border border-line-strong bg-white px-3 py-2 font-[inherit] text-small"
              />
            </>
          )}
          {(() => {
            const problems = [
              ...issues,
              ...(b.sent && !changed ? ['ubah kode atau lampirkan bukti sesuai pertanyaan verifikator'] : []),
              ...(vProblem ? [vProblem.replace(/\.$/, '').toLowerCase()] : []),
            ];
            return (
              <span className="flex flex-wrap items-center justify-between gap-2">
                <span
                  id={`${id}-gate`}
                  className={cx(
                    'text-caption',
                    problems.length ? 'font-medium text-warning' : 'text-success',
                  )}
                >
                  {problems.length
                    ? `Belum bisa diteruskan: ${problems.join('; ')}.`
                    : 'Semua kode valid dan bersumber.'}
                </span>
                <Button
                  variant="primary"
                  disabled={problems.length > 0}
                  aria-describedby={`${id}-gate`}
                  onClick={finish}
                >
                  {b.sent
                    ? `Simpan versi ${(b.versions.at(-1)?.version ?? 1) + 1} dan siapkan tanggapan`
                    : 'Validasi dan teruskan ke grouping'}
                </Button>
              </span>
            );
          })()}
        </div>
      )}
      <span className="text-caption text-ink-500">
        Kode ditarik dari RME; koder memvalidasi dan meminta koreksi lewat query, tidak mengubah catatan
        klinis. Grouping INA-CBG dan kirim E-Klaim di layar Klaim & koding. Versi koding baru selalu beralasan
        dan tercatat di jejak audit.
      </span>
    </section>
  );
}

function KodeRow({
  c,
  evidence,
  sent,
  locked,
  onPatch,
  onQuery,
}: {
  c: KodeBerkas;
  evidence: readonly Bukti[];
  sent: boolean;
  locked: boolean;
  onPatch: (patch: Partial<KodeBerkas>, message: string) => void;
  onQuery: () => void;
}) {
  const [mode, setMode] = useState<'none' | 'keep' | 'reject'>('none');
  const [pick, setPick] = useState('');
  const st = codeStatus(c);
  const eff = effectiveCode(c);
  const view = KODE_VIEW[st];
  return (
    <li
      aria-label={`Kode ${c.code}`}
      className={cx('flex flex-col gap-2 border-b border-line py-2.5', c.removed && 'opacity-70')}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <span className="flex min-w-0 flex-[1_1_280px] flex-col">
          <span>
            <span className={cx('font-mono font-semibold text-brand-700', c.removed && 'line-through')}>
              {eff.code}
            </span>{' '}
            <span className={cx(c.removed && 'line-through')}>{eff.name}</span>
            {eff.code !== c.code && <span className="text-caption text-ink-500"> (semula {c.code})</span>}
          </span>
          <span className="text-caption text-ink-500">
            {c.system} · {c.role} · dari {SUMBER_KODE_LABEL[c.source]} · {c.sourceNote}
          </span>
          {eff.evidence && <span className="text-caption text-success">✓ Bukti: {eff.evidence.label}</span>}
          {!eff.evidence && c.keepReason && (
            <span className="text-caption text-ink-700">
              Dipertahankan tanpa tautan bukti: “{c.keepReason}”
            </span>
          )}
        </span>
        <Chip tone={view.tone}>{view.label}</Chip>
      </div>

      {st === 'ada-saran' && c.suggestion && !locked && (
        <div className="flex flex-col gap-2 rounded-control border border-[#C9D3EE] bg-[#F6F8FD] p-3 text-small">
          <span>
            <span className="font-semibold">Saran: {c.suggestion.code}</span> {c.suggestion.name} ·{' '}
            {c.suggestion.why}
          </span>
          <span className="text-caption text-ink-500">Bukti: {c.suggestion.evidence.label}</span>
          {mode === 'reject' ? (
            <AlasanForm
              label="Alasan menolak saran (wajib)"
              submitLabel="Tolak saran"
              min={KEEP_REASON_MIN}
              onCancel={() => setMode('none')}
              onSubmit={(r) => {
                if (c.suggestion)
                  onPatch(
                    { suggestion: { ...c.suggestion, decided: 'tolak' }, keepReason: r },
                    `Saran ${c.suggestion.code} ditolak`,
                  );
              }}
            />
          ) : (
            <span className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="primary"
                onClick={() => {
                  if (c.suggestion)
                    onPatch(
                      { suggestion: { ...c.suggestion, decided: 'terima' } },
                      `Saran ${c.suggestion.code} diterima menggantikan ${c.code}`,
                    );
                }}
              >
                Terima {c.suggestion.code}
              </Button>
              <Button size="sm" onClick={() => setMode('reject')}>
                Tolak saran…
              </Button>
            </span>
          )}
        </div>
      )}

      {st === 'perlu-bukti' && !locked && (
        <div className="flex flex-col gap-2 rounded-control border border-warning-border bg-[#FFFAF2] p-3 text-small">
          <span className="text-ink-700">
            Kode ini menaikkan severitas; tautkan bukti klinis dari RME, pertahankan dengan alasan, atau
            tanyakan DPJP.
          </span>
          <span className="flex flex-wrap items-end gap-2">
            <label className="flex min-w-0 flex-[1_1_240px] flex-col gap-1 font-semibold text-ink-700">
              Bukti dari RME untuk {c.code}
              <select
                value={pick}
                onChange={(e) => setPick(e.target.value)}
                className="h-11 rounded-control border border-line-strong bg-white px-2 font-[inherit] font-normal text-ink-900"
              >
                <option value="">Pilih bukti…</option>
                {evidence.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.label}
                  </option>
                ))}
              </select>
            </label>
            <Button
              size="sm"
              variant="primary"
              disabled={!pick}
              onClick={() => {
                const ev = evidence.find((e) => e.id === pick);
                if (ev) onPatch({ evidence: ev }, `Bukti tertaut ke ${c.code}: ${ev.label}`);
              }}
            >
              Tautkan bukti
            </Button>
            <Button size="sm" onClick={() => setMode('keep')}>
              Pertahankan dengan alasan…
            </Button>
            <Button size="sm" variant="ghost" onClick={onQuery}>
              Query ke DPJP…
            </Button>
          </span>
          {mode === 'keep' && (
            <AlasanForm
              label={`Alasan mempertahankan ${c.code} tanpa tautan bukti (wajib)`}
              submitLabel="Simpan alasan"
              min={KEEP_REASON_MIN}
              onCancel={() => setMode('none')}
              onSubmit={(r) => {
                setMode('none');
                onPatch({ keepReason: r }, `${c.code} dipertahankan dengan alasan`);
              }}
            />
          )}
        </div>
      )}

      {sent && !locked && !c.removed && c.role === 'sekunder' && (
        <span>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onPatch({ removed: true }, `${c.code} dihapus pada versi koding baru`)}
          >
            Hapus {c.code} di versi baru
          </Button>
        </span>
      )}
    </li>
  );
}
