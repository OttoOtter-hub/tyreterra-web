import {
  Controller, Get, Post, Body, Param, UseGuards, Request, ParseUUIDPipe,
} from '@nestjs/common';
import { DealsService } from './deals.service';
import { MessagesService } from '../messages/messages.service';
import { CreateMessageDto } from '../messages/dto/create-message.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { User } from '../auth/entities/user.entity';

@Controller('deals')
@UseGuards(JwtAuthGuard)
export class DealsController {
  constructor(
    private readonly dealsService: DealsService,
    private readonly messagesService: MessagesService,
  ) {}

  @Get()
  findMine(@Request() req: { user: User }) {
    return this.dealsService.findMine(req.user);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string, @Request() req: { user: User }) {
    return this.dealsService.findOne(id, req.user);
  }

  // ── In-deal chat (§7.3) ──────────────────────────────────────────────────

  @Get(':id/messages')
  getMessages(@Param('id', ParseUUIDPipe) id: string, @Request() req: { user: User }) {
    return this.messagesService.findAll(id, req.user);
  }

  @Post(':id/messages')
  sendMessage(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateMessageDto,
    @Request() req: { user: User },
  ) {
    return this.messagesService.send(id, dto, req.user);
  }
}
