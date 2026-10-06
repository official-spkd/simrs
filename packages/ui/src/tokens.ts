/** Nilai token Pelangi Klinis untuk kebutuhan JS (halaman /dev/ui, grafik). Sumber: theme.css (ADR-0086). */

export const RAMP_STEPS = ['50', '100', '200', '300', '400', '500', '600', '700', '800', '900'] as const;

export const ramps = {
  samudra: ['#EEF4FF', '#DCE7FF', '#BBD0FF', '#8EB0FA', '#5F8BF0', '#3D6CE0', '#2C55C4', '#24449E', '#1F3A80', '#1B3166'],
  zamrud: ['#ECFAF4', '#D2F2E4', '#A7E4CA', '#73CFAA', '#43B488', '#24976D', '#1A7A58', '#176249', '#154F3C', '#124133'],
  anggrek: ['#F5F2FF', '#EBE4FF', '#D6CAFE', '#B9A3FB', '#9A78F4', '#7F56E6', '#6A3FCF', '#5832AB', '#482B8B', '#3B2670'],
  toska: ['#EDFCFB', '#D3F6F3', '#A8ECE6', '#6FDAD2', '#36BFB6', '#1BA29B', '#148280', '#146868', '#155354', '#154546'],
  bougenvil: ['#FFF1F7', '#FFE2EF', '#FFC6DF', '#FF9BC4', '#F769A3', '#E54486', '#C82C6B', '#A42257', '#871F49', '#701D3F'],
  kunyit: ['#FFF8EB', '#FEEDC8', '#FDD98D', '#FBBF52', '#F5A524', '#DB860F', '#B8670A', '#924E0D', '#763F11', '#613512'],
  koral: ['#FFF1EF', '#FFE0DB', '#FFC1B8', '#FE9787', '#F86751', '#E5442E', '#C23221', '#9E291D', '#82261D', '#6B241D'],
  batu: ['#F8FAFC', '#F1F4F8', '#E5EAF1', '#D2DAE5', '#B3BFCE', '#8794A8', '#65728A', '#4D5870', '#263043', '#17202E'],
} as const;

export type RampName = keyof typeof ramps;

/**
 * Domain layar → rona. Aksen `brand-*` di dalam `[data-domain]` mengikuti rona ini (theme.css). Kunyit dan koral
 * tidak pernah menjadi domain: keduanya khusus status peringatan dan kritis.
 */
export const DOMAINS = {
  fo: { label: 'Front office', ramp: 'samudra' },
  kl: { label: 'Klinis', ramp: 'zamrud' },
  pj: { label: 'Penunjang', ramp: 'anggrek' },
  ku: { label: 'Keuangan', ramp: 'toska' },
  mj: { label: 'Manajemen', ramp: 'bougenvil' },
  si: { label: 'Sistem', ramp: 'batu' },
} as const satisfies Record<string, { label: string; ramp: RampName }>;

export type DomainKey = keyof typeof DOMAINS;

/** Warna rona domain sebagai variabel CSS, untuk dipakai di luar subtree `[data-domain]` (mis. titik grup menu). */
export function domainColor(domain: DomainKey, step: (typeof RAMP_STEPS)[number] = '600'): string {
  return `var(--color-${DOMAINS[domain].ramp}-${step})`;
}

export const palettes = [
  {
    name: 'Samudra · aksi utama',
    use: 'Tombol utama, tautan, fokus, front office, info',
    swatches: [
      ['samudra-50', '#EEF4FF'],
      ['samudra-100', '#DCE7FF'],
      ['samudra-600', '#2C55C4'],
      ['samudra-800', '#1F3A80'],
    ],
  },
  {
    name: 'Rona domain',
    use: 'Aksen layar per domain (600)',
    swatches: [
      ['zamrud-600 · klinis', '#1A7A58'],
      ['anggrek-600 · penunjang', '#6A3FCF'],
      ['toska-600 · keuangan', '#148280'],
      ['bougenvil-600 · manajemen', '#C82C6B'],
      ['batu-700 · sistem', '#4D5870'],
    ],
  },
  {
    name: 'Netral (batu)',
    use: 'Teks, garis, permukaan',
    swatches: [
      ['ink-900', '#17202E'],
      ['ink-700', '#3B4559'],
      ['ink-500', '#4D5870'],
      ['line', '#E5EAF1'],
      ['canvas', '#F8FAFC'],
    ],
  },
  {
    name: 'Status',
    use: 'Hanya untuk status; tidak pernah hiasan',
    swatches: [
      ['danger · koral-600', '#C23221'],
      ['warning · kunyit-700', '#924E0D'],
      ['success · zamrud-700', '#176249'],
      ['info · samudra-700', '#24449E'],
    ],
  },
] as const;

export const triageLevels = [
  { level: 1, label: 'Resusitasi', target: 'segera', bg: '#C23221', fg: '#FFFFFF', border: '#9E291D' },
  { level: 2, label: 'Emergensi', target: '≤ 10 menit', bg: '#C4320A', fg: '#FFFFFF', border: '#A42A08' },
  { level: 3, label: 'Urgen', target: '≤ 30 menit', bg: '#FEEDC8', fg: '#763F11', border: '#FDD98D' },
  { level: 4, label: 'Semi-urgen', target: '≤ 60 menit', bg: '#D2F2E4', fg: '#176249', border: '#A7E4CA' },
  { level: 5, label: 'Tidak urgen', target: '≤ 120 menit', bg: '#DCE7FF', fg: '#24449E', border: '#BBD0FF' },
] as const;

export const spaceScale = [4, 8, 12, 16, 20, 24, 28, 32] as const;
