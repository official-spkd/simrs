/**
 * Parser CSV kecil (RFC 4180) untuk impor data rujukan: kutip ganda, baris baru di dalam kutip, CRLF, BOM.
 * Pemisah koma, atau titik koma bila baris judul memakainya (ekspor Excel berlocale Indonesia).
 * Baris kosong dilewati. Tanpa dependensi tambahan.
 */
export function parseCsv(text: string): string[][] {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const firstLine = src.slice(0, src.search(/\r?\n|$/));
  const delimiter = firstLine.includes(';') && !firstLine.includes(',') ? ';' : ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let i = 0;
  const endRow = () => {
    row.push(field);
    field = '';
    if (!(row.length === 1 && row[0] === '')) rows.push(row);
    row = [];
  };
  while (i < src.length) {
    const c = src[i] as string;
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 2;
        } else {
          quoted = false;
          i += 1;
        }
      } else {
        field += c;
        i += 1;
      }
      continue;
    }
    if (c === '"' && field === '') {
      quoted = true;
      i += 1;
    } else if (c === delimiter) {
      row.push(field);
      field = '';
      i += 1;
    } else if (c === '\r' || c === '\n') {
      endRow();
      i += c === '\r' && src[i + 1] === '\n' ? 2 : 1;
    } else {
      field += c;
      i += 1;
    }
  }
  if (quoted) throw new Error('CSV tidak valid: tanda kutip tidak ditutup');
  if (field !== '' || row.length > 0) endRow();
  return rows;
}

export interface CsvRecord {
  /** Nomor rekaman data (baris judul = 1, rekaman pertama = 2). */
  line: number;
  values: Record<string, string>;
  /** Terisi bila jumlah sel berbeda dari baris judul (mis. koma di dalam nilai tanpa kutip). */
  malformed?: string;
}

/** Rekaman dengan nama kolom dari baris judul (huruf kecil, tanpa spasi tepi). */
export function csvRecords(text: string): { columns: string[]; records: CsvRecord[] } {
  const [header, ...rows] = parseCsv(text);
  if (!header) return { columns: [], records: [] };
  const columns = header.map((h) => h.trim().toLowerCase());
  const records = rows.map((cells, index) => ({
    line: index + 2,
    values: Object.fromEntries(columns.map((col, c) => [col, (cells[c] ?? '').trim()])),
    ...(cells.length !== columns.length
      ? {
          malformed: `berisi ${cells.length} kolom, baris judul ${columns.length} kolom (nilai yang memuat koma harus dikutip)`,
        }
      : {}),
  }));
  return { columns, records };
}
