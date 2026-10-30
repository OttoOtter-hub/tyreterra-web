import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User, UserStatus } from '../entities/user.entity';

export interface JwtPayload {
  sub: string;
  email: string;
  role: string;
  tv?: number; // users.token_version at issue time
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_SECRET ?? 'change-me-in-production',
    });
  }

  async validate(payload: JwtPayload): Promise<User> {
    const user = await this.userRepo
      .createQueryBuilder('u')
      .addSelect('u.token_version')
      .where('u.id = :id', { id: payload.sub })
      .getOne();
    if (!user || user.status === UserStatus.BLOCKED || (payload.tv ?? 0) !== user.token_version) {
      throw new UnauthorizedException();
    }
    delete user.token_version;
    return user;
  }
}
