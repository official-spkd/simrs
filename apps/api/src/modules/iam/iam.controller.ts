import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  assignmentInputSchema,
  type AssignmentInput,
  createUserSchema,
  type CreateUserInput,
  endAssignmentSchema,
  rolePermissionsSchema,
  type RolePermissionsInput,
  updateUserSchema,
  type UpdateUserInput,
} from '@simrs/shared';
import { z } from 'zod';
import { Audited, bodyReason, changedFields, paramId, resultId } from '../../common/audited.decorator';
import { RequirePermission } from '../../common/require-permission.decorator';
import { TenantScoped } from '../../common/tenant-scoped.decorator';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { IamService } from './iam.service';

const schemas = {
  list: z.strictObject({
    cursor: z.uuid().optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
    search: z.string().trim().min(2).max(60).optional(),
    /** `not_activated` = aktif tetapi belum punya kata sandi (belum bisa masuk). */
    status: z.enum(['active', 'disabled', 'not_activated']).optional(),
    role: z
      .string()
      .regex(/^[a-z][a-z0-9_]{2,40}$/)
      .optional(),
    unitId: z.uuid().optional(),
  }),
  roleCode: z.string().regex(/^[a-z][a-z0-9_]{2,40}$/),
};
const uuid = new ParseUUIDPipe();

/** P03 · Pengguna, penugasan, dan matriks izin (layar /sistem/akses). Semua perubahan diaudit. */
@ApiTags('iam (P02, P03)')
@TenantScoped()
@Controller('iam')
export class IamController {
  constructor(private readonly iam: IamService) {}

  @Get('users')
  @RequirePermission('iam.users', 'read')
  listUsers(@Query(new ZodValidationPipe(schemas.list)) q: z.infer<typeof schemas.list>) {
    return this.iam.listUsers(q);
  }

  /** Angka ringkas untuk reviu akses: akun aktif, tanpa MFA, terkunci, dorman, akses darurat. */
  @Get('summary')
  @RequirePermission('iam.users', 'read')
  summary() {
    return this.iam.summary();
  }

  @Get('users/:id')
  @RequirePermission('iam.users', 'read')
  userDetail(@Param('id', uuid) id: string) {
    return this.iam.userDetail(id);
  }

  @Post('users')
  @RequirePermission('iam.users', 'write')
  @Audited({ action: 'create', resource: 'user', resourceId: resultId })
  createUser(@Body(new ZodValidationPipe(createUserSchema)) body: CreateUserInput) {
    return this.iam.createUser(body);
  }

  @Patch('users/:id')
  @RequirePermission('iam.users', 'write')
  @Audited({ action: 'update', resource: 'user', resourceId: paramId, details: changedFields })
  updateUser(
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(updateUserSchema)) body: UpdateUserInput,
  ) {
    return this.iam.updateUser(id, body);
  }

  @Post('users/:id/reset-password')
  @HttpCode(200)
  @RequirePermission('iam.users', 'write')
  @Audited({
    action: 'update',
    resource: 'user_credential',
    resourceId: paramId,
    details: () => ({ reset: 'password' }),
  })
  resetPassword(@Param('id', uuid) id: string) {
    return this.iam.resetPassword(id);
  }

  @Post('users/:id/reset-mfa')
  @HttpCode(200)
  @RequirePermission('iam.users', 'write')
  @Audited({
    action: 'update',
    resource: 'user_credential',
    resourceId: paramId,
    details: () => ({ reset: 'mfa' }),
  })
  resetMfa(@Param('id', uuid) id: string) {
    return this.iam.resetMfa(id);
  }

  /** Cabut "percayai perangkat ini" satu perangkat milik pengguna lain. ADR-0022. */
  @Post('trusted-devices/:id/revoke')
  @HttpCode(200)
  @RequirePermission('iam.users', 'write')
  @Audited({
    action: 'deactivate',
    resource: 'trusted_device',
    resourceId: paramId,
    details: () => ({ reason: 'admin_revoked' }),
  })
  revokeTrustedDevice(@Param('id', uuid) id: string) {
    return this.iam.revokeTrustedDevice(id);
  }

  /** Cabut PIN masuk cepat satu perangkat (perangkat hilang, staf pindah unit). ADR-0024. */
  @Post('pin-devices/:id/revoke')
  @HttpCode(200)
  @RequirePermission('iam.users', 'write')
  @Audited({
    action: 'deactivate',
    resource: 'registered_device',
    resourceId: paramId,
    details: () => ({ reason: 'admin_revoked' }),
  })
  revokePinDevice(@Param('id', uuid) id: string) {
    return this.iam.revokePinDevice(id);
  }

  @Post('users/:id/assignments')
  @RequirePermission('iam.users', 'write')
  @Audited({ action: 'create', resource: 'staff_assignment', resourceId: resultId, details: changedFields })
  addAssignment(
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(assignmentInputSchema)) body: AssignmentInput,
  ) {
    return this.iam.addAssignment(id, body);
  }

  @Post('assignments/:id/end')
  @HttpCode(200)
  @RequirePermission('iam.users', 'write')
  @Audited({
    action: 'update',
    resource: 'staff_assignment',
    resourceId: paramId,
    reason: bodyReason,
    details: () => ({ ended: true }),
  })
  endAssignment(
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(endAssignmentSchema)) body: z.infer<typeof endAssignmentSchema>,
  ) {
    return this.iam.endAssignment(id, body.reason);
  }

  @Get('roles')
  @RequirePermission('iam.roles', 'read')
  listRoles() {
    return this.iam.listRoles();
  }

  @Put('roles/:code/permissions')
  @RequirePermission('iam.roles', 'write')
  replaceRolePermissions(
    @Param('code', new ZodValidationPipe(schemas.roleCode)) code: string,
    @Body(new ZodValidationPipe(rolePermissionsSchema)) body: RolePermissionsInput,
  ) {
    // Audit berisi selisih izin ditulis service (TenantDb.audit) agar memuat tambah/cabut, bukan sekadar "berubah".
    return this.iam.replaceRolePermissions(code, body);
  }
}
