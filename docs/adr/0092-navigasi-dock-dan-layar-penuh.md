# ADR-0092 · Navigasi dock ala macOS (bisa diganti sidebar) dan layar penuh

Status: diterima · 7 Okt 2026 · Komponen lintas lapisan (`packages/ui`, `apps/web`)

## Konteks

Pemilik produk meminta tiga hal:
- versi dock untuk navigasi, mirip dock MacBook: mengklik ikon memunculkan sub-menu di atasnya;
- setiap layar responsif dan memenuhi layar, supaya ruang kerja lebih luas;
- sidebar lama tetap bisa dipilih.

Mockup "Dock · layar penuh" (kanvas desain ADR-0091, papan D00–D44) disetujui sebelum diterapkan.

## Keputusan

1. **Dock** (`@simrs/ui` `Dock`).
   - Satu ikon per grup menu. Ubin bergradien satu rona domain 800 → 600 dengan ikon grup (`NavGroup.icon`, peta `GROUP_ICON` di `lib/nav.ts`).
   - Klik ikon membuka *stack* berisi layar grup itu di atas ikon. Hanya satu stack terbuka sekaligus.
   - Esc menutup stack dan mengembalikan fokus ke ikon. Klik di luar dock dan berpindah layar juga menutupnya.
   - Grup satu layar menjadi tautan langsung.
   - Titik di bawah ikon menandai grup layar aktif. Lencana koral menghitung menu mendesak.
   - Setelah pemisah ada tombol Cari (membuka palet ⌘K) dan Akun. Stack Akun memuat identitas, RS · unit, status integrasi, ganti posisi, PIN, dan Keluar.
   - Pembesaran ikon ala macOS (ikon tetangga ikut membesar lewat `:has`) hanya untuk penunjuk halus tanpa preferensi kurangi gerak.
2. **Aksesibilitas.**
   - Dock tetap `nav "Navigasi utama"` dengan tombol `aria-expanded`/`aria-controls`.
   - Stack tertutup memakai `hidden`, jadi semua tautan tetap ada di DOM: isi menu sama dengan sidebar (izin, modul, posisi).
   - Di bawah 768 px dock menjadi bilah bawah selebar layar dengan label terlihat dan bisa digulir. Stack menjadi lembar di atas bilah. Target sentuh 44 px.
3. **Pilihan tampilan.**
   - Toolbar memuat grup tombol "Tampilan navigasi" (Dock / Sidebar, `aria-pressed`), mulai 768 px.
   - Pilihan disimpan di cookie `simrs_nav` per peramban (bukan data sensitif, nilai divalidasi `parseNavLayout`). Server membaca cookie itu agar render awal tepat tanpa kedip.
   - Tanpa cookie, bawaan diambil dari env `NAV_LAYOUT`: `dock` bawaan, atau `sidebar`.
4. **Layar penuh.**
   - Jendela kaca tidak lagi bergelagar atau membulat di layar lebar. Isi memakai seluruh lebar di kedua tampilan.
   - Dalam mode dock konten diberi ruang bawah agar tidak tertutup dock.
   - Dock dirender di luar kaca, karena `backdrop-filter` menjadi containing block bagi `position: fixed`.
5. **Palet perintah** kini bisa dikendalikan dari luar (`open`/`onOpenChange`) agar tombol Cari di dock membukanya. Tanpa prop itu, perilakunya tetap seperti sebelumnya.

## Pengujian

- Unit `@simrs/ui`:
  - buka/tutup stack, Esc mengembalikan fokus, satu stack sekaligus, klik luar;
  - tautan tetap di DOM, grup satu layar, Cari;
  - AppShell mode dock.
- Unit web: `parseNavLayout` dan `NAV_LAYOUT`.
- E2E `e2e/demo/dock.spec.ts`:
  - cookie dock menang atas bawaan;
  - stack, Esc, klik luar, navigasi, stack Akun, tanpa scroll horizontal;
  - Cari → palet;
  - pilihan Sidebar bertahan setelah muat ulang.
- Suite E2E lain berjalan dengan `NAV_LAYOUT=sidebar` (webServer Playwright), karena menguji isi menu lewat sidebar yang selalu terlihat.

## Konsekuensi

- Tidak ada dependensi baru.
- Pengguna yang lebih suka sidebar memilihnya sekali per peramban. RS dapat menetapkan bawaan lewat `NAV_LAYOUT`.
- Tangkapan layar panduan perlu dibuat ulang untuk tampilan dock (CD-5).
