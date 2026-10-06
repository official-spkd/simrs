import { describe, expect, it } from 'vitest';
import { parseNavLayout } from './nav-layout';
import { webEnv } from './server/web-env';

describe('tampilan navigasi (ADR-0092)', () => {
  it('cookie hanya menerima dock/sidebar', () => {
    expect(parseNavLayout('dock')).toBe('dock');
    expect(parseNavLayout('sidebar')).toBe('sidebar');
    expect(parseNavLayout('DOCK')).toBeNull();
    expect(parseNavLayout('<script>')).toBeNull();
    expect(parseNavLayout(undefined)).toBeNull();
  });

  it('bawaan server dock; NAV_LAYOUT=sidebar mengubahnya; nilai lain diabaikan', () => {
    expect(webEnv({ APP_ENV: 'local' }).navLayout).toBe('dock');
    expect(webEnv({ APP_ENV: 'local', NAV_LAYOUT: ' Sidebar ' }).navLayout).toBe('sidebar');
    expect(webEnv({ APP_ENV: 'local', NAV_LAYOUT: 'atas' }).navLayout).toBe('dock');
  });
});
