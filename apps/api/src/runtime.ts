import type { IncomingMessage } from 'node:http';

/**
 * The visitor's address for rate limits. Behind a proxy every connection comes
 * from the proxy, so with TRUST_PROXY=1 this reads the last hop it added.
 * Only turn that on when a proxy overwrites or appends X-Forwarded-For.
 */
export function clientAddress(request: IncomingMessage, env: NodeJS.ProcessEnv = process.env) {
  if (env.TRUST_PROXY === '1') {
    const header = request.headers['x-forwarded-for'];
    const hop = (Array.isArray(header) ? header.join(',') : header)?.split(',').at(-1)?.trim();
    if (hop) return hop;
  }
  return request.socket.remoteAddress ?? 'unknown';
}

const secretLength = 32;

/** Settings the process cannot run correctly without. Returns problems, never values. */
export function configProblems(
  process_: 'api' | 'payments' | 'accounts',
  env: NodeJS.ProcessEnv = process.env,
) {
  const problems: string[] = [];
  const need = (name: string) => { if (!env[name]) problems.push(`${name} is required`); };
  const production = env.NODE_ENV === 'production';
  need('DATABASE_URL');
  if (process_ === 'accounts') need('ACCOUNT_ARCHIVE_KEY');
  if (process_ === 'payments') need('BACHS_SANDBOX_SECRET_KEY');
  if (process_ === 'api') {
    if (Buffer.byteLength(env.AUTH_CODE_SECRET ?? '') < secretLength) {
      problems.push(`AUTH_CODE_SECRET must be at least ${secretLength} bytes`);
    }
    if (production) {
      need('MAPBOX_ACCESS_TOKEN');
      need('AUTH_DELIVERY_TOKEN');
      if (!env.AUTH_DELIVERY_WEBHOOK?.startsWith('https://')) problems.push('AUTH_DELIVERY_WEBHOOK must be an HTTPS URL');
      if (env.TRUST_PROXY !== '1') problems.push('TRUST_PROXY=1 is required behind the production proxy');
    }
  }
  return problems;
}

export function requireConfig(process_: Parameters<typeof configProblems>[0]) {
  const problems = configProblems(process_);
  if (!problems.length) return;
  console.error(`Cannot start ${process_}:\n- ${problems.join('\n- ')}`);
  process.exit(1);
}

/** Enough to diagnose a failure, without request bodies, tokens, or SQL values. */
export function describeError(error: unknown) {
  if (!(error instanceof Error)) return 'Unknown error';
  const { code, status } = error as Error & { code?: unknown; status?: unknown };
  return [error.name, error.message, code && `code=${code}`, status && `status=${status}`].filter(Boolean).join(' ');
}
