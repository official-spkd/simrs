'use client';

import type { PharmacyPrescription } from '@simrs/shared';
import { Button } from '@simrs/ui';
import { blockingAlerts, type RxLocal, telaahBlock } from '@/lib/penunjang-farmasi';
import { FarmasiDetail, type FarmasiHandlers } from './farmasi-detail';
import { NOT_YOUR_TURN } from './use-scenario-tasks';

type Tab = 'telaah' | 'siap' | 'serah';
const TAB_LABEL: Record<Tab, string> = { telaah: 'Telaah', siap: 'Penyiapan', serah: 'Serah terima' };

/** Umpan balik setelah resep berpindah tahap (role status), dengan pintasan ke tab berikutnya. */
export function FlashBar({
  flash,
  onOpen,
  onClose,
}: {
  flash: { text: string; lines?: string[]; next?: Tab };
  onOpen: (tab: Tab) => void;
  onClose: () => void;
}) {
  return (
    <div
      role="status"
      className="flex flex-wrap items-center justify-between gap-2.5 rounded-control border border-success-border bg-[#EAF6EC] py-2 pr-2 pl-3.5 text-small font-semibold text-success"
    >
      <span className="flex min-w-0 flex-[1_1_280px] flex-col gap-0.5">
        <span>{flash.text}</span>
        {flash.lines && flash.lines.length > 0 && (
          <span className="font-normal text-ink-700">Stok depo berkurang: {flash.lines.join('; ')}.</span>
        )}
      </span>
      <span className="flex gap-1.5">
        {flash.next && (
          <Button size="sm" onClick={() => flash.next && onOpen(flash.next)}>
            Buka {TAB_LABEL[flash.next]}
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={onClose}>
          Tutup
        </Button>
      </span>
    </div>
  );
}

/** Hitung gerbang (CDS, tahanan, giliran simulasi) untuk resep terpilih lalu tampilkan rinciannya. */
export function FarmasiDetailFor({
  role,
  tab,
  rx,
  local,
  rj,
  enabled,
  pharmacists,
  userName,
  busy,
  error,
  handlers,
}: {
  tab: Tab;
  role: string | null;
  rx: PharmacyPrescription;
  local: RxLocal | undefined;
  /** Resep Tn. Suryo (skenario rawat jalan): tahapnya mengikuti tugas simulasi `farmasi`. */
  rj: boolean;
  enabled: (task: string) => boolean;
  pharmacists: readonly string[];
  userName: string;
  busy: boolean;
  error: string | null;
  handlers: FarmasiHandlers;
}) {
  const blocking = blockingAlerts(rx, local);
  const approveReason =
    (role !== 'apoteker' ? 'Telaah dan penyiapan hanya oleh posisi Apoteker.' : null) ??
    telaahBlock(blocking, !!local?.hold) ??
    (rj && !enabled('telaah') ? NOT_YOUR_TURN : null);
  const workReason =
    role !== 'apoteker'
      ? 'Penyiapan dan serah terima hanya oleh posisi Apoteker.'
      : rj && !enabled(tab === 'siap' ? 'siap' : 'serah')
        ? NOT_YOUR_TURN
        : null;
  return (
    <FarmasiDetail
      role={role}
      tab={tab}
      rx={rx}
      local={local}
      blocking={blocking}
      approveReason={approveReason}
      workScenarioReason={workReason}
      scenarioReceivers={rj}
      pharmacists={pharmacists}
      currentUser={userName}
      busy={busy}
      error={error}
      handlers={handlers}
    />
  );
}
