# @simrs/ui

Token desain Klinis Bersih + komponen React dasar. Paket sumber (tanpa build): Next.js memakainya lewat `transpilePackages`.

- `@simrs/ui/theme.css`: tema Tailwind v4 (`@theme`) dari `design/tokens.json`. Impor setelah `@import 'tailwindcss'`, lalu tambahkan `@source` ke `packages/ui/src` agar kelasnya terpindai.
- Komponen: `AppShell`, `Sidebar`, `Button`, `Field`, `Chip`/`StatusChip`/`FilterChip`, `Alert`, `Card`/`KpiCard`, `Tabs`/`TabList`/`TabPanel`, `RadioSegmented`, `SafetyGate`, `PatientBanner`, `LineChart`, `Icon`.
- Tab: satu primitif ARIA (`TabList` + `TabPanel`, atau `Tabs` lengkap) dengan gaya `pil`, `segmen` (ringkas), `garis`; membungkus di layar sempit; `keepMounted` menjaga panel tak aktif tetap terpasang agar isian belum disimpan tidak hilang.
- Segmen: `TabList variant="segmen"` + `TabPanel` hanya bila pilihan berpindah panel (skenario Simulasi); memilih nilai/mode tanpa panel (rentang, mode koneksi, kanal bayar) memakai `RadioSegmented` (`radiogroup`/`radio`, `aria-checked`, panah memindah pilihan).
- Target sentuh: setiap kontrol interaktif ≥ 44 px (token `touch`, kelas `h-11`/`min-h-touch`); `Button size="sm"` hanya lebih ringkas ke samping; `segmen` dan `RadioSegmented` tampak 36 px dengan area sentuh diperluas ke 44 px; tautan sidebar padat di desktop, 44 px di layar sentuh dan menu sempit. Diuji di `src/tabs-touch.test.tsx` dan E2E `/dev/ui`.
- Pratinjau semua token dan komponen: `http://localhost:3000/dev/ui`.
