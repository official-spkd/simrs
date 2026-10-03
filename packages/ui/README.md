# @simrs/ui

Token desain Klinis Bersih + komponen React dasar. Paket sumber (tanpa build): Next.js memakainya lewat `transpilePackages`.

- `@simrs/ui/theme.css`: tema Tailwind v4 (`@theme`) dari `design/tokens.json`. Impor setelah `@import 'tailwindcss'`, lalu tambahkan `@source` ke `packages/ui/src` agar kelasnya terpindai.
- Komponen: `AppShell`, `Sidebar`, `Button`, `Field`, `Chip`/`StatusChip`/`FilterChip`, `Alert`, `Card`/`KpiCard`, `Tabs`, `PatientBanner`, `Icon`.
- Pratinjau semua token dan komponen: `http://localhost:3000/dev/ui`.
