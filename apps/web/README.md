# @simrs/web

Next.js 16 (App Router) + Tailwind v4 dengan token Klinis Bersih dari `@simrs/ui`.

| Rute      | Isi                                                                         |
| --------- | --------------------------------------------------------------------------- |
| `/`       | Beranda staf + status `/ready` API                                          |
| `/dev/ui` | Fondasi desain (token + komponen), padanan `design/mockups/Fondasi.dc.html` |

- Menu sidebar: `src/lib/nav.ts`. Nyalakan `available: true` saat layar fase terkait selesai.
- Klien API bertipe: `src/lib/api.ts` (respons divalidasi zod, galat → `ApiError` berkode stabil).
- `pnpm dev` (port 3000), `pnpm build`, `pnpm test`, `pnpm test:e2e` (Playwright, ditambahkan di potongan 8).
