import test from 'node:test';
import assert from 'node:assert/strict';
import {retryAfterSeconds} from '../supabase/functions/clinicorp-financial-sync/source-rate.mjs';

test('respects provider pauses expressed in seconds or an HTTP date',()=>{
  const now=Date.parse('2026-10-15T19:00:00Z');
  assert.equal(retryAfterSeconds('120',now),120);
  assert.equal(retryAfterSeconds('Thu, 15 Oct 2026 19:02:01 GMT',now),121);
  assert.equal(retryAfterSeconds('Thu, 15 Oct 2026 18:59:00 GMT',now),0);
  assert.equal(retryAfterSeconds('0',now),0);
});
test('missing or malformed pause headers use the database backoff',()=>{
  for(const value of [null,undefined,'','not a date'])assert.equal(retryAfterSeconds(value),null);
});
