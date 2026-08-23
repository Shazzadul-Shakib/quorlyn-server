import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { EnvConfig } from '../config/env.validation';
import { TokenService } from './token.service';
import { OrgClaimService } from './org-claim.service';

@Global()
@Module({
  imports: [
    JwtModule.registerAsync({
      useFactory: (configService: ConfigService<EnvConfig, true>) => ({
        secret: configService.get('JWT_ACCESS_SECRET', { infer: true }),
        signOptions: {
          expiresIn: configService.get('JWT_ACCESS_TTL', { infer: true }),
        },
      }),
      inject: [ConfigService],
    }),
  ],
  providers: [TokenService, OrgClaimService],
  exports: [TokenService, OrgClaimService, JwtModule],
})
export class TokenModule {}
