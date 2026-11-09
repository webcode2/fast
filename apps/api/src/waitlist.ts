import { createHash } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { authenticatedAccount, db, limited, readJson } from './auth.ts';
import { uuid } from './orders.ts';
import { staffPermissions } from './staff.ts';

const send = (status: number, body: object) => ({ status, body });
const maxBodyBytes = 1024;
const signupsPerAddress = 30;
const signupsPerContact = 5;
// ponytail: staff see the newest 500. Add paging or an export when the list outgrows that.
const staffListLimit = 500;

/** Reads an email or a phone number. Bare Nigerian numbers become international format. */
export function parseContact(raw: unknown) {
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  if (value.includes('@')) {
    const email = value.toLowerCase();
    return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
      ? { contact: email, type: 'email' }
      : null;
  }
  const digits = value.replace(/[\s()-]/g, '');
  const phone = /^\+[1-9]\d{7,14}$/.test(digits) ? digits
    : /^234[789][01]\d{8}$/.test(digits) ? `+${digits}`
    : /^0[789][01]\d{8}$/.test(digits) ? `+234${digits.slice(1)}`
    : /^[789][01]\d{8}$/.test(digits) ? `+234${digits}`
    : null;
  return phone && { contact: phone, type: 'phone' };
}

const allowedOrigins = () =>
  (process.env.WAITLIST_ORIGINS ?? '').split(',').map((origin) => origin.trim()).filter(Boolean);

/** Browser access rules: only the approved website addresses may call the signup. */
export function waitlistHeaders(request: IncomingMessage) {
  const origin = request.headers.origin;
  return {
    Vary: 'Origin',
    ...(origin && allowedOrigins().includes(origin) ? {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'POST',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '600',
    } : {}),
  };
}

export async function waitlistSignup(request: IncomingMessage) {
  if (request.method !== 'POST') return send(405, { error: 'Only POST is supported' });
  const origin = request.headers.origin;
  if (origin && !allowedOrigins().includes(origin)) return send(403, { error: 'Origin not allowed' });
  const input = await readJson(request, maxBodyBytes).catch(() => null);
  if (!input) return send(400, { error: 'Invalid request' });
  // Only bots fill the hidden field. They see success, so they don't adapt.
  if (input.website) return send(202, { ok: true });

  const parsed = parseContact(input.contact);
  if (!parsed) return send(400, { error: 'Enter a valid phone number or email address.' });
  if (input.role !== 'customer' && input.role !== 'rider') return send(400, { error: 'Choose how you plan to use the app.' });
  if (input.consent !== true) return send(400, { error: 'Please agree so we can contact you at launch.' });

  const address = request.socket.remoteAddress ?? 'unknown';
  const contactKey = createHash('sha256').update(parsed.contact).digest('hex');
  if (await limited(`waitlist:${address}`, signupsPerAddress) || await limited(`waitlist:${contactKey}`, signupsPerContact)) {
    return send(429, { error: 'Too many attempts. Please try again later.' });
  }
  await db.query(
    `INSERT INTO waitlist_signups (contact,contact_type,role) VALUES ($1,$2,$3)
     ON CONFLICT (contact) DO NOTHING`,
    [parsed.contact, parsed.type, input.role],
  );
  // The answer is the same for a repeat signup, so nobody can test who has joined.
  return send(202, { ok: true });
}

export async function staffWaitlist(request: IncomingMessage, path: string) {
  const staff = await authenticatedAccount(request);
  if (!staff) return send(401, { error: 'Sign in required' });
  if (!(await staffPermissions(staff)).includes('administrator')) return send(403, { error: 'Administrator access required' });
  if (path === '/admin/waitlist' && request.method === 'GET') {
    const [{ rows: signups }, { rows: [count] }] = await Promise.all([
      db.query(
        `SELECT id, contact, contact_type AS "contactType", role, consented_at AS "consentedAt"
         FROM waitlist_signups ORDER BY consented_at DESC, id LIMIT $1`, [staffListLimit],
      ),
      db.query(
        `SELECT count(*)::int AS total, (count(*) FILTER (WHERE role='customer'))::int AS customers,
           (count(*) FILTER (WHERE role='rider'))::int AS riders FROM waitlist_signups`,
      ),
    ]);
    return send(200, { signups, ...count });
  }
  const id = path.match(/^\/admin\/waitlist\/([^/]+)\/remove$/)?.[1];
  if (!id || !uuid.test(id) || request.method !== 'POST') return send(404, { error: 'Route not found' });
  const { rowCount } = await db.query('DELETE FROM waitlist_signups WHERE id=$1', [id]);
  return rowCount ? send(200, { ok: true }) : send(404, { error: 'Signup not found' });
}
