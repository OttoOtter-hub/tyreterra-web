import {
  EmailContent,
  accountApprovedEmail,
  accountRejectedEmail,
  adminNewRegistrationEmail,
  dealCreatedEmail,
  listingsExpiredEmail,
  listingsExpiringEmail,
  newRequestEmail,
  offerReceivedEmail,
  passwordResetEmail,
  requestDeclinedEmail,
} from './email-templates';

const URL = 'https://app.test/some/page?id=1&x=2';

const linked: [string, EmailContent][] = [
  ['passwordResetEmail', passwordResetEmail(URL)],
  ['accountApprovedEmail', accountApprovedEmail(URL)],
  ['newRequestEmail', newRequestEmail(URL)],
  ['offerReceivedEmail', offerReceivedEmail(URL)],
  ['requestDeclinedEmail', requestDeclinedEmail(URL)],
  ['dealCreatedEmail', dealCreatedEmail(URL)],
  ['listingsExpiringEmail', listingsExpiringEmail(2, URL)],
  ['listingsExpiredEmail', listingsExpiredEmail(2, URL)],
  ['adminNewRegistrationEmail', adminNewRegistrationEmail(URL)],
];
const all: [string, EmailContent][] = [...linked, ['accountRejectedEmail', accountRejectedEmail()]];

describe('email templates', () => {
  it.each(all)('%s has a branded subject, HTML and a text version', (_name, email) => {
    expect(email.subject).toMatch(/ — Tyre Terra$/);
    expect(email.html).toMatch(/^<!doctype html>/);
    expect(email.text.length).toBeGreaterThan(20);
    expect(email.text).not.toMatch(/<[a-z]/i);
  });

  it.each(all)('%s loads nothing external (no images, stylesheets or scripts)', (_name, email) => {
    expect(email.html).not.toMatch(/<img|<link|<script|url\(/i);
  });

  it.each(linked)('%s links into the app in both versions (HTML-escaped)', (_name, email) => {
    expect(email.html).toContain('href="https://app.test/some/page?id=1&amp;x=2"');
    expect(email.text).toContain(URL);
  });

  it.each(all)('%s carries no price, currency or contact fields', (_name, email) => {
    for (const body of [email.html, email.text]) {
      expect(body).not.toMatch(/€|EUR|USD|price|phone|@/i);
    }
  });

  it('password reset states the 1 hour validity', () => {
    const email = passwordResetEmail(URL);
    expect(email.text).toContain('1 hour');
    expect(email.html).toContain('1 hour');
  });

  it('deal email says contacts are in the app, without including any', () => {
    expect(dealCreatedEmail(URL).text).toContain('contact details are available in the app');
  });

  it('expiry emails use the listing count with correct grammar', () => {
    expect(listingsExpiringEmail(1, URL).text).toContain('1 of your listings expires within the next 3 days');
    expect(listingsExpiringEmail(4, URL).text).toContain('4 of your listings expire within the next 3 days');
    expect(listingsExpiredEmail(1, URL).text).toContain('1 of your listings has expired');
    expect(listingsExpiredEmail(3, URL).text).toContain('3 of your listings have expired');
  });

  it('escapes HTML in the link', () => {
    const email = newRequestEmail('https://app.test/"><script>alert(1)</script>');
    expect(email.html).not.toContain('<script>');
    expect(email.html).toContain('&lt;script&gt;');
  });
});
