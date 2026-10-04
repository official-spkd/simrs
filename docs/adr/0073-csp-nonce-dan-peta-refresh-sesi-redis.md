# ADR-0073 · Hardening web: CSP ber-nonce per permintaan dan peta refresh sesi di Redis

Status: diterima · 5 Okt 2026 · Komponen: P01, P02 (web BFF) · Fase 10 potongan 10.9a · Memperbarui ADR-0013

## Konteks
CSP web dari `next.config.ts` mengizinkan `script-src 'unsafe-inline'`, karena hidrasi Next memakai skrip inline yang
tidak bisa diberi hash saat build. Akibatnya, injeksi HTML apa pun bisa menjalankan skrip. Selain itu, peta "refresh
sekali per token" (ADR-0013) disimpan di memori proses. Dengan beberapa instans web di belakang load balancer,
permintaan paralel yang membawa refresh token yang sama bisa memanggil `/auth/refresh` dari dua instans. Deteksi
pemakaian ulang di API (ADR-0011) lalu mencabut sesi pengguna. Batas laju Redis per IP + per pengguna sudah dibangun
terpisah (agen K), jadi tidak termasuk ADR ini.

## Keputusan
1. **CSP dibangkitkan per permintaan di `src/proxy.ts`** (`src/lib/csp.ts`):
   - nonce acak 128 bit;
   - `script-src 'self' 'nonce-…' 'strict-dynamic'`, tanpa `unsafe-inline`. `unsafe-eval` dan `ws:` hanya ada saat
     `next dev` (HMR);
   - `style-src` tetap `'unsafe-inline'` (atribut `style` React, font Next);
   - arahan lain tetap: `default-src 'self'`, `frame-ancestors 'none'`, `object-src 'none'`, `base-uri`/`form-action 'self'`.

   Cara nonce sampai ke skrip:
   - proxy meneruskan CSP + header `x-nonce` ke render, dan Next memasang nonce di semua skrip kerangkanya;
   - CSP juga dikirim sebagai header respons;
   - `next.config.ts` tidak lagi mengirim CSP, hanya header statis (nosniff, DENY, Referrer-Policy, COOP,
     Permissions-Policy, HSTS).
2. **Semua halaman dirender per permintaan.**
   - Root layout memanggil `connection()`, karena halaman prarender membawa skrip tanpa nonce dan akan diblokir.
   - Halaman staf sudah dinamis sebelumnya, jadi yang berubah hanya `/_not-found`. Halaman publik `/masuk` dan
     `/verifikasi` diuji E2E.
   - Komponen yang kelak memasang `<Script>` sendiri membaca `headers().get('x-nonce')`.
3. **Peta refresh dua lapis** (`src/lib/server/refresh.ts`):
   - **Lapis 1** (tetap): peta janji di memori proses selama 30 detik.
   - **Lapis 2** (baru): peta bersama di Redis lewat `ioredis`, paket yang sama dengan API/worker; tidak ada paket
     baru di monorepo.
   - **Siapa memanggil API:** instans yang menang `SET NX PX` (kunci 15 detik) memanggil API, lalu menyimpan hasilnya
     selama 30 detik. Instans lain menunggu hasil itu (poll 50 ms, maksimal 12 detik).
   - **Galat sementara** (API mati, batas laju) tidak disimpan, jadi instans lain boleh mencoba lagi. 401 disimpan
     supaya semua instans memberi jawaban yang sama.
   - **Kerahasiaan:** kunci Redis adalah hash token lama, bukan token itu sendiri. Isinya dienkripsi AES-256-GCM dengan
     kunci turunan token lama, sehingga pembaca Redis tanpa token lama tidak mendapat token baru.
4. **Gagal aman ke per instans.** Bila Redis tidak terjangkau:
   - Sebelum ada klaim: refresh berjalan per instans (perilaku lama). Peringatan dicatat sekali per gangguan; dicatat
     sebagai galat di produksi atau bila `REFRESH_STORE=redis`. Redis dicoba lagi setiap 5 detik.
   - Saat menunggu instans lain: refresh dihentikan dengan 503 (permintaan lolos tanpa cookie baru). Instans ini
     tidak ikut memanggil API, karena itu akan memakai ulang token dan mencabut sesi.
5. **Pengaturan.**
   - `REFRESH_STORE`: `auto` (bawaan, memakai `REDIS_URL`), `redis`, atau `memory`. `memory` diabaikan di produksi.
   - `REFRESH_REDIS_PREFIX`, bawaan `simrs:web:refresh:`.
   - `REDIS_URL` dan keduanya ikut daftar putih `.env` root di `next.config.ts`. `ioredis` ditandai
     `serverExternalPackages`.
6. **Banyak instans web wajib memakai `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` yang sama** (32 byte base64) saat build dan
   runtime. Tanpa itu, Server Action yang dirender instans A dan dikirim ke instans B gagal didekripsi. Ini syarat
   deployment, dicatat di `.env.example`.

## Konsekuensi
+ Skrip injeksi tanpa nonce diblokir peramban. E2E memeriksa bahwa header CSP produksi tidak memuat skrip
  `unsafe-inline`/`unsafe-eval`, semua `<script>` membawa nonce permintaan, dan login MFA serta layar presentasi tetap
  terhidrasi tanpa pelanggaran CSP. Tes semua-layar juga gagal bila ada galat konsol, termasuk pelanggaran CSP.
+ Instans web bisa ditambah tanpa sticky session. E2E memakai dua server web (data API + mode presentasi) yang berbagi
  cookie localhost dan Redis: 6 permintaan paralel menghasilkan satu rotasi dan sesi tetap hidup. Dengan
  `REFRESH_STORE=memory`, tes yang sama gagal (sesi dicabut, 307 ke `/masuk`).
− Tidak ada lagi halaman statis: setiap halaman dirender per permintaan (sudah demikian untuk halaman staf).
− Token sesi baru tersimpan di Redis selama 30 detik (terenkripsi, kunci turunan token lama). Redis harus berada di
  jaringan internal, seperti untuk batas laju.
− Halaman 404 bawaan untuk path berekstensi gambar/font (di luar matcher proxy) dikirim tanpa CSP. Tidak memuat data
  pengguna.
