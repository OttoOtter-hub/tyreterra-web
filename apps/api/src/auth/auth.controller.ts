import { Controller, Post, Get, Body, UseGuards, Request, Req, Res, HttpCode } from '@nestjs/common';
import { ThrottlerGuard, Throttle } from '@nestjs/throttler';
import type { Request as ExpressRequest, Response } from 'express';
import { AuthService } from './auth.service';
import { SessionsService, SessionTokens } from './sessions.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { User } from './entities/user.entity';
import { clearRefreshCookie, readRefreshCookie, setRefreshCookie } from './refresh-cookie';

// The refresh token only ever travels in the httpOnly cookie, never in a body
function respondWithSession(res: Response, tokens: SessionTokens) {
  setRefreshCookie(res, tokens.refresh_token);
  return { access_token: tokens.access_token };
}

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly sessions: SessionsService,
  ) {}

  // 3 registrations per hour per IP — prevents automated account-creation spam
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 3, ttl: 60 * 60_000 } })
  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  // 5 attempts per 15 minutes per IP — brute-force protection
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 15 * 60_000 } })
  @Post('login')
  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response) {
    return respondWithSession(res, await this.authService.login(dto));
  }

  // 30 per 5 minutes per IP — several tabs and a shared office IP stay well below it
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 30, ttl: 5 * 60_000 } })
  @HttpCode(200)
  @Post('refresh')
  async refresh(@Req() req: ExpressRequest, @Res({ passthrough: true }) res: Response) {
    try {
      return respondWithSession(res, await this.sessions.rotate(readRefreshCookie(req)));
    } catch (err) {
      clearRefreshCookie(res);
      throw err;
    }
  }

  // Under the refresh path so the cookie reaches it. No access token needed:
  // logout must work after it has expired.
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 30, ttl: 5 * 60_000 } })
  @HttpCode(204)
  @Post('refresh/logout')
  async logout(@Req() req: ExpressRequest, @Res({ passthrough: true }) res: Response) {
    await this.sessions.revoke(readRefreshCookie(req));
    clearRefreshCookie(res);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  getProfile(@Request() req: { user: User }) {
    return this.authService.getProfile(req.user.id);
  }

  // 5 attempts per 15 minutes per IP, like login
  @UseGuards(ThrottlerGuard, JwtAuthGuard)
  @Throttle({ default: { limit: 5, ttl: 15 * 60_000 } })
  @Post('change-password')
  async changePassword(
    @Body() dto: ChangePasswordDto,
    @Request() req: { user: User },
    @Res({ passthrough: true }) res: Response,
  ) {
    return respondWithSession(res, await this.authService.changePassword(req.user.id, dto));
  }

  // 3 requests per hour per IP — prevents email enumeration / spam
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 3, ttl: 60 * 60_000 } })
  @Post('forgot-password')
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.forgotPassword(dto);
  }

  @Post('reset-password')
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto);
  }
}
