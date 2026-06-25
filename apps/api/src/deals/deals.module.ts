import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DealsService } from './deals.service';
import { DealsController } from './deals.controller';
import { Deal } from './entities/deal.entity';
import { Message } from '../messages/entities/message.entity';
import { MessagesService } from '../messages/messages.service';

@Module({
  imports: [TypeOrmModule.forFeature([Deal, Message])],
  controllers: [DealsController],
  providers: [DealsService, MessagesService],
  exports: [DealsService],
})
export class DealsModule {}
