import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { verifySlackSignature } from './verify.js';

/**
 * Self-contained tests: a hardcoded signing secret and locally-computed HMAC
 * signatures (we never read SLACK_SIGNING_SECRET from the environment). This
 * keeps the security gate test deterministic and runnable without secrets.
 */
const SECRET = 'test-signing-secret-0123456789';

/** Compute the `v0=<hex>` Slack signature for the given inputs. */
function sign(rawBody: string, timestamp: string, secret = SECRET): string {
  const base = `v0:${timestamp}:${rawBody}`;
  return 'v0=' + createHmac('sha256', secret).update(base).digest('hex');
}

describe('verifySlackSignature', () => {
  const rawBody = 'command=%2Flist&user_id=U123&text=';
  // Fixed clock: timestamp and `now` are aligned so the request is "fresh".
  const ts = '1718900000';
  const now = 1718900000 * 1000;

  it('accepts a valid signature within the 5-minute window', () => {
    const sig = sign(rawBody, ts);
    expect(verifySlackSignature(rawBody, ts, sig, SECRET, now)).toBe(true);
  });

  it('rejects a signature computed over a different body (tampering)', () => {
    const sig = sign('command=%2Fhack', ts);
    expect(verifySlackSignature(rawBody, ts, sig, SECRET, now)).toBe(false);
  });

  it('rejects a signature signed with a different secret (forgery)', () => {
    const sig = sign(rawBody, ts, 'wrong-secret');
    expect(verifySlackSignature(rawBody, ts, sig, SECRET, now)).toBe(false);
  });

  it('rejects a stale timestamp outside the 5-minute window (replay)', () => {
    // Signature is cryptographically valid, but the timestamp is 6 minutes old.
    const staleTs = String(1718900000 - 6 * 60);
    const sig = sign(rawBody, staleTs);
    expect(verifySlackSignature(rawBody, staleTs, sig, SECRET, now)).toBe(false);
  });

  it('rejects a future timestamp outside the window', () => {
    const futureTs = String(1718900000 + 6 * 60);
    const sig = sign(rawBody, futureTs);
    expect(verifySlackSignature(rawBody, futureTs, sig, SECRET, now)).toBe(false);
  });

  it('rejects a non-numeric timestamp without throwing', () => {
    const sig = sign(rawBody, 'not-a-number');
    expect(verifySlackSignature(rawBody, 'not-a-number', sig, SECRET, now)).toBe(false);
  });

  it('rejects a signature of a different length without throwing (length guard)', () => {
    expect(verifySlackSignature(rawBody, ts, 'v0=deadbeef', SECRET, now)).toBe(false);
    expect(verifySlackSignature(rawBody, ts, '', SECRET, now)).toBe(false);
  });

  it('rejects an empty signature header', () => {
    expect(verifySlackSignature(rawBody, ts, '', SECRET, now)).toBe(false);
  });
});
