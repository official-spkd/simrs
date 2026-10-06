/**
 * B07 · Pencegahan dan pengendalian infeksi (rencana fase 8 §8.5): surveilans HAIs (laju per 1.000 hari alat atau
 * per 100 operasi), konfirmasi kasus suspek, bundle all-or-none, kebersihan tangan 5 momen (INM-01), dan
 * penempatan isolasi sesuai kewaspadaan transmisi. Fungsi murni untuk layar mode presentasi (ADR-0023).
 */

export type HaiType = 'isk' | 'ido' | 'vap' | 'phlebitis';

export interface HaiDef {
  id: HaiType;
  label: string;
  short: string;
  /** Penyebut: hari alat atau jumlah operasi. */
  denominator: string;
  /** Laju per … */
  per: 1000 | 100;
  unit: string;
  /** Sasaran RS (komite PPI): laju ≤ sasaran. */
  target: number;
}

export const HAI_DEFS: readonly HaiDef[] = [
  {
    id: 'isk',
    short: 'ISK',
    label: 'ISK terkait kateter urine',
    denominator: 'hari kateter urine',
    per: 1000,
    unit: '‰',
    target: 4.7,
  },
  {
    id: 'ido',
    short: 'IDO',
    label: 'Infeksi daerah operasi (IDO)',
    denominator: 'operasi bersih',
    per: 100,
    unit: '%',
    target: 2,
  },
  {
    id: 'vap',
    short: 'VAP',
    label: 'Pneumonia terkait ventilator (VAP)',
    denominator: 'hari ventilator',
    per: 1000,
    unit: '‰',
    target: 5.8,
  },
  {
    id: 'phlebitis',
    short: 'Phlebitis',
    label: 'Phlebitis',
    denominator: 'hari kateter IV perifer',
    per: 1000,
    unit: '‰',
    target: 5,
  },
];

/** Laju dibulatkan 1 desimal; null bila penyebut nol. */
export function haiRate(cases: number, denominator: number, per: number): number | null {
  if (denominator <= 0) return null;
  return Math.round(((cases * per) / denominator) * 10) / 10;
}

export function haiOnTarget(rate: number | null, target: number): boolean {
  return rate === null || rate <= target;
}

export function formatRate(rate: number | null, unit: string): string {
  if (rate === null) return '—';
  return `${rate.toLocaleString('id-ID', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}${unit}`;
}

// ---------------------------------------------------------------------------------------------------------------
// Kasus suspek

/** Kriteria minimal konfirmasi HAI (ringkas, per jenis): semua harus terpenuhi untuk konfirmasi. */
export const HAI_CRITERIA: Record<HaiType, readonly string[]> = {
  isk: [
    'Kateter urine terpasang > 2 hari kalender',
    'Demam > 38 °C atau nyeri suprapubik',
    'Kultur urine ≥ 10⁵ CFU/mL',
  ],
  ido: [
    'Dalam 30 hari pasca-operasi',
    'Pus atau tanda radang di luka operasi',
    'Didiagnosis oleh dokter bedah/DPJP',
  ],
  vap: [
    'Ventilator > 2 hari kalender',
    'Infiltrat baru pada foto toraks',
    'Sekret purulen atau perburukan oksigenasi',
  ],
  phlebitis: [
    'Kateter IV perifer terpasang',
    'Nyeri, kemerahan, atau bengkak di lokasi tusukan',
    'Skor VIP ≥ 2',
  ],
};

export function confirmBlock(type: HaiType, checks: readonly boolean[]): string | null {
  const need = HAI_CRITERIA[type].length;
  const done = checks.filter(Boolean).length;
  return done === need
    ? null
    : `Kriteria belum terpenuhi semua (${done}/${need}); bila tidak, putuskan "Bukan HAI".`;
}

// ---------------------------------------------------------------------------------------------------------------
// Kebersihan tangan (INM-01)

export const HH_MOMENTS = [
  'Sebelum kontak pasien',
  'Sebelum tindakan aseptik',
  'Setelah terpapar cairan tubuh',
  'Setelah kontak pasien',
  'Setelah kontak lingkungan pasien',
] as const;

export type HhAction = 'handrub' | 'cuci' | 'tidak';

export interface HhObservation {
  profession: string;
  moment: number;
  action: HhAction;
}

/** Kepatuhan = tindakan (handrub/cuci tangan) ÷ peluang, persen bulat. */
export function hhCompliance(obs: readonly Pick<HhObservation, 'action'>[]): {
  done: number;
  total: number;
  pct: number | null;
} {
  const total = obs.length;
  const done = obs.filter((o) => o.action !== 'tidak').length;
  return { done, total, pct: total ? Math.round((done / total) * 100) : null };
}

export function hhByProfession(
  obs: readonly HhObservation[],
): Array<{ profession: string; done: number; total: number; pct: number }> {
  const groups = new Map<string, HhObservation[]>();
  for (const o of obs) groups.set(o.profession, [...(groups.get(o.profession) ?? []), o]);
  return [...groups.entries()].map(([profession, list]) => {
    const c = hhCompliance(list);
    return { profession, done: c.done, total: c.total, pct: c.pct ?? 0 };
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Bundle

export interface BundleDef {
  id: string;
  label: string;
  elements: readonly string[];
}

/** All-or-none: patuh hanya bila semua elemen dilakukan. */
export function bundleCompliant(elements: readonly boolean[]): boolean {
  return elements.length > 0 && elements.every(Boolean);
}

export function bundleRate(audits: ReadonlyArray<{ compliant: boolean }>): number | null {
  if (audits.length === 0) return null;
  return Math.round((audits.filter((a) => a.compliant).length / audits.length) * 100);
}

// ---------------------------------------------------------------------------------------------------------------
// Isolasi

export type Precaution = 'kontak' | 'droplet' | 'airborne';

export const PRECAUTION_LABEL: Record<Precaution, string> = {
  kontak: 'Kewaspadaan kontak',
  droplet: 'Kewaspadaan droplet',
  airborne: 'Kewaspadaan airborne',
};

export interface IsolationRoom {
  id: string;
  label: string;
  negativePressure: boolean;
  occupiedBy: string | null;
}

/** Airborne wajib ruang bertekanan negatif; ruang harus kosong. */
export function roomBlock(need: Precaution, room: IsolationRoom | undefined): string | null {
  if (!room) return 'Pilih ruang isolasi.';
  if (room.occupiedBy) return `${room.label} terisi.`;
  if (need === 'airborne' && !room.negativePressure)
    return 'Kewaspadaan airborne wajib ruang bertekanan negatif.';
  return null;
}
