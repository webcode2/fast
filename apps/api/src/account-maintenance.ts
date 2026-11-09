import { setTimeout as delay } from 'node:timers/promises';
import { db } from './auth.ts';
import { maintainAccounts } from './account-archive.ts';
import { expireOverdueOrders, heartbeat, purgeExpiredAuthRows, removeUnverifiedAccounts } from './maintenance-tasks.ts';
import { describeError, requireConfig } from './runtime.ts';

requireConfig('accounts');
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
      await expireOverdueOrders();
      await purgeExpiredAuthRows();
      await removeUnverifiedAccounts();
      await heartbeat('accounts');
    } catch (error) {
      if (once) throw error;
      console.error(`Account maintenance failed: ${describeError(error)}`);
      await heartbeat('accounts', true);
    }
    if (!once && !stop.signal.aborted) await delay(60_000, undefined, { signal: stop.signal }).catch(() => {});
  } while (!once && !stop.signal.aborted);
} finally {
  await db.end();
}
