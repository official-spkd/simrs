import { formatJam } from '@simrs/shared';
import { Alert } from '@simrs/ui';
import { DEMO_NOW } from '@/lib/demo/fixtures/waktu';
import type { DowntimeBanner as Banner } from '@/lib/operasional-downtime-toko';
import { readDowntimeBanner } from '@/lib/server/data/platform';
import { webEnv } from '@/lib/server/web-env';

const jam = (min: number | null) =>
  min === null ? '–' : formatJam(new Date(Date.parse(DEMO_NOW) + min * 60_000));

/**
 * P13 · Banner downtime (presentasi murni): tampil selama downtime aktif atau pemulihan belum selesai. Status
 * ditulis dalam teks (tidak hanya warna). Dipakai `DowntimeBanner` (server) dan layar yang sudah memegang datanya.
 */
export function DowntimeBannerView({ banner }: { banner: Banner }) {
  if (banner.phase === 'aktif') {
    return (
      <Alert
        level="critical"
        title={`Mode downtime aktif sejak ${jam(banner.startedAt)} · ${banner.causeLabel}`}
      >
        {banner.cause === 'bpjs'
          ? 'Pendaftaran tetap jalan; SEP diganti surat jaminan sementara dan dikirim ulang setelah BPJS pulih.'
          : 'Server edge melayani baca dan pendaftaran; tulis klinis memakai formulir kertas darurat.'}{' '}
        {banner.backlog > 0 ? `${banner.backlog} pesan menunggu di antrean kirim. ` : ''}
        {banner.by ? `Diaktifkan ${banner.by}.` : ''}
      </Alert>
    );
  }
  return (
    <Alert level="warning" title="Layanan pulih · entri susulan dan sinkronisasi berjalan">
      {banner.backlog > 0
        ? `${banner.backlog} pesan antrean kirim belum tersinkron. `
        : 'Antrean kirim menunggu entri susulan formulir kertas. '}
      Data yang dicatat di kertas selama downtime dimasukkan sebagai entri susulan.
    </Alert>
  );
}

/**
 * Banner downtime untuk layout (mode presentasi saja; mode api tidak membaca toko demo dan tidak menampilkan apa
 * pun). Pemasangan di layout staf/perangkat: permintaan ke CD-0 (lihat `docs/handoff/CD-3.md`).
 */
export async function DowntimeBanner() {
  if (webEnv().dataSource !== 'demo') return null;
  const banner = await readDowntimeBanner();
  return banner ? <DowntimeBannerView banner={banner} /> : null;
}
