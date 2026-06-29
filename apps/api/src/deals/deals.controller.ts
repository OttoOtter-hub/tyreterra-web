import {
  Controller, Get, Post, Body, Param, UseGuards, Request, ParseUUIDPipe,
  UseInterceptors, UploadedFile, BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname } from 'path';
import { randomUUID } from 'crypto';
import { DealsService } from './deals.service';
import { MessagesService } from '../messages/messages.service';
import { CreateMessageDto } from '../messages/dto/create-message.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { User } from '../auth/entities/user.entity';

const ALLOWED_MIME = [
  'image/jpeg', 'image/png', 'image/webp', 'image/gif',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
];

const uploadStorage = diskStorage({
  destination: '/var/www/uploads',
  filename: (_req, file, cb) => {
    const ext = extname(file.originalname).toLowerCase();
    cb(null, `${randomUUID()}${ext}`);
  },
});

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

  @Post(':id/confirm-receipt')
  confirmReceipt(@Param('id', ParseUUIDPipe) id: string, @Request() req: { user: User }) {
    return this.dealsService.confirmReceipt(id, req.user);
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

  @Post(':id/messages/upload')
  @UseInterceptors(FileInterceptor('file', {
    storage: uploadStorage,
    limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
    fileFilter: (_req, file, cb) => {
      if (ALLOWED_MIME.includes(file.mimetype)) {
        cb(null, true);
      } else {
        cb(new BadRequestException('File type not allowed'), false);
      }
    },
  }))
  uploadFile(
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: Express.Multer.File,
    @Body('body') body: string | undefined,
    @Request() req: { user: User },
  ) {
    if (!file) throw new BadRequestException('No file provided');
    return this.messagesService.sendFile(id, file, body, req.user);
  }
}
