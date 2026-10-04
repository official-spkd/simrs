import { formatJam, type MailSendRequest, type WhatsappSendRequest } from '@simrs/shared';
import { z } from 'zod';
import { type OutboxOperation, PermanentOperationError } from './operation-types';

/** Payload pesan: hanya ID tantangan login; kode dibaca dan didekripsi saat dikirim. */
const payloadSchema = z.object({ challengeId: z.uuid() });

/**
 * P02 · Kode cadangan login (mockup Login: "Kirim kode lewat WhatsApp") ke WhatsApp/email akun. Tantangan yang
 * sudah dipakai/kedaluwarsa atau kodenya sudah diganti kanal lain dilewati. Respons tidak disimpan.
 */
export const sendBackupCode: OutboxOperation = {
  sensitive: true,
  async prepare(msg, ctx) {
    const p = payloadSchema.safeParse(msg.payload);
    if (!p.success) throw new PermanentOperationError('Payload kode cadangan tidak dikenali');
    const ch = await ctx.read((tx) =>
      tx.loginChallenge.findUnique({
        where: { id: p.data.challengeId },
        select: {
          otpEnc: true,
          otpChannel: true,
          consumedAt: true,
          expiresAt: true,
          user: { select: { email: true, phoneEnc: true, status: true } },
        },
      }),
    );
    if (!ch?.otpEnc) return { skip: 'tantangan tidak ditemukan' };
    if (ch.consumedAt || ch.expiresAt <= new Date()) return { skip: 'tantangan sudah selesai' };
    if (ch.otpChannel !== msg.target) return { skip: 'kode sudah dikirim ulang lewat kanal lain' };
    if (ch.user.status !== 'active') return { skip: 'akun nonaktif' };
    let code: string;
    try {
      code = ctx.decryptLoginOtp(ch.otpEnc);
    } catch {
      throw new PermanentOperationError('Kode cadangan tidak bisa dibaca');
    }
    const text = `Kode masuk SIM RS: ${code}. Berlaku sampai pukul ${formatJam(ch.expiresAt)} WIB. Jangan berikan kode ini kepada siapa pun, termasuk petugas SIM RS.`;
    if (msg.target === 'whatsapp') {
      if (!ch.user.phoneEnc) return { skip: 'akun tanpa no. HP' };
      const body: WhatsappSendRequest = { to: ctx.decryptStaffPhone(ch.user.phoneEnc), text };
      return { method: 'POST', path: '/whatsapp/send', body };
    }
    if (!ch.user.email) return { skip: 'akun tanpa email' };
    const body: MailSendRequest = { to: ch.user.email, subject: '[SIM RS] Kode masuk', text };
    return { method: 'POST', path: '/email/send', body };
  },
};
