import { setTimeout as delay } from 'node:timers/promises';
import { db } from './auth.ts';
import { bachsKey } from './bachs.ts';
import { settlePayments } from './payment-settlement.ts';

const once = process.argv.includes('--once');
const stop = new AbortController();
process.once('SIGINT', () => stop.abort());
process.once('SIGTERM', () => stop.abort());
try {
  bachsKey();
  do {
    try {
      await settlePayments();
    } catch (error) {
      if (once) throw error;
      console.error('Payment settlement failed');
    }
    if (!once && !stop.signal.aborted) await delay(60_000, undefined, { signal: stop.signal }).catch(() => {});
  } while (!once && !stop.signal.aborted);
} finally {
  await db.end();
}
