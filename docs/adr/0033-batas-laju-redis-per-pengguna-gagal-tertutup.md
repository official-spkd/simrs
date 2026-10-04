# ADR-0033 · Batas laju di Redis bersama, per pengguna, dan login gagal tertutup

Status: diterima · 5 Okt 2026 · Komponen: P02 (login), API lintas modul

## Konteks

Batas laju API (`@nestjs/throttler`) dihitung di memori tiap proses dan hanya per IP. Dengan beberapa instans API di belakang load balancer, penebak kata sandi bisa membagi percobaannya ke semua instans (batas efektif × jumlah instans). Sebaliknya, staf satu RS sering keluar lewat satu IP (NAT), sehingga batas per IP harus longgar dan tidak melindungi dari satu akun yang membanjiri API. docs/05 §4 meminta rate limit login, OTP, dan webhook; utang teknis mencatat "pindah ke Redis + batas per pengguna".

## Keputusan

1. **Penghitung bersama di Redis.** `RateLimitStorage` menyimpan hit di Redis lewat satu skrip Lua atomik (jendela geser + penanda blokir, jam Redis), dipakai semua instans. `RATE_LIMIT_STORE=auto|redis|memory`; `memory` ditolak di produksi.
2. **Tiga batas per menit, per endpoint.** `default` per IP (`TRUST_PROXY`), `auth` per IP untuk endpoint `@AuthRateLimited()` (login, MFA, ganti sandi, refresh), `user` per `tenantId:userId` dari sesi (`USER_RATE_LIMIT_PER_MIN`, bawaan 300), dipasang `@TenantScoped()` setelah AuthGuard dan sebelum transaksi database.
3. **Kunci tanpa data mentah dan terpisah per database.** `simrs:rl:<nama database>:{<throttler>:<sha256>}`: IP dan ID pengguna hanya sebagai hash; awalan per database memisahkan pengembangan, E2E, dan worktree yang memakai Redis yang sama (`RATE_LIMIT_REDIS_PREFIX` menimpa).
4. **Login gagal tertutup bila Redis mati** (produksi atau `RATE_LIMIT_STORE=redis`): endpoint `auth` dijawab `503` agar penebakan sandi tidak lolos lewat penghitung per instans. Batas lain sementara dihitung di memori instans agar layanan klinis tetap berjalan; Redis dicoba lagi tiap 5 detik, gangguan dan pemulihan dicatat sekali. Di luar produksi (`auto`) tanpa Redis: memori + peringatan.

## Konsekuensi

+ Batas login berlaku untuk seluruh deployment, bukan per instans; satu akun tidak bisa membanjiri API walau berbagi IP dengan banyak staf.
+ Pengembangan tanpa Docker tetap jalan (memori), dan tes/E2E/worktree tidak saling menghabiskan kuota.
− Ketersediaan login di produksi bergantung pada Redis: Redis mati = tidak ada login, MFA, ganti sandi, atau refresh sesi baru (sesi yang masih berlaku tetap jalan sampai token aksesnya habis). Redis wajib dipantau dan dibuat sangat tersedia.
− `503` saat ini memakai kode `INTERNAL_ERROR`; kode stabil khusus (mis. `SERVICE_UNAVAILABLE`) menyusul bila klien perlu membedakannya.
