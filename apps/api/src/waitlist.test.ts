import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseContact } from './waitlist.ts';

test('Nigerian phone numbers become one international format', () => {
  const contact = { contact: '+2348060000000', type: 'phone' };
  for (const typed of ['08060000000', '0806 000 0000', '806-000-0000', '2348060000000', '+234 806 000 0000']) {
    assert.deepEqual(parseContact(typed), contact, typed);
  }
  assert.deepEqual(parseContact('+447700900000'), { contact: '+447700900000', type: 'phone' });
});

test('emails are lowercased so one person is listed once', () => {
  assert.deepEqual(parseContact(' Ada@Example.TEST '), { contact: 'ada@example.test', type: 'email' });
});

test('anything else is rejected', () => {
  for (const bad of ['', '12345', 'not an email', 'a@b', '@example.test', '0806000000a', 42, null, undefined, {}]) {
    assert.equal(parseContact(bad), null, String(bad));
  }
  assert.equal(parseContact(`${'a'.repeat(250)}@example.test`), null);
});
