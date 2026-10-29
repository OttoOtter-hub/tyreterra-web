/**
 * Sends one test email through the configured Resend account, to check the
 * key, the sender domain and delivery. Nothing is written to the database.
 * Usage: TEST_EMAIL_TO=you@example.com npx ts-node -T src/send-test-email.ts
 */
import 'dotenv/config';
import { DataSource } from 'typeorm';
import { EmailService } from './common/email/email.service';

async function main() {
  const to = process.env.TEST_EMAIL_TO;
  if (!to) {
    console.error('TEST_EMAIL_TO is not set');
    process.exit(1);
  }
  if (!process.env.RESEND_API_KEY || !process.env.EMAIL_FROM) {
    // Otherwise the dev/test stub would "succeed" without sending anything
    console.error('RESEND_API_KEY and EMAIL_FROM must be set in .env');
    process.exit(1);
  }

  // send() needs no database; the DataSource is only used for company recipients
  const email = new EmailService({} as DataSource);
  const ok = await email.send(to, 'test', {
    subject: 'Test email — Tyre Terra',
    html: '<!doctype html><html><body style="font-family:Arial,Helvetica,sans-serif">' +
      '<p>This is a test email from Tyre Terra. Email delivery works.</p></body></html>',
    text: 'This is a test email from Tyre Terra. Email delivery works.',
  });

  console.log(ok ? 'Test email accepted by Resend' : 'Test email FAILED — see the error above');
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error((err as Error).message);
  process.exit(1);
});
