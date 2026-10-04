import { z } from 'zod';

/**
 * P09 · Notifikasi staf. Selalu tersimpan in-app; salinan dikirim ke email dan/atau WhatsApp lewat outbox bila
 * akun punya alamatnya. Isi notifikasi TIDAK memuat PHI (identitas pasien, alasan klinis): penerima membuka
 * tautan ke layar berizin untuk detailnya. Lokal: email dan WhatsApp diterima `apps/mock` (kotak masuk mock).
 */

export const NOTIFICATION_CHANNELS = ['in_app', 'email', 'whatsapp'] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

export const NOTIFY_EMAIL_OPERATION = 'notify.email';
export const NOTIFY_WHATSAPP_OPERATION = 'notify.whatsapp';

/** Kirim email (mock `/email/send`; produksi: SMTP/penyedia email). */
export const mailSendSchema = z.strictObject({
  to: z.email(),
  subject: z.string().min(1).max(200),
  text: z.string().min(1).max(5000),
});
export type MailSendRequest = z.infer<typeof mailSendSchema>;

/** Kirim WhatsApp (mock `/whatsapp/send`; produksi: WhatsApp Business API). Nomor bentuk baku `62…`. */
export const whatsappSendSchema = z.strictObject({
  to: z.string().regex(/^62\d{8,13}$/),
  text: z.string().min(1).max(1000),
});
export type WhatsappSendRequest = z.infer<typeof whatsappSendSchema>;

export const messageAcceptedSchema = z.object({ messageId: z.string().min(1).max(200) });

/** Teks pesan email/WhatsApp dari notifikasi (tautan absolut ke web, bila ada). */
export function notificationText(
  n: { title: string; body: string; link: string | null },
  webBaseUrl: string,
): string {
  const url = n.link ? new URL(n.link, webBaseUrl).toString() : null;
  return [
    n.title,
    '',
    n.body,
    ...(url ? ['', `Buka: ${url}`] : []),
    '',
    '— SIM RS (pesan otomatis, jangan dibalas)',
  ].join('\n');
}

/** Tautan notifikasi wajib path internal web (bukan URL luar): mencegah tautan phishing lewat notifikasi. */
export const notificationLinkSchema = z
  .string()
  .regex(/^\/(?!\/)[A-Za-z0-9/_\-?=&.%]*$/, 'Tautan notifikasi harus path internal')
  .max(500);
