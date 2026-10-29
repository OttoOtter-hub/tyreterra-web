import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ListingsService } from './listings.service';
import { ListingsController } from './listings.controller';
import { ListingsExportService } from './listings-export.service';
import { ListingsImportService } from './listings-import.service';
import { Listing } from './entities/listing.entity';
import { ListingSize } from './entities/listing-size.entity';
import { AuditLog } from '../audit/entities/audit-log.entity';
import { Company } from '../companies/entities/company.entity';
import { EncryptionService } from '../common/encryption.service';
import { ImportBatch, ImportBatchItem, ImportMapping } from './import/import.entities';
import { SmartImportService } from './import/smart-import.service';
import { SmartImportController } from './import/smart-import.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Listing, ListingSize, AuditLog, Company, ImportBatch, ImportBatchItem, ImportMapping])],
  controllers: [ListingsController, SmartImportController],
  providers: [ListingsService, ListingsExportService, ListingsImportService, SmartImportService, EncryptionService],
  exports: [ListingsService, ListingsExportService],
})
export class ListingsModule {}
