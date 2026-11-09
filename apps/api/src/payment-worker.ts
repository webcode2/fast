import { setTimeout as delay } from 'node:timers/promises';
import { db } from './auth.ts';
import { bachsKey } from './bachs.ts';
import { heartbeat } from './maintenance-tasks.ts';
import { reconcileCollections } from './payments.ts';
import { settlePayments } from './payment-settlement.ts';
import { describeError, requireConfig } from './runtime.ts';

requireConfig('payments');
const once = process.argv.includes('--once');
const stop = new AbortController();
process.once('SIGINT', () => stop.abort());
process.once('SIGTERM', () => stop.abort());
try {
  bachsKey();
  do {
    try {
      await reconcileCollections();
      await settlePayments();
      await heartbeat('payments');
    } catch (error) {
      if (once) throw error;
      console.error(`Payment worker pass failed: ${describeError(error)}`);
      await heartbeat('payments', true);
    }
    if (!once && !stop.signal.aborted) await delay(60_000, undefined, { signal: stop.signal }).catch(() => {});
  } while (!once && !stop.signal.aborted);
} finally {
  await db.end();
}
