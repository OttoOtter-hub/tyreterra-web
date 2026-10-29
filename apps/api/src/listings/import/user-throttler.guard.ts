import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

// Rate limit per signed-in user rather than per IP (colleagues behind one
// office NAT share an IP). Runs after JwtAuthGuard, which sets req.user.
@Injectable()
export class UserThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, any>): Promise<string> {
    return req.user?.id ? `user:${req.user.id}` : req.ip;
  }
}
