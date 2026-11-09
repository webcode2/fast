import Link from 'next/link';
import { redirect } from 'next/navigation';
import { adminProfile, apiRequest } from '../admin-auth';
import { resolveDispute } from './actions';

type Dispute = {
  orderId: string;
  customerId: string;
  riderId: string;
  details: string;
  createdAt: string;
  completedAt: string;
  agreedFareKobo: number;
};

const timestamp = new Intl.DateTimeFormat('en-NG', {
  dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Lagos',
});

export default async function DisputesPage({ searchParams }: {
  searchParams: Promise<{ message?: string }>;
}) {
  const admin = await adminProfile();
  if (!admin) redirect('/login');
  if (!admin.email_verified || !admin.phone_verified) redirect('/account');

  const { message } = await searchParams;
  const result = await apiRequest('/admin/disputes').catch(() => null);
  const cases: Dispute[] | null = result?.status === 200 ? result.data.disputes : null;
  return (
    <main className="container auth-page dispute-page">
      <Link href="/">Back to dashboard</Link>
      <h1>Non-delivery disputes</h1>
      {message && <p role="status">{message}</p>}
      {cases === null ? <p>The dispute queue is temporarily unavailable.</p>
        : cases.length === 0 ? <p>No open disputes.</p>
        : cases.map((item) => (
          <article key={item.orderId} className="auth-form">
            <h2>Trip {item.orderId.slice(0, 8)}</h2>
            <dl>
              <dt>Order ID</dt><dd>{item.orderId}</dd>
              <dt>Customer ID</dt><dd>{item.customerId}</dd>
              <dt>Rider ID</dt><dd>{item.riderId}</dd>
              <dt>Marked complete</dt><dd>{timestamp.format(new Date(item.completedAt))} WAT</dd>
              <dt>Reported</dt><dd>{timestamp.format(new Date(item.createdAt))} WAT</dd>
            </dl>
            <h3>Customer report</h3>
            <p className="dispute-details">{item.details}</p>
            <form className="dispute-decision" action={resolveDispute.bind(null, item.orderId)}>
              <label>
                Decision
                <select name="decision" defaultValue="" required>
                  <option value="" disabled>Choose a decision</option>
                  <option value="upheld">Uphold the report</option>
                  <option value="dismissed">Dismiss the report</option>
                </select>
              </label>
              <label>
                Resolution summary shown to the customer
                <textarea name="resolution" required maxLength={1000} rows={4} />
              </label>
              <button type="submit">Resolve dispute</button>
            </form>
          </article>
        ))}
    </main>
  );
}
