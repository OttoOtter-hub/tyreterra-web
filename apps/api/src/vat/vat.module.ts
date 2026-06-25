import { Module } from '@nestjs/common';
import { VatService } from './vat.service';
import { VatController } from './vat.controller';

@Module({
  controllers: [VatController],
  providers: [VatService],
  exports: [VatService],
})
export class VatModule {}
