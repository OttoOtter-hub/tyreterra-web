import { Global, Module } from '@nestjs/common';
import { EmailService } from './email.service';

// Global so every feature module shares one EmailService (and one Resend
// client) instead of each declaring its own provider.
@Global()
@Module({
  providers: [EmailService],
  exports: [EmailService],
})
export class EmailModule {}
