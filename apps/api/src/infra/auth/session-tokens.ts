import { timingSafeEqual } from 'node:crypto';
import { hashToken, randomToken } from '@simrs/shared/node';

/**
 * Token buram: `<awalan>.<tenantId>.<id>.<rahasia>`.
 * - awalan membedakan jenis (sa1 akses, sr1 refresh, sc1 tantangan MFA, st1 perangkat tepercaya, sd1 perangkat
 *   ber-PIN) sehingga token tidak bisa dipakai silang;
 * - tenantId hanya petunjuk untuk membuka transaksi bertenant: memalsukannya membuat sesi tidak ditemukan (RLS);
 * - rahasia 256 bit; database hanya menyimpan hash SHA-256-nya.
 */
export type TokenKind = 'sa1' | 'sr1' | 'sc1' | 'st1' | 'sd1';

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const TOKEN = new RegExp(`^(sa1|sr1|sc1|st1|sd1)\\.(${UUID})\\.(${UUID})\\.([A-Za-z0-9_-]{43})$`);

export interface ParsedToken {
  kind: TokenKind;
  tenantId: string;
  id: string;
  secret: string;
}

export function issueToken(kind: TokenKind, tenantId: string, id: string): { token: string; hash: string } {
  const secret = randomToken();
  return { token: `${kind}.${tenantId}.${id}.${secret}`, hash: hashToken(secret) };
}

export function parseToken(token: string, expected: TokenKind): ParsedToken | null {
  const m = TOKEN.exec(token);
  if (!m || m[1] !== expected) return null;
  return { kind: expected, tenantId: m[2] as string, id: m[3] as string, secret: m[4] as string };
}

/** Bandingkan rahasia dengan hash tersimpan secara waktu-konstan. */
export function secretMatches(secret: string, storedHash: string | null | undefined): boolean {
  if (!storedHash) return false;
  const a = Buffer.from(hashToken(secret), 'hex');
  const b = Buffer.from(storedHash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Ambil token dari header `Authorization: Bearer …`. */
export function bearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const m = /^Bearer ([A-Za-z0-9._-]{20,300})$/.exec(header);
  return m ? (m[1] as string) : null;
}
