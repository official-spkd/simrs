import { formatTanggalWaktu, type PrintableTicket } from '@simrs/shared';

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ESCAPES[c] ?? c);

/** CSP halaman tiket: tanpa skrip, tanpa sumber luar; hanya gaya sebaris. */
export const TICKET_HTML_CSP = "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'self'";

/**
 * F05 · Tiket antrean siap cetak di printer termal 80 mm (keputusan fase 2 no. 10): HTML mandiri tanpa skrip, tanpa
 * identitas pasien (hanya nomor, tujuan, lokasi, perkiraan, kode booking/SEP). Dipakai anjungan; kelak juga loket.
 */
export function renderTicketHtml(t: PrintableTicket): string {
  const rows: string[] = [];
  if (t.estimatedWaitMinutes !== null) {
    rows.push(
      t.estimatedWaitMinutes === 0
        ? 'Perkiraan dipanggil: sebentar lagi'
        : `Perkiraan dipanggil: ± ${t.estimatedWaitMinutes} menit`,
    );
  }
  if (t.bookingCode) rows.push(`Kode booking: ${t.bookingCode}`);
  if (t.sepNo) rows.push(`SEP: ${t.sepNo}`);
  return `<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8">
<title>Tiket ${esc(t.queueNo)}</title>
<style>
@page { size: 80mm auto; margin: 4mm; }
* { box-sizing: border-box; }
body { margin: 0; width: 72mm; font-family: system-ui, sans-serif; color: #000; background: #fff; text-align: center; }
.rs { font-size: 12pt; font-weight: 700; margin: 0 0 2mm; }
.label { font-size: 9pt; letter-spacing: 0.08em; margin: 3mm 0 0; }
.no { font-family: ui-monospace, monospace; font-size: 40pt; font-weight: 700; line-height: 1.1; margin: 1mm 0; }
.dest { font-size: 13pt; font-weight: 700; margin: 0; }
.loc { font-size: 10pt; margin: 1mm 0 3mm; }
.row { font-size: 9pt; margin: 0.5mm 0; }
.foot { font-size: 8pt; border-top: 1px dashed #000; margin-top: 3mm; padding-top: 2mm; }
</style>
</head>
<body>
<p class="rs">${esc(t.tenantName)}</p>
<p class="label">NOMOR ANTREAN</p>
<p class="no">${esc(t.queueNo)}</p>
<p class="dest">${esc(t.destination)}</p>
<p class="loc">${esc(t.location)}</p>
${rows.map((r) => `<p class="row">${esc(r)}</p>`).join('\n')}
<p class="foot">Diambil ${esc(formatTanggalWaktu(t.issuedAt))} WIB · simpan tiket ini sampai nomor Anda dipanggil</p>
</body>
</html>
`;
}
