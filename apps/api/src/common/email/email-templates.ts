// Transactional email templates. Each returns a subject plus an HTML and a
// plain-text body. To keep the marketplace anonymous they state only that
// something happened and link into the app: no prices, company names or
// contact details of the other party — those are visible only after login.

export interface EmailContent {
  subject: string;
  html: string;
  text: string;
}

const BRAND = 'Tyre Terra';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Plain inline-styled HTML, no external images or stylesheets
function layout(heading: string, paragraphs: string[], action?: { label: string; url: string }): string {
  const body = paragraphs
    .map((p) => `<p style="margin:0 0 16px;line-height:1.5">${escapeHtml(p)}</p>`)
    .join('\n');
  const button = action
    ? `<p style="margin:24px 0">` +
      `<a href="${escapeHtml(action.url)}" style="display:inline-block;padding:10px 18px;background:#1a56db;color:#ffffff;text-decoration:none;border-radius:6px;font-weight:600">${escapeHtml(action.label)}</a>` +
      `</p>\n<p style="margin:0 0 16px;font-size:13px;color:#6b7280;line-height:1.5">If the button does not work, open this link:<br>${escapeHtml(action.url)}</p>`
    : '';
  return `<!doctype html>
<html><body style="margin:0;padding:24px;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif;color:#111827">
<div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:8px;padding:24px">
<p style="margin:0 0 20px;font-size:18px;font-weight:700">${BRAND}</p>
<h1 style="margin:0 0 16px;font-size:20px">${escapeHtml(heading)}</h1>
${body}
${button}
<p style="margin:24px 0 0;font-size:12px;color:#9ca3af">This is an automated message from ${BRAND}. Please do not reply.</p>
</div>
</body></html>`;
}

function plain(heading: string, paragraphs: string[], action?: { label: string; url: string }): string {
  const lines = [heading, '', ...paragraphs.flatMap((p) => [p, ''])];
  if (action) lines.push(`${action.label}: ${action.url}`, '');
  lines.push(`This is an automated message from ${BRAND}. Please do not reply.`);
  return lines.join('\n');
}

function build(
  subject: string,
  heading: string,
  paragraphs: string[],
  action?: { label: string; url: string },
): EmailContent {
  return {
    subject: `${subject} — ${BRAND}`,
    html: layout(heading, paragraphs, action),
    text: plain(heading, paragraphs, action),
  };
}

export function passwordResetEmail(resetUrl: string): EmailContent {
  return build(
    'Reset your password',
    'Reset your password',
    [
      'We received a request to reset the password for your account.',
      'The link is valid for 1 hour and can be used once. If you did not request a reset, you can ignore this email — your password stays the same.',
    ],
    { label: 'Set a new password', url: resetUrl },
  );
}

export function accountApprovedEmail(loginUrl: string): EmailContent {
  return build(
    'Your account is approved',
    'Your account is approved',
    ['Your registration has been reviewed and approved. You can now log in.'],
    { label: 'Log in', url: loginUrl },
  );
}

export function accountRejectedEmail(): EmailContent {
  return build(
    'Your registration was not approved',
    'Your registration was not approved',
    [
      'Your registration has been reviewed and was not approved, so the account cannot be used.',
      'If you think this is a mistake, please contact the platform administrator.',
    ],
  );
}

export function newRequestEmail(requestUrl: string): EmailContent {
  return build(
    'New request for your listing',
    'New request for your listing',
    ['A buyer has sent a request for one of your listings. Open it to send an offer or decline.'],
    { label: 'View request', url: requestUrl },
  );
}

export function offerReceivedEmail(requestUrl: string): EmailContent {
  return build(
    'You received an offer',
    'You received an offer',
    ['The seller has replied to your request with an offer. Open it to accept or reject.'],
    { label: 'View offer', url: requestUrl },
  );
}

export function requestDeclinedEmail(requestUrl: string): EmailContent {
  return build(
    'Your request was declined',
    'Your request was declined',
    ['The seller has declined your request.'],
    { label: 'View request', url: requestUrl },
  );
}

export function dealCreatedEmail(dealUrl: string): EmailContent {
  return build(
    'A deal has been created',
    'A deal has been created',
    [
      'An offer has been accepted and a deal is now open.',
      "The other party's contact details are available in the app, on the deal page.",
    ],
    { label: 'Open deal', url: dealUrl },
  );
}

export function listingsExpiringEmail(count: number, listingsUrl: string): EmailContent {
  const what = count === 1 ? '1 of your listings expires' : `${count} of your listings expire`;
  return build(
    'Listings expiring soon',
    'Listings expiring soon',
    [`${what} within the next 3 days. Renew them to keep them visible in the catalogue.`],
    { label: 'Go to my listings', url: listingsUrl },
  );
}

export function listingsExpiredEmail(count: number, listingsUrl: string): EmailContent {
  const what = count === 1 ? '1 of your listings has' : `${count} of your listings have`;
  return build(
    'Listings expired',
    'Listings expired',
    [`${what} expired and no longer appear in the catalogue. Renew them to make them visible again.`],
    { label: 'Go to my listings', url: listingsUrl },
  );
}

export function adminNewRegistrationEmail(approvalUrl: string): EmailContent {
  return build(
    'New registration awaiting approval',
    'New registration awaiting approval',
    ['A new user has registered and is waiting for approval.'],
    { label: 'Open approval queue', url: approvalUrl },
  );
}
