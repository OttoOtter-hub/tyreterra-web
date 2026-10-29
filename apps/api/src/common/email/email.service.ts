import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Resend } from 'resend';
import { User, UserStatus } from '../../auth/entities/user.entity';
import { EmailContent } from './email-templates';

// Sends transactional email through Resend.
//
// Without RESEND_API_KEY the service runs as a stub that only logs — allowed
// in development and test; any other NODE_ENV refuses to start, so production
// never silently drops mail.
//
// Sending never throws: a failed email must not fail the user's request.
// Failures are logged with the email kind only — never the body, which may
// carry a reset token.
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly resend: Resend | null;
  private readonly from: string;
  private readonly appUrl: string;
  private readonly adminEmail: string | null;
  private readonly logBodies: boolean;

  constructor(private readonly dataSource: DataSource) {
    const env = process.env.NODE_ENV;
    const devOrTest = env === 'development' || env === 'test';
    const apiKey = process.env.RESEND_API_KEY;
    const from = process.env.EMAIL_FROM;

    if (!apiKey || !from) {
      if (!devOrTest) {
        throw new Error(
          'RESEND_API_KEY and EMAIL_FROM must be set — refusing to start without email delivery ' +
          '(only NODE_ENV=development/test may run the logging stub)',
        );
      }
      this.logger.warn('RESEND_API_KEY/EMAIL_FROM not set — emails are only logged (stub mode)');
    }

    this.resend = apiKey && from ? new Resend(apiKey) : null;
    this.from = from ?? 'Tyre Terra <noreply@localhost>';
    this.appUrl = (process.env.FRONTEND_URL ?? 'http://localhost:3000').replace(/\/+$/, '');
    this.adminEmail = process.env.ADMIN_NOTIFY_EMAIL || null;
    // Only the development stub prints bodies (e.g. the reset link) to the log
    this.logBodies = !this.resend && env === 'development';
  }

  // Absolute link into the web app, e.g. link('/deals/123')
  link(path: string): string {
    return `${this.appUrl}${path}`;
  }

  // Returns true when the email was handed to Resend (or logged by the stub)
  async send(to: string, kind: string, content: EmailContent): Promise<boolean> {
    const masked = maskEmail(to);
    if (!this.resend) {
      this.logger.log(`[EMAIL stub] ${kind} → ${masked} | ${content.subject}`);
      if (this.logBodies) this.logger.log(`[EMAIL stub] ${kind} body:\n${content.text}`);
      return true;
    }

    try {
      const { data, error } = await this.resend.emails.send({
        from: this.from,
        to,
        subject: content.subject,
        html: content.html,
        text: content.text,
        tags: [{ name: 'kind', value: kind }],
      });
      if (error) {
        this.logger.error(`Email ${kind} → ${masked} failed: ${error.name} (${error.statusCode ?? 'no status'})`);
        return false;
      }
      this.logger.log(`Email ${kind} → ${masked} sent (${data?.id ?? 'no id'})`);
      return true;
    } catch (err) {
      this.logger.error(`Email ${kind} → ${masked} failed: ${(err as Error)?.name ?? 'Error'}`);
      return false;
    }
  }

  // Emails the account(s) of a company. Recipient lookup errors are swallowed
  // too, so callers can always await this safely.
  async sendToCompany(companyId: string | null | undefined, kind: string, content: EmailContent): Promise<boolean> {
    if (!companyId) return false;
    let users: User[];
    try {
      users = await this.dataSource.getRepository(User).find({
        where: { company_id: companyId, status: UserStatus.ACTIVE },
        select: { id: true, email: true },
      });
    } catch (err) {
      this.logger.error(`Email ${kind}: recipient lookup failed: ${(err as Error)?.name ?? 'Error'}`);
      return false;
    }
    if (!users.length) return false;
    const results = await Promise.all(users.map((u) => this.send(u.email, kind, content)));
    return results.every(Boolean);
  }

  async sendToAdmin(kind: string, content: EmailContent): Promise<boolean> {
    if (!this.adminEmail) {
      this.logger.warn(`Email ${kind}: ADMIN_NOTIFY_EMAIL is not set — skipped`);
      return false;
    }
    return this.send(this.adminEmail, kind, content);
  }
}

function maskEmail(email: string): string {
  const at = email.indexOf('@');
  if (at <= 0) return '***';
  return `${email[0]}***${email.slice(at)}`;
}
