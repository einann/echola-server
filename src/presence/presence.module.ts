import { Module } from '@nestjs/common';
import { PresenceHandler } from './presence.handler';

@Module({
  providers: [PresenceHandler],
  exports: [PresenceHandler],
})
export class PresenceModule {}
