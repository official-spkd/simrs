'use client';

import { formatTanggal } from '@simrs/shared';
import { Alert, Button, Chip, type ChipTone, Tabs } from '@simrs/ui';
import { useState } from 'react';
import {
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
import { useTokoAction } from '@/components/backoffice/use-toko';
import { demoStamp } from '@/lib/backoffice-toko';
import { DOC_FLOW, DOC_STATUS_LABEL, type DocStatus, pct, reviewStatus } from '@/lib/dokumen';
import {
  DOC_APPROVER_ROLES,
  isAuthor,
  MIN_REVIEW_NOTE,
  type RegDocsStoreState,
  remindKey,
} from '@/lib/dokumen-toko';

const S_TONE: Record<DocStatus, ChipTone> = {
  draf: 'neutral',
  telaah: 'info',
  disetujui: 'brand',
  terbit: 'success',
  usang: 'danger',
};

/**
 * B12 · DMS berversi + distribusi baca + paket bukti akreditasi. Hanya versi terbit yang tampil ke unit; versi lama
 * usang tetap tersimpan bertanda "TIDAK BERLAKU". Penyetuju = pengguna sesi (Auditor mutu/Manajemen) yang bukan
 * penyusun; versi baru disusun pengguna yang memulainya. Tersimpan di toko demo (domain `regulasi`, ADR-0085).
 */
export function DocumentBoard({
  state,
  rev,
  viewer,
  units,
  chapters,
  today,
}: {
  state: RegDocsStoreState;
  rev: number;
  viewer: { userId: string; name: string; role: string | null };
  units: ReadonlyArray<{ unit: string; staff: number }>;
  chapters: ReadonlyArray<{ code: string; label: string; elements: number; withEvidence: number }>;
  today: string;
}) {
  const docs = state.docs;
  const reads = state.reads;
  const evidence = state.evidence;
  const [tab, setTab] = useState('dokumen');
  const [sel, setSel] = useState(docs.find((d) => d.status === 'draf')?.id ?? docs[0]?.id ?? '');
  const [note, setNote] = useState('');
  const [distPick, setDistDoc] = useState('');
  const [chapter, setChapter] = useState('');
  const [evDoc, setEvDoc] = useState('');
  const { act, pending, flash } = useTokoAction('regulasi', rev);
  const at = () => demoStamp().jam;

  const doc = docs.find((d) => d.id === sel);
  const published = docs.filter((d) => d.status === 'terbit');
  const distDoc = published.some((d) => d.id === distPick) ? distPick : (published[0]?.id ?? '');
  const canApproveRole = !!viewer.role && (DOC_APPROVER_ROLES as readonly string[]).includes(viewer.role);

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
            ...(doc.approval
              ? ([
                  ['Disetujui', `${doc.approval.by.name} · ${doc.approval.jam} · ${doc.approval.note}`],
                ] as const)
              : []),
            ['Terbit', doc.publishedAt ? formatTanggal(doc.publishedAt) : 'belum'],
            ['Tinjau ulang', doc.reviewDue ? formatTanggal(doc.reviewDue) : '—'],
          ]}
        />
        <hr className="m-0 border-0 border-t border-line" />
        {doc.status === 'draf' && (
          <span>
            <Button
              variant="primary"
              disabled={pending}
              onClick={() =>
                act(
                  { type: 'dokumen.ditelaah', id: doc.id, jam: at() },
                  `${doc.code} v${doc.version} dikirim ke telaah · ${at()}.`,
                )
              }
            >
              Kirim ke telaah
            </Button>
          </span>
        )}
        {doc.status === 'telaah' && (
          <div className="flex flex-col gap-3">
            <TextField label="Catatan telaah" rows={2} value={note} onChange={setNote} />
            <span className="text-small text-ink-700">
              Penyusun: {doc.author}. Penyetuju = pengguna yang masuk (posisi Auditor mutu atau Manajemen),
              wajib orang lain.
            </span>
            <ReasonButton
              reason={
                pending
                  ? 'Menyimpan…'
                  : !canApproveRole
                    ? 'Penyetuju dokumen: posisi Auditor mutu atau Manajemen.'
                    : isAuthor(doc, viewer)
                      ? 'Anda penyusun dokumen ini: penyetuju harus pengguna lain (pemisahan tugas).'
                      : note.trim().length < MIN_REVIEW_NOTE
                        ? `Tulis catatan telaah minimal ${MIN_REVIEW_NOTE} huruf.`
                        : null
              }
              onClick={() =>
                act(
                  { type: 'dokumen.disetujui', id: doc.id, note: note.trim(), jam: at() },
                  `${doc.code} v${doc.version} disetujui ${viewer.name} · ${at()}.`,
                  () => setNote(''),
                )
              }
            >
              Setujui dokumen
            </ReasonButton>
          </div>
        )}
        {doc.status === 'disetujui' && (
          <span>
            <Button
              variant="primary"
              disabled={pending}
              onClick={() => {
                const old = docs.find((d) => d.code === doc.code && d.status === 'terbit');
                act(
                  { type: 'dokumen.diterbitkan', id: doc.id, jam: at() },
                  `${doc.code} v${doc.version} terbit · ${at()}; didistribusikan ke ${units.length} unit${old ? `, v${old.version} tidak berlaku (bertanda air)` : ''}.`,
                  () => setDistDoc(doc.id),
                );
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
                    disabled={pending}
                    onClick={() => {
                      const id = `${doc.id}-r${doc.version + 1}`;
                      act(
                        { type: 'dokumen.versi-baru', id: doc.id, jam: at() },
                        `Draf ${doc.code} v${doc.version + 1} dibuat untuk tinjau ulang oleh ${viewer.name} · ${at()}.`,
                        () => setSel(id),
                      );
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
              const key = remindKey(dist.id, u.unit);
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
                      (state.reminded[key] ? (
                        <span className="text-caption text-ink-500">
                          Pengingat terkirim {state.reminded[key].jam} oleh {state.reminded[key].by}
                        </span>
                      ) : (
                        <Button
                          size="sm"
                          disabled={pending}
                          onClick={() =>
                            act(
                              { type: 'baca.diingatkan', docId: dist.id, unit: u.unit, jam: at() },
                              `Pengingat baca ${dist.code} dikirim ke ${u.staff - n} staf ${u.unit} · ${at()}.`,
                            )
                          }
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

  const evidenceBlock = pending
    ? 'Menyimpan…'
    : !chapter
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
              act(
                { type: 'bukti.ditautkan', chapter, docId: evDoc, jam: at() },
                `${d?.code ?? ''} ditautkan sebagai bukti ${chapter} · ${at()}.`,
                () => setEvDoc(''),
              );
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
