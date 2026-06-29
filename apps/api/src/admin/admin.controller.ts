import {
  Controller, Get, Post, Patch, Delete, Body, Param, Query,
  UseGuards, Request, ParseUUIDPipe, Res,
} from '@nestjs/common';
import { Response } from 'express';
import { AdminService } from './admin.service';
import { ListingsExportService } from '../listings/listings-export.service';
import { ApproveUserDto } from './dto/approve-user.dto';
import { SetRoleDto } from './dto/set-role.dto';
import { AuditLogQueryDto } from './dto/audit-log-query.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminGuard } from './guards/admin.guard';
import { User } from '../auth/entities/user.entity';

@Controller('admin')
@UseGuards(JwtAuthGuard, AdminGuard)
export class AdminController {
  constructor(
    private readonly adminService: AdminService,
    private readonly exportService: ListingsExportService,
  ) {}

  // ── KPI Dashboard ────────────────────────────────────────────────────────
  @Get('dashboard')
  dashboard() {
    return this.adminService.getDashboard();
  }

  // ── User approval queue ──────────────────────────────────────────────────
  @Get('users/pending')
  pendingUsers() {
    return this.adminService.getPendingUsers();
  }

  @Post('users/:id/approve')
  approveUser(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ApproveUserDto,
    @Request() req: { user: User },
  ) {
    return this.adminService.approveOrReject(id, dto, req.user);
  }

  @Post('users/:id/block')
  blockUser(@Param('id', ParseUUIDPipe) id: string, @Request() req: { user: User }) {
    return this.adminService.blockUser(id, req.user);
  }

  @Post('users/:id/unblock')
  unblockUser(@Param('id', ParseUUIDPipe) id: string, @Request() req: { user: User }) {
    return this.adminService.unblockUser(id, req.user);
  }

  @Patch('users/:id/role')
  setRole(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetRoleDto,
    @Request() req: { user: User },
  ) {
    return this.adminService.setRole(id, dto.role, req.user);
  }

  // ── Listing moderation ───────────────────────────────────────────────────
  @Delete('listings/:id')
  removeListing(@Param('id', ParseUUIDPipe) id: string, @Request() req: { user: User }) {
    return this.adminService.removeListing(id, req.user);
  }

  // ── Export all listings ──────────────────────────────────────────────────
  @Get('listings/export')
  async exportAll(@Res() res: Response) {
    const buf = await this.exportService.exportAll();
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="all-listings.xlsx"',
    });
    res.send(buf);
  }

  // ── VAT override ─────────────────────────────────────────────────────────
  @Post('companies/:id/vat-verify')
  overrideVat(@Param('id', ParseUUIDPipe) id: string, @Request() req: { user: User }) {
    return this.adminService.overrideVat(id, req.user);
  }

  // ── Audit log ─────────────────────────────────────────────────────────────
  @Get('audit-log')
  auditLog(@Query() query: AuditLogQueryDto) {
    return this.adminService.getAuditLog(query);
  }

  // ── Ratings ───────────────────────────────────────────────────────────────
  @Post('companies/:id/recalculate-rating')
  recalculateRating(@Param('id', ParseUUIDPipe) id: string) {
    return this.adminService.recalculateRating(id);
  }
}
