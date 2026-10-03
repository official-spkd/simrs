# apps/

Kosong sampai fase 0. Claude Code membuat:

| Folder    | Isi                                                                     | Port |
| --------- | ----------------------------------------------------------------------- | ---- |
| `api/`    | NestJS API, modul per bounded context (`src/modules/<konteks>`)         | 4000 |
| `worker/` | NestJS standalone + BullMQ (outbox, retry, DLQ, job terjadwal)          | —    |
| `web/`    | Next.js: staf `/`, anjungan `/kiosk`, display `/display/*`, `/dev/ui`   | 3000 |
| `mock/`   | Mock BPJS, E-Klaim, SATUSEHAT, Dukcapil, TTE, TPDI, BTN + panel kendali | 4100 |
| `mobile/` | Expo, mode pasien & klinisi (fase 9)                                    | —    |
