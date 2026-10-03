/**
 * Uang disimpan sebagai bigint rupiah (tanpa desimal). Jangan pernah memakai number/float untuk nominal.
 */
export type Rupiah = bigint;

const THOUSANDS = /\B(?=(\d{3})+(?!\d))/g;

/** `1250400n` → `Rp 1.250.400`; negatif → `−Rp 1.250.400`. */
export function formatRupiah(amount: Rupiah): string {
  const negative = amount < 0n;
  const digits = (negative ? -amount : amount).toString().replace(THOUSANDS, '.');
  return `${negative ? '−' : ''}Rp ${digits}`;
}

/** Terima `"Rp 1.250.400"`, `"1250400"`, `"1.250.400"`, atau negatif (`-`/`−`). Menolak pecahan. */
export function parseRupiah(input: string): Rupiah {
  let s = input.trim();
  let negative = false;
  if (s.startsWith('-') || s.startsWith('−')) {
    negative = true;
    s = s.slice(1).trim();
  }
  s = s.replace(/^Rp\.?\s*/i, '');
  if (!/^\d{1,3}(\.\d{3})+$|^\d+$/.test(s)) {
    throw new RangeError(`Format rupiah tidak valid: "${input}"`);
  }
  const value = BigInt(s.replace(/\./g, ''));
  return negative ? -value : value;
}

/** Konversi dari number hanya bila bilangan bulat aman (mis. dari JSON eksternal). */
export function rupiahFromNumber(value: number): Rupiah {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`Nominal harus bilangan bulat rupiah, diterima ${value}`);
  }
  return BigInt(value);
}

export function sumRupiah(values: Iterable<Rupiah>): Rupiah {
  let total = 0n;
  for (const v of values) total += v;
  return total;
}

/** Serialisasi bigint ke string untuk JSON API (bigint tidak didukung JSON). */
export function rupiahToJson(amount: Rupiah): string {
  return amount.toString();
}
