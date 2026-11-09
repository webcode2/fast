import { apiRequest } from './admin-auth';
import { resolveTripIssue } from './trip-issue-actions';

type RecoveryAlert = {
  id: string;
  trackingDropout: boolean;
  recoveryRequestedAt: string | null;
};

type TripIssue = {
  id: string;
  orderId: string;
  riderId: string;
  category: string;
  details: string;
  createdAt: string;
};

const issueLabels: Record<string, string> = {
  safety: 'Rider safety',
  customer_unreachable: 'Customer unreachable',
  wrong_address: 'Wrong address',
  parcel_problem: 'Parcel problem',
  payment_problem: 'Payment problem',
  other: 'Other problem',
};

export async function RiderReports() {
  const result = await apiRequest('/trips/issues').catch(() => null);
  const issues: TripIssue[] | null = result?.status === 200 ? result.data.issues : null;
  return (
    <section aria-labelledby="reports-title">
      <h2 id="reports-title">Rider reports</h2>
      {!issues ? <p>Reports are temporarily unavailable.</p>
        : issues.length === 0 ? <p>No open rider reports.</p>
        : (
          <ul className="areas">
            {issues.map((issue) => (
              <li key={issue.id}>
                <h3>{issueLabels[issue.category] ?? issue.category}</h3>
                <p>Trip {issue.orderId}</p>
                <p>Rider {issue.riderId}</p>
                {issue.details && <p className="dispute-details">{issue.details}</p>}
                <form action={resolveTripIssue.bind(null, issue.id)}>
                  <button type="submit">Mark resolved</button>
                </form>
              </li>
            ))}
          </ul>
        )}
    </section>
  );
}

export async function RecoveryAlerts() {
  const result = await apiRequest('/trips/recovery-alerts').catch(() => null);
  const alerts: RecoveryAlert[] | null = result?.status === 200 ? result.data.alerts : null;
  return (
    <section aria-labelledby="recovery-title">
      <h2 id="recovery-title">Trip recovery alerts</h2>
      {!alerts ? <p>Alerts are temporarily unavailable.</p>
        : alerts.length === 0 ? <p>No active recovery alerts.</p>
        : (
          <ul className="areas">
            {alerts.map((alert) => (
              <li key={alert.id}>
                <h3>{alert.recoveryRequestedAt ? 'Support requested' : 'Tracking interrupted'}</h3>
                <p>Trip {alert.id}</p>
                {alert.recoveryRequestedAt && alert.trackingDropout && <p>Tracking is also interrupted.</p>}
              </li>
            ))}
          </ul>
        )}
    </section>
  );
}
