import 'server-only';

/**
 * F01–F06 · Data front office, satu modul per layar agar potongan fase 2 (2 jadwal, 3 booking, 4b antrean,
 * 5b pendaftaran, 6 anjungan) tidak saling bertabrakan. Halaman boleh mengimpor dari sini atau dari modul layarnya.
 * Mode presentasi memakai data dummy (divalidasi kontrak yang sama dengan API kelak) yang memproyeksikan kemajuan
 * Tn. Suryo (skenario rawat jalan); jalur api diisi tiap potongan.
 */
export { getQueueBoard } from './antrean';
export { getWeeklySchedule } from './jadwal';
export { getKioskDefaultPatient } from './kiosk';
export { getRegistrationDesk, getScenarioRegistrationPatient } from './pendaftaran';
export { demoProgress, frontOfficeActionSession } from './shared';
