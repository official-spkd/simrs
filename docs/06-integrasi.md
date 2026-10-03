# 06 · Integrasi dan mock

> Kontrak di bawah adalah **rangkuman untuk membangun mock dan lapisan konektor**. Sebelum integrasi nyata, setiap konektor wajib dicocokkan dengan dokumen resmi yang diterima RS: katalog/trust mark API BPJS Kesehatan, dokumentasi SATUSEHAT (Kemenkes DTO), manual web service E-Klaim INA-CBG, serta spesifikasi API TPDI dan BTN. Bila ada perbedaan, dokumen resmi yang benar; perbarui file ini.

## 1. Pola umum konektor

```
packages/shared/src/integrations/<sistem>/contract.ts   ← tipe request/response (zod)
apps/api/src/modules/integration-hub/connectors/<sistem>/
  <sistem>.connector.ts        ← interface (dipakai modul domain)
  <sistem>.http.ts             ← implementasi HTTP (mock/sandbox/production sama)
  <sistem>.mapper.ts           ← domain ↔ kontrak
apps/worker/src/processors/<sistem>.processor.ts   ← kirim dari outbox, retry, DLQ
apps/mock/src/<sistem>/        ← server tiruan + skenario
```
- Base URL dan kredensial per tenant di `tenant_settings` (terenkripsi). Lokal: semua mengarah ke `http://localhost:4100/<sistem>`.
- Setiap panggilan keluar dicatat di `delivery_attempts` (request/response tersamar, durasi, kode).
- Kode galat eksternal dipetakan ke kode internal stabil (`BPJS_PESERTA_TIDAK_AKTIF`, `SATUSEHAT_PATIENT_NOT_FOUND`, dst.).

## 2. BPJS Kesehatan

### Autentikasi (dirangkum)
Header per request: `X-cons-id`, `X-timestamp` (detik UTC), `X-signature` = Base64(HMAC-SHA256(`consId&timestamp`, secretKey)), `user_key`. Respons layanan VClaim/Antrean v2 terenkripsi (AES-256-CBC dengan kunci turunan `consId + secretKey + timestamp`, lalu dekompresi LZ-string). **Mock wajib meniru tanda tangan dan enkripsi ini** (bisa dimatikan lewat flag untuk debugging) agar konektor teruji sejak awal.

### VClaim (dipakai F06, U05)
| Operasi | Kegunaan |
|---|---|
| Peserta by NIK / no. kartu | cek kepesertaan, hak kelas, status aktif |
| Rujukan by no. rujukan / no. kartu | validasi rujukan FKTP/RS |
| Insert/update/hapus SEP | penerbitan SEP RJ/RI |
| Rencana kontrol / SPRI | surat kontrol dan surat perintah rawat inap |
| Monitoring klaim / histori pelayanan | dipakai klaim dan rekonsiliasi |

### Antrean RS (F02–F05)
| Operasi | Kegunaan |
|---|---|
| Tambah antrean | daftar booking ke BPJS (kode booking, poli, dokter, jam, estimasi) |
| Update waktu (task id 1–7, 99 batal) | 1 mulai tunggu admisi · 2 mulai layan admisi · 3 mulai tunggu poli · 4 mulai layan poli · 5 mulai tunggu farmasi · 6 mulai layan farmasi · 7 obat selesai |
| Batal antrean, list task | sinkron status |
| Jadwal dokter (HFIS) | baca/perbarui jadwal dan kuota |

Task id dikirim otomatis dari event domain (lihat simulasi rawat jalan). Waktu dikirim dalam milidetik epoch.

### Aplicare
Ketersediaan tempat tidur per kelas, diperbarui dari papan bed (K05) saat status berubah.

## 3. E-Klaim INA-CBG (U05)

Aplikasi E-Klaim berjalan di server lokal RS dan menerima JSON terenkripsi (kunci enkripsi dari aplikasi E-Klaim). Alur metode: `new_claim` → `set_claim_data` (diagnosa, prosedur, tarif RS per kategori, kelas, LOS, cara pulang) → `grouper` (stage 1, lalu stage 2 bila ada special CMG) → `claim_final` → `send_claim_individual` / kirim kolektif → status verifikasi.
Mock E-Klaim menyediakan grouper tiruan berbasis tabel kecil (kode CBG dan tarif **simulasi**) agar alur end-to-end bisa diuji.

## 4. SATUSEHAT (I02)

| Item | Ringkasan |
|---|---|
| Token | OAuth2 client credentials (`client_id`, `client_secret` per organisasi) → access token berumur terbatas; cache dan perbarui sebelum kedaluwarsa |
| Base FHIR | FHIR R4; resource `Organization`, `Location`, `Practitioner`, `Patient` (lookup IHS by NIK), `Encounter`, `Condition`, `Observation`, `Procedure`, `ServiceRequest`, `Specimen`, `DiagnosticReport`, `ImagingStudy`, `Medication*`, `AllergyIntolerance`, `Composition` |
| Urutan | Encounter dulu, lalu resource anak yang mereferensikan Encounter |
| Identitas | Organization ID dan Location ID didaftarkan sekali per tenant (P01); IHS pasien dan praktisi di-lookup lalu disimpan di `external_ids` |

Mock SATUSEHAT: token endpoint, lookup IHS by NIK (data fiktif), POST/PUT resource dengan validasi minimal (wajib `subject`, `encounter`), dan skenario galat 401/422/429/5xx. Opsional: profil Docker `fhir` menjalankan HAPI FHIR untuk validasi resource yang lebih ketat.

## 5. Dukcapil, TTE, WhatsApp

- **Dukcapil** (P05): verifikasi NIK → data demografi fiktif di mock.
- **TTE** (P10): kirim hash dokumen + identitas penanda tangan → tanda tangan + sertifikat tiruan; verifikasi.
- **WhatsApp/SMS**: lokal hanya ditulis ke tabel notifikasi + Mailpit; konektor nyata ditentukan kemudian.

## 6. TPDI dan BTN
Lihat `07-pembayaran-btn-tpdi.md`.

## 7. Panel kendali mock (`http://localhost:4100`)

Halaman sederhana untuk pengembang dan demo:
- Status tiap mock + log 50 request terakhir.
- Pengatur skenario per sistem: normal, lambat (latensi N detik), gagal (kode N), acak.
- Pemicu manual: bayar tagihan VA/QRIS, kirim ulang webhook (callback ganda), kedaluwarsakan tagihan, setujui/tolak pembiayaan, cairkan pembiayaan, BPJS bayar klaim, verifikator ubah status klaim (layak bayar/pending/dispute), unggah mutasi BTN.
- Reset data mock.
