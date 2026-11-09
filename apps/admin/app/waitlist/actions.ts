'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { adminProfile, apiRequest } from '../admin-auth';

export async function removeSignup(id: string) {
  const admin = await adminProfile();
  if (!admin) redirect('/login');
  if (!admin.email_verified || !admin.phone_verified) redirect('/account');
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error('Invalid signup ID');
  await apiRequest('/admin/waitlist/' + id + '/remove', 'POST', {}).catch(() => null);
  revalidatePath('/waitlist');
}
