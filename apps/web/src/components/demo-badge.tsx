import { DemoDataMenu } from './demo-data-menu';

/**
 * Lencana tetap di header saat mode presentasi (ADR-0023): audiens dan presenter selalu tahu bahwa data di layar
 * adalah data dummy fiktif, bukan data pasien sungguhan. Lencana sekaligus membuka menu data demo (ringkasan toko
 * bersama + "Mulai ulang data demo", ADR-0085).
 */
export function DemoBadge() {
  return <DemoDataMenu />;
}
