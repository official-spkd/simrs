'use client';

import { formatTanggal } from '@simrs/shared';
import { Alert, Button, Chip, type ChipTone, FilterChip } from '@simrs/ui';
import { useState } from 'react';
import {
  ConfirmBox,
  FlashLine,
  KeyValues,
  Panel,
  PickRow,
  ReasonButton,
  TextField,
} from '@/components/backoffice/kit';
import { useTokoAction } from '@/components/backoffice/use-toko';
import { demoStamp } from '@/lib/backoffice-toko';
import { type Employee, GROUP_LABEL } from '@/lib/demo/fixtures/pegawai';
import { licenseStatus, licenseText, type LicenseStatus, maskNik, worstLicense } from '@/lib/sdm';
import { type EmployeeProgress, MIN_HR_REASON, sipBlock as sipGate } from '@/lib/sdm-toko';

const TONE: Record<LicenseStatus, ChipTone> = { aktif: 'success', segera: 'warning', kedaluwarsa: 'danger' };

/**
 * B03 · Data pegawai + izin praktik: daftar kiri (penanda STR/SIP), detail kanan. NIK tersamar; buka utuh wajib
 * beralasan (tercatat di jejak toko atas nama pengguna sesi). SIP ≤ 60 hari → pengingat; SIP kedaluwarsa →
 * kewenangan order ditangguhkan sampai SIP baru dicatat (dilanggan Kredensial). Pegawai keluar → akun dan penugasan
 * berakhir otomatis (MRMIK 2.1b). Tersimpan di toko demo (domain `sdm`, ADR-0085).
 */
export function EmployeeTab({
  employees,
  progress,
  rev,
  today,
}: {
  employees: readonly Employee[];
  progress: Readonly<Record<string, EmployeeProgress>>;
  rev: number;
  today: string;
}) {
  const [filter, setFilter] = useState<'semua' | 'tindakan'>('tindakan');
  const state = progress;
  const worst = (id: string) => worstLicense(state[id]?.licenses ?? [], today);
  const visible = employees.filter((e) => filter === 'semua' || worst(e.id).status !== 'aktif');
  const [sel, setSel] = useState(visible[0]?.id ?? employees[0]?.id ?? '');
  const [askNik, setAskNik] = useState(false);
  const [nikOpen, setNikOpen] = useState<Record<string, boolean>>({});
  const [askLeave, setAskLeave] = useState(false);
  const [sipNo, setSipNo] = useState('');
  const [sipUntil, setSipUntil] = useState('');
  const { act, pending, flash } = useTokoAction('sdm', rev);

  const e = employees.find((x) => x.id === sel);
  const s = e ? { ...(state[e.id] as EmployeeProgress), nikOpen: !!nikOpen[e.id] } : undefined;
  const at = () => demoStamp().jam;

  const sipBlock = pending ? 'Menyimpan…' : sipGate(sipNo, sipUntil, today);

  const detail =
    !e || !s ? (
      <Panel title="Detail pegawai">
        <p className="m-0 text-small text-ink-500">Pilih pegawai di daftar kiri.</p>
      </Panel>
    ) : (
      <Panel
        title={e.name}
        sub={`${e.position} · ${e.unit}`}
        actions={s.left ? <Chip tone="neutral">Keluar {s.left.jam}</Chip> : <Chip tone="success">Aktif</Chip>}
      >
        <KeyValues
          rows={[
            [
              'NIP',
              <span key="nip" className="font-mono">
                {e.nip}
              </span>,
            ],
            [
              'NIK',
              <span key="nik" className="flex flex-wrap items-center gap-2">
                <span className="font-mono">{s.nikOpen ? e.nik : maskNik(e.nik)}</span>
                {!s.nikOpen && !askNik && (
                  <Button size="sm" variant="ghost" onClick={() => setAskNik(true)}>
                    Tampilkan utuh…
                  </Button>
                )}
              </span>,
            ],
            ['Kelompok', GROUP_LABEL[e.group]],
            ['Mulai bekerja', formatTanggal(e.joinDate)],
          ]}
        />
        {askNik && (
          <ConfirmBox
            title="Buka NIK utuh?"
            confirmLabel="Tampilkan NIK"
            minReason={MIN_HR_REASON}
            onCancel={() => setAskNik(false)}
            onConfirm={(reason) =>
              act(
                { type: 'nik.dibuka', employeeId: e.id, reason, jam: at() },
                `Akses NIK utuh ${e.name} tercatat di jejak audit · ${at()} · alasan: ${reason}.`,
                () => {
                  setNikOpen((cur) => ({ ...cur, [e.id]: true }));
                  setAskNik(false);
                },
              )
            }
          >
            Data pribadi pegawai. Pembukaan tercatat atas nama Anda beserta alasannya.
          </ConfirmBox>
        )}
        <span className="text-small font-semibold text-ink-700">Izin praktik</span>
        {s.licenses.length === 0 ? (
          <p className="m-0 text-small text-ink-500">Jabatan ini tidak memerlukan STR/SIP.</p>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
            {s.licenses.map((l) => {
              const st = licenseStatus(l.expiry, today);
              return (
                <li
                  key={l.number}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-control border border-line px-3 py-2 text-small"
                >
                  <span className="flex flex-col">
                    <span className="font-mono font-semibold">{l.number}</span>
                    <span className="text-caption text-ink-500">
                      {l.expiry ? `berlaku s.d. ${formatTanggal(l.expiry)}` : 'berlaku seumur hidup'}
                    </span>
                  </span>
                  <Chip tone={TONE[st.status]}>{licenseText(st.status, st.days)}</Chip>
                </li>
              );
            })}
          </ul>
        )}
        {(() => {
          const w = worstLicense(s.licenses, today);
          if (s.left) return null;
          if (w.status === 'kedaluwarsa') {
            return (
              <div className="flex flex-col gap-3">
                <Alert level="critical" title="Kewenangan klinis ditangguhkan">
                  {w.license?.kind} kedaluwarsa: order baru atas nama {e.name} diblokir di CPOE sampai{' '}
                  {w.license?.kind} baru dicatat dan diverifikasi.
                </Alert>
                <TextField label="Nomor SIP baru" value={sipNo} onChange={setSipNo} />
                <TextField
                  label="Berlaku sampai"
                  value={sipUntil}
                  onChange={setSipUntil}
                  placeholder="2031-10-05"
                  hint="Format TTTT-BB-HH, sesuai dokumen SIP (pindaian diunggah ke arsip dokumen)."
                />
                <ReasonButton
                  reason={sipBlock}
                  onClick={() =>
                    act(
                      {
                        type: 'sip.diperbarui',
                        employeeId: e.id,
                        number: sipNo.trim(),
                        until: sipUntil,
                        jam: at(),
                      },
                      `SIP baru ${e.name} dicatat · ${at()}; kewenangan klinis aktif kembali setelah verifikasi komite medik.`,
                      () => {
                        setSipNo('');
                        setSipUntil('');
                      },
                    )
                  }
                >
                  Simpan SIP baru
                </ReasonButton>
              </div>
            );
          }
          if (w.status === 'segera') {
            return s.remindedAt ? (
              <span className="text-small font-semibold text-success">
                Pengingat perpanjangan terkirim · {s.remindedAt}
              </span>
            ) : (
              <span>
                <Button
                  variant="primary"
                  disabled={pending}
                  onClick={() =>
                    act(
                      { type: 'pengingat.dikirim', employeeId: e.id, jam: at() },
                      `Pengingat perpanjangan ${w.license?.kind} dikirim ke ${e.name} · ${at()}.`,
                    )
                  }
                >
                  Kirim pengingat perpanjangan
                </Button>
              </span>
            );
          }
          return null;
        })()}
        <hr className="m-0 border-0 border-t border-line" />
        {s.left ? (
          <Alert level="info" title={`Pegawai keluar · ${s.left.jam} oleh ${s.left.by}`}>
            Akun dinonaktifkan, semua penugasan diakhiri, dan sesi aktif dicabut otomatis. Alasan:{' '}
            {s.left.reason}.
          </Alert>
        ) : askLeave ? (
          <ConfirmBox
            title={`Proses ${e.name} keluar?`}
            confirmLabel="Proses keluar"
            minReason={MIN_HR_REASON}
            danger
            onCancel={() => setAskLeave(false)}
            onConfirm={(reason) =>
              act(
                { type: 'pegawai.keluar', employeeId: e.id, reason, jam: at() },
                `${e.name} diproses keluar · ${at()} (${reason}): akun SIM RS dinonaktifkan, penugasan diakhiri, sesi dicabut.`,
                () => setAskLeave(false),
              )
            }
          >
            Akun SIM RS dan semua penugasan berakhir saat itu juga (MRMIK 2.1b). Riwayat kepegawaian tetap
            tersimpan.
          </ConfirmBox>
        ) : (
          <span>
            <Button variant="ghost" onClick={() => setAskLeave(true)}>
              Proses pegawai keluar…
            </Button>
          </span>
        )}
      </Panel>
    );

  return (
    <div className="flex flex-col gap-4">
      <FlashLine flash={flash} />
      <div className="flex flex-wrap items-start gap-4">
        <div className="min-w-0 flex-[1_1_300px] xl:max-w-[400px]">
          <Panel
            title="Pegawai"
            sub={`${employees.length} pegawai · izin dicek tiap pagi`}
            flush
            actions={
              <span role="group" aria-label="Saring pegawai" className="flex gap-2">
                <FilterChip selected={filter === 'tindakan'} onClick={() => setFilter('tindakan')}>
                  Perlu tindakan
                </FilterChip>
                <FilterChip selected={filter === 'semua'} onClick={() => setFilter('semua')}>
                  Semua
                </FilterChip>
              </span>
            }
          >
            {visible.map((x) => {
              const w = worst(x.id);
              const left = state[x.id]?.left;
              return (
                <PickRow
                  key={x.id}
                  selected={x.id === sel}
                  onClick={() => {
                    setSel(x.id);
                    setAskNik(false);
                    setAskLeave(false);
                  }}
                  title={x.name}
                  sub={`${x.position} · ${x.unit}`}
                  right={
                    left ? (
                      <Chip tone="neutral">Keluar</Chip>
                    ) : w.status === 'aktif' ? undefined : (
                      <Chip tone={TONE[w.status]}>
                        {w.license?.kind} {licenseText(w.status, w.days).toLowerCase()}
                      </Chip>
                    )
                  }
                />
              );
            })}
            {visible.length === 0 && (
              <p className="m-0 px-4 py-5 text-center text-small text-ink-500">
                Tidak ada izin praktik yang perlu ditindaklanjuti.
              </p>
            )}
          </Panel>
        </div>
        <div className="min-w-0 flex-[999_1_440px]">{detail}</div>
      </div>
    </div>
  );
}
