'use client';

import { formatTanggalWaktu } from '@simrs/shared';
import { Alert, Button, Chip, type ChipTone, Tabs } from '@simrs/ui';
import { useState } from 'react';
import {
  ConfirmBox,
  FlashLine,
  KeyValues,
  Panel,
  PickRow,
  ReasonButton,
  TableWrap,
  TD,
  TextField,
  TH,
} from '@/components/backoffice/kit';
import { useTokoAction } from '@/components/backoffice/use-toko';
import { demoStamp } from '@/lib/backoffice-toko';
import type { AmsRequest, GyssensCase } from '@/lib/demo/fixtures/ppra';
import {
  appropriateRate,
  approvalHoursLeft,
  decisionBlock,
  GYSSENS_LABEL,
  GYSSENS_STEPS,
  gyssensResult,
  orderHold,
  type Restriction,
  RESTRICTION_LABEL,
} from '@/lib/ppra';
import { MIN_MODULE_REASON, PPRA_TEAM_ROLES, type PpraStoreState } from '@/lib/ppra-toko';

const R_TONE: Record<Restriction, ChipTone> = { bebas: 'success', pengawasan: 'warning', cadangan: 'danger' };

/**
 * B08 · PPRA: antrean persetujuan antibiotik cadangan dari CPOE (kedaluwarsa 24 jam, putusan beralasan oleh tim
 * PPRA = posisi Apoteker/Dokter, bukan penulis resep), audit Gyssens berurutan, dan katalog restriksi. Modul bisa
 * dimatikan per RS: order tidak lagi ditahan dan layar menjadi baca saja. Tersimpan di toko demo (domain `ppra`).
 */
export function PpraBoard({
  requests,
  restrictions,
  pending: cases,
  state,
  rev,
  viewer,
  now,
}: {
  requests: readonly AmsRequest[];
  restrictions: ReadonlyArray<{ drug: string; restriction: Restriction }>;
  pending: readonly GyssensCase[];
  state: PpraStoreState;
  rev: number;
  viewer: { name: string; role: string | null };
  now: string;
}) {
  const moduleOn = state.moduleOn;
  const decisions = state.decisions;
  const answers = state.answers;
  const results = state.results;
  const [askToggle, setAskToggle] = useState(false);
  const [tab, setTab] = useState('persetujuan');
  const [sel, setSel] = useState(requests[0]?.id ?? '');
  const [kind, setKind] = useState<'setuju' | 'tolak' | null>(null);
  const [reason, setReason] = useState('');
  const [alternative, setAlternative] = useState('');
  const { act, pending, flash } = useTokoAction('ppra', rev);
  const teamRole = !!viewer.role && (PPRA_TEAM_ROLES as readonly string[]).includes(viewer.role);

  const r = requests.find((x) => x.id === sel);
  const left = r ? approvalHoursLeft(r.requestedAt, now) : 0;
  const d = r ? decisions[r.id] : undefined;
  const expired = !d && left < 0;
  const block = pending
    ? 'Menyimpan…'
    : !teamRole
      ? 'Putusan diambil tim PPRA (posisi Apoteker atau Dokter).'
      : r && viewer.name === r.prescriber
        ? 'Anda penulis resep ini: putusan oleh anggota tim PPRA lain (pemisahan tugas).'
        : kind
          ? decisionBlock(kind, reason, alternative)
          : null;
  const restrictionOf = (drug: string) => restrictions.find((x) => x.drug === drug)?.restriction ?? 'bebas';

  const decide = () => {
    if (!r || !kind || block) return;
    const { jam } = demoStamp();
    act(
      { type: 'putusan.dicatat', id: r.id, kind, reason: reason.trim(), alternative: alternative.trim(), jam },
      kind === 'setuju'
        ? `${r.number} ${r.drug} disetujui · ${jam}; order dilepas ke farmasi, evaluasi ulang 72 jam.`
        : `${r.number} ${r.drug} ditolak · ${jam}; DPJP diberi tahu dengan saran ${alternative.trim()}.`,
      () => {
        setKind(null);
        setReason('');
        setAlternative('');
      },
    );
  };

  const approvals = (
    <div className="flex flex-wrap items-start gap-4">
      <div className="min-w-0 flex-[1_1_300px] xl:max-w-[400px]">
        <Panel title="Menunggu persetujuan" sub="Order antibiotik cadangan dari CPOE" flush>
          {requests.map((x) => {
            const dx = decisions[x.id];
            const h = approvalHoursLeft(x.requestedAt, now);
            return (
              <PickRow
                key={x.id}
                selected={x.id === sel}
                onClick={() => {
                  setSel(x.id);
                  setKind(null);
                }}
                title={`${x.number} · ${x.drug}`}
                sub={`RM ${x.rm} · ${x.unit}`}
                right={
                  dx ? (
                    <Chip tone={dx.kind === 'setuju' ? 'success' : 'danger'}>
                      {dx.kind === 'setuju' ? 'Disetujui' : 'Ditolak'}
                    </Chip>
                  ) : h < 0 ? (
                    <Chip tone="neutral">Kedaluwarsa</Chip>
                  ) : (
                    <Chip tone={h <= 4 ? 'danger' : 'warning'}>sisa {h} jam</Chip>
                  )
                }
              />
            );
          })}
        </Panel>
      </div>
      <div className="min-w-0 flex-[999_1_460px]">
        {r ? (
          <Panel
            title={`${r.number} · ${r.drug} ${r.regimen}`}
            sub={`Diminta ${formatTanggalWaktu(r.requestedAt)} oleh ${r.prescriber}`}
          >
            <KeyValues
              rows={[
                ['Pasien', `RM ${r.rm} · ${r.unit}`],
                ['Klinis', r.clinical],
                ['Mikrobiologi', r.culture],
                ['Restriksi', RESTRICTION_LABEL[restrictionOf(r.drug)]],
              ]}
            />
            <hr className="m-0 border-0 border-t border-line" />
            {d ? (
              <Alert
                level={d.kind === 'setuju' ? 'success' : 'warning'}
                title={`${d.kind === 'setuju' ? 'Disetujui' : 'Ditolak'} · ${d.jam} oleh ${d.by.name}`}
              >
                {d.reason}
                {d.kind === 'tolak' && ` Saran: ${d.alternative}.`}
              </Alert>
            ) : expired ? (
              <Alert level="info" title="Kedaluwarsa">
                Tidak diputus dalam 24 jam: order dibatalkan otomatis dan DPJP diminta mengajukan ulang bila
                masih perlu.
              </Alert>
            ) : !moduleOn ? (
              <p className="m-0 text-small text-ink-500">Modul PPRA tidak aktif; putusan tidak diperlukan.</p>
            ) : kind ? (
              <div className="flex flex-col gap-3">
                <TextField
                  label="Pertimbangan klinis tim PPRA"
                  rows={2}
                  value={reason}
                  onChange={setReason}
                />
                {kind === 'tolak' && (
                  <TextField
                    label="Antibiotik alternatif yang disarankan"
                    value={alternative}
                    onChange={setAlternative}
                  />
                )}
                <span className="flex flex-wrap items-start gap-2">
                  <ReasonButton
                    reason={block}
                    variant={kind === 'tolak' ? 'danger' : 'primary'}
                    onClick={decide}
                  >
                    {kind === 'setuju' ? 'Simpan persetujuan' : 'Simpan penolakan'}
                  </ReasonButton>
                  <Button variant="ghost" disabled={pending} onClick={() => setKind(null)}>
                    Batal
                  </Button>
                </span>
              </div>
            ) : (
              <span className="flex flex-wrap gap-2">
                <Button variant="primary" onClick={() => setKind('setuju')}>
                  Setujui…
                </Button>
                <Button onClick={() => setKind('tolak')}>Tolak…</Button>
                <Chip tone={left <= 4 ? 'danger' : 'warning'}>kedaluwarsa dalam {left} jam</Chip>
              </span>
            )}
          </Panel>
        ) : (
          <Panel title="Permintaan">
            <p className="m-0 text-small text-ink-500">Tidak ada order yang menunggu persetujuan.</p>
          </Panel>
        )}
      </div>
    </div>
  );

  const audit = (
    <div className="flex flex-wrap items-start gap-4">
      <div className="flex min-w-0 flex-[999_1_460px] flex-col gap-4">
        {cases.map((c) => {
          const a = answers[c.id] ?? [];
          const res = gyssensResult(a);
          return (
            <Panel key={c.id} title={`Audit Gyssens · RM ${c.rm}`} sub={c.drug}>
              <p className="m-0 text-small text-ink-700">{c.summary}</p>
              {res.done ? (
                <Alert
                  level={res.category === '0' ? 'success' : 'warning'}
                  title={`Kategori ${res.category}`}
                >
                  {GYSSENS_LABEL[res.category]}. Diaudit {state.auditors[c.id] ?? '—'}; umpan balik dikirim ke DPJP.
                </Alert>
              ) : (
                <div className="flex flex-col gap-2">
                  <span className="text-caption text-ink-500">
                    Pertanyaan {res.next + 1} dari {GYSSENS_STEPS.length} (berhenti pada jawaban "Ya" pertama)
                  </span>
                  <span className="text-small font-semibold">{GYSSENS_STEPS[res.next]?.question}</span>
                  <span className="flex gap-2">
                    {[true, false].map((v) => (
                      <Button
                        key={String(v)}
                        variant={v ? 'secondary' : 'primary'}
                        disabled={!moduleOn || !teamRole || pending}
                        onClick={() => {
                          const out = gyssensResult([...a, v]);
                          const { jam } = demoStamp();
                          act(
                            { type: 'gyssens.dijawab', caseId: c.id, answer: v, jam },
                            out.done
                              ? `Audit RM ${c.rm}: kategori ${out.category} (${GYSSENS_LABEL[out.category]}) · ${jam}.`
                              : null,
                          );
                        }}
                      >
                        {v ? 'Ya' : 'Tidak'}
                        <span className="sr-only"> untuk RM {c.rm}</span>
                      </Button>
                    ))}
                  </span>
                </div>
              )}
            </Panel>
          );
        })}
      </div>
      <div className="min-w-0 flex-[1_1_300px] xl:max-w-[380px]">
        <Panel title="Hasil audit bulan ini" sub={`${results.length} kasus dinilai`}>
          <span className="text-kpi font-bold">{appropriateRate(results)}%</span>
          <span className="text-caption text-ink-500">penggunaan tepat (kategori 0)</span>
          <ul className="m-0 flex list-none flex-col gap-1 p-0 text-small">
            {Object.entries(
              results.reduce<Record<string, number>>((m, c) => ({ ...m, [c]: (m[c] ?? 0) + 1 }), {}),
            ).map(([c, n]) => (
              <li key={c} className="flex justify-between gap-2">
                <span>
                  {c} · {GYSSENS_LABEL[c]}
                </span>
                <span className="font-mono">{n}</span>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    </div>
  );

  const catalog = (
    <Panel title="Katalog restriksi antibiotik" sub="Contoh kebijakan RS · ditegakkan di CPOE" flush>
      <TableWrap label="Restriksi antibiotik">
        <thead>
          <tr>
            <th className={TH}>Antibiotik</th>
            <th className={TH}>Restriksi</th>
            <th className={TH}>Order di CPOE</th>
          </tr>
        </thead>
        <tbody>
          {restrictions.map((x) => (
            <tr key={x.drug}>
              <td className={TD}>{x.drug}</td>
              <td className={TD}>
                <Chip tone={R_TONE[x.restriction]}>{RESTRICTION_LABEL[x.restriction]}</Chip>
              </td>
              <td className={TD}>
                {orderHold(x.restriction, moduleOn) === 'ditahan'
                  ? 'Ditahan menunggu PPRA'
                  : 'Langsung ke farmasi'}
              </td>
            </tr>
          ))}
        </tbody>
      </TableWrap>
    </Panel>
  );

  return (
    <div className="flex flex-col gap-4">
      <FlashLine flash={flash} />
      <Panel
        title="Modul PPRA untuk RS ini"
        sub="Pengaturan per RS (modul tersier); perubahan tercatat di jejak audit"
        tone={moduleOn ? undefined : 'warning'}
        actions={
          <>
            <Chip tone={moduleOn ? 'success' : 'neutral'}>{moduleOn ? 'Aktif' : 'Tidak aktif'}</Chip>
            {!askToggle && (
              <Button disabled={pending} onClick={() => setAskToggle(true)}>
                {moduleOn ? 'Matikan modul…' : 'Aktifkan modul…'}
              </Button>
            )}
          </>
        }
      >
        {moduleOn && (
          <p className="m-0 text-small text-ink-700">
            Order antibiotik cadangan ditahan di CPOE sampai diputus tim PPRA (batas 24 jam); audit Gyssens
            aktif.
          </p>
        )}
        {!moduleOn && (
          <Alert level="warning" title="Modul PPRA tidak aktif">
            Order antibiotik cadangan tidak ditahan di CPOE; persetujuan dan audit Gyssens hanya bisa dibaca.
          </Alert>
        )}
        {askToggle && (
          <ConfirmBox
            title={moduleOn ? 'Matikan modul PPRA untuk RS ini?' : 'Aktifkan modul PPRA untuk RS ini?'}
            confirmLabel={moduleOn ? 'Matikan' : 'Aktifkan'}
            minReason={MIN_MODULE_REASON}
            danger={moduleOn}
            onCancel={() => setAskToggle(false)}
            onConfirm={(why) => {
              const { jam } = demoStamp();
              act(
                { type: 'modul.diubah', on: !moduleOn, reason: why, jam },
                `Modul PPRA ${moduleOn ? 'dimatikan' : 'diaktifkan'} · ${jam} · alasan: ${why}.`,
                () => setAskToggle(false),
              );
            }}
          >
            {moduleOn
              ? 'Order antibiotik cadangan akan langsung ke farmasi tanpa persetujuan tim PPRA.'
              : 'Order antibiotik cadangan kembali ditahan menunggu persetujuan tim PPRA.'}
          </ConfirmBox>
        )}
      </Panel>
      <Tabs
        label="PPRA"
        value={tab}
        onChange={setTab}
        keepMounted
        panelClassName="pt-4 outline-none"
        items={[
          {
            id: 'persetujuan',
            label: 'Persetujuan antibiotik',
            badge: String(
              requests.filter((x) => !decisions[x.id] && approvalHoursLeft(x.requestedAt, now) >= 0).length,
            ),
            badgeTone: 'danger',
            content: approvals,
          },
          { id: 'gyssens', label: 'Audit Gyssens', content: audit },
          { id: 'katalog', label: 'Katalog restriksi', content: catalog },
        ]}
      />
    </div>
  );
}
