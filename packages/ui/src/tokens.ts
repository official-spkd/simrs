/** Nilai token untuk kebutuhan JS (mis. halaman /dev/ui, grafik). Sumber: design/tokens.json. */
export const palettes = [
  {
    name: 'Teal klinis (aksen)',
    use: 'Navigasi aktif, tombol utama, tautan, fokus',
    swatches: [
      ['brand-50', '#E6F4F1'],
      ['brand-100', '#D5ECE7'],
      ['brand-600', '#0F766E'],
      ['brand-700', '#0B5D56'],
    ],
  },
  {
    name: 'Netral',
    use: 'Teks, garis, permukaan',
    swatches: [
      ['ink-900', '#14212B'],
      ['ink-700', '#3F4C58'],
      ['ink-500', '#5B6B79'],
      ['line', '#E3E8EE'],
      ['canvas', '#F5F7F9'],
    ],
  },
  {
    name: 'Semantik',
    use: 'Status dan peringatan klinis',
    swatches: [
      ['danger', '#B42318'],
      ['warning', '#8A4B00'],
      ['success', '#1E6B34'],
      ['info', '#1E3A8A'],
    ],
  },
  {
    name: 'Permukaan semantik',
    use: 'Latar badge dan kotak peringatan',
    swatches: [
      ['danger-bg', '#FDECEA'],
      ['warning-bg', '#FFF3E0'],
      ['success-bg', '#EAF5EC'],
      ['info-bg', '#EEF2FB'],
    ],
  },
] as const;

export const triageLevels = [
  { level: 1, label: 'Resusitasi', target: 'segera', bg: '#B42318', fg: '#FFFFFF', border: '#9A1E14' },
  { level: 2, label: 'Emergensi', target: '≤ 10 menit', bg: '#C4320A', fg: '#FFFFFF', border: '#A42A08' },
  { level: 3, label: 'Urgen', target: '≤ 30 menit', bg: '#FEF0C7', fg: '#7A4300', border: '#F5D9A8' },
  { level: 4, label: 'Semi-urgen', target: '≤ 60 menit', bg: '#EAF6EC', fg: '#1E6B34', border: '#BFE3C6' },
  { level: 5, label: 'Tidak urgen', target: '≤ 120 menit', bg: '#EEF4FF', fg: '#1E3A8A', border: '#C7D7FE' },
] as const;

export const spaceScale = [4, 8, 12, 16, 20, 24, 28, 32] as const;
