import { Chip, Icon } from '@simrs/ui';

/**
 * Lencana tetap di header saat mode presentasi (ADR-0023): audiens dan presenter selalu tahu bahwa data di layar
 * adalah data dummy fiktif, bukan data pasien sungguhan.
 */
export function DemoBadge() {
  return (
    <Chip tone="warning" icon={<Icon name="info" size={14} />} className="font-semibold">
      <span title="Semua nama, nomor, dan angka di layar ini fiktif dan tidak tersimpan ke rekam medis">
        Mode presentasi · data fiktif
      </span>
    </Chip>
  );
}
