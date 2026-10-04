import 'server-only';

/**
 * Jalur `api` untuk domain yang backend-nya belum dibangun (ADR-0023). Halaman domain itu berstatus `demo` di
 * registri layar sehingga jalur ini tidak pernah tercapai; bila tercapai, gagal keras alih-alih menebak endpoint.
 */
export function notImplemented(domain: string): never {
  throw new Error(`Backend ${domain} belum tersedia; layar ini hanya ada di mode presentasi (ADR-0023).`);
}
