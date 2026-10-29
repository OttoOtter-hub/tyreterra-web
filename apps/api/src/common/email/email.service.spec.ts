import { Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Resend } from 'resend';
import { EmailService } from './email.service';
import { passwordResetEmail } from './email-templates';
import { UserStatus } from '../../auth/entities/user.entity';

jest.mock('resend', () => ({ Resend: jest.fn() }));

const RESET_URL = 'https://app.test/reset-password?token=' + 'a'.repeat(64);

describe('EmailService', () => {
  const savedEnv = { ...process.env };
  let send: jest.Mock;
  let find: jest.Mock;
  let dataSource: DataSource;
  let logged: string[];

  beforeEach(() => {
    process.env = { ...savedEnv, NODE_ENV: 'test', FRONTEND_URL: 'https://app.test/' };
    delete process.env.RESEND_API_KEY;
    delete process.env.EMAIL_FROM;
    delete process.env.ADMIN_NOTIFY_EMAIL;

    send = jest.fn().mockResolvedValue({ data: { id: 'msg-1' }, error: null });
    (Resend as unknown as jest.Mock).mockReset();
    (Resend as unknown as jest.Mock).mockImplementation(() => ({ emails: { send } }));

    find = jest.fn().mockResolvedValue([{ id: 'u1', email: 'seller@example.com' }]);
    dataSource = { getRepository: jest.fn(() => ({ find })) } as unknown as DataSource;

    logged = [];
    for (const level of ['log', 'warn', 'error'] as const) {
      jest.spyOn(Logger.prototype, level).mockImplementation((msg: unknown) => { logged.push(String(msg)); });
    }
  });

  afterEach(() => {
    process.env = { ...savedEnv };
    jest.restoreAllMocks();
  });

  const withResend = () => {
    process.env.RESEND_API_KEY = 're_test_key';
    process.env.EMAIL_FROM = 'Tyre Terra <noreply@mail.example.test>';
    return new EmailService(dataSource);
  };

  describe('configuration', () => {
    it('refuses to start in production without RESEND_API_KEY', () => {
      process.env.NODE_ENV = 'production';
      process.env.EMAIL_FROM = 'Tyre Terra <noreply@mail.example.test>';
      expect(() => new EmailService(dataSource)).toThrow(/RESEND_API_KEY and EMAIL_FROM must be set/);
    });

    it('refuses to start in production without EMAIL_FROM', () => {
      process.env.NODE_ENV = 'production';
      process.env.RESEND_API_KEY = 're_test_key';
      expect(() => new EmailService(dataSource)).toThrow(/EMAIL_FROM/);
    });

    it('refuses to start when NODE_ENV is unset', () => {
      delete process.env.NODE_ENV;
      expect(() => new EmailService(dataSource)).toThrow();
    });

    it.each(['development', 'test'])('runs as a logging stub in %s without a key', async (env) => {
      process.env.NODE_ENV = env;
      const service = new EmailService(dataSource);
      await expect(service.send('a@example.com', 'password-reset', passwordResetEmail(RESET_URL))).resolves.toBe(true);
      expect(Resend).not.toHaveBeenCalled();
    });

    it('prints the body (reset link) only in the development stub', async () => {
      process.env.NODE_ENV = 'development';
      await new EmailService(dataSource).send('a@example.com', 'password-reset', passwordResetEmail(RESET_URL));
      expect(logged.some((l) => l.includes(RESET_URL))).toBe(true);
    });

    it('does not print the body in the test stub', async () => {
      await new EmailService(dataSource).send('a@example.com', 'password-reset', passwordResetEmail(RESET_URL));
      expect(logged.some((l) => l.includes('token='))).toBe(false);
    });

    it('builds app links from FRONTEND_URL without a double slash', () => {
      expect(new EmailService(dataSource).link('/deals/1')).toBe('https://app.test/deals/1');
    });
  });

  describe('send() with Resend', () => {
    it('passes from, to, subject, html, text and a kind tag', async () => {
      const service = withResend();
      const content = passwordResetEmail(RESET_URL);

      await expect(service.send('dealer@example.com', 'password-reset', content)).resolves.toBe(true);
      expect(Resend).toHaveBeenCalledWith('re_test_key');
      expect(send).toHaveBeenCalledWith({
        from: 'Tyre Terra <noreply@mail.example.test>',
        to: 'dealer@example.com',
        subject: content.subject,
        html: content.html,
        text: content.text,
        tags: [{ name: 'kind', value: 'password-reset' }],
      });
    });

    it('logs only the fact of sending in production mode — no link, token or full address', async () => {
      process.env.NODE_ENV = 'production';
      await withResend().send('dealer@example.com', 'password-reset', passwordResetEmail(RESET_URL));
      expect(logged.join('\n')).not.toMatch(/token=|reset-password|dealer@example\.com/);
      expect(logged.some((l) => l.includes('password-reset') && l.includes('sent'))).toBe(true);
    });

    it('returns false instead of throwing when the client rejects', async () => {
      send.mockRejectedValue(new Error(`request failed for ${RESET_URL}`));
      await expect(withResend().send('dealer@example.com', 'password-reset', passwordResetEmail(RESET_URL))).resolves.toBe(false);
      expect(logged.join('\n')).not.toContain('token=');
    });

    it('returns false when Resend answers with an API error', async () => {
      send.mockResolvedValue({ data: null, error: { name: 'rate_limit_exceeded', message: 'slow down', statusCode: 429 } });
      await expect(withResend().send('dealer@example.com', 'x', passwordResetEmail(RESET_URL))).resolves.toBe(false);
      expect(logged.some((l) => l.includes('rate_limit_exceeded') && l.includes('429'))).toBe(true);
    });
  });

  describe('sendToCompany()', () => {
    it('emails the active users of the company', async () => {
      await expect(withResend().sendToCompany('c1', 'new-request', passwordResetEmail(RESET_URL))).resolves.toBe(true);
      expect(find).toHaveBeenCalledWith(expect.objectContaining({
        where: { company_id: 'c1', status: UserStatus.ACTIVE },
      }));
      expect(send).toHaveBeenCalledWith(expect.objectContaining({ to: 'seller@example.com' }));
    });

    it('returns false without sending when the company has no active user', async () => {
      find.mockResolvedValue([]);
      await expect(withResend().sendToCompany('c1', 'new-request', passwordResetEmail(RESET_URL))).resolves.toBe(false);
      expect(send).not.toHaveBeenCalled();
    });

    it('returns false instead of throwing when the recipient lookup fails', async () => {
      find.mockRejectedValue(new Error('db down'));
      await expect(withResend().sendToCompany('c1', 'new-request', passwordResetEmail(RESET_URL))).resolves.toBe(false);
    });
  });

  describe('sendToAdmin()', () => {
    it('sends to ADMIN_NOTIFY_EMAIL', async () => {
      process.env.ADMIN_NOTIFY_EMAIL = 'admin@example.test';
      await expect(withResend().sendToAdmin('admin-new-registration', passwordResetEmail(RESET_URL))).resolves.toBe(true);
      expect(send).toHaveBeenCalledWith(expect.objectContaining({ to: 'admin@example.test' }));
    });

    it('skips with a warning when ADMIN_NOTIFY_EMAIL is not set', async () => {
      await expect(withResend().sendToAdmin('admin-new-registration', passwordResetEmail(RESET_URL))).resolves.toBe(false);
      expect(send).not.toHaveBeenCalled();
      expect(logged.some((l) => l.includes('ADMIN_NOTIFY_EMAIL'))).toBe(true);
    });
  });
});
