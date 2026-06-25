import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RatingsService } from './ratings.service';
import { Rating } from './entities/rating.entity';
import { Deal } from '../deals/entities/deal.entity';
import { Request } from '../requests/entities/request.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Rating, Deal, Request])],
  providers: [RatingsService],
  exports: [RatingsService],
})
export class RatingsModule {}
