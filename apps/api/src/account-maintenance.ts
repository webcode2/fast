import { setTimeout as delay } from 'node:timers/promises';
import { db } from './auth.ts';
import { maintainAccounts } from './account-archive.ts';

const once = process.argv.includes('--once');
const stop = new AbortController();
process.once('SIGINT', () => stop.abort());
process.once('SIGTERM', () => stop.abort());
try {
  do {
    try {
      while ((await maintainAccounts()).archived === 25 && !stop.signal.aborted) {
        // Drain ready accounts in bounded transactions.
      }
    } catch (error) {
      if (once) throw error;
      console.error('Account maintenance failed');
    }
    if (!once && !stop.signal.aborted) await delay(60_000, undefined, { signal: stop.signal }).catch(() => {});
  } while (!once && !stop.signal.aborted);
} finally {
  await db.end();
}
