import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  type Booking,
  bookingCodeSchema,
  type BookingListQuery,
  bookingListQuerySchema,
  type CancelBookingInput,
  cancelBookingSchema,
  type CheckInResult,
  type CreateBookingInput,
  createBookingSchema,
  type RescheduleBookingInput,
  rescheduleBookingSchema,
} from '@simrs/shared';
import { Audited, type AuditSource, bodyReason, paramId, resultId } from '../../common/audited.decorator';
import { RequireModule } from '../../common/require-module.decorator';
import { RequirePermission } from '../../common/require-permission.decorator';
import { TenantScoped } from '../../common/tenant-scoped.decorator';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { BookingService } from './booking.service';

const uuid = new ParseUUIDPipe();

/** Pasien booking dari hasil (respons `Booking` atau `{ booking }`/`{ cancelled }`), untuk kolom audit `patientId`. */
const resultPatient = ({ result }: AuditSource): string | undefined => {
  const r = result as { patientId?: string; booking?: { patientId?: string } } | undefined;
  return r?.patientId ?? r?.booking?.patientId;
};
const bodyPatient = ({ body }: AuditSource): string | undefined =>
  (body as { patientId?: string } | undefined)?.patientId;
const resultBookingId = ({ result }: AuditSource): string | undefined =>
  (result as { booking?: { id?: string } } | undefined)?.booking?.id;
/** Rincian audit tanpa PHI: keranjang kuota dan sesi. */
const createdDetails = ({ body }: AuditSource) => {
  const b = (body ?? {}) as { quotaBucket?: unknown; sessionId?: unknown };
  return { quotaBucket: b.quotaBucket, sessionId: b.sessionId };
};

/**
 * F02 · Booking dan janji temu (`/api/v1/booking/appointments`, kontrak `@simrs/shared` `schemas/booking`). Kanal
 * staf selalu `loket`. Setiap baca/ubah booking tercatat di audit dengan pasiennya.
 */
@ApiTags('booking (F02)')
@TenantScoped()
@RequireModule('F02')
@Controller('booking/appointments')
export class BookingController {
  constructor(private readonly booking: BookingService) {}

  @RequirePermission('booking', 'write')
  @Post()
  @Audited({
    action: 'create',
    resource: 'appointment',
    resourceId: resultId,
    patientId: bodyPatient,
    details: createdDetails,
  })
  create(@Body(new ZodValidationPipe(createBookingSchema)) body: CreateBookingInput): Promise<Booking> {
    return this.booking.create(body);
  }

  @RequirePermission('booking', 'read')
  @Get()
  list(@Query(new ZodValidationPipe(bookingListQuerySchema)) q: BookingListQuery) {
    return this.booking.list(q);
  }

  @RequirePermission('booking', 'read')
  @Get('by-code/:code')
  @Audited({ action: 'read', resource: 'appointment', resourceId: resultId, patientId: resultPatient })
  getByCode(@Param('code', new ZodValidationPipe(bookingCodeSchema)) code: string): Promise<Booking> {
    return this.booking.getByCode(code);
  }

  @RequirePermission('booking', 'read')
  @Get(':id')
  @Audited({ action: 'read', resource: 'appointment', resourceId: paramId, patientId: resultPatient })
  get(@Param('id', uuid) id: string): Promise<Booking> {
    return this.booking.get(id);
  }

  @RequirePermission('booking', 'cancel')
  @Post(':id/cancel')
  @HttpCode(200)
  @Audited({
    action: 'update',
    resource: 'appointment',
    resourceId: paramId,
    patientId: resultPatient,
    reason: bodyReason,
    details: () => ({ status: 'cancelled' }),
  })
  cancel(
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(cancelBookingSchema)) body: CancelBookingInput,
  ): Promise<Booking> {
    return this.booking.cancel(id, body);
  }

  @RequirePermission('booking', 'write')
  @Post(':id/reschedule')
  @HttpCode(200)
  @Audited({
    action: 'update',
    resource: 'appointment',
    resourceId: paramId,
    patientId: resultPatient,
    reason: bodyReason,
    details: (src) => ({ status: 'rescheduled', newAppointmentId: resultBookingId(src) }),
  })
  reschedule(
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(rescheduleBookingSchema)) body: RescheduleBookingInput,
  ) {
    return this.booking.reschedule(id, body);
  }

  @RequirePermission('booking', 'write')
  @Post(':id/check-in')
  @HttpCode(200)
  @Audited({
    action: 'update',
    resource: 'appointment',
    resourceId: paramId,
    patientId: resultPatient,
    details: () => ({ status: 'checked_in' }),
  })
  checkIn(@Param('id', uuid) id: string): Promise<CheckInResult> {
    return this.booking.checkIn(id);
  }
}
