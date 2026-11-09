'use server';

import { redirect } from 'next/navigation';
import { apiRequest } from '../admin-auth';

export async function approveIdentity(riderId: string, form: FormData) {
  if (!/^[0-9a-f-]{36}$/i.test(riderId)) throw new Error('Invalid rider ID');
  const result = await apiRequest('/dispatch/riders/' + riderId + '/identity', 'POST', {
    approved: true, samePersonConfirmed: form.get('samePerson') === 'on',
  }).catch(() => null);
  const message = result?.status === 200 ? 'Rider approved.'
    : result?.data.error ?? 'Could not approve rider.';
  redirect('/rider-identity?message=' + encodeURIComponent(message));
}
