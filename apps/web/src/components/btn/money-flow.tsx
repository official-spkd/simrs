import { Chip } from '@simrs/ui';

function Arrow({ label }: { label: string }) {
  return (
    <span
      aria-hidden="true"
      className="flex flex-none flex-col items-center justify-center gap-0.5 px-1 text-[11px] font-semibold text-brand-700 max-md:w-full max-md:flex-row max-md:py-0.5"
    >
      <span>{label}</span>
      <span className="text-base leading-none">
        <span className="max-md:hidden">→</span>
        <span className="md:hidden">↓</span>
      </span>
    </span>
  );
}

/**
 * Alur dana (ADR-0005, CLAUDE.md §4.8): dana pasien masuk langsung dari kanal BTN ke rekening operasional RS;
 * TPDI hanya mengorkestrasi tagihan, notifikasi webhook, dan laporan, tanpa menampung dana.
 */
export function MoneyFlow({ operational }: { operational: string }) {
  return (
    <section
      aria-label="Alur dana"
      className="flex flex-col gap-2.5 rounded-card border border-line bg-white px-4 pb-4 pt-3"
    >
      <span className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-semibold">Alur dana</span>
        <span className="text-caption text-ink-500">Semua angka di layar ini adalah data simulasi.</span>
      </span>
      <p className="sr-only">
        Pasien membayar lewat kanal BTN (VA, QRIS, atau EDC); dana masuk langsung ke rekening operasional RS
        di BTN {operational}. TPDI hanya mengorkestrasi tagihan, webhook, dan laporan, dan tidak menampung
        dana.
      </p>
      <div className="flex flex-wrap items-stretch gap-y-2.5">
        <div className="flex min-w-0 flex-[0_1_150px] flex-col gap-0.5 rounded-control border border-line bg-[#F8FAFB] px-3 py-2.5 max-md:flex-[1_1_100%]">
          <span className="font-semibold">Pasien</span>
          <span className="text-caption text-ink-500">
            membayar tagihan RS di loket, aplikasi, atau m-banking
          </span>
        </div>
        <Arrow label="bayar" />
        <div className="flex min-w-0 flex-[1_1_180px] flex-col gap-1 rounded-control border border-[#BFE0D9] bg-[#F2FAF8] px-3 py-2.5">
          <span className="font-semibold text-brand-700">Kanal BTN</span>
          <span className="flex flex-wrap gap-1.5">
            <Chip tone="brand">VA BTN</Chip>
            <Chip tone="brand">QRIS · acquirer BTN</Chip>
            <Chip tone="brand">EDC BTN</Chip>
          </span>
        </div>
        <Arrow label="dana langsung" />
        <div className="flex min-w-0 flex-[1_1_190px] flex-col gap-0.5 rounded-control border border-[#B7DEC0] bg-[#EAF5EC] px-3 py-2.5">
          <span className="font-semibold text-success">Rekening operasional RS</span>
          <span className="text-caption text-ink-700">
            BTN <span className="font-mono">{operational}</span> · atas nama RS · mutasi ditarik lewat API H2H
          </span>
        </div>
        <span className="mx-3 w-px flex-none self-stretch border-l-[1.5px] border-dashed border-line-strong max-lg:hidden" />
        <div className="flex min-w-0 flex-[1.4_1_260px] flex-col gap-1 rounded-control border-[1.5px] border-dashed border-[#9FB0BF] bg-white px-3 py-2.5">
          <span className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-semibold">TPDI · orkestrasi</span>
            <Chip tone="warning">TPDI tidak menampung dana</Chip>
          </span>
          <span className="text-caption text-ink-700">
            Tagihan VA/QR via API BTN · webhook ke SIM RS (HMAC, idempoten) · laporan transaksi untuk
            rekonsiliasi
          </span>
          <span className="text-caption text-ink-500">
            Fee TPDI ditagih terpisah lewat invoice bulanan, tidak dipotong dari dana. Biaya VA dan MDR QRIS
            dikenakan BTN sesuai perjanjian.
          </span>
        </div>
      </div>
    </section>
  );
}
