import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { EnvConfig } from '../../../common/config/env.validation';
import {
  AuthenticatedUser,
  JwtPayload,
} from '../../../common/token/jwt-payload.interface';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(configService: ConfigService<EnvConfig, true>) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get('JWT_ACCESS_SECRET', { infer: true }),
    });
  }

  // Stateless by design: the payload is trusted as-is for the access token's
  // short life, no DB round trip per request. See plan for the trade-off.
  validate(payload: JwtPayload): AuthenticatedUser {
    return payload;
  }
}
