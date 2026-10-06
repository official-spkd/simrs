'use client';

import { formatTanggal, formatTanggalWaktu } from '@simrs/shared';
import { Alert, Chip, type ChipTone } from '@simrs/ui';
import { useState } from 'react';
import {
  CheckField,
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
import type { PrivilegeApplication } from '@/lib/demo/fixtures/kredensial';
import type { Employee } from '@/lib/demo/fixtures/pegawai';
import {
  CRED_STAGES,
  credentialVerifyBlock,
  DECISION_LABEL,
  orderGuard,
  type OrderGuardResult,
  type PrivilegeDecision,
  reviewBlock,
} from '@/lib/kredensial';
import {
  COMMITTEE_ROLES,
  type CredentialStoreState,
  DIRECTOR_ROLES,
  licensesOf,
  REVIEW_ROLES,
} from '@/lib/kredensial-toko';
import { licenseStatus, licenseText, type LicenseStatus, worstLicense } from '@/lib/sdm';

const TONE: Record<LicenseStatus, ChipTone> = { aktif: 'success', segera: 'warning', kedaluwarsa: 'danger' };

/**
 * B04 · Pengajuan kewenangan klinis sampai RKK terbit, daftar RKK berlaku (≤ 60 hari ditandai), dan uji kait CPOE
 * yang memblokir order tanpa kewenangan atau dengan SIP kedaluwarsa. Langkah telaah/komite oleh posisi Dokter
 * (rapat komite oleh pengguna lain dari penelaah), RKK oleh posisi Manajemen; izin praktik dari SDM. Tersimpan di toko
 * demo (domain `kredensial`, ADR-0085).
 */
export function CredentialBoard({
  applications,
  employees,
  store,
  rev,
  viewer,
  today,
}: {
  applications: readonly PrivilegeApplication[];
  employees: readonly Employee[];
  store: CredentialStoreState;
  rev: number;
  viewer: { userId: string; name: string; role: string | null };
  today: string;
}) {
  const [sel, setSel] = useState(applications[0]?.id ?? '');
  const [docDraft, setDocDraft] = useState<Record<string, boolean[]>>({});
  const [decDraft, setDecDraft] = useState<Record<string, Record<string, PrivilegeDecision | undefined>>>({});
  const [noteDraft, setNoteDraft] = useState<Record<string, string>>({});
  const { act, pending, flash } = useTokoAction('kredensial', rev);
  const [testWho, setTestWho] = useState('');
  const [testItem, setTestItem] = useState('');
  const [testResult, setTestResult] = useState<OrderGuardResult | null>(null);
  const granted = store.granted;
  const has = (roles: readonly string[]) => !!viewer.role && roles.includes(viewer.role);

  const empByName = new Map(employees.map((e) => [e.name, e]));
  const a = applications.find((x) => x.id === sel);
  const p = a ? store.apps[a.id] : undefined;
  const s =
    a && p
      ? {
          ...p,
          docs: docDraft[a.id] ?? p.docs,
          decisions: p.stage > 1 ? p.decisions : { ...p.decisions, ...(decDraft[a.id] ?? {}) },
          note: p.stage > 1 ? p.note : (noteDraft[a.id] ?? ''),
        }
      : undefined;
  const stamp = (i: number) => {
    const at = s?.at[i as 1 | 2 | 3 | 4];
    const who = s?.by[i as 1 | 2 | 3 | 4];
    return at ? `${formatTanggalWaktu(at)}${who ? ` · ${who.name}` : ''}` : null;
  };
  const advance = (event: Parameters<typeof act>[0], text: string) => {
    if (!a) return;
    act(event, `${a.number}: ${text} · ${demoStamp().jam}.`);
  };

  const practitioners = [
    ...new Set([...granted.map((g) => g.practitioner), ...applications.map((x) => x.practitioner)]),
  ];
  const items = [...new Set([...granted.map((g) => g.item), ...applications.flatMap((x) => x.items)])];

  let detail = (
    <Panel title="Pengajuan kewenangan">
      <p className="m-0 text-small text-ink-500">Pilih pengajuan di daftar kiri.</p>
    </Panel>
  );
  if (a && s) {
    const emp = empByName.get(a.practitioner);
    const licenses = licensesOf(store, a.practitioner);
    const w = worstLicense(licenses, today);
    const docs = a.documents.map((d, i) => ({ label: d.label, ok: s.docs[i] ?? false }));
    const verify = pending ? 'Menyimpan…' : credentialVerifyBlock(licenses, today, docs);
    const review = pending
      ? 'Menyimpan…'
      : !has(REVIEW_ROLES)
        ? 'Telaah oleh mitra bestari (posisi Dokter).'
        : viewer.name === a.practitioner
          ? 'Praktisi tidak bisa menelaah pengajuannya sendiri.'
          : reviewBlock(a.items, s.decisions, s.note);
    const committee = pending
      ? 'Menyimpan…'
      : !has(COMMITTEE_ROLES)
        ? `Rekomendasi diputus rapat ${a.committee.toLowerCase()} (posisi Dokter).`
        : viewer.name === a.practitioner
          ? 'Praktisi tidak bisa memutus pengajuannya sendiri.'
          : s.by[2]?.userId === viewer.userId
            ? 'Anda penelaah pengajuan ini: rapat komite diputus pengguna lain (pemisahan tugas).'
            : null;
    const director = pending
      ? 'Menyimpan…'
      : has(DIRECTOR_ROLES)
        ? null
        : 'RKK dan SPK diterbitkan direktur (posisi Manajemen).';
    const grantedItems = a.items.filter((i) => s.decisions[i] && s.decisions[i] !== 'tidak');
    let body;
    if (s.stage === 0) {
      body = (
        <div className="flex flex-col gap-1">
          <span className="text-small font-semibold text-ink-700">
            Verifikasi berkas (sekretariat {a.committee.toLowerCase()})
          </span>
          <span className="flex flex-wrap items-center gap-2 text-small">
            Izin praktik:{' '}
            <Chip tone={TONE[w.status]}>
              {w.license ? `${w.license.kind} ${licenseText(w.status, w.days).toLowerCase()}` : 'berlaku'}
            </Chip>
          </span>
          {a.documents.map((d, i) => (
            <CheckField
              key={d.label}
              label={`${d.label}${d.ok ? '' : ' (susulan)'}`}
              checked={s.docs[i] ?? false}
              onChange={(v) =>
                setDocDraft((cur) => ({ ...cur, [a.id]: s.docs.map((x, j) => (j === i ? v : x)) }))
              }
            />
          ))}
          <ReasonButton
            reason={verify}
            onClick={() =>
              advance(
                { type: 'berkas.diverifikasi', id: a.id, docs: s.docs, when: demoStamp().when },
                `berkas lengkap, diteruskan ke ${a.reviewer}`,
              )
            }
          >
            Berkas lengkap, teruskan ke mitra bestari
          </ReasonButton>
        </div>
      );
    } else if (s.stage === 1) {
      body = (
        <div className="flex flex-col gap-3">
          <span className="text-small font-semibold text-ink-700">Telaah oleh {a.reviewer}</span>
          {a.items.map((i) => (
            <SelectField
              key={i}
              label={i}
              value={s.decisions[i] ?? ''}
              placeholder="Pilih keputusan…"
              onChange={(v) =>
                setDecDraft((cur) => ({
                  ...cur,
                  [a.id]: { ...(cur[a.id] ?? {}), [i]: (v || undefined) as PrivilegeDecision | undefined },
                }))
              }
              options={(Object.keys(DECISION_LABEL) as PrivilegeDecision[]).map((k) => [
                k,
                DECISION_LABEL[k],
              ])}
            />
          ))}
          <TextField
            label="Catatan mitra bestari"
            rows={3}
            value={s.note}
            onChange={(v) => setNoteDraft((cur) => ({ ...cur, [a.id]: v }))}
            hint="Dasar penilaian: logbook, hasil evaluasi praktik, observasi langsung."
          />
          <ReasonButton
            reason={review}
            onClick={() =>
              advance(
                {
                  type: 'telaah.dikirim',
                  id: a.id,
                  decisions: Object.fromEntries(
                    Object.entries(s.decisions).filter((e): e is [string, PrivilegeDecision] => !!e[1]),
                  ),
                  note: s.note.trim(),
                  when: demoStamp().when,
                },
                'hasil telaah dikirim ke rapat komite',
              )
            }
          >
            Kirim hasil telaah ke komite
          </ReasonButton>
        </div>
      );
    } else if (s.stage === 2) {
      body = (
        <div className="flex flex-col gap-3">
          <span className="text-small font-semibold text-ink-700">Rapat {a.committee.toLowerCase()}</span>
          <ul className="m-0 flex list-none flex-col gap-1 p-0 text-small">
            {a.items.map((i) => (
              <li
                key={i}
                className="flex flex-wrap justify-between gap-2 rounded-control border border-line px-3 py-1.5"
              >
                <span>{i}</span>
                <Chip
                  tone={
                    s.decisions[i] === 'tidak'
                      ? 'danger'
                      : s.decisions[i] === 'supervisi'
                        ? 'warning'
                        : 'success'
                  }
                >
                  {DECISION_LABEL[s.decisions[i] ?? 'tidak']}
                </Chip>
              </li>
            ))}
          </ul>
          <ReasonButton
            reason={committee}
            onClick={() =>
              advance(
                { type: 'komite.disetujui', id: a.id, when: demoStamp().when },
                `${a.committee} merekomendasikan ke direktur`,
              )
            }
          >
            Setujui rekomendasi komite
          </ReasonButton>
        </div>
      );
    } else if (s.stage === 3) {
      body = (
        <div className="flex flex-col gap-3">
          <span className="text-small text-ink-700">
            Direktur menerbitkan Rincian Kewenangan Klinis (RKK) dan Surat Penugasan Klinis untuk{' '}
            {grantedItems.length} butir, berlaku 3 tahun.
          </span>
          <ReasonButton
            reason={director}
            onClick={() =>
              advance(
                { type: 'rkk.diterbitkan', id: a.id, when: demoStamp().when },
                'RKK dan SPK terbit; CPOE menegakkan kewenangan baru',
              )
            }
          >
            Terbitkan RKK dan SPK (direktur)
          </ReasonButton>
        </div>
      );
    } else {
      body = (
        <Alert level="success" title={`${s.rkk?.number ?? 'RKK'} terbit · ${stamp(4) ?? ''}`}>
          {grantedItems.length} butir kewenangan berlaku s.d. {s.rkk ? formatTanggal(s.rkk.expiry) : '—'} dan
          langsung ditegakkan saat order di CPOE.
          {a.items.length > grantedItems.length &&
            ` ${a.items.length - grantedItems.length} butir tidak diberikan.`}
        </Alert>
      );
    }
    detail = (
      <Panel
        title={`${a.number} · ${a.practitioner}`}
        sub={`${a.kind} · ${a.committee} · diajukan ${formatTanggalWaktu(a.submittedAt)}`}
      >
        <StageTrack
          label={`Tahap ${a.number}`}
          stages={CRED_STAGES.map((label, i) => ({
            label,
            at: i === 0 ? formatTanggal(a.submittedAt) : stamp(i),
          }))}
          current={s.stage >= 4 ? CRED_STAGES.length : s.stage + 1}
        />
        <KeyValues
          rows={[
            ['Butir diajukan', a.items.join(', ')],
            ['Unit', emp?.unit ?? '—'],
          ]}
        />
        <hr className="m-0 border-0 border-t border-line" />
        {body}
      </Panel>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <FlashLine flash={flash} />
      <div className="flex flex-wrap items-start gap-4">
        <div className="min-w-0 flex-[1_1_300px] xl:max-w-[380px]">
          <Panel title="Pengajuan kewenangan" sub="Komite medik dan komite keperawatan" flush>
            {applications.map((x) => {
              const st = store.apps[x.id] ?? { stage: 0 };
              return (
                <PickRow
                  key={x.id}
                  selected={x.id === sel}
                  onClick={() => setSel(x.id)}
                  title={`${x.number} · ${x.practitioner}`}
                  sub={`${x.kind} · ${x.items.length} butir`}
                  right={
                    <Chip tone={st.stage >= 4 ? 'success' : 'info'}>
                      {st.stage >= 4 ? 'RKK terbit' : CRED_STAGES[st.stage + 1]}
                    </Chip>
                  }
                />
              );
            })}
          </Panel>
        </div>
        <div className="min-w-0 flex-[999_1_460px]">{detail}</div>
      </div>

      <div className="flex flex-wrap items-start gap-4">
        <div className="min-w-0 flex-[999_1_480px]">
          <Panel
            title="RKK berlaku"
            sub="Ditandai bila berakhir ≤ 60 hari; rekredensial dimulai otomatis"
            flush
          >
            <TableWrap label="Daftar kewenangan klinis berlaku">
              <thead>
                <tr>
                  <th className={TH}>Praktisi</th>
                  <th className={TH}>Kewenangan</th>
                  <th className={TH}>Berlaku s.d.</th>
                </tr>
              </thead>
              <tbody>
                {granted.map((g) => {
                  const st = licenseStatus(g.expiry, today);
                  return (
                    <tr key={`${g.practitioner}-${g.item}`}>
                      <td className={TD}>{g.practitioner}</td>
                      <td className={TD}>
                        {g.item}
                        {g.decision === 'supervisi' && (
                          <span className="block text-caption text-warning">dengan supervisi</span>
                        )}
                      </td>
                      <td className={TD}>
                        <span className="block whitespace-nowrap">{formatTanggal(g.expiry)}</span>
                        {st.status !== 'aktif' && (
                          <Chip tone={TONE[st.status]}>{licenseText(st.status, st.days)}</Chip>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </TableWrap>
          </Panel>
        </div>
        <div className="min-w-0 flex-[1_1_320px] xl:max-w-[420px]">
          <Panel title="Uji penegakan di CPOE" sub="Order tindakan diperiksa terhadap RKK dan SIP">
            <SelectField
              label="Praktisi"
              value={testWho}
              onChange={(v) => {
                setTestWho(v);
                setTestResult(null);
              }}
              placeholder="Pilih praktisi…"
              options={practitioners.map((p) => [p, p])}
            />
            <SelectField
              label="Tindakan yang dipesan"
              value={testItem}
              onChange={(v) => {
                setTestItem(v);
                setTestResult(null);
              }}
              placeholder="Pilih tindakan…"
              options={items.map((i) => [i, i])}
            />
            <ReasonButton
              reason={testWho && testItem ? null : 'Pilih praktisi dan tindakan dulu.'}
              variant="secondary"
              onClick={() =>
                setTestResult(orderGuard(testWho, testItem, granted, licensesOf(store, testWho), today))
              }
            >
              Uji order
            </ReasonButton>
            {testResult &&
              (testResult.ok ? (
                <Alert level="success" title="Order diizinkan">
                  {testResult.text}
                </Alert>
              ) : (
                <Alert level="critical" title={`Order diblokir · ${testResult.code}`}>
                  {testResult.text} Override darurat hanya dengan alasan tercatat dan ditinjau komite.
                </Alert>
              ))}
          </Panel>
        </div>
      </div>
    </div>
  );
}
