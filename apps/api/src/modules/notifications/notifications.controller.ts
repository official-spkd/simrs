import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { TenantScoped } from '../../common/tenant-scoped.decorator';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { NotificationsService } from './notifications.service';

const listQuery = z.strictObject({
  unread: z.enum(['true', 'false']).default('false'),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

/**
 * P09 · Notifikasi milik pengguna yang login (tanpa izin khusus: setiap staf berhak atas notifikasinya sendiri).
 * Isi notifikasi tanpa PHI, jadi membaca daftar ini tidak dicatat sebagai akses data pasien.
 */
@ApiTags('notifications (P09)')
@TenantScoped()
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  list(@Query(new ZodValidationPipe(listQuery)) q: z.infer<typeof listQuery>) {
    return this.notifications.list({ unreadOnly: q.unread === 'true', limit: q.limit });
  }

  @Get('unread-count')
  async unreadCount() {
    return { unread: await this.notifications.unreadCount() };
  }

  @Post('read-all')
  @HttpCode(200)
  markAllRead() {
    return this.notifications.markAllRead();
  }

  @Post(':id/read')
  @HttpCode(200)
  markRead(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.notifications.markRead(id);
  }
}
