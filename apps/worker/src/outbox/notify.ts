import {
  type MailSendRequest,
  messageAcceptedSchema,
  notificationText,
  type WhatsappSendRequest,
} from '@simrs/shared';
import { z } from 'zod';
import { type OutboxOperation, PermanentOperationError } from './operation-types';

/** Payload pesan: hanya ID notifikasi; alamat tujuan dibaca (dan no. HP didekripsi) saat dikirim. */
const payloadSchema = z.object({ notificationId: z.uuid() });

function readPayload(payload: unknown) {
  const p = payloadSchema.safeParse(payload);
  if (!p.success) throw new PermanentOperationError('Payload notifikasi tidak dikenali');
  return p.data;
}

const select = {
  title: true,
  body: true,
  link: true,
  recipient: { select: { email: true, phoneEnc: true, status: true } },
} as const;

/** Respons penyedia hanya diperiksa bentuknya; isinya tidak disimpan (alamat tujuan = data pribadi). */
function accepted(responseBody: string): void {
  let json: unknown;
  try {
    json = JSON.parse(responseBody);
  } catch {
    throw new PermanentOperationError('Respons pengirim pesan bukan JSON');
  }
  if (!messageAcceptedSchema.safeParse(json).success) {
    throw new PermanentOperationError('Respons pengirim pesan tidak dikenali');
  }
}

/**
 * P09 · Salinan notifikasi ke email (mock `/email/send`). Alamat dibaca saat dikirim, sehingga perubahan email atau
 * akun yang dinonaktifkan sebelum terkirim ikut dihormati (dilewati).
 */
export const notifyEmail: OutboxOperation = {
  sensitive: true,
  async prepare(msg, ctx) {
    const { notificationId } = readPayload(msg.payload);
    const n = await ctx.read((tx) => tx.notification.findUnique({ where: { id: notificationId }, select }));
    if (!n) return { skip: 'notifikasi tidak ditemukan' };
    if (n.recipient.status !== 'active') return { skip: 'akun penerima nonaktif' };
    if (!n.recipient.email) return { skip: 'penerima tidak punya email' };
    const body: MailSendRequest = {
      to: n.recipient.email,
      subject: `[SIM RS] ${n.title}`,
      text: notificationText(n, ctx.webBaseUrl),
    };
    return { method: 'POST', path: '/email/send', body };
  },
  async onSuccess(_tx, _msg, responseBody) {
    accepted(responseBody);
  },
};

/** P09 · Salinan notifikasi ke WhatsApp (mock `/whatsapp/send`); no. HP staf didekripsi saat dikirim. */
export const notifyWhatsapp: OutboxOperation = {
  sensitive: true,
  async prepare(msg, ctx) {
    const { notificationId } = readPayload(msg.payload);
    const n = await ctx.read((tx) => tx.notification.findUnique({ where: { id: notificationId }, select }));
    if (!n) return { skip: 'notifikasi tidak ditemukan' };
    if (n.recipient.status !== 'active') return { skip: 'akun penerima nonaktif' };
    if (!n.recipient.phoneEnc) return { skip: 'penerima tidak punya no. HP' };
    let to: string;
    try {
      to = ctx.decryptStaffPhone(n.recipient.phoneEnc);
    } catch {
      throw new PermanentOperationError('No. HP penerima tidak bisa dibaca');
    }
    const body: WhatsappSendRequest = { to, text: notificationText(n, ctx.webBaseUrl) };
    return { method: 'POST', path: '/whatsapp/send', body };
  },
  async onSuccess(_tx, _msg, responseBody) {
    accepted(responseBody);
  },
};
