'use client';

import { formatJam, formatTanggal } from '@simrs/shared';
import { Alert, Button, Chip, type ChipTone, Tabs } from '@simrs/ui';
import { useState } from 'react';
import {
  type Flash,
  FlashLine,
  KeyValues,
  Panel,
  PickRow,
  ReasonButton,
  SelectField,
  StageTrack,
  TableWrap,
  TD,
  TextField,
  TH,
} from '@/components/backoffice/kit';
import { demoNow } from '@/lib/demo/fixtures/waktu';
import {
  DOC_FLOW,
  DOC_STATUS_LABEL,
  type DocStatus,
  docApproveBlock,
  pct,
  publish,
  type RegDoc,
  reviewStatus,
} from '@/lib/dokumen';

const S_TONE: Record<DocStatus, ChipTone> = {
  draf: 'neutral',
  telaah: 'info',
  disetujui: 'brand',
  terbit: 'success',
  usang: 'danger',
};

/**
 * B12 · DMS berversi + distribusi baca + paket bukti akreditasi. Hanya versi terbit yang tampil ke unit; versi lama
 * usang tetap tersimpan bertanda "TIDAK BERLAKU". Semua aksi simulasi.
 */
export function DocumentBoard({
  initialDocs,
  approvers,
  units,
  receipts,
  chapters,
  today,
}: {
  initialDocs: readonly RegDoc[];
  approvers: readonly string[];
  units: ReadonlyArray<{ unit: string; staff: number }>;
  receipts: Record<string, Record<string, number>>;
  chapters: ReadonlyArray<{ code: string; label: string; elements: number; withEvidence: number }>;
  today: string;
}) {
  const [tab, setTab] = useState('dokumen');
  const [docs, setDocs] = useState<RegDoc[]>([...initialDocs]);
  const [sel, setSel] = useState(
    initialDocs.find((d) => d.status === 'draf')?.id ?? initialDocs[0]?.id ?? '',
  );
  const [note, setNote] = useState('');
  const [approver, setApprover] = useState('');
  const [reads, setReads] = useState(receipts);
  const [reminded, setReminded] = useState<Record<string, string>>({});
  const [distDoc, setDistDoc] = useState(initialDocs.find((d) => d.status === 'terbit')?.id ?? '');
  const [evidence, setEvidence] = useState(() =>
    Object.fromEntries(chapters.map((c) => [c.code, c.withEvidence])),
  );
  const [chapter, setChapter] = useState('');
  const [evDoc, setEvDoc] = useState('');
  const [flash, setFlash] = useState<Flash | null>(null);
  const at = () => formatJam(demoNow());

  const doc = docs.find((d) => d.id === sel);
  const published = docs.filter((d) => d.status === 'terbit');
  const setStatus = (id: string, status: DocStatus, text: string) => {
    setDocs((cur) => cur.map((d) => (d.id === id ? { ...d, status } : d)));
    setFlash({ ok: true, text: `${text} · ${at()}.` });
  };

  let detail = null;
  if (doc) {
    const rv = reviewStatus(doc.reviewDue, today);
    const idx = DOC_FLOW.indexOf(doc.status);
    detail = (
      <Panel
        title={`${doc.code} v${doc.version}`}
        sub={doc.title}
        actions={<Chip tone={S_TONE[doc.status]}>{DOC_STATUS_LABEL[doc.status]}</Chip>}
      >
        {doc.status !== 'usang' && (
          <StageTrack
            label={`Tahap ${doc.code} v${doc.version}`}
            stages={DOC_FLOW.map((s) => ({ label: DOC_STATUS_LABEL[s] }))}
            current={doc.status === 'terbit' ? DOC_FLOW.length : idx}
          />
        )}
        <KeyValues
          rows={[
            ['Jenis', `${doc.kind} · pemilik ${doc.owner}`],
            ['Penyusun', doc.author],
            ['Terbit', doc.publishedAt ? formatTanggal(doc.publishedAt) : 'belum'],
            ['Tinjau ulang', doc.reviewDue ? formatTanggal(doc.reviewDue) : '—'],
          ]}
        />
        <hr className="m-0 border-0 border-t border-line" />
        {doc.status === 'draf' && (
          <span>
            <Button
              variant="primary"
              onClick={() => setStatus(doc.id, 'telaah', `${doc.code} v${doc.version} dikirim ke telaah`)}
            >
              Kirim ke telaah
            </Button>
          </span>
        )}
        {doc.status === 'telaah' && (
          <div className="flex flex-col gap-3">
            <TextField label="Catatan telaah" rows={2} value={note} onChange={setNote} />
            <SelectField
              label="Penyetuju"
              value={approver}
              onChange={setApprover}
              placeholder="Pilih penyetuju…"
              options={approvers.map((a) => [a, a])}
              hint={`Penyusun: ${doc.author}.`}
            />
            <ReasonButton
              reason={
                note.trim().length < 10
                  ? 'Tulis catatan telaah minimal 10 huruf.'
                  : docApproveBlock(doc.author, approver || null)
              }
              onClick={() => {
                setStatus(doc.id, 'disetujui', `${doc.code} v${doc.version} disetujui ${approver}`);
                setNote('');
                setApprover('');
              }}
            >
              Setujui dokumen
            </ReasonButton>
          </div>
        )}
        {doc.status === 'disetujui' && (
          <span>
            <Button
              variant="primary"
              onClick={() => {
                const old = docs.find((d) => d.code === doc.code && d.status === 'terbit');
                setDocs((cur) => publish(cur, doc.id, today));
                setReads((cur) => ({ ...cur, [doc.id]: {} }));
                setDistDoc(doc.id);
                setFlash({
                  ok: true,
                  text: `${doc.code} v${doc.version} terbit · ${at()}; didistribusikan ke ${units.length} unit${old ? `, v${old.version} tidak berlaku (bertanda air)` : ''}.`,
                });
              }}
            >
              Terbitkan dan distribusikan
            </Button>
          </span>
        )}
        {doc.status === 'terbit' &&
          (rv.status === 'aman' ? (
            <span className="text-small text-ink-700">Berlaku; tinjau ulang terjadwal otomatis.</span>
          ) : (
            <div className="flex flex-col gap-2">
              <Alert
                level={rv.status === 'lewat' ? 'critical' : 'warning'}
                title={rv.status === 'lewat' ? 'Lewat tanggal tinjau ulang' : 'Tinjau ulang segera'}
              >
                {rv.status === 'lewat' ? `Lewat ${-(rv.days ?? 0)} hari.` : `${rv.days} hari lagi.`} Versi ini
                tetap berlaku sampai versi baru terbit.
              </Alert>
              {!docs.some((d) => d.code === doc.code && d.version > doc.version) && (
                <span>
                  <Button
                    onClick={() => {
                      const id = `${doc.id}-r${doc.version + 1}`;
                      setDocs((cur) => [
                        ...cur,
                        {
                          ...doc,
                          id,
                          version: doc.version + 1,
                          status: 'draf',
                          publishedAt: null,
                          reviewDue: null,
                        },
                      ]);
                      setSel(id);
                      setFlash({
                        ok: true,
                        text: `Draf ${doc.code} v${doc.version + 1} dibuat untuk tinjau ulang · ${at()}.`,
                      });
                    }}
                  >
                    Mulai tinjau ulang (versi baru)
                  </Button>
                </span>
              )}
            </div>
          ))}
        {doc.status === 'usang' && (
          <div
            role="img"
            aria-label="Pratinjau dokumen tidak berlaku bertanda air"
            className="relative min-h-[96px] overflow-hidden rounded-control border border-line bg-subtle p-3 text-small"
          >
            {doc.title} · versi {doc.version}
            <span
              aria-hidden="true"
              className="absolute inset-x-0 top-[40%] -rotate-6 text-center text-lg font-bold tracking-widest text-danger/40"
            >
              TIDAK BERLAKU
            </span>
          </div>
        )}
      </Panel>
    );
  }

  const documents = (
    <div className="flex flex-wrap items-start gap-4">
      <div className="min-w-0 flex-[1_1_300px] xl:max-w-[420px]">
        <Panel
          title="Dokumen"
          sub={`${published.length} terbit · ${docs.filter((d) => ['draf', 'telaah', 'disetujui'].includes(d.status)).length} dalam proses`}
          flush
        >
          {docs.map((d) => {
            const rv = reviewStatus(d.status === 'terbit' ? d.reviewDue : null, today);
            return (
              <PickRow
                key={d.id}
                selected={d.id === sel}
                onClick={() => setSel(d.id)}
                title={`${d.code} v${d.version}`}
                sub={d.title}
                right={
                  <>
                    <Chip tone={S_TONE[d.status]}>{DOC_STATUS_LABEL[d.status]}</Chip>
                    {rv.status !== 'aman' && (
                      <Chip tone={rv.status === 'lewat' ? 'danger' : 'warning'}>tinjau ulang</Chip>
                    )}
                  </>
                }
              />
            );
          })}
        </Panel>
      </div>
      <div className="min-w-0 flex-[999_1_440px]">{detail}</div>
    </div>
  );

  const dist = docs.find((d) => d.id === distDoc);
  const distribution = (
    <Panel
      title="Distribusi dan tanda terima baca"
      sub="Hanya versi terbit yang tampil ke unit"
      actions={
        <SelectField
          label="Dokumen"
          value={distDoc}
          onChange={setDistDoc}
          options={published.map((d) => [d.id, `${d.code} v${d.version}`])}
        />
      }
      flush
    >
      {dist ? (
        <TableWrap label="Tanda terima baca per unit">
          <thead>
            <tr>
              <th className={TH}>Unit</th>
              <th className={`${TH} text-right`}>Sudah baca</th>
              <th className={`${TH} text-right`}>Persentase</th>
              <th className={TH}>
                <span className="sr-only">Aksi</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {units.map((u) => {
              const n = reads[dist.id]?.[u.unit] ?? 0;
              const p = pct(n, u.staff) ?? 0;
              const key = `${dist.id}-${u.unit}`;
              return (
                <tr key={u.unit}>
                  <td className={TD}>{u.unit}</td>
                  <td className={`${TD} text-right font-mono`}>
                    {n}/{u.staff}
                  </td>
                  <td className={`${TD} text-right`}>
                    <Chip tone={p === 100 ? 'success' : p >= 80 ? 'warning' : 'danger'}>{p}%</Chip>
                  </td>
                  <td className={TD}>
                    {p < 100 &&
                      (reminded[key] ? (
                        <span className="text-caption text-ink-500">Pengingat terkirim {reminded[key]}</span>
                      ) : (
                        <Button
                          size="sm"
                          onClick={() => {
                            setReminded((cur) => ({ ...cur, [key]: at() }));
                            setFlash({
                              ok: true,
                              text: `Pengingat baca ${dist.code} dikirim ke ${u.staff - n} staf ${u.unit} · ${at()}.`,
                            });
                          }}
                        >
                          Kirim pengingat<span className="sr-only"> ke {u.unit}</span>
                        </Button>
                      ))}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </TableWrap>
      ) : (
        <p className="m-0 px-4 py-5 text-small text-ink-500">Belum ada dokumen terbit.</p>
      )}
    </Panel>
  );

  const evidenceBlock = !chapter
    ? 'Pilih bab.'
    : !evDoc
      ? 'Pilih dokumen terbit sebagai bukti.'
      : (evidence[chapter] ?? 0) >= (chapters.find((c) => c.code === chapter)?.elements ?? 0)
        ? 'Semua elemen bab ini sudah berbukti.'
        : null;
  const accreditation = (
    <div className="flex flex-wrap items-start gap-4">
      <div className="min-w-0 flex-[999_1_460px]">
        <Panel title="Paket bukti akreditasi" sub="Elemen penilaian yang sudah ditautkan bukti dokumen" flush>
          <TableWrap label="Kelengkapan bukti per bab">
            <thead>
              <tr>
                <th className={TH}>Bab</th>
                <th className={`${TH} text-right`}>Berbukti</th>
                <th className={`${TH} text-right`}>Kelengkapan</th>
              </tr>
            </thead>
            <tbody>
              {chapters.map((c) => {
                const n = evidence[c.code] ?? 0;
                const p = pct(n, c.elements) ?? 0;
                return (
                  <tr key={c.code}>
                    <td className={TD}>
                      <span className="block font-semibold">{c.code}</span>
                      <span className="block text-caption text-ink-500">{c.label}</span>
                    </td>
                    <td className={`${TD} text-right font-mono`}>
                      {n}/{c.elements}
                    </td>
                    <td className={`${TD} text-right`}>
                      <Chip tone={p === 100 ? 'success' : p >= 85 ? 'warning' : 'danger'}>{p}%</Chip>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </TableWrap>
        </Panel>
      </div>
      <div className="min-w-0 flex-[1_1_300px] xl:max-w-[400px]">
        <Panel title="Tautkan bukti">
          <SelectField
            label="Bab"
            value={chapter}
            onChange={setChapter}
            placeholder="Pilih bab…"
            options={chapters.map((c) => [c.code, `${c.code} · ${c.label}`])}
          />
          <SelectField
            label="Dokumen terbit"
            value={evDoc}
            onChange={setEvDoc}
            placeholder="Pilih dokumen…"
            options={published.map((d) => [d.id, `${d.code} v${d.version} · ${d.title}`])}
          />
          <ReasonButton
            reason={evidenceBlock}
            onClick={() => {
              const d = docs.find((x) => x.id === evDoc);
              setEvidence((cur) => ({ ...cur, [chapter]: (cur[chapter] ?? 0) + 1 }));
              setFlash({ ok: true, text: `${d?.code ?? ''} ditautkan sebagai bukti ${chapter} · ${at()}.` });
              setEvDoc('');
            }}
          >
            Tautkan sebagai bukti
          </ReasonButton>
        </Panel>
      </div>
    </div>
  );

  return (
    <div className="flex flex-col gap-4">
      <FlashLine flash={flash} />
      <Tabs
        label="Dokumen regulasi dan akreditasi"
        value={tab}
        onChange={setTab}
        keepMounted
        panelClassName="pt-4 outline-none"
        items={[
          { id: 'dokumen', label: 'Dokumen & versi', content: documents },
          { id: 'distribusi', label: 'Distribusi & baca', content: distribution },
          { id: 'akreditasi', label: 'Bukti akreditasi', content: accreditation },
        ]}
      />
    </div>
  );
}
