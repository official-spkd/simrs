import { describe, expect, it } from 'vitest';
import { deviceLanding, deviceRouteKind, ENROL_PATH, enrolUrl } from './perangkat';
import {
  cookieNames,
  parseDeviceToken,
  type SessionCookieOptions,
  writeDeviceCookie,
} from './server/cookies';

const TENANT = '0199a000-0000-7000-8000-000000000001';
const ID = '0199b000-0000-7000-8000-000000000001';

describe('layar perangkat (ADR-0027)', () => {
  it('mengenali rute anjungan dan display', () => {
    expect(deviceRouteKind('/kiosk')).toBe('kiosk');
    expect(deviceRouteKind('/display/antrean')).toBe('queue_display');
    expect(deviceRouteKind('/kiosks')).toBeNull();
    expect(deviceRouteKind('/displayx')).toBeNull();
    expect(deviceRouteKind('/sistem/akses')).toBeNull();
  });

  it('URL pendaftaran hanya membawa tujuan layar perangkat (anti open redirect)', () => {
    expect(enrolUrl('/display/antrean')).toBe(`${ENROL_PATH}?lanjut=%2Fdisplay%2Fantrean`);
    expect(enrolUrl('/sistem/akses')).toBe(ENROL_PATH);
    expect(enrolUrl('//evil.example/kiosk')).toBe(ENROL_PATH);
    expect(enrolUrl(null)).toBe(ENROL_PATH);
  });

  it('tujuan setelah mendaftar sesuai jenis perangkat', () => {
    expect(deviceLanding('queue_display', '/display/antrean')).toBe('/display/antrean');
    expect(deviceLanding('kiosk', '/display/antrean')).toBe('/kiosk');
    expect(deviceLanding('queue_display', 'https://evil.example')).toBe('/display/antrean');
    expect(deviceLanding('kiosk')).toBe('/kiosk');
  });

  it('cookie perangkat: hanya token dv1 sah; httpOnly, Lax, __Host- + Secure di luar lokal', () => {
    const token = `dv1.${TENANT}.${ID}.${'A'.repeat(43)}`;
    expect(parseDeviceToken(token)).toBe(token);
    expect(parseDeviceToken(token.replace('dv1', 'sd1'))).toBeNull();
    expect(parseDeviceToken(`${token};x`)).toBeNull();
    expect(parseDeviceToken(undefined)).toBeNull();
    expect(cookieNames(false).device).toBe('simrs_device');
    expect(cookieNames(true).device).toBe('__Host-simrs_device');

    const set: Array<[string, string, SessionCookieOptions]> = [];
    const w = { set: (n: string, v: string, o: SessionCookieOptions) => set.push([n, v, o]) };
    writeDeviceCookie(w, { token, expiresAt: '2027-10-05T00:00:00.000Z' }, true);
    writeDeviceCookie(w, null, true);
    expect(set[0]).toEqual([
      '__Host-simrs_device',
      token,
      {
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
        path: '/',
        expires: new Date('2027-10-05T00:00:00.000Z'),
      },
    ]);
    expect(set[1]?.[1]).toBe('');
    expect(set[1]?.[2].expires.getTime()).toBe(0);
  });
});
