/**
 * Gaya segmen bersama (`TabList variant="segmen"` dan `RadioSegmented`): pil abu-abu, pilihan aktif putih. Tampak
 * 36 px; `::before` memperluas area sentuh 4 px ke atas/bawah menutup padding wadah (`p-1`) sehingga tetap 44 px.
 */
export const SEGMENT_GROUP = 'flex flex-wrap gap-1 rounded-[12px] bg-[rgba(23,32,46,0.06)] p-1';
export const SEGMENT_ITEM =
  "relative inline-flex h-9 items-center gap-2 rounded-[9px] border-0 px-3.5 before:absolute before:inset-x-0 before:-inset-y-1 before:content-['']";
export const SEGMENT_ON = 'bg-white font-semibold text-ink-900 shadow-tab';
export const SEGMENT_OFF = 'bg-transparent text-ink-700';
