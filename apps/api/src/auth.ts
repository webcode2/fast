import { createHash, createHmac, randomBytes, randomInt, scrypt, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { promisify } from 'node:util';
import pg from 'pg';
import { clientAddress, describeError } from './runtime.ts';

const timeoutMs = (name: string, fallback: number) => {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
};

export const db = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: timeoutMs('PG_POOL_MAX', 20),
  connectionTimeoutMillis: timeoutMs('PG_CONNECT_TIMEOUT_MS', 3000),
  statement_timeout: timeoutMs('PG_STATEMENT_TIMEOUT_MS', 10_000),
});
// Without a listener, a database restart would crash the process through an idle client.
db.on('error', (error) => console.error(`Idle database client failed: ${describeError(error)}`));
const derive = promisify(scrypt);
const profile = `id, role, email, phone, email_verified, phone_verified,
  (SELECT display_name FROM account_profiles WHERE account_id=accounts.id) AS name`;
const staffTypes = ['admin','staff'];
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const failure = (status: number, error: string) => ({ status, body: { error } });
const success = (body: object = { ok: true }, status = 200) => ({ status, body });
const validPassword = (value: string) => value.length >= 12 && Buffer.byteLength(value) <= 128;
const validEmail = (value: string) => value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
export const validPhone = (value: string) => /^\+[1-9]\d{7,14}$/.test(value);
const equal = (a: string, b: string) =>
  a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export async function hashPassword(password: string, salt = randomBytes(16).toString('hex')) {
  return salt + ':' + ((await derive(password, salt, 64)) as Buffer).toString('hex');
}

export async function readRaw(request: IncomingMessage, maxBytes = 8192) {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    bytes += chunk.length;
    if (bytes > maxBytes) throw new Error('Invalid body');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export async function readJson(request: IncomingMessage, maxBytes = 8192) {
  const raw = await readRaw(request, maxBytes);
  const input = raw.length ? JSON.parse(raw.toString()) : {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid body');
  return input as Record<string, unknown>;
}

export async function limited(bucket: string, maximum: number) {
  const result = await db.query(
    `INSERT INTO auth_limits VALUES ($1,1,now()+interval '15 minutes')
     ON CONFLICT (bucket) DO UPDATE SET
       hits = CASE WHEN auth_limits.expires_at <= now() THEN 1 ELSE LEAST(auth_limits.hits + 1, $2 + 1) END,
       expires_at = CASE WHEN auth_limits.expires_at <= now() THEN excluded.expires_at ELSE auth_limits.expires_at END
     RETURNING hits`, [bucket, maximum],
  );
  return result.rows[0].hits > maximum;
}

function codeHash(account: string, purpose: string, code: string) {
  const secret = process.env.AUTH_CODE_SECRET;
  if (!secret || Buffer.byteLength(secret) < 32) throw new Error('Auth code secret missing');
  return createHmac('sha256', secret).update(`${account}:${purpose}:${code}`).digest('hex');
}

async function sendCode(account: { id: string; phone: string; email: string }, purpose: string) {
  const hook = process.env.AUTH_DELIVERY_WEBHOOK;
  const local = process.env.NODE_ENV !== 'production' && process.env.AUTH_DEV_CODES === '1';
  if (!hook && !local) throw new Error('Auth delivery missing');
  if (hook && (!hook.startsWith('https://') || !process.env.AUTH_DELIVERY_TOKEN)) {
    throw new Error('Invalid delivery configuration');
  }
  const code = String(randomInt(1_000_000)).padStart(6, '0');
  const hash = codeHash(account.id, purpose, code);
  await db.query(
    `INSERT INTO auth_codes (account_id,purpose,code_hash,expires_at) VALUES ($1,$2,$3,now()+interval '10 minutes')
     ON CONFLICT (account_id,purpose) DO UPDATE SET code_hash=excluded.code_hash,
       expires_at=excluded.expires_at, attempts=0`, [account.id, purpose, hash],
  );
  if (!hook) {
    console.info(`Local auth code (${purpose}): ${code}`);
    return;
  }
  const response = await fetch(hook, {
    method: 'POST',
    redirect: 'error',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.AUTH_DELIVERY_TOKEN}` },
    body: JSON.stringify({ purpose, channel: purpose === 'phone' ? 'sms' : 'email',
      recipient: purpose === 'phone' ? account.phone : account.email, code }),
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error('Auth delivery failed');
}

const sessionHours = 24;
const sessionRenewBelowHours = 12;

function sessionHash(request: IncomingMessage) {
  const token = request.headers.authorization?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
  return token ? digest(token) : '';
}

export async function authenticatedAccount(request: IncomingMessage) {
  const hash = sessionHash(request);
  if (!hash) return undefined;
  const { rows: [account] } = await db.query(
    `SELECT accounts.*, auth_sessions.expires_at<now()+interval '${sessionRenewBelowHours} hours' AS session_renewal_due
     FROM accounts JOIN auth_sessions ON account_id=id
     WHERE token_hash=$1 AND auth_sessions.expires_at>now() AND deleted_at IS NULL`,
    [hash],
  );
  // Sessions end after a day idle, not mid-delivery.
  if (account?.session_renewal_due) {
    await db.query(`UPDATE auth_sessions SET expires_at=now()+interval '${sessionHours} hours' WHERE token_hash=$1`, [hash]);
  }
  return account;
}

export async function auth(request: IncomingMessage, path: string) {
  const method = request.method;
  const ip = clientAddress(request);
  const input = method === 'GET' ? {} : await readJson(request).catch(() => null);
  if (!input) return failure(400, 'Invalid request body');
  const get = (key: string) => typeof input[key] === 'string' ? input[key] : '';
  const email = get('email').trim().toLowerCase();
  const password = get('password');
  const name = get('name').trim();
  const phone = get('phone').trim();
  const code = get('code');
  const purpose = get('purpose');
  const role = get('role');
  const publicRoutes = ['/auth/register', '/auth/login', '/auth/reset/request', '/auth/reset', '/auth/recover'];
  if (publicRoutes.includes(path) && method === 'POST') {
    if (await limited(`public:${ip}`, 120)) return failure(429, 'Try again later');
    if (!validEmail(email)) return failure(400, 'Enter a valid email address');
    // Per address, so a stranger guessing passwords can't lock the real owner out.
    const blocked = path === '/auth/login'
      ? await limited(`${path}:${ip}:${digest(email)}`, 10) || await limited(`${path}:${digest(email)}`, 100)
      : await limited(`${path}:${digest(email)}`, 5);
    if (blocked) return failure(429, 'Try again later');
    if (path === '/auth/register') {
      if (!validPassword(password) || !validPhone(phone) || !name || name.length > 100 ||
          !['customer', 'rider'].includes(role)) {
        return failure(400, 'Provide a name, international phone number, role, and password of at least 12 characters');
      }
      await db.query(
        `WITH created AS (
           INSERT INTO accounts (role,email,phone,password_hash) VALUES ($1,$2,$3,$5)
           ON CONFLICT DO NOTHING RETURNING id,role
         ) INSERT INTO account_profiles (account_id,account_type,display_name) SELECT id,role,$4 FROM created`,
        [role, email, phone, name, await hashPassword(password)],
      );
      return success(undefined, 202);
    }
    const { rows: [account] } = await db.query('SELECT * FROM accounts WHERE email=$1 AND archived_at IS NULL', [email]);
    if (path === '/auth/reset/request') {
      if (account?.email_verified && !account.deleted_at) {
        // Keep response timing independent of account existence and provider latency.
        void sendCode(account, 'reset').catch(() => console.error('Reset delivery failed'));
      }
      return success(undefined, 202);
    }
    if (path === '/auth/reset') {
      if (!validPassword(password) || !/^\d{6}$/.test(code)) return failure(400, 'Invalid code or password');
      if (!account?.email_verified || account.deleted_at) return failure(400, 'Invalid or expired code');
      return consumeCode(account.id, 'reset', code, password);
    }
    const hash = account?.password_hash as string | undefined;
    if (!validPassword(password)) return failure(401, 'Invalid credentials');
    const computed = await hashPassword(password, hash?.split(':')[0] ?? '00000000000000000000000000000000');
    if (!hash || !equal(computed, hash)) return failure(401, 'Invalid credentials');
    if (path === '/auth/recover') {
      const restored = await db.query(
        `UPDATE accounts SET deleted_at=NULL WHERE id=$1 AND password_hash=$2
           AND deleted_at>clock_timestamp()-interval '720 hours' AND archived_at IS NULL
           AND role IN ('customer','rider')`, [account.id, hash],
      );
      return restored.rowCount ? success() : failure(409, 'Account recovery is unavailable');
    }
    if (account.deleted_at) return failure(403, 'Account is scheduled for deletion. Use account recovery.');
    if (get('client') === 'admin' && !staffTypes.includes(account.role)) return failure(403, 'Admin access required');
    if (get('client') === 'mobile' && staffTypes.includes(account.role)) return failure(403, 'Mobile access required');
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const { rows: [current] } = await client.query(
        `SELECT ${profile}, password_hash FROM accounts WHERE id=$1 AND deleted_at IS NULL FOR UPDATE`, [account.id],
      );
      if (current?.password_hash !== hash) return failure(401, 'Invalid credentials');
      // One active device per account: the newest sign-in replaces any other session.
      const token = randomBytes(32).toString('hex');
      await client.query(
        `INSERT INTO auth_sessions (token_hash,account_id,expires_at) VALUES ($1,$2,now()+interval '${sessionHours} hours')
         ON CONFLICT (account_id) DO UPDATE SET token_hash=excluded.token_hash,expires_at=excluded.expires_at`,
        [digest(token), current.id],
      );
      await client.query('COMMIT');
      const { password_hash: _, ...user } = current;
      return success({ token, user });
    } finally {
      try { await client.query('ROLLBACK'); } finally { client.release(); }
    }
  }

  const account = await authenticatedAccount(request);
  if (!account) return failure(401, 'Sign in required');
  if (path === '/auth/logout' && method === 'POST') {
    await db.query('DELETE FROM auth_sessions WHERE token_hash=$1', [sessionHash(request)]);
    return success();
  }
  if (path === '/auth/profile' && method === 'GET') {
    const { rows: [user] } = await db.query(
      `SELECT ${profile}, ARRAY(SELECT role FROM staff_role_assignments WHERE account_id=accounts.id ORDER BY role) AS roles
       FROM accounts WHERE id=$1 AND deleted_at IS NULL`, [account.id],
    );
    return user ? success({ user }) : failure(401, 'Sign in required');
  }
  if (path === '/auth/profile' && method === 'PATCH') {
    if (!name || name.length > 100) return failure(400, 'Enter a name of up to 100 characters');
    await db.query('UPDATE account_profiles SET display_name=$1 WHERE account_id=$2', [name, account.id]);
    const { rows: [user] } = await db.query(
      `SELECT ${profile} FROM accounts WHERE id=$1 AND deleted_at IS NULL`, [account.id],
    );
    return user ? success({ user }) : failure(401, 'Sign in required');
  }
  if (path === '/auth/delete' && method === 'POST') {
    if (!['customer','rider'].includes(account.role)) return failure(403, 'Self-deletion is for customer and rider accounts');
    if (await limited(`account-delete:${account.id}`, 5)) return failure(429, 'Try again later');
    if (!validPassword(password) ||
        !equal(await hashPassword(password, account.password_hash.split(':')[0]), account.password_hash)) {
      return failure(401, 'Current password is incorrect');
    }
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const locked = await client.query(
        'SELECT 1 FROM accounts WHERE id=$1 AND deleted_at IS NULL AND password_hash=$2 FOR UPDATE',
        [account.id, account.password_hash],
      );
      if (!locked.rowCount) return failure(409, 'Account changed. Sign in again.');
      await client.query('UPDATE rider_dispatch SET available=false,location=NULL,location_at=NULL WHERE rider_id=$1', [account.id]);
      await client.query(
        "UPDATE delivery_orders SET status='cancelled' WHERE customer_id=$1 AND status='pending_dispatch'", [account.id],
      );
      const active = await client.query(
        "SELECT 1 FROM delivery_orders WHERE (customer_id=$1 OR assigned_rider_id=$1) AND status IN ('assigned','picked_up')",
        [account.id],
      );
      if (active.rowCount) return failure(409, 'Resolve active deliveries before deleting this account');
      const { rows: [deletion] } = await client.query(
        `UPDATE accounts SET deleted_at=clock_timestamp() WHERE id=$1
         RETURNING deleted_at AS "deletedAt", deleted_at+interval '720 hours' AS "recoverUntil"`, [account.id],
      );
      await client.query('DELETE FROM auth_sessions WHERE account_id=$1', [account.id]);
      await client.query('DELETE FROM auth_codes WHERE account_id=$1', [account.id]);
      await client.query('COMMIT');
      return success(deletion);
    } finally {
      try { await client.query('ROLLBACK'); } finally { client.release(); }
    }
  }
  if (path === '/auth/password' && method === 'POST') {
    if (await limited(`password:${account.id}`, 5)) return failure(429, 'Try again later');
    const previous = get('currentPassword');
    if (!validPassword(password) || !validPassword(previous)) return failure(400, 'Invalid password');
    if (!equal(await hashPassword(previous, account.password_hash.split(':')[0]), account.password_hash)) {
      return failure(401, 'Current password is incorrect');
    }
    const changed = await updatePassword(account.id, password, account.password_hash);
    return changed ? success() : failure(409, 'Password changed. Sign in again');
  }
  if ((path === '/auth/verify/request' || path === '/auth/verify') && method === 'POST') {
    if (purpose !== 'email' && purpose !== 'phone') return failure(400, 'Invalid verification type');
    if (account[`${purpose}_verified`]) return success();
    if (path === '/auth/verify/request') {
      if (await limited(`verify:${account.id}:${purpose}`, 3)) return failure(429, 'Try again later');
      await sendCode(account, purpose);
      return success(undefined, 202);
    }
    if (!/^\d{6}$/.test(code)) return failure(400, 'Invalid or expired code');
    return consumeCode(account.id, purpose, code);
  }
  return failure(404, 'Route not found');
}

async function updatePassword(id: string, password: string, currentHash: string) {
  const hash = await hashPassword(password);
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const changed = await client.query(
      'UPDATE accounts SET password_hash=$1 WHERE id=$2 AND password_hash=$3 AND deleted_at IS NULL',
      [hash, id, currentHash],
    );
    if (!changed.rowCount) return false;
    await client.query('DELETE FROM auth_sessions WHERE account_id=$1', [id]);
    await client.query('DELETE FROM auth_codes WHERE account_id=$1', [id]);
    await client.query('COMMIT');
    return true;
  } finally {
    try { await client.query('ROLLBACK'); } finally { client.release(); }
  }
}

async function consumeCode(id: string, purpose: 'email' | 'phone' | 'reset', code: string, password?: string) {
  const hash = codeHash(id, purpose, code);
  const passwordHash = password ? await hashPassword(password) : null;
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const account = await client.query('SELECT id FROM accounts WHERE id=$1 AND deleted_at IS NULL FOR UPDATE', [id]);
    if (!account.rowCount) return failure(400, 'Invalid or expired code');
    const { rows: [challenge] } = await client.query(
      `UPDATE auth_codes SET attempts=attempts+1
       WHERE account_id=$1 AND purpose=$2 AND expires_at>now() AND attempts<5 RETURNING code_hash`,
      [id, purpose],
    );
    if (!challenge || !equal(challenge.code_hash, hash)) {
      await client.query('COMMIT');
      return failure(400, 'Invalid or expired code');
    }
    if (purpose === 'reset') {
      await client.query('UPDATE accounts SET password_hash=$1 WHERE id=$2', [passwordHash, id]);
      await client.query('DELETE FROM auth_sessions WHERE account_id=$1', [id]);
      await client.query('DELETE FROM auth_codes WHERE account_id=$1', [id]);
    } else {
      const column = purpose === 'email' ? 'email_verified' : 'phone_verified';
      await client.query(`UPDATE accounts SET ${column}=true WHERE id=$1`, [id]);
      await client.query('DELETE FROM auth_codes WHERE account_id=$1 AND purpose=$2', [id, purpose]);
    }
    await client.query('COMMIT');
    return success();
  } finally {
    try { await client.query('ROLLBACK'); } finally { client.release(); }
  }
}
