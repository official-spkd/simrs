'use client';

import { formatJam, formatTanggal, formatTanggalWaktu } from '@simrs/shared';
import { Alert, Button, Chip, type ChipTone } from '@simrs/ui';
import { useState } from 'react';
import {
  CheckField,
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
import type { PrivilegeApplication } from '@/lib/demo/fixtures/kredensial';
import type { Employee } from '@/lib/demo/fixtures/pegawai';
import { demoNow } from '@/lib/demo/fixtures/waktu';
import {
  CRED_STAGES,
  credentialVerifyBlock,
  DECISION_LABEL,
  type GrantedPrivilege,
  orderGuard,
  type OrderGuardResult,
  type PrivilegeDecision,
  reviewBlock,
  rkkExpiry,
  rkkNumber,
} from '@/lib/kredensial';
import { licenseStatus, licenseText, type LicenseStatus, worstLicense } from '@/lib/sdm';

const TONE: Record<LicenseStatus, ChipTone> = { aktif: 'success', segera: 'warning', kedaluwarsa: 'danger' };

interface AppState {
  stage: number;
  docs: boolean[];
  decisions: Record<string, PrivilegeDecision | undefined>;
  note: string;
  at: Record<number, string>;
  rkk: { number: string; expiry: string } | null;
}

/**
 * B04 · Pengajuan kewenangan klinis sampai RKK terbit, daftar RKK berlaku (≤ 60 hari ditandai), dan uji kait CPOE
 * yang memblokir order tanpa kewenangan atau dengan SIP kedaluwarsa.
 */
export function CredentialBoard({
  applications,
  employees,
  initialGranted,
  today,
}: {
  applications: readonly PrivilegeApplication[];
  employees: readonly Employee[];
  initialGranted: readonly GrantedPrivilege[];
  today: string;
}) {
  const [sel, setSel] = useState(applications[0]?.id ?? '');
  const [state, setState] = useState<Record<string, AppState>>(() =>
    Object.fromEntries(
      applications.map((a) => [
        a.id,
        {
          stage: a.stage,
          docs: a.documents.map((d) => d.ok),
          decisions: {},
          note: '',
          at: (a.verifiedAt ? { 1: formatTanggalWaktu(a.verifiedAt) } : {}) as Record<number, string>,
          rkk: null,
        },
      ]),
    ),
  );
  const [granted, setGranted] = useState<GrantedPrivilege[]>([...initialGranted]);
  const [seq, setSeq] = useState(14);
  const [flash, setFlash] = useState<Flash | null>(null);
  const [testWho, setTestWho] = useState('');
  const [testItem, setTestItem] = useState('');
  const [testResult, setTestResult] = useState<OrderGuardResult | null>(null);

  const empByName = new Map(employees.map((e) => [e.name, e]));
  const a = applications.find((x) => x.id === sel);
  const s = a ? state[a.id] : undefined;
  const patch = (id: string, p: Partial<AppState>) =>
    setState((cur) => ({ ...cur, [id]: { ...(cur[id] as AppState), ...p } }));
  const stamp = () => formatTanggalWaktu(demoNow());

  const advance = (to: number, text: string, extra: Partial<AppState> = {}) => {
    if (!a || !s) return;
    patch(a.id, { stage: to, at: { ...s.at, [to]: stamp() }, ...extra });
    setFlash({ ok: true, text: `${a.number}: ${text} · ${formatJam(demoNow())}.` });
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
    const licenses = emp?.licenses ?? [];
    const w = worstLicense(licenses, today);
    const docs = a.documents.map((d, i) => ({ label: d.label, ok: s.docs[i] ?? false }));
    const verify = credentialVerifyBlock(licenses, today, docs);
    const review = reviewBlock(a.items, s.decisions, s.note);
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
              onChange={(v) => patch(a.id, { docs: s.docs.map((x, j) => (j === i ? v : x)) })}
            />
          ))}
          <ReasonButton
            reason={verify}
            onClick={() => advance(1, `berkas lengkap, diteruskan ke ${a.reviewer}`)}
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
                patch(a.id, {
                  decisions: { ...s.decisions, [i]: (v || undefined) as PrivilegeDecision | undefined },
                })
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
            onChange={(v) => patch(a.id, { note: v })}
            hint="Dasar penilaian: logbook, hasil evaluasi praktik, observasi langsung."
          />
          <ReasonButton reason={review} onClick={() => advance(2, 'hasil telaah dikirim ke rapat komite')}>
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
          <span>
            <Button
              variant="primary"
              onClick={() => advance(3, `${a.committee} merekomendasikan ke direktur`)}
            >
              Setujui rekomendasi komite
            </Button>
          </span>
        </div>
      );
    } else if (s.stage === 3) {
      body = (
        <div className="flex flex-col gap-3">
          <span className="text-small text-ink-700">
            Direktur menerbitkan Rincian Kewenangan Klinis (RKK) dan Surat Penugasan Klinis untuk{' '}
            {grantedItems.length} butir, berlaku 3 tahun.
          </span>
          <span>
            <Button
              variant="primary"
              onClick={() => {
                const number = rkkNumber(seq);
                const expiry = rkkExpiry(today);
                setSeq((n) => n + 1);
                setGranted((cur) => [
                  ...cur.filter((g) => !(g.practitioner === a.practitioner && a.items.includes(g.item))),
                  ...grantedItems.map((item) => ({
                    practitioner: a.practitioner,
                    item,
                    decision: s.decisions[item] as 'diberikan' | 'supervisi',
                    expiry,
                  })),
                ]);
                advance(
                  4,
                  `${number} terbit, berlaku s.d. ${formatTanggal(expiry)}; CPOE menegakkan kewenangan baru`,
                  {
                    rkk: { number, expiry },
                  },
                );
              }}
            >
              Terbitkan RKK dan SPK (direktur)
            </Button>
          </span>
        </div>
      );
    } else {
      body = (
        <Alert level="success" title={`${s.rkk?.number ?? 'RKK'} terbit · ${s.at[4] ?? ''}`}>
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
            at: i === 0 ? formatTanggal(a.submittedAt) : (s.at[i] ?? null),
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
              const st = state[x.id] as AppState;
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
                setTestResult(
                  orderGuard(testWho, testItem, granted, empByName.get(testWho)?.licenses ?? [], today),
                )
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
