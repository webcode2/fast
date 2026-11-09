import Link from 'next/link';
import { redirect } from 'next/navigation';
import { adminProfile } from '../admin-auth';
import { AuthForm, Field } from '../auth-form';

export default async function Account({ searchParams }: { searchParams: Promise<{ message?: string }> }) {
  const user = await adminProfile();
  if (!user) redirect('/login');
  const { message } = await searchParams;
  return (
    <main className="container auth-page">
      <Link href="/">Back to dashboard</Link>
      <h1>Admin account</h1>
      {message && <p role="status">{message}</p>}
      <AuthForm action="name" button="Save name">
        <Field label="Name" name="name" autoComplete="name" defaultValue={user.name} />
      </AuthForm>
      <h2>Email</h2>
      <p>{user.email} · {user.email_verified ? 'Verified' : 'Unverified'}</p>
      {!user.email_verified && <>
        <AuthForm action="sendEmail" button="Send email code" />
        <AuthForm action="verifyEmail" button="Verify email">
          <Field label="Email code" name="code" autoComplete="one-time-code" />
        </AuthForm>
      </>}
      <h2>Phone</h2>
      <p>{user.phone} · {user.phone_verified ? 'Verified' : 'Unverified'}</p>
      {!user.phone_verified && <>
        <AuthForm action="sendPhone" button="Send SMS code" />
        <AuthForm action="verifyPhone" button="Verify phone">
          <Field label="SMS code" name="code" autoComplete="one-time-code" />
        </AuthForm>
      </>}
      <h2>Change password</h2>
      <AuthForm action="password" button="Update password">
        <Field label="Current password" name="currentPassword" type="password" autoComplete="current-password" />
        <Field label="New password" name="password" type="password" autoComplete="new-password" />
      </AuthForm>
      <AuthForm action="logout" button="Sign out" />
    </main>
  );
}
