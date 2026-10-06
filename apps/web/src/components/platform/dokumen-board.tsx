'use client';

import {
  DOCUMENT_KIND_IDS,
  DOCUMENT_KINDS,
  type DocumentKind,
  formatJam,
  formatTanggalLahir,
  formatTanggalWaktu,
} from '@simrs/shared';
import { Alert, Button, Chip, type ChipTone, cx, Field, PatientBanner } from '@simrs/ui';
import { useState } from 'react';
import { demoHash } from '@/lib/demo/fixtures/dokumen';
import { useDemoDispatch } from '@/lib/demo/store/client';
import { DOCUMENT_SIGNER, type DocumentStoreState, SIGN_ONLY_DOCTOR } from '@/lib/platform-dokumen-toko';
import { demoNow } from '@/lib/demo/fixtures/waktu';
import {
  canRequestTte,
  canVoid,
  type DemoDocument,
  type DocPatient,
  type DocStatus,
  formatBytes,
  kindLabel,
  maskName,
  sha256Hex,
  STATUS_LABEL,
  validateUpload,
  verifyDocument,
} from '@/lib/platform-dokumen';
import { QrCode } from './codes';
import { ActivityLog, type ConfirmRequest, ConfirmDialog, FlowSteps, Panel, Stamp } from './parts';

const TONE: Record<DocStatus, ChipTone> = {
  draft: 'neutral',
  pending: 'warning',
  signed: 'success',
  failed: 'danger',
  void: 'neutral',
};
const SELECT =
  'h-11 rounded-control border border-line-strong bg-white px-3 font-[inherit] text-ink-900 aria-[invalid=true]:border-danger';
const TTE_STEPS = [
  { label: 'Unggah', note: 'berkas + hash' },
  { label: 'Minta TTE', note: 'ke penanda tangan' },
  { label: 'Tanda tangan', note: 'sertifikat elektronik' },
  { label: 'QR verifikasi', note: 'dokumen terkunci' },
];

function stepOf(d: DemoDocument): number {
  if (d.status === 'signed') return 4;
  if (d.status === 'pending') return 2;
  return 1;
}

type FileMeta = { name: string; size: number; type: string; sha256: string };

/**
 * P08 · Dokumen pasien: daftar per pasien, unggah (PDF/PNG/JPEG ≤ 10 MB, hash SHA-256 dihitung di browser), minta
 * TTE → tanda tangan → QR verifikasi, batal beralasan, dan pratinjau halaman verifikasi publik (nama tersamar).
 * Tersimpan di toko demo bersama (domain `dokumen`); TTE hanya oleh posisi Dokter (DPJP), atas nama pengguna sesi.
 */
export function DokumenBoard({
  patients,
  state,
  rev,
  tenantName,
  canSign,
  userName,
}: {
  patients: DocPatient[];
  state: DocumentStoreState;
  rev: number;
  tenantName: string;
  /** Posisi aktif = Dokter (DPJP) (gerbang ulang di toko). */
  canSign: boolean;
  /** Nama pengguna sesi (penanda tangan bila Dokter). */
  userName: string;
}) {
  const docs = state.docs;
  const { dispatch, pending, error: saveError } = useDemoDispatch('dokumen', rev);
  const [patientId, setPatientId] = useState(patients[0]?.id ?? '');
  const [selected, setSelected] = useState<string>(docs[0]?.id ?? '');
  const [uploading, setUploading] = useState(false);
  const [form, setForm] = useState<{ kind: string; title: string; file: FileMeta | null }>({
    kind: '',
    title: '',
    file: null,
  });
  const [error, setError] = useState<{ field: string; message: string } | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [voiding, setVoiding] = useState<DemoDocument | null>(null);
  const [tamper, setTamper] = useState(false);
  const log = [...state.log];

  const patient = patients.find((p) => p.id === patientId) ?? patients[0];
  if (!patient) return null;
  const list = docs.filter((d) => d.patientId === patient.id);
  const doc = list.find((d) => d.id === selected) ?? list[0];

  /** Kirim aksi dokumen ke toko; umpan balik berjam bila tersimpan. */
  const send = (
    build: (now: Date, t: string) => Parameters<typeof dispatch>[0],
    text: string,
    then?: () => void,
  ) => {
    const now = demoNow();
    const t = formatJam(now);
    dispatch(build(now, t), (ok) => {
      if (!ok) return;
      setFlash(`${text} · ${t}`);
      then?.();
    });
  };

  const pickPatient = (id: string) => {
    setPatientId(id);
    setSelected(docs.find((d) => d.patientId === id)?.id ?? '');
    setFlash(null);
    setUploading(false);
  };

  const onFile = async (f: File | undefined) => {
    setError(null);
    if (!f) return setForm((cur) => ({ ...cur, file: null }));
    const sha256 = await sha256Hex(await f.arrayBuffer());
    setForm((cur) => ({ ...cur, file: { name: f.name, size: f.size, type: f.type, sha256 } }));
  };

  const submitUpload = () => {
    const check = validateUpload(form);
    if (!check.ok || !form.file) {
      setError(check.ok ? { field: 'file', message: 'Pilih berkas' } : check);
      return;
    }
    const now = demoNow();
    const id = `dok-unggah-${docs.length + 1}`;
    const kind = form.kind as DocumentKind;
    const file = form.file;
    const t = formatJam(now);
    dispatch(
      {
        type: 'dokumen.diunggah',
        patientId: patient.id as Extract<
          Parameters<typeof dispatch>[0],
          { type: 'dokumen.diunggah' }
        >['patientId'],
        kind,
        title: form.title.trim(),
        mime: check.mime,
        sizeBytes: file.size,
        sha256: file.sha256,
        at: now.toISOString(),
        jam: t,
      },
      (ok) => {
        if (!ok) return;
        setSelected(id);
        setUploading(false);
        setForm({ kind: '', title: '', file: null });
        setFlash(`Tersimpan · ${t} · SHA-256 ${file.sha256.slice(0, 12)}…`);
      },
    );
  };

  const voidRequest: ConfirmRequest | null = voiding
    ? {
        title: `Batalkan ${voiding.title}?`,
        body: (
          <>
            Dokumen tidak dihapus: tetap tersimpan dengan tanda <b>Dibatalkan</b> dan alasan, dan tidak lagi
            tampil di ringkasan pasien.
          </>
        ),
        confirmLabel: 'Ya, batalkan dokumen',
        danger: true,
        reasonLabel: 'Alasan pembatalan',
        reasonPlaceholder: 'mis. berkas milik pasien lain, terunggah ke RM yang salah',
      }
    : null;

  const verify = doc?.verifyCode
    ? verifyDocument(docs, doc.verifyCode, tamper ? demoHash(`${doc.id}-lain`) : doc.sha256)
    : null;

  return (
    <div className="flex flex-col gap-4">
      <div role="group" aria-label="Pilih pasien" className="flex flex-wrap gap-2">
        {patients.map((p) => (
          <button
            key={p.id}
            type="button"
            aria-pressed={p.id === patient.id}
            onClick={() => pickPatient(p.id)}
            className={cx(
              'flex min-h-11 cursor-pointer flex-col items-start rounded-control border px-3 py-1.5 text-left font-[inherit]',
              p.id === patient.id ? 'border-brand-600 bg-brand-50' : 'border-line-strong bg-white',
            )}
          >
            <span className="text-small font-semibold">{p.nama}</span>
            <span className="font-mono text-caption text-ink-500">RM {p.rm}</span>
          </button>
        ))}
      </div>
      <PatientBanner
        name={patient.nama}
        sex={patient.jk}
        ageYears={patient.umur}
        birthDate={formatTanggalLahir(patient.tanggalLahir)}
        mrn={patient.rm}
        allergies={patient.alergi}
        guarantor={patient.penjamin}
        attending={patient.dpjp}
      />

      <div className="flex flex-wrap items-start gap-4">
        <Panel
          className="flex-[1_1_340px]"
          title={`Dokumen pasien · ${list.length}`}
          sub="Tidak pernah dihapus; salah unggah dibatalkan beralasan"
          actions={
            <Button size="sm" variant="primary" onClick={() => setUploading(true)} disabled={uploading}>
              Unggah dokumen
            </Button>
          }
        >
          {uploading && (
            <form
              aria-label="Unggah dokumen"
              className="flex flex-col gap-3 rounded-control border border-brand-100 bg-[#F8FCFB] p-3"
              onSubmit={(e) => {
                e.preventDefault();
                submitUpload();
              }}
            >
              <label className="flex flex-col gap-1.5">
                <span className="text-small font-semibold text-ink-700">Jenis dokumen</span>
                <select
                  className={SELECT}
                  value={form.kind}
                  aria-invalid={error?.field === 'kind'}
                  onChange={(e) => setForm({ ...form, kind: e.target.value })}
                >
                  <option value="">Pilih jenis…</option>
                  {DOCUMENT_KIND_IDS.map((k) => (
                    <option key={k} value={k}>
                      {DOCUMENT_KINDS[k]}
                    </option>
                  ))}
                </select>
                {error?.field === 'kind' && <span className="text-caption text-danger">{error.message}</span>}
              </label>
              <Field
                label="Judul"
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                error={error?.field === 'title' ? error.message : null}
              />
              <label className="flex flex-col gap-1.5">
                <span className="text-small font-semibold text-ink-700">
                  Berkas (PDF, PNG, JPEG · maks. 10 MB)
                </span>
                <input
                  type="file"
                  accept="application/pdf,image/png,image/jpeg"
                  className="min-h-11 text-small"
                  aria-invalid={error?.field === 'file'}
                  onChange={(e) => void onFile(e.target.files?.[0])}
                />
                {form.file && (
                  <span className="text-caption text-ink-500">
                    {form.file.name} · {formatBytes(form.file.size)} · SHA-256{' '}
                    <span className="font-mono">{form.file.sha256.slice(0, 12)}…</span>
                  </span>
                )}
                {error?.field === 'file' && <span className="text-caption text-danger">{error.message}</span>}
              </label>
              <span className="flex flex-wrap gap-2">
                <Button type="submit" variant="primary">
                  Simpan dokumen
                </Button>
                <Button
                  onClick={() =>
                    setForm({
                      kind: 'hasil',
                      title: 'Hasil EKG 12 sadapan',
                      file: {
                        name: 'ekg-12-sadapan.pdf',
                        size: 88_000,
                        type: 'application/pdf',
                        sha256: demoHash('contoh-ekg'),
                      },
                    })
                  }
                >
                  Isi contoh
                </Button>
                <Button variant="ghost" onClick={() => setUploading(false)}>
                  Batal
                </Button>
              </span>
            </form>
          )}
          {list.length === 0 ? (
            <p className="m-0 text-small text-ink-500">Belum ada dokumen untuk pasien ini.</p>
          ) : (
            <ul aria-label="Daftar dokumen" className="m-0 flex list-none flex-col gap-1.5 p-0">
              {list.map((d) => (
                <li key={d.id}>
                  <button
                    type="button"
                    aria-current={d.id === doc?.id ? 'true' : undefined}
                    onClick={() => {
                      setSelected(d.id);
                      setTamper(false);
                      setFlash(null);
                    }}
                    className={cx(
                      'flex min-h-11 w-full cursor-pointer flex-col items-start gap-1 rounded-control border px-3 py-2 text-left font-[inherit]',
                      d.id === doc?.id ? 'border-brand-600 bg-brand-50' : 'border-line bg-white',
                      d.status === 'void' && 'text-ink-500',
                    )}
                  >
                    <span className={cx('text-small font-semibold', d.status === 'void' && 'line-through')}>
                      {d.title}
                    </span>
                    <span className="flex flex-wrap items-center gap-1.5 text-caption text-ink-500">
                      <Chip tone={TONE[d.status]}>
                        {d.needsSignature ? STATUS_LABEL[d.status] : 'Lampiran (tanpa TTE)'}
                      </Chip>
                      {kindLabel(d.kind)} · {formatTanggalWaktu(d.uploadedAt)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        {doc && (
          <div className="flex min-w-0 flex-[2_1_420px] flex-col gap-4">
            <Panel
              title={doc.title}
              sub={`${kindLabel(doc.kind)} · ${formatBytes(doc.sizeBytes)} · diunggah ${formatTanggalWaktu(doc.uploadedAt)} oleh ${doc.uploadedBy}`}
              tone={doc.status === 'failed' ? 'danger' : undefined}
            >
              {doc.needsSignature && doc.status !== 'void' && (
                <FlowSteps label="Tahap tanda tangan elektronik" steps={TTE_STEPS} current={stepOf(doc)} />
              )}
              <dl className="m-0 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-small">
                <dt className="text-ink-500">Status</dt>
                <dd className="m-0">
                  <Chip tone={TONE[doc.status]}>
                    {doc.needsSignature ? STATUS_LABEL[doc.status] : 'Lampiran (tanpa TTE)'}
                  </Chip>
                </dd>
                <dt className="text-ink-500">SHA-256</dt>
                <dd className="m-0 font-mono text-caption break-all">{doc.sha256}</dd>
                {doc.signer && (
                  <>
                    <dt className="text-ink-500">Penanda tangan</dt>
                    <dd className="m-0">{doc.signer}</dd>
                  </>
                )}
                {doc.signedAt && (
                  <>
                    <dt className="text-ink-500">Ditandatangani</dt>
                    <dd className="m-0">{formatTanggalWaktu(doc.signedAt)}</dd>
                  </>
                )}
                {doc.voidReason && (
                  <>
                    <dt className="text-ink-500">Alasan batal</dt>
                    <dd className="m-0">{doc.voidReason}</dd>
                  </>
                )}
              </dl>
              {doc.status === 'failed' && (
                <Alert level="critical" title="TTE gagal">
                  {doc.failReason} Dokumen belum sah sampai ditandatangani ulang.
                </Alert>
              )}
              {doc.status === 'signed' && (
                <Alert level="success" title="Terkunci">
                  Dokumen bertanda tangan tidak bisa diubah atau dibatalkan; koreksi lewat addendum.
                </Alert>
              )}
              <span className="flex flex-wrap items-center gap-2">
                {doc.status === 'draft' && doc.needsSignature && (
                  <Button
                    variant="primary"
                    disabled={!canRequestTte(doc).ok || pending}
                    onClick={() =>
                      send(
                        (now, t) => ({ type: 'tte.diminta', id: doc.id, at: now.toISOString(), jam: t }),
                        `Permintaan TTE dikirim ke ${DOCUMENT_SIGNER}`,
                      )
                    }
                  >
                    Minta TTE ke {patient.dpjp}
                  </Button>
                )}
                {doc.status === 'failed' && (
                  <Button
                    variant="primary"
                    disabled={pending}
                    onClick={() =>
                      send(
                        (now, t) => ({ type: 'tte.diminta', id: doc.id, at: now.toISOString(), jam: t }),
                        'Permintaan TTE dikirim ulang',
                      )
                    }
                  >
                    Kirim ulang permintaan TTE
                  </Button>
                )}
                {doc.status === 'pending' && (
                  <>
                    <Button
                      variant="primary"
                      disabled={!canSign || pending}
                      aria-describedby={!canSign ? 'tte-hanya-dokter' : undefined}
                      onClick={() =>
                        send(
                          (now, t) => ({
                            type: 'tte.ditandatangani',
                            id: doc.id,
                            at: now.toISOString(),
                            jam: t,
                          }),
                          `Ditandatangani ${userName}`,
                        )
                      }
                    >
                      Tandatangani (TTE) sebagai {canSign ? userName : 'Dokter (DPJP)'}
                    </Button>
                    <Button
                      disabled={pending}
                      onClick={() =>
                        send(
                          (_now, t) => ({ type: 'tte.gagal', id: doc.id, jam: t }),
                          'TTE gagal: penyelenggara tidak menjawab',
                        )
                      }
                    >
                      Simulasikan gangguan TTE
                    </Button>
                    {!canSign && (
                      <span id="tte-hanya-dokter" className="basis-full text-caption text-ink-700">
                        Menunggu tanda tangan {doc.signer ?? DOCUMENT_SIGNER}. {SIGN_ONLY_DOCTOR}
                      </span>
                    )}
                  </>
                )}
                {doc.status !== 'void' && doc.status !== 'signed' && (
                  <Button variant="danger" disabled={!canVoid(doc).ok} onClick={() => setVoiding(doc)}>
                    Batalkan dokumen
                  </Button>
                )}
              </span>
              {(flash || saveError) && (
                <span role="status">
                  <Stamp>{saveError ?? flash}</Stamp>
                </span>
              )}
            </Panel>

            {verify && doc.verifyCode && (
              <Panel
                title="Verifikasi QR publik"
                sub="Pratinjau halaman yang dibuka saat QR di dokumen dipindai (tanpa login)"
              >
                <div className="flex flex-wrap items-start gap-4">
                  <QrCode
                    value={`https://verifikasi.contoh/${doc.verifyCode}`}
                    size={112}
                    label={`QR verifikasi ${doc.title}`}
                  />
                  <div
                    role="region"
                    aria-label="Pratinjau halaman verifikasi"
                    className="flex min-w-0 flex-[1_1_260px] flex-col gap-1.5 rounded-control border border-line-strong bg-canvas p-3 text-small"
                  >
                    <span className="font-mono text-caption text-ink-500">
                      verifikasi.contoh/{doc.verifyCode}
                    </span>
                    <span className="font-semibold">{tenantName}</span>
                    {verify.status === 'asli' ? (
                      <Chip tone="success">Dokumen asli · tanda tangan sah</Chip>
                    ) : verify.status === 'tidak-cocok' ? (
                      <Chip tone="danger">Tidak cocok · isi berkas berbeda dari yang ditandatangani</Chip>
                    ) : (
                      <Chip tone="danger">Kode tidak dikenal</Chip>
                    )}
                    <span>
                      {kindLabel(doc.kind)} · pasien {maskName(patient.nama)}
                    </span>
                    <span>
                      Ditandatangani {doc.signer} · {doc.signedAt ? formatTanggalWaktu(doc.signedAt) : ''}
                    </span>
                    <span className="text-caption text-ink-500">
                      Isi rekam medis tidak ditampilkan di halaman publik.
                    </span>
                  </div>
                </div>
                <label className="flex min-h-11 cursor-pointer items-center gap-2 text-small">
                  <input
                    type="checkbox"
                    className="size-5 accent-brand-600"
                    checked={tamper}
                    onChange={(e) => setTamper(e.target.checked)}
                  />
                  Uji dengan berkas yang sudah diubah (hash berbeda)
                </label>
              </Panel>
            )}
            <Panel title="Aktivitas sesi ini" sub="Tercatat di jejak audit (buat, cetak, TTE, batal)">
              {log.length === 0 ? (
                <p className="m-0 text-small text-ink-500">Belum ada aktivitas.</p>
              ) : (
                <ActivityLog label="Aktivitas dokumen" items={log} />
              )}
            </Panel>
          </div>
        )}
      </div>
      <ConfirmDialog
        request={voidRequest}
        onClose={() => setVoiding(null)}
        onConfirm={(reason) => {
          if (!voiding) return;
          const v = voiding;
          send(
            (_now, t) => ({ type: 'dokumen.dibatalkan', id: v.id, reason, jam: t }),
            `Dibatalkan: ${v.title}`,
          );
        }}
      />
    </div>
  );
}
