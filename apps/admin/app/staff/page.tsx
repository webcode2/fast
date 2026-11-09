import Link from 'next/link';
import { redirect } from 'next/navigation';
import { adminProfile, apiRequest } from '../admin-auth';
import { saveStaffRoles } from './actions';

type Staff = { id: string; name: string; email: string; accountType: string; roles: string[] };

export default async function StaffPage({ searchParams }: {
  searchParams: Promise<{ message?: string }>;
}) {
  const user = await adminProfile();
  if (!user) redirect('/login');
  const result = await apiRequest('/admin/staff').catch(() => null);
  const { message } = await searchParams;
  const staff: Staff[] = result?.status === 200 ? result.data.staff : [];
  const assignable: string[] = result?.status === 200 ? result.data.assignableRoles : [];
  return (
    <main className="container auth-page">
      <Link href="/">Back to dashboard</Link>
      <h1>Staff roles</h1>
      {message && <p role="status">{message}</p>}
      {result?.status !== 200 && <p>{result?.data.error ?? 'Staff roles are temporarily unavailable.'}</p>}
      {staff.map((person) => (
        <article className="auth-form" key={person.id}>
          <h2>{person.name}</h2>
          <p>{person.email}</p>
          <p>Roles: {person.roles.map((role) => role.replaceAll('_', ' ')).join(', ') || 'None'}</p>
          {person.id !== user.id && (person.accountType !== 'admin' || user.roles.includes('administrator')) && (
            <form action={saveStaffRoles.bind(null, person.id)} className="dispute-decision">
              <fieldset>
                <legend>Assignable roles</legend>
                {assignable.map((role) => (
                  <div key={role}>
                    <input type="checkbox" id={person.id + role} name="roles" value={role}
                      defaultChecked={person.roles.includes(role)} />
                    <label htmlFor={person.id + role}>{role.replaceAll('_', ' ')}</label>
                  </div>
                ))}
              </fieldset>
              <button type="submit">Save roles</button>
            </form>
          )}
        </article>
      ))}
    </main>
  );
}
