import Link from 'next/link';
import { redirect } from 'next/navigation';
import { adminProfile } from './admin-auth';
import { RecoveryAlerts, RiderReports } from './recovery-alerts';

const areas = [
  ['Deliveries', 'Monitor active deliveries and review completed trips.'],
  ['Riders', 'Review rider verification and dispatch eligibility.'],
  ['Disputes', 'Investigate non-delivery reports and track resolutions.'],
  ['Payouts', 'Reconcile rider earnings and review next-day payouts.'],
];

export default async function Dashboard() {
  const user = await adminProfile();
  if (!user) redirect('/login');
  if (!user.email_verified || !user.phone_verified) redirect('/account');
  const roles: string[] = user.roles ?? [];
  const can = (role: string) => roles.includes('administrator') || roles.includes(role);
  return (
    <>
      <header className="site-header">
        <div className="container">FAST <span>Admin</span> <Link href="/account">Account</Link> {can('dispute_resolver') && <Link href="/disputes">Disputes</Link>}
          {can('rider_verifier') && <Link href="/rider-identity">Rider identity</Link>}
          {can('staff_manager') && <Link href="/staff">Staff roles</Link>}
          {can('archive_exporter') && <Link href="/archives">Archives</Link>}
          {roles.includes('administrator') && <Link href="/waitlist">Waitlist</Link>}</div>
      </header>
      <main className="container">
        <div className="intro">
          <p className="eyebrow">Port Harcourt · Operations</p>
          <h1>Operations dashboard</h1>
          <p>Delivery, rider, dispute, and payout tools for the pilot.</p>
        </div>
        {can('recovery_operator') && <RiderReports />}
        {can('recovery_operator') && <RecoveryAlerts />}
        <section aria-labelledby="areas-title">
          <div className="section-header">
            <h2 id="areas-title">Operations areas</h2>
            <span>Setup in progress</span>
          </div>
          <ul className="areas">
            {areas.map(([title, description]) => (
              <li key={title}>
                <h3>{title}</h3>
                <p>{description}</p>
              </li>
            ))}
          </ul>
        </section>
      </main>
    </>
  );
}
