import { Button, Icon } from '@simrs/ui';
import { useState } from 'react';

/** F01 · Perbedaan jadwal RS vs HFIS (Mobile JKN) dan tombol sinkron. */
export function HfisPanel({
  pending,
  diffText,
  inSyncText,
  busy,
  onSync,
  canSync = true,
}: {
  pending: boolean;
  diffText: string;
  inSyncText: string;
  busy: boolean;
  onSync: () => void;
  /** false = peran tanpa izin sinkron HFIS: tombol kirim tidak ditampilkan. */
  canSync?: boolean;
}) {
  if (!pending) {
    return (
      <section
        role="status"
        aria-label="Sinkron HFIS"
        className="flex flex-col gap-1.5 rounded-card border border-success-border bg-[linear-gradient(90deg,var(--color-zamrud-50),#FFFFFF)] p-4"
      >
        <span className="flex items-center gap-1.5 font-semibold text-success">
          <Icon name="check" size={15} strokeWidth={2.4} />
          Tersinkron dengan HFIS
        </span>
        <span className="text-small text-ink-700">{inSyncText}</span>
      </section>
    );
  }
  return (
    <section
      aria-label="Perbedaan dengan HFIS"
      className="flex flex-col gap-2.5 rounded-card border border-warning-border bg-[linear-gradient(160deg,#FFFFFF_55%,rgba(138,75,0,0.07))] p-4"
    >
      <span className="flex items-center gap-1.5 font-semibold text-warning">
        <Icon name="alert" size={15} strokeWidth={2.2} />
        Perbedaan dengan HFIS
      </span>
      <span className="text-small text-ink-700">{diffText}</span>
      {canSync ? (
        <Button size="sm" className="self-start" disabled={busy} onClick={onSync}>
          {busy ? 'Mengirim ke HFIS…' : 'Perbarui jadwal ke HFIS'}
        </Button>
      ) : (
        <span className="text-caption text-ink-500">
          Pengiriman ke HFIS dilakukan petugas pendaftaran atau admin.
        </span>
      )}
    </section>
  );
}

/** F01 · Dampak cuti: pasien yang sudah booking perlu dialihkan; pengalihan dikirim setelah disetujui. */
export function LeaveImpact({
  dayName,
  doctorName,
  substituteName,
  time,
  patients,
  approved,
  busy,
  onApprove,
}: {
  dayName: string;
  doctorName: string;
  substituteName: string;
  time: string;
  patients: number;
  approved: string | null;
  busy: boolean;
  onApprove: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <section
      aria-label={`Dampak cuti ${dayName}`}
      className="flex flex-col gap-2 rounded-card border border-line bg-white p-4"
    >
      <span className="font-semibold">Dampak cuti {dayName}</span>
      <span className="text-small text-ink-700">
        {patients} pasien sudah booking ke {doctorName}. Notifikasi WhatsApp dan pengalihan ke{' '}
        {substituteName} {approved ? 'sudah dikirim.' : 'siap dikirim setelah disetujui.'}
      </span>
      <Button
        variant={open ? 'secondary' : 'primary'}
        size="sm"
        className="self-start"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {open ? 'Tutup tinjauan' : `Tinjau ${patients} pasien`}
      </Button>
      {open && (
        <div className="flex flex-col gap-2 rounded-control border border-line bg-white p-3 text-small">
          <span>
            <span className="font-semibold">{patients} pasien</span> · {dayName} {time} · dialihkan ke{' '}
            {substituteName} di jam yang sama, nomor antrean tetap.
          </span>
          <span className="text-ink-500">
            Pasien yang menolak pengalihan dijadwal ulang lewat Mobile JKN tanpa kehilangan kuota.
          </span>
          {approved ? (
            <span role="status" className="font-semibold text-success">
              {approved}
            </span>
          ) : (
            <Button variant="primary" disabled={busy} onClick={onApprove}>
              {busy ? 'Mengirim…' : 'Setujui pengalihan dan kirim notifikasi'}
            </Button>
          )}
        </div>
      )}
    </section>
  );
}
