import { type AppEnv, resolveAppEnv } from '@simrs/shared';

/**
 * Sumber data layar yang backend-nya belum ada (ADR-0023): `demo` = data dummy fiktif untuk presentasi,
 * `api` = backend sungguhan. Layar fase 1 (Akses, Audit, Formulir, MPI) selalu memakai API.
 */
export type DataSource = 'api' | 'demo';

export interface WebEnv {
  appEnv: AppEnv;
  apiBaseUrl: string;
  /** Kolom "Kode RS" di layar masuk (lokal/staging). Produksi: RS ditentukan dari subdomain. */
  tenantCodeField: boolean;
  /** Isi awal kolom "Kode RS" (`LOGIN_TENANT_CODE`; lokal bawaan RSCM, keputusan pengguna 4 Okt 2026). */
  loginTenantCode: string;
  /** Cookie Secure + `__Host-` di luar lokal (lokal memakai http://localhost). */
  secureCookies: boolean;
  /** Mode presentasi hanya bila `APP_ENV=local` DAN `DATA_SOURCE=demo`; staging/produksi selalu `api`. */
  dataSource: DataSource;
}

/** Kode RS awal di layar masuk: dari env bila sah, selain itu RSCM di lokal; kosong di luar lokal. */
function tenantCodeDefault(raw: string | undefined, appEnv: AppEnv): string {
  const code = raw?.trim().toUpperCase() ?? '';
  if (/^[A-Z0-9][A-Z0-9-]{1,29}$/.test(code)) return code;
  return appEnv === 'local' ? 'RSCM' : '';
}

/** Konfigurasi web dari env server, gagal aman: APP_ENV tak disetel/tak dikenal = production. */
export function webEnv(source: Record<string, string | undefined> = process.env): WebEnv {
  const appEnv = resolveAppEnv(source.APP_ENV);
  return {
    appEnv,
    apiBaseUrl: source.API_BASE_URL ?? 'http://localhost:4000',
    tenantCodeField: appEnv !== 'production',
    loginTenantCode: tenantCodeDefault(source.LOGIN_TENANT_CODE, appEnv),
    secureCookies: appEnv !== 'local',
    dataSource: appEnv === 'local' && source.DATA_SOURCE?.trim().toLowerCase() === 'demo' ? 'demo' : 'api',
  };
}
