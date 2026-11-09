'use server';

import { redirect } from 'next/navigation';
import { adminProfile, apiRequest } from '../admin-auth';

export async function resolveDispute(orderId: string, form: FormData) {
  const admin = await adminProfile();
  if (!admin) redirect('/login');
  if (!admin.email_verified || !admin.phone_verified) redirect('/account');
  if (!/^[0-9a-f-]{36}$/i.test(orderId)) throw new Error('Invalid order ID');
  const decision = String(form.get('decision') ?? '');
  const resolution = String(form.get('resolution') ?? '');
  const result = await apiRequest('/admin/disputes/' + orderId + '/resolve', 'POST', {
    decision, resolution,
  }).catch(() => null);
  const message = result?.status === 200
    ? 'Dispute resolved.'
    : result?.data.error ?? 'Could not resolve the dispute. Please try again.';
  redirect('/disputes?message=' + encodeURIComponent(message));
}
