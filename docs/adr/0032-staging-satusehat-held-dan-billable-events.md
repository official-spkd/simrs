# ADR-0032 · Staging lintas fase: SATUSEHAT `held` dan peristiwa biaya tanpa harga

Status: diterima · 6 Okt 2026 (fase 3 potongan 3.1) · Komponen: I03 (SATUSEHAT), U01 (charge capture), K01–K15

## Konteks

Fase 3 menghasilkan data yang kelak dikirim ke SATUSEHAT (Encounter, Condition, Observation, Procedure,
AllergyIntolerance, ServiceRequest, MedicationRequest, MedicationAdministration, Composition). Data yang sama juga
kelak ditagih (visite, admisi, transfer, pulang, IGD, lab, radiologi, tindakan, obat). Konektor SATUSEHAT baru
dibangun di fase 7, dan master tarif U01 baru ada di fase 5. Bila pencatatan ditunda sampai fase itu, entri fase 3
harus dipindai ulang, dan urutan serta kelengkapannya tidak terjamin. Rencana fase 3 (keputusan 13 dan 14) memutuskan
pencatatan dilakukan sekarang.

## Keputusan

1. **SATUSEHAT = pesan outbox berstatus `held`.**
   - `SatusehatRecorder.record(resource, sourceId, revision)` menulis pesan di transaksi yang sama dengan entrinya.
   - Bentuk pesan:
     - operasi `satusehat.<resource>.upsert` (registri `CLINICAL_OPERATIONS`);
     - payload `{ sourceId, revision }` saja, tanpa PHI;
     - kunci idempotensi `<operasi>:<sourceId>:<revision>`;
     - status `held` (`enqueueOutbox(..., { held: true })`).
   - Dispatcher hanya mengklaim `pending`/`failed`/`processing`, sehingga pesan `held` tidak pernah dikirim. Hal ini
     dibuktikan tes db, API, dan worker.
   - Fase 7 melepas pesan `held` berurutan, Encounter dulu. Worker membaca data terbaru saat `prepare` dan melewati
     revisi yang sudah usang (pola HFIS).
2. **Biaya = `billable_events` tanpa harga.**
   - `BillableRecorder.record({ encounterId, patientId, sourceType, sourceId, kind, quantity, occurredAt })` mencatat
     di transaksi yang sama.
   - Tabel append-only dan unik per `(sumber, id, jenis)`; pencatatan ulang diabaikan (`skipDuplicates`).
   - Koreksi entri klinis tidak menambah biaya ganda. Pemanggil memakai `rootId` entri sebagai `sourceId` bila
     biayanya per entri, bukan per versi.
   - Fase 5 memberi harga dan membentuk `charge_items`. CPOE mode api menyembunyikan nominal sampai U01 (keputusan 14).
3. **Satu transaksi.** Kedua perekam memakai transaksi permintaan (`TenantDb`). Bila entri batal, staging ikut
   batal; tidak ada staging tanpa entri, dan tidak ada entri tanpa staging.

## Konsekuensi

- `outbox_messages` berisi pesan `held` yang menumpuk sampai fase 7 (rencana §5, volume). Indeks status yang ada
  cukup; layar Integration Hub fase 7 menampilkannya sebagai antrean staging.
- `billable_events` menumpuk sampai fase 5 tanpa nilai uang, sehingga tidak ada risiko jurnal.
- Modul klinis tidak memanggil outbox atau tabel biaya langsung. Jenis resource dan jenis biaya baru harus ditambah di
  registri shared (`SATUSEHAT_RESOURCES`) dan CHECK `billable_events_values_valid`.
