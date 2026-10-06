'use client';

import { formatTanggalWaktu } from '@simrs/shared';
import { Alert, Chip } from '@simrs/ui';
import { FlashLine, Panel, ReasonButton, StageTrack, TableWrap, TD, TH } from '@/components/backoffice/kit';
import { useTokoAction } from '@/components/backoffice/use-toko';
import { demoStamp } from '@/lib/backoffice-toko';
import {
  DESTRUCTION_ACTIONS,
  DESTRUCTION_STAGES,
  destructionStepBlock,
  ELECTRONIC_DESTRUCTION_BLOCK,
  inactiveYears,
  RETENTION_YEARS,
  type RetentionBatch,
  retentionCandidates,
} from '@/lib/rekam-medis-adm';
import {
  DESTRUCTION_DIRECTOR_ROLES,
  DESTRUCTION_PROPOSER_ROLES,
  type DestructionStep,
} from '@/lib/rekam-medis-adm-toko';

const fmt = (n: number) => new Intl.NumberFormat('id-ID').format(n);
const BA_NUMBER = 'BAP-2026-003';
const ROLE_TEXT = [
  '',
  'komite RM (Petugas rekam medis/Manajemen)',
  'direktur (Manajemen)',
  'direktur (Manajemen)',
  'petugas RM pelaksana',
];

/**
 * B09 · Retensi dan pemusnahan berjejak: kandidat dihitung sistem (inaktif > masa retensi, tanpa legal hold,
 * lembar simpan permanen dipisahkan) → usul komite RM → setuju direktur (pengguna lain dari pengusul) → berita acara
 * ber-TTE → catat pemusnahan fisik. Urutan tidak bisa dilompati; tiap tahap oleh pengguna sesi dengan posisi berhak;
 * pemusnahan elektronik ditolak. Tersimpan di toko demo (domain `rekam-medis-adm`).
 */
export function RetentionTab({
  batches,
  today,
  computedAt,
  actors,
  stage,
  steps,
  rev,
  viewerId,
  viewerRole,
}: {
  batches: readonly RetentionBatch[];
  today: string;
  computedAt: string;
  actors: { committee: string; director: string; witness: string };
  stage: number;
  steps: readonly DestructionStep[];
  rev: number;
  viewerId: string;
  viewerRole: string | null;
}) {
  const candidates = retentionCandidates(batches, today);
  const candidateIds = new Set(candidates.map((c) => c.id));
  const { act, pending, flash } = useTokoAction('rekam-medis-adm', rev);
  const totalFiles = candidates.reduce((n, c) => n + c.eligibleFiles, 0);
  const totalPermanent = candidates.reduce((n, c) => n + c.permanentSheets, 0);
  const totalHold = candidates.reduce((n, c) => n + c.legalHoldFiles, 0);
  const target = stage + 1;
  const roles: readonly string[] =
    target === 1
      ? DESTRUCTION_PROPOSER_ROLES
      : target === 2 || target === 3
        ? DESTRUCTION_DIRECTOR_ROLES
        : [];
  const block = pending
    ? 'Menyimpan…'
    : (destructionStepBlock(stage, target) ??
      (roles.length > 0 && !(viewerRole && roles.includes(viewerRole))
        ? `Tahap ini dijalankan ${ROLE_TEXT[target]}.`
        : target === 2 && steps[1]?.userId === viewerId
          ? 'Anda pengusul: penyetuju harus pengguna lain (pemisahan tugas).'
          : null));
  const signer = steps[3]?.who ?? actors.director;

  const next = () => {
    if (block) return;
    const { jam, when } = demoStamp();
    act(
      { type: 'pemusnahan.maju', target, when },
      target === 4
        ? `Pemusnahan ${fmt(totalFiles)} berkas fisik tercatat dengan berita acara ${BA_NUMBER} · ${jam}. Metadata pemusnahan disimpan permanen.`
        : `${DESTRUCTION_STAGES[target]} · ${jam}.`,
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <FlashLine flash={flash} />
      <div className="flex flex-wrap items-start gap-4">
        <div className="flex min-w-0 flex-[999_1_520px] flex-col gap-4">
          <Panel
            title="Kandidat pemusnahan berkas fisik"
            sub={`Inaktif > ${RETENTION_YEARS['rawat-jalan']} tahun sejak kunjungan terakhir · dihitung ${formatTanggalWaktu(computedAt)}`}
            flush
          >
            <TableWrap label="Kelompok berkas dan status retensi">
              <thead>
                <tr>
                  <th className={TH}>Kelompok berkas</th>
                  <th className={`${TH} text-right`}>Berkas</th>
                  <th className={`${TH} text-right`}>Inaktif</th>
                  <th className={TH}>Status</th>
                </tr>
              </thead>
              <tbody>
                {batches.map((b) => {
                  const cand = candidateIds.has(b.id);
                  return (
                    <tr key={b.id}>
                      <td className={TD}>
                        <span className="block font-semibold">{b.label}</span>
                        {b.legalHoldFiles > 0 && (
                          <span className="block text-caption text-ink-500">
                            {b.legalHoldFiles} berkas legal hold dikeluarkan
                          </span>
                        )}
                      </td>
                      <td className={`${TD} text-right font-mono`}>
                        {fmt(b.files - (cand ? b.legalHoldFiles : 0))}
                      </td>
                      <td className={`${TD} text-right font-mono`}>{inactiveYears(b.lastVisit, today)} th</td>
                      <td className={TD}>
                        {!cand ? (
                          <Chip tone="neutral">Belum masa retensi</Chip>
                        ) : stage >= 4 ? (
                          <Chip tone="success">Dimusnahkan</Chip>
                        ) : (
                          <Chip tone="warning">Kandidat</Chip>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </TableWrap>
          </Panel>
          <Alert level="info" title="Dikecualikan otomatis">
            {fmt(totalPermanent)} lembar simpan permanen (resume, persetujuan tindakan, identitas, laporan
            operasi) dipisahkan dari kandidat. {totalHold} berkas berstatus legal hold tidak ikut dihitung.
          </Alert>
          <Panel title="Data rekam medis elektronik" sub="Kebijakan masa simpan 25 tahun">
            <ReasonButton reason={ELECTRONIC_DESTRUCTION_BLOCK} variant="danger" onClick={() => undefined}>
              Musnahkan data elektronik
            </ReasonButton>
          </Panel>
        </div>
        <div className="min-w-0 flex-[1_1_340px] xl:max-w-[440px]">
          <Panel
            title={`Usulan pemusnahan · ${fmt(totalFiles)} berkas`}
            sub="Urutan persetujuan tidak bisa dilompati"
            tone={stage >= 4 ? 'success' : undefined}
          >
            <StageTrack
              label="Tahap pemusnahan"
              stages={DESTRUCTION_STAGES.map((label, i) => ({
                label,
                at: steps[i] ? formatTanggalWaktu(steps[i].when) : null,
              }))}
              current={stage >= 4 ? DESTRUCTION_STAGES.length : stage + 1}
            />
            <ol aria-label="Jejak persetujuan" className="m-0 flex list-none flex-col gap-1.5 p-0 text-small">
              {steps.map((l, i) => (
                <li key={`${i}-${l.when}`} className="flex flex-col border-l-2 border-brand-600 pl-2.5">
                  <span className="font-semibold">{DESTRUCTION_STAGES[i]}</span>
                  <span className="text-caption text-ink-500">
                    {l.who} · {formatTanggalWaktu(l.when)}
                  </span>
                </li>
              ))}
            </ol>
            {stage >= 3 && (
              <Alert level="success" title={`Berita acara ${BA_NUMBER}`}>
                Metode pencacahan oleh vendor bersertifikat · saksi komite RM dan {actors.witness} ·
                ditandatangani elektronik {signer}.
              </Alert>
            )}
            {stage < 4 && (
              <ReasonButton reason={block} onClick={next}>
                {DESTRUCTION_ACTIONS[stage]}
              </ReasonButton>
            )}
            {stage < 4 && (
              <span className="text-caption text-ink-500">
                Berikutnya dijalankan oleh: {ROLE_TEXT[target]}
              </span>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}
