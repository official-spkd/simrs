# 06 · Demo publik (`APP_ENV=demo`)

Demo publik menjalankan SIM RS dengan **data fiktif** di internet. Tujuannya presentasi ke calon pengguna: layar
mode presentasi (ADR-0023) dan akun "Masuk cepat". Demo ini bukan staging dan bukan produksi. Jangan pernah
memasukkan data pasien asli.

Contoh yang berjalan: `https://demo.spkd.store/demo-simrs` (VPS 187.77.119.238, sejak 7 Okt 2026).

## Perilaku `APP_ENV=demo`

| Aspek                                                                              | local                                 | **demo**         | staging                               | production   |
| ---------------------------------------------------------------------------------- | ------------------------------------- | ---------------- | ------------------------------------- | ------------ |
| Fitur pengembang (Swagger, `/api/v1/dev`, tenant dari header, panduan tanpa login) | ya (bila `NODE_ENV` bukan production) | **tidak**        | ya (bila `NODE_ENV` bukan production) | tidak        |
| Mode presentasi (`DATA_SOURCE=demo`) dan akun presentasi                           | ya                                    | **ya**           | tidak                                 | tidak        |
| Cookie `Secure`                                                                    | tidak                                 | **ya**           | ya                                    | ya           |
| `INTEGRATION_MODE`                                                                 | bebas                                 | **wajib `mock`** | bebas                                 | bukan `mock` |
| `STORAGE_DRIVER=disk`                                                              | boleh                                 | **boleh**        | tidak                                 | tidak        |
| Layanan mock dengan `NODE_ENV=production`                                          | tidak                                 | **boleh**        | tidak                                 | tidak        |

Aturannya ada di `packages/shared/src/env.ts`: `devToolsAllowed`, `presentationModeAllowed`, dan
`integrationModeProblem`.

## Dipasang di bawah path

Isi `WEB_BASE_PATH` (mis. `/demo-simrs`) **sebelum** `pnpm build`. Nilainya dibakukan saat build web menjadi
`basePath` Next. Tautan yang tidak ditulis ulang Next memakai `withBasePath()` (`apps/web/src/lib/base-path.ts`).
Kosong berarti aplikasi berada di akar domain.

## Susunan server

- **Kode:** `/opt/spkd/simrs`, milik user `simrs`. Clone lewat deploy key read-only; alias SSH `github-simrs` ada
  di `/root/.ssh/config`.
- **Infrastruktur:** Postgres, Redis, MinIO, dan Mailpit dari `docker-compose.yml`. Semuanya hanya mendengar di
  `127.0.0.1`.
- **Aplikasi:** layanan systemd `simrs-mock`, `simrs-api`, `simrs-worker`, dan `simrs-web`, dengan
  `EnvironmentFile=/opt/spkd/simrs/.env`. Web dijalankan dengan `next start -H 127.0.0.1 -p 3000`.
- **Caddy:** HTTPS otomatis (Let's Encrypt, `cert_issuer acme`). Blok `handle /demo-simrs*` diteruskan ke
  `127.0.0.1:3000`. Path lain melayani halaman indeks produk di `/opt/spkd/index`.
- **Firewall:** ufw hanya membuka 22, 80, dan 443.

Isi `.env` yang membedakan demo dari lokal:

```
NODE_ENV=production
APP_ENV=demo
DATA_SOURCE=demo
INTEGRATION_MODE=mock
HOST=127.0.0.1
ALLOW_DEV_TENANT_HEADER=false
LOGIN_TENANT_CODE=RSFA
WEB_BASE_PATH=/demo-simrs
WEB_BASE_URL=https://demo.spkd.store/demo-simrs
```

Akun presentasi dibuat untuk RS fiktif, **bukan** nama RS sungguhan:

```bash
pnpm db:akun-presentasi --tenant RSFA
```

## Memperbarui demo

Jalankan sebagai root di VPS:

```bash
cd /opt/spkd/simrs
git pull --ff-only
pnpm install --frozen-lockfile
pnpm build
pnpm db:deploy
chown -R simrs:simrs /opt/spkd/simrs
systemctl restart simrs-mock simrs-api simrs-worker simrs-web
```

Kalau ingin mereset data demo, jalankan `pnpm db:seed`. Perintah ini idempoten.
