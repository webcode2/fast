import Link from 'next/link';
import { redirect } from 'next/navigation';
import { adminProfile, apiRequest } from '../admin-auth';
import { approveIdentity } from './actions';

type Rider = { id: string; name: string; ninJob: string | null; licenceJob: string | null };

export default async function IdentityQueue({ searchParams }: {
  searchParams: Promise<{ message?: string }>;
}) {
  const user = await adminProfile();
  if (!user) redirect('/login');
  const { message } = await searchParams;
  const result = await apiRequest('/admin/rider-identity').catch(() => null);
  const riders: Rider[] | null = result?.status === 200 ? result.data.riders : null;
  return (
    <main className="container auth-page">
      <Link href="/">Back to dashboard</Link>
      <h1>Rider identity</h1>
      <p>Compare both job results in Smile ID and confirm they identify the same rider before approving.</p>
      {message && <p role="status">{message}</p>}
      {riders === null ? <p>{result?.data.error ?? 'Identity queue unavailable.'}</p>
        : riders.length === 0 ? <p>No riders awaiting review.</p>
        : riders.map((rider) => (
          <article className="auth-form" key={rider.id}>
            <h2>{rider.name}</h2>
            <p>NIN and selfie: {rider.ninJob ?? 'Awaiting pass'}</p>
            <p>Driver licence: {rider.licenceJob ?? 'Awaiting pass'}</p>
            {rider.ninJob && rider.licenceJob && (
              <form className="dispute-decision" action={approveIdentity.bind(null, rider.id)}>
                <label>
                  <span><input type="checkbox" name="samePerson" required /> Both checks identify the same rider</span>
                </label>
                <button type="submit">Approve for dispatch</button>
              </form>
            )}
          </article>
        ))}
    </main>
  );
}
