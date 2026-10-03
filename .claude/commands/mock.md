---
description: Tambah atau perbaiki mock integrasi di apps/mock
argument-hint: <bpjs|eklaim|satusehat|dukcapil|tte|tpdi|btn> <kebutuhan>
---
Kerjakan mock: $ARGUMENTS

Ikuti kontrak di `docs/06-integrasi.md` (dan `docs/07-pembayaran-btn-tpdi.md` untuk TPDI/BTN). Mock harus:
- meniru header otentikasi/tanda tangan dan format respons sistem aslinya (termasuk kode galat);
- menyediakan skenario di panel kendali (normal, lambat, gagal, dan pemicu manual yang relevan);
- memakai data fiktif yang konsisten dengan seed;
- punya tes kontrak yang juga dipakai untuk menguji konektor di `apps/api`.
