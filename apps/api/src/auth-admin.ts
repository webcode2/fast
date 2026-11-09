import { db, hashPassword } from './auth.ts';

const { ADMIN_EMAIL, ADMIN_PHONE, ADMIN_PASSWORD, ADMIN_NAME } = process.env;
try {
  const email = ADMIN_EMAIL?.trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 ||
      !ADMIN_PHONE || !/^\+[1-9]\d{7,14}$/.test(ADMIN_PHONE) ||
      !ADMIN_PASSWORD || ADMIN_PASSWORD.length < 12 || Buffer.byteLength(ADMIN_PASSWORD) > 128 ||
      !ADMIN_NAME?.trim() || ADMIN_NAME.trim().length > 100) {
    throw new Error('Set valid ADMIN_EMAIL, ADMIN_PHONE, ADMIN_PASSWORD and ADMIN_NAME');
  }
  const type = process.env.ADMIN_ACCOUNT_TYPE ?? 'admin';
  if (!['admin','staff'].includes(type)) throw new Error('ADMIN_ACCOUNT_TYPE must be admin or staff');
  await db.query(
    `WITH created AS (
       INSERT INTO accounts (role,email,phone,password_hash) VALUES ($5,$1,$2,$4) RETURNING id,role
     ), profiled AS (
       INSERT INTO account_profiles (account_id,account_type,display_name) SELECT id,role,$3 FROM created
     ) INSERT INTO staff_role_assignments (account_id,role) SELECT id,'administrator' FROM created WHERE role='admin'`,
    [email, ADMIN_PHONE, ADMIN_NAME.trim(), await hashPassword(ADMIN_PASSWORD), type],
  );
  console.log('Staff account provisioned');
} finally {
  await db.end();
}
