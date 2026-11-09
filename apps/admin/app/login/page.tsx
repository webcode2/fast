import { AuthForm, Field } from '../auth-form';

export default async function Login({ searchParams }: { searchParams: Promise<{ message?: string }> }) {
  const { message } = await searchParams;
  return (
    <main className="container auth-page">
      <h1>Admin sign in</h1>
      {message && <p role="status">{message}</p>}
      <AuthForm action="login" button="Sign in">
        <Field label="Email" name="email" type="email" autoComplete="username" />
        <Field label="Password" name="password" type="password" autoComplete="current-password" />
      </AuthForm>
      <h2>Reset your password</h2>
      <AuthForm action="requestReset" button="Send reset code">
        <Field label="Verified email" name="email" type="email" autoComplete="email" />
      </AuthForm>
      <AuthForm action="reset" button="Reset password">
        <Field label="Verified email" name="email" type="email" autoComplete="email" />
        <Field label="Reset code" name="code" autoComplete="one-time-code" />
        <Field label="New password" name="password" type="password" autoComplete="new-password" />
      </AuthForm>
    </main>
  );
}
