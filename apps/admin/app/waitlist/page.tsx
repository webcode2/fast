import Link from 'next/link';
import { redirect } from 'next/navigation';
import { adminProfile, apiRequest } from '../admin-auth';
import { removeSignup } from './actions';

type Signup = {
  id: string;
  contact: string;
  contactType: 'phone' | 'email';
  role: 'customer' | 'rider';
  consentedAt: string;
};

const time = new Intl.DateTimeFormat('en-NG', {
  timeZone: 'Africa/Lagos', dateStyle: 'medium', timeStyle: 'short',
});

export default async function WaitlistPage() {
  const admin = await adminProfile();
  if (!admin) redirect('/login');
  if (!admin.email_verified || !admin.phone_verified) redirect('/account');
  const result = await apiRequest('/admin/waitlist').catch(() => null);
  const data = result?.status === 200 ? result.data : null;
  const signups: Signup[] = data?.signups ?? [];
  return (
    <main className="container auth-page dispute-page">
      <Link href="/">Back to dashboard</Link>
      <h1>Launch waitlist</h1>
      {!data ? <p>{result?.data.error ?? 'The waitlist is temporarily unavailable.'}</p> : (
        <>
          <p>{data.total} signups: {data.customers} customers and {data.riders} riders. Use these contacts only to announce the launch, and remove anyone who asks.</p>
          {data.total > signups.length && <p>Showing the newest {signups.length}.</p>}
          {signups.length === 0 ? <p>No signups yet.</p> : signups.map((signup) => (
            <article className="auth-form" key={signup.id}>
              <h2>{signup.contact}</h2>
              <p>{signup.role === 'rider' ? 'Rider' : 'Customer'} · agreed {time.format(new Date(signup.consentedAt))} WAT</p>
              <form action={removeSignup.bind(null, signup.id)}>
                <button type="submit">Remove from waitlist</button>
              </form>
            </article>
          ))}
        </>
      )}
    </main>
  );
}
