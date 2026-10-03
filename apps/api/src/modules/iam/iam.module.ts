import { Module } from '@nestjs/common';
import { IamController } from './iam.controller';
import { IamRepository } from './iam.repository';
import { IamService } from './iam.service';

/** P02/P03 · Manajemen pengguna, penugasan, dan matriks izin. */
@Module({ controllers: [IamController], providers: [IamService, IamRepository] })
export class IamModule {}
