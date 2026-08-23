import { Global, Module } from '@nestjs/common';
import { SessionService } from './session.service';
import { DeviceSessionService } from './device-session.service';

@Global()
@Module({
  providers: [SessionService, DeviceSessionService],
  exports: [SessionService, DeviceSessionService],
})
export class SessionModule {}
