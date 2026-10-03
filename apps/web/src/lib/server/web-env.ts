import { type AppEnv, resolveAppEnv } from '@simrs/shared';

export interface WebEnv {
  appEnv: AppEnv;
  apiBaseUrl: string;
  /** Kolom "Kode RS" di layar masuk (lokal/staging). Produksi: RS ditentukan dari subdomain. */
  tenantCodeField: boolean;
  /** Cookie Secure + `__Host-` di luar lokal (lokal memakai http://localhost). */
  secureCookies: boolean;
}

/** Konfigurasi web dari env server, gagal aman: APP_ENV tak disetel/tak dikenal = production. */
export function webEnv(source: Record<string, string | undefined> = process.env): WebEnv {
  const appEnv = resolveAppEnv(source.APP_ENV);
  return {
    appEnv,
    apiBaseUrl: source.API_BASE_URL ?? 'http://localhost:4000',
    tenantCodeField: appEnv !== 'production',
    secureCookies: appEnv !== 'local',
  };
}
