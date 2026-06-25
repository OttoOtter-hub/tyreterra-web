import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminService } from './admin.service';
import { AdminController } from './admin.controller';
import { User } from '../auth/entities/user.entity';
import { Company } from '../companies/entities/company.entity';
import { Listing } from '../listings/entities/listing.entity';
import { AuditLog } from '../audit/entities/audit-log.entity';
import { RatingsModule } from '../ratings/ratings.module';
import { EmailService } from '../common/email.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, Company, Listing, AuditLog]),
    RatingsModule,
  ],
  controllers: [AdminController],
  providers: [AdminService, EmailService],
})
export class AdminModule {}
