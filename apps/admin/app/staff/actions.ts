'use server';

import { redirect } from 'next/navigation';
import { apiRequest } from '../admin-auth';

export async function saveStaffRoles(id: string, form: FormData) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error('Invalid staff ID');
  const result = await apiRequest('/admin/staff/' + id + '/roles', 'PUT', {
    roles: form.getAll('roles').map(String),
  }).catch(() => null);
  const message = result?.status === 200 ? 'Roles saved.'
    : result?.data.error ?? 'Could not save staff roles.';
  redirect('/staff?message=' + encodeURIComponent(message));
}
