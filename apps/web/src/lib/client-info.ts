import { isIP } from 'node:net';

export interface ClientInfo {
  /** IP klien untuk audit dan batas laju di API (null bila tidak diketahui). */
  ip: string | null;
  /** Host yang dibuka pengguna (menentukan RS dari subdomain di produksi). */
  host: string | null;
  userAgent: string | null;
}

interface HeaderReader {
  get(name: string): string | null;
}

/**
 * Info klien dari header permintaan ke web. IP = entri PALING KANAN `X-Forwarded-For`: entri yang
 * ditambahkan reverse proxy tepercaya di depan web (wajib di produksi). Entri kiri bisa dipalsukan klien.
 * Tanpa reverse proxy (lokal), Next mengisi header ini dari alamat soket bila belum ada.
 */
export function clientInfo(headers: HeaderReader): ClientInfo {
  const forwarded = headers.get('x-forwarded-for') ?? '';
  const last = forwarded
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .at(-1);
  const host = (headers.get('x-forwarded-host') ?? headers.get('host'))?.split(',')[0]?.trim();
  return {
    ip: last && isIP(last) !== 0 ? last : null,
    host: host && /^[a-z0-9.-]+(:\d{1,5})?$/i.test(host) ? host.toLowerCase() : null,
    userAgent: headers.get('user-agent')?.slice(0, 300) ?? null,
  };
}
