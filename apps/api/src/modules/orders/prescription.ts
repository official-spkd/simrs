import type { ClinicalPdfInput } from '@simrs/pdf';
import { MEDICATION_FREQUENCIES, type OrderGroup } from '@simrs/shared';

/**
 * Isi PDF resep (ADR-0029) dari kiriman order TERSIMPAN (isi beku, bukan masukan klien): tabel obat aktif (racikan
 * dengan komponennya), alergi tercatat, dan peringatan CDS yang di-override beserta alasannya, sehingga apoteker
 * melihat keputusan dokter di lembar yang sama. Dipakai saat kirim (penulis berwenang TTE) dan saat DPJP meninjau order
 * residen; tanpa jam render.
 */
export function prescriptionSections(
  group: OrderGroup,
  allergies: readonly string[],
  /** Override CDS atas obat kiriman ini: `{ name, message, reason }` (`OrdersView.medicationOverrides`). */
  overrides: ReadonlyArray<{ name: string; message: string; reason: string | null }>,
): ClinicalPdfInput['sections'] {
  const meds = group.medicationRequests.filter((m) => m.status !== 'dibatalkan');
  const rows = meds.map((m) => {
    const name = m.compound
      ? `${m.name} (racikan ${m.compound.quantity} ${m.compound.dosageForm}): ${m.compound.components
          .map((c) => `${c.name} ${c.amount}`)
          .join(', ')}`
      : m.name;
    const freq = MEDICATION_FREQUENCIES[m.frequency].label;
    const times = m.customTimes.length ? ` (${m.customTimes.join(', ')} WIB)` : '';
    return [
      name,
      m.dose,
      m.route,
      `${freq}${times}`,
      m.durationDays ? `${m.durationDays} hari` : '—',
      m.instructions ?? '—',
    ];
  });
  return [
    {
      title: 'Resep',
      blocks: [
        {
          kind: 'table',
          columns: ['Obat', 'Dosis', 'Rute', 'Aturan pakai', 'Lama', 'Keterangan'],
          widths: [4, 1.4, 1.2, 2.2, 1, 2],
          rows,
        },
      ],
    },
    {
      title: 'Keselamatan',
      blocks: [
        {
          kind: 'fields',
          rows: [{ label: 'Alergi tercatat', value: allergies.length ? allergies.join(', ') : 'Tidak ada' }],
        },
        ...(overrides.length
          ? [
              {
                kind: 'list' as const,
                items: overrides.map(
                  (o) => `Override CDS · ${o.name}: ${o.message} Alasan: ${o.reason ?? '—'}`,
                ),
              },
            ]
          : []),
      ],
    },
  ];
}

/** Ada obat aktif yang perlu lembar resep. */
export const hasPrescription = (group: OrderGroup) =>
  group.medicationRequests.some((m) => m.status !== 'dibatalkan');
