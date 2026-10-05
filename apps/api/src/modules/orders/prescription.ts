import type { ClinicalPdfInput } from '@simrs/pdf';
import { MEDICATION_FREQUENCIES, type MedicationFrequency, type OrderLineInput } from '@simrs/shared';
import type { EvaluatedLine } from '../cds/cds.service';

type MedicationLine = Extract<OrderLineInput, { type: 'obat' }>;

/**
 * Isi PDF resep (ADR-0029) dari baris obat kiriman: tabel obat (racikan dengan komponennya), alergi tercatat, dan
 * peringatan CDS yang di-override beserta alasannya, sehingga apoteker melihat keputusan dokter di lembar yang sama.
 * Hanya data yang tersimpan di order (isi beku), tanpa jam render.
 */
export function prescriptionSections(
  lines: ReadonlyArray<{ input: MedicationLine; evaluated: EvaluatedLine }>,
  allergies: readonly string[],
): ClinicalPdfInput['sections'] {
  const rows = lines.map(({ input, evaluated }) => {
    const r = evaluated.resolved;
    const name =
      r.type === 'obat' && input.compound
        ? `${input.compound.name} (racikan ${input.compound.quantity} ${input.compound.dosageForm}): ${input.compound.components
            .map((c) => `${r.drugs.find((d) => d.id === c.drugId)?.name ?? 'obat'} ${c.amount}`)
            .join(', ')}`
        : evaluated.name;
    const freq = MEDICATION_FREQUENCIES[input.frequency as MedicationFrequency].label;
    const times = input.customTimes?.length ? ` (${input.customTimes.join(', ')} WIB)` : '';
    return [
      name,
      input.dose,
      input.route,
      `${freq}${times}`,
      input.durationDays ? `${input.durationDays} hari` : '—',
      input.instructions ?? '—',
    ];
  });
  const overridden = lines.flatMap(({ input, evaluated }) =>
    evaluated.overridden
      ? evaluated.findings
          .filter((f) => f.level === 'block')
          .map((f) => `${evaluated.name}: ${f.message} Alasan dokter: ${input.override ?? '—'}`)
      : [],
  );
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
        ...(overridden.length
          ? [{ kind: 'list' as const, items: overridden.map((o) => `Override CDS · ${o}`) }]
          : []),
      ],
    },
  ];
}
