import Link from 'next/link';
import { redirect } from 'next/navigation';
import { adminProfile, apiRequest } from '../admin-auth';

type Archive = { accountId: string; archivedAt: string; purgeAt: string };
const time = new Intl.DateTimeFormat('en-NG', {
  timeZone: 'Africa/Lagos', dateStyle: 'medium', timeStyle: 'short',
});

export default async function ArchivePage() {
  if (!await adminProfile()) redirect('/login');
  const result = await apiRequest('/admin/archives').catch(() => null);
  const archives: Archive[] | null = result?.status === 200 ? result.data.archives : null;
  return (
    <main className="container auth-page">
      <Link href="/">Back to dashboard</Link>
      <h1>Account archives</h1>
      <p>Archives purge automatically. Each export is recorded.</p>
      {archives === null ? <p>{result?.data.error ?? 'Archives are temporarily unavailable.'}</p>
        : archives.length === 0 ? <p>No account archives are available.</p>
        : archives.map((archive) => (
          <article className="auth-form" key={archive.accountId}>
            <h2>Account {archive.accountId.slice(0, 8)}</h2>
            <p>Archived {time.format(new Date(archive.archivedAt))} WAT</p>
            <p>Purges {time.format(new Date(archive.purgeAt))} WAT</p>
            <form action="/archives/export" method="post">
              <input type="hidden" name="accountId" value={archive.accountId} />
              <button type="submit">Download JSON export</button>
            </form>
          </article>
        ))}
    </main>
  );
}
