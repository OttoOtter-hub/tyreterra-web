import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ListingsService } from './listings.service';
import { ListingsController } from './listings.controller';
import { ListingsExportService } from './listings-export.service';
import { ListingsImportService } from './listings-import.service';
import { Listing } from './entities/listing.entity';
import { AuditLog } from '../audit/entities/audit-log.entity';
import { Company } from '../companies/entities/company.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Listing, AuditLog, Company])],
  controllers: [ListingsController],
  providers: [ListingsService, ListingsExportService, ListingsImportService],
  exports: [ListingsService, ListingsExportService],
})
export class ListingsModule {}
