import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { authenticatedAccount, db, limited, readJson } from './auth.ts';
import { uuid } from './orders.ts';
import { hasStaffPermission } from './staff.ts';

const base = 'https://testapi.smileidentity.com';
const checks = {
  nin: { country: 'NG', id_type: 'NIN', verification_method: 'biometric_kyc' },
  licence: { country: 'NG', id_type: 'DRIVERS_LICENSE', verification_method: 'document_verification' },
} as const;
const send = (status: number, body: object) => ({ status, body });
const providerJob = /^job_[a-z0-9]{26}$/;

function config() {
  if (process.env.NODE_ENV === 'production') return;
  const partner = process.env.SMILE_SANDBOX_PARTNER_ID;
  const key = process.env.SMILE_SANDBOX_API_KEY;
  const secret = process.env.SMILE_CALLBACK_SECRET;
  const callback = process.env.SMILE_CALLBACK_BASE_URL;
  const privacy = process.env.SMILE_PRIVACY_URL;
  const isHttps = (value?: string) => value && URL.canParse(value) && new URL(value).protocol === 'https:';
  if (!partner || !/^[1-9]\d*$/.test(partner) || !key || !secret || Buffer.byteLength(secret) < 32 ||
      !callback || !privacy || !isHttps(callback) || !isHttps(privacy)) return;
  return { partner, key, secret, callback, privacy };
}

function proof(id: string, secret: string) {
  return createHmac('sha256', secret).update(id).digest('hex');
}

async function smile(settings: NonNullable<ReturnType<typeof config>>, path: string, body?: FormData) {
  const headers = { 'SmileID-Partner-ID': settings.partner };
  const auth = await fetch(base + '/v3/token', {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(4000),
    headers: { ...headers, 'SmileID-API-Key': settings.key },
  });
  if (!auth.ok) throw new Error('Smile ID authentication unavailable');
  const { token } = await auth.json();
  if (typeof token !== 'string' || !token) throw new Error('Smile ID token unavailable');
  const result = await fetch(base + path, {
    method: body ? 'POST' : 'GET', body, redirect: 'error', signal: AbortSignal.timeout(4000),
    headers: { ...headers, 'SmileID-Token': token },
  });
  if (result.status === 404 && !body) return null;
  if (!result.ok) throw new Error('Smile ID request failed');
  return result.json();
}

async function refreshJob(settings: NonNullable<ReturnType<typeof config>>, attempt: {
  id: string; provider_user_id: string; provider_job_id: string | null;
}, job: string) {
  if (attempt.provider_job_id && attempt.provider_job_id !== job) return false;
  const result = await smile(settings, '/v3/status/' + job);
  if (result?.job_id !== job || result.user_id !== attempt.provider_user_id ||
      !['processing','clear','block','attention','error'].includes(result.status)) return false;
  await db.query(
    `UPDATE rider_identity_checks c SET provider_job_id=$2,
       status=CASE WHEN $3='processing' THEN c.status ELSE $3 END,
       verification_url=NULL,updated_at=clock_timestamp()
     FROM accounts a WHERE c.id=$1 AND a.id=c.rider_id AND a.deleted_at IS NULL
       AND (c.provider_job_id IS NULL OR c.provider_job_id=$2)
       AND c.status IN ('pending','attention')`, [attempt.id, job, result.status],
  );
  return true;
}

export async function riderIdentity(request: IncomingMessage, path: string) {
  const settings = config();
  const method = request.method;
  const callback = path.match(/^\/identity\/smile\/callback\/([^/]+)\/([a-f0-9]{64})$/);
  if (callback && method === 'POST') {
    const [, id, secret] = callback;
    if (!settings || !uuid.test(id) ||
        !timingSafeEqual(Buffer.from(proof(id, settings.secret), 'hex'), Buffer.from(secret, 'hex'))) {
      return send(401, { error: 'Invalid callback' });
    }
    const input = await readJson(request, 256_000).catch(() => null);
    const job = input?.job_id;
    if (typeof job !== 'string' || !providerJob.test(job)) return send(400, { error: 'Invalid Smile ID job' });
    const { rows: [attempt] } = await db.query(
      `SELECT c.id,c.provider_user_id,c.provider_job_id,c.status FROM rider_identity_checks c
       JOIN accounts a ON a.id=c.rider_id WHERE c.id=$1 AND a.deleted_at IS NULL`, [id],
    );
    if (!attempt) return send(404, { error: 'Verification not found' });
    if (['clear','block','error'].includes(attempt.status)) {
      return attempt.provider_job_id === job ? send(200, { ok: true }) : send(409, { error: 'Job mismatch' });
    }
    return await refreshJob(settings, attempt, job)
      ? send(200, { ok: true }) : send(409, { error: 'Verification could not be matched' });
  }

  const user = await authenticatedAccount(request);
  if (!user) return send(401, { error: 'Sign in required' });
  if (path === '/admin/rider-identity' && method === 'GET') {
    if (!await hasStaffPermission(user, 'rider_verifier')) return send(403, { error: 'Rider verifier access required' });
    const { rows } = await db.query(
      `SELECT a.id,p.display_name AS name,
          (SELECT provider_job_id FROM rider_identity_checks WHERE rider_id=a.id AND kind='nin' AND status='clear'
           ORDER BY created_at DESC,id DESC LIMIT 1) AS "ninJob",
          (SELECT provider_job_id FROM rider_identity_checks WHERE rider_id=a.id AND kind='licence' AND status='clear'
           ORDER BY created_at DESC,id DESC LIMIT 1) AS "licenceJob"
       FROM accounts a JOIN account_profiles p ON p.account_id=a.id
       LEFT JOIN rider_dispatch r ON r.rider_id=a.id
       WHERE a.role='rider' AND a.deleted_at IS NULL AND r.identity_verified_at IS NULL
         AND EXISTS (SELECT 1 FROM rider_identity_checks WHERE rider_id=a.id)
       ORDER BY a.id LIMIT 100`,
    );
    return send(200, { riders: rows });
  }
  if (user.role !== 'rider') return send(403, { error: 'Rider access required' });
  if (path === '/identity/rider' && method === 'GET') {
    const { rows } = await db.query(
      `SELECT DISTINCT ON (kind) kind,
         CASE WHEN status='pending' AND provider_job_id IS NULL AND expires_at<=clock_timestamp()
              THEN 'expired' ELSE status END AS status
       FROM rider_identity_checks WHERE rider_id=$1 ORDER BY kind,created_at DESC,id DESC`, [user.id],
    );
    const approved = await db.query('SELECT 1 FROM rider_dispatch WHERE rider_id=$1 AND identity_verified_at IS NOT NULL', [user.id]);
    return send(200, { checks: rows, approved: Boolean(approved.rowCount), available: Boolean(settings) });
  }
  if (!settings) return send(503, { error: 'Smile ID verification is unavailable' });
  if (path === '/identity/rider/refresh' && method === 'POST') {
    if (await limited(`identity-refresh:${user.id}`, 15)) return send(429, { error: 'Try again later' });
    const { rows } = await db.query(
      `SELECT DISTINCT ON (kind) id,provider_user_id,provider_job_id,status
       FROM rider_identity_checks WHERE rider_id=$1 ORDER BY kind,created_at DESC,id DESC`, [user.id],
    );
    for (const attempt of rows) {
      if (attempt.provider_job_id && ['pending','attention'].includes(attempt.status)) {
        await refreshJob(settings, attempt, attempt.provider_job_id);
      }
    }
    return send(200, { ok: true });
  }
  if (path !== '/identity/rider/start' || method !== 'POST') return send(404, { error: 'Route not found' });
  if (!user.phone_verified) return send(403, { error: 'Verify your phone before starting identity checks' });
  const input = await readJson(request).catch(() => null);
  const kind = input?.kind;
  if ((kind !== 'nin' && kind !== 'licence') || input?.consent !== true) {
    return send(400, { error: 'Choose an identity check and confirm consent' });
  }
  if (await limited(`identity-start:${user.id}`, 8)) return send(429, { error: 'Try again later' });
  const { rows: [existing] } = await db.query(
    `SELECT *, expires_at>clock_timestamp() AS current FROM rider_identity_checks
     WHERE rider_id=$1 AND kind=$2 ORDER BY created_at DESC,id DESC LIMIT 1`, [user.id, kind],
  );
  if (existing?.status === 'clear' || existing?.status === 'attention' ||
      (existing?.status === 'pending' && existing.provider_job_id)) {
    return send(409, { error: 'This check is already complete or in review' });
  }
  if (existing?.status === 'pending' && existing.current && existing.verification_url) {
    return send(200, { url: existing.verification_url });
  }
  const id = randomUUID();
  const providerUser = 'fl_' + id.replaceAll('-', '');
  const expires = new Date(Date.now() + 30 * 60_000).toISOString();
  const callbackUrl = new URL(`/identity/smile/callback/${id}/${proof(id, settings.secret)}`, settings.callback);
  const form = new FormData();
  form.set('name', kind === 'nin' ? 'FAST NIN and selfie' : 'FAST driver licence');
  form.set('id_types', JSON.stringify([checks[kind]]));
  form.set('notice_privacy_policy_url', settings.privacy);
  form.set('is_single_use', 'true');
  form.set('expires_at', expires);
  form.set('callback_url', callbackUrl.href);
  form.set('user_id', providerUser);
  // The link is created with no database connection held. Two racing taps can make two
  // links, and the newest is used. The insert still requires a live account.
  const link = await smile(settings, '/v3/smile_links', form);
  if (link?.user_id !== providerUser || typeof link.ref_id !== 'string' || !uuid.test(link.ref_id) ||
      link.link !== `https://links.usesmileid.com/v3/${settings.partner}/${link.ref_id}`) {
    return send(503, { error: 'Smile ID did not return a valid verification link' });
  }
  const saved = await db.query(
    `INSERT INTO rider_identity_checks (id,rider_id,kind,provider_user_id,provider_link_id,verification_url,expires_at)
     SELECT $1,id,$3,$4,$5,$6,$7 FROM accounts WHERE id=$2 AND deleted_at IS NULL`,
    [id,user.id,kind,providerUser,link.ref_id,link.link,expires],
  );
  if (!saved.rowCount) return send(401, { error: 'Sign in required' });
  return send(201, { url: link.link });
}
