import type { IncomingMessage } from 'node:http';
import { authenticatedAccount, db, readJson } from './auth.ts';
import { archiveKey } from './account-archive.ts';
import { uuid } from './orders.ts';

const operationalRoles = ['dispute_resolver','rider_verifier','recovery_operator'];
const assignableRoles = [...operationalRoles, 'staff_manager','archive_exporter'];
const send = (status: number, body: object) => ({ status, body });
const forbidden = () => send(403, { error: 'Staff permission required' });

export async function staffPermissions(user: { id: string; role: string; email_verified: boolean; phone_verified: boolean }) {
  if (!['admin','staff'].includes(user.role) || !user.email_verified || !user.phone_verified) return [];
  const { rows } = await db.query(
    'SELECT role FROM staff_role_assignments WHERE account_id=$1 ORDER BY role', [user.id],
  );
  return rows.map(({ role }) => role as string);
}

export async function hasStaffPermission(user: Parameters<typeof staffPermissions>[0], permission: string) {
  const roles = await staffPermissions(user);
  return roles.includes('administrator') || roles.includes(permission);
}

export async function staffApi(request: IncomingMessage, path: string) {
  const user = await authenticatedAccount(request);
  if (!user) return send(401, { error: 'Sign in required' });
  const method = request.method;
  const permissions = await staffPermissions(user);
  const administrator = permissions.includes('administrator');

  if (path.startsWith('/admin/archives')) {
    if (!administrator && !permissions.includes('archive_exporter')) return forbidden();
    if (path === '/admin/archives' && method === 'GET') {
      const { rows } = await db.query(
        `SELECT account_id AS "accountId",archived_at AS "archivedAt",purge_at AS "purgeAt"
         FROM account_archives WHERE purge_at>clock_timestamp() ORDER BY purge_at,account_id LIMIT 100`,
      );
      return send(200, { archives: rows });
    }
    const [, id] = path.match(/^\/admin\/archives\/([^/]+)\/export$/) ?? [];
    if (!id || !uuid.test(id) || method !== 'POST') return send(404, { error: 'Route not found' });
    const { rows: [archive] } = await db.query(
      `WITH exported AS (
         INSERT INTO account_archive_exports (account_id,actor_id)
         SELECT account_id,$2 FROM account_archives
         WHERE account_id=$1 AND purge_at>clock_timestamp() FOR UPDATE RETURNING account_id
       )
       SELECT pgp_sym_decrypt(a.encrypted_data,$3)::jsonb AS data
       FROM account_archives a JOIN exported e ON e.account_id=a.account_id`,
      [id, user.id, archiveKey()],
    );
    return archive ? send(200, { archive: archive.data }) : send(404, { error: 'Archive unavailable or expired' });
  }

  if (!administrator && !permissions.includes('staff_manager')) return forbidden();
  const allowed = administrator ? assignableRoles : operationalRoles;
  if (path === '/admin/staff' && method === 'GET') {
    const { rows } = await db.query(
      `SELECT a.id,a.role AS "accountType",p.display_name AS name,a.email,
         ARRAY(SELECT s.role FROM staff_role_assignments s WHERE s.account_id=a.id ORDER BY s.role) AS roles
       FROM accounts a JOIN account_profiles p ON p.account_id=a.id
       WHERE a.role IN ('staff','admin') AND a.deleted_at IS NULL
       ORDER BY p.display_name,a.id LIMIT 100`,
    );
    return send(200, { staff: rows, assignableRoles: allowed });
  }
  const [, id] = path.match(/^\/admin\/staff\/([^/]+)\/roles$/) ?? [];
  if (!id || !uuid.test(id) || method !== 'PUT') return send(404, { error: 'Route not found' });
  if (id.toLowerCase() === user.id) return forbidden();
  const input = await readJson(request).catch(() => null);
  const roles = input?.roles;
  if (!Array.isArray(roles) || roles.length > allowed.length ||
      roles.some((role) => typeof role !== 'string' || !allowed.includes(role))) {
    return send(400, { error: 'Provide a list of assignable roles' });
  }
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const target = await client.query(
      "SELECT role FROM accounts WHERE id=$1 AND role IN ('staff','admin') AND deleted_at IS NULL FOR UPDATE", [id],
    );
    if (!target.rowCount) return send(404, { error: 'Staff account not found' });
    if (!administrator && target.rows[0].role === 'admin') return forbidden();
    const before = (await client.query(
      'SELECT role FROM staff_role_assignments WHERE account_id=$1 ORDER BY role', [id],
    )).rows.map(({ role }) => role as string);
    const after = [...new Set([...before.filter((role) => !allowed.includes(role)), ...roles])].sort();
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      await client.query('DELETE FROM staff_role_assignments WHERE account_id=$1 AND role=ANY($2::text[])', [id, allowed]);
      await client.query(
        `INSERT INTO staff_role_assignments (account_id,role) SELECT $1,role FROM unnest($2::text[]) AS role
         ON CONFLICT DO NOTHING`, [id, after],
      );
      await client.query(
        'INSERT INTO staff_role_changes (actor_id,staff_id,previous_roles,new_roles) VALUES ($1,$2,$3,$4)',
        [user.id, id, before, after],
      );
    }
    await client.query('COMMIT');
    return send(200, { roles: after });
  } finally {
    try { await client.query('ROLLBACK'); } finally { client.release(); }
  }
}
