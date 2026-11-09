'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { adminProfile, apiRequest } from './admin-auth';

export async function resolveTripIssue(issueId: string) {
  const admin = await adminProfile();
  if (!admin) redirect('/login');
  if (!admin.email_verified || !admin.phone_verified) redirect('/account');
  if (!/^[0-9a-f-]{36}$/i.test(issueId)) throw new Error('Invalid report ID');
  await apiRequest('/trips/issues/' + issueId + '/resolve', 'POST', {}).catch(() => null);
  revalidatePath('/');
}
