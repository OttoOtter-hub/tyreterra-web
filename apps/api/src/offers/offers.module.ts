import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OffersService } from './offers.service';
import { OffersController } from './offers.controller';
import { Offer } from './entities/offer.entity';
import { Request } from '../requests/entities/request.entity';
import { Deal } from '../deals/entities/deal.entity';
import { Company } from '../companies/entities/company.entity';
import { AuditLog } from '../audit/entities/audit-log.entity';
import { EncryptionService } from '../common/encryption.service';

@Module({
  imports: [TypeOrmModule.forFeature([Offer, Request, Deal, Company, AuditLog])],
  controllers: [OffersController],
  providers: [OffersService, EncryptionService],
  exports: [OffersService, EncryptionService],
})
export class OffersModule {}
