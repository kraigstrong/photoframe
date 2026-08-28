import { beforeAll, describe, expect, it, vi } from 'vitest';
import { sanitizeProperties } from './posthog.ts';

/**
 * These tests drive the REAL `posthog-js` library rather than a mock.
 *
 * Every other test in this directory mocks `posthog-js`, which means they
 * only ever feed `sanitizeProperties` synthetic properties we invented. That
 * cannot catch the failure mode that actually matters: PostHog attaching a
 * property we did not anticipate, or — worse — carrying something essential
 * inside `properties` that our allowlist then silently removes.
 *
 * `distinct_id` is exactly that. It rides in `properties`, not as a
 * top-level field on `CaptureResult`, and stripping it produces no error and
 * no failing mocked test — it just quietly makes every funnel and the
 * unique-device count unanswerable. That is only discoverable against the
 * real library, so it is checked here.
 */
/** posthog-js is a module singleton: `init` only takes effect on the first
 * call, so the real property set is captured exactly once and shared. */
async function capturedPropertiesFromRealLibrary(): Promise<Record<string, unknown>> {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}')));
  const seen: Record<string, unknown>[] = [];
  const { default: posthog } = await import('posthog-js');
  posthog.init('phc_test_key_not_real', {
    api_host: 'https://example.invalid/ingest',
    autocapture: false,
    capture_pageview: false,
    capture_pageleave: false,
    disable_session_recording: true,
    persistence: 'memory',
    person_profiles: 'never',
    bootstrap: { distinctID: 'test-device-id' },
    before_send: (result) => {
      if (result) seen.push(result.properties ?? {});
      return null; // never actually send
    },
  });
  posthog.capture('photo_load', { ev: 'photo_load', did: 'test-device-id', seq: 1 });
  // Wait for the real pipeline rather than sleeping a fixed 50ms.
  // posthog-js assembles properties through its own async work, and a fixed
  // wait that is comfortable on a dev machine is a coin flip on a loaded CI
  // runner — these tests would then fail with a confusing "expected
  // undefined" rather than anything to do with what they actually assert.
  await vi.waitFor(
    () => {
      if (seen.length === 0) {
        throw new Error('posthog-js has not reached before_send yet');
      }
    },
    { timeout: 5000, interval: 10 },
  );
  return seen[0] ?? {};
}

describe('sanitizeProperties against the real posthog-js property set', () => {
  let raw: Record<string, unknown>;

  beforeAll(async () => {
    raw = await capturedPropertiesFromRealLibrary();
  });

  it('keeps distinct_id — without it every funnel and the device count break', () => {
    // Guard the premise: if a future version stops putting distinct_id in
    // properties, this test should fail loudly rather than pass vacuously.
    expect(raw.distinct_id).toBe('test-device-id');

    const clean = sanitizeProperties(raw);
    expect(clean.distinct_id).toBe('test-device-id');
    expect(clean.token).toBeDefined();
  });

  it('keeps our own event fields', () => {
    const clean = sanitizeProperties(raw);
    expect(clean.ev).toBe('photo_load');
    expect(clean.did).toBe('test-device-id');
    expect(clean.seq).toBe(1);
  });

  it('strips every fingerprinting-adjacent property the real library attaches', () => {
    const clean = sanitizeProperties(raw);
    for (const key of [
      '$current_url',
      '$referrer',
      '$referring_domain',
      '$screen_height',
      '$screen_width',
      '$viewport_height',
      '$viewport_width',
      '$raw_user_agent',
      '$browser',
      '$browser_version',
      '$browser_language',
      '$timezone',
      '$timezone_offset',
      '$device_type',
      '$device_id',
      '$host',
      '$pathname',
      '$session_entry_url',
    ]) {
      expect(clean, `${key} must not survive`).not.toHaveProperty(key);
    }
  });

  it('lets nothing through that is not on an explicit allowlist', () => {
    const allowed = new Set([
      'ev',
      'v',
      'did',
      'sid',
      'seq',
      'platform',
      'canShareFiles',
      'source',
      'ok',
      'frame',
      'via',
      'outcome',
      'err',
      'kind',
      'distinct_id',
      'token',
      '$lib',
      '$lib_version',
      '$insert_id',
      '$time',
      '$geoip_disable',
      '$process_person_profile',
      // Forced to a dummy value, never the guest's real address.
      '$ip',
    ]);
    const leaked = Object.keys(sanitizeProperties(raw)).filter((k) => !allowed.has(k));
    expect(leaked).toEqual([]);
  });
});

describe('IP suppression', () => {
  it('always forces $ip to a dummy value, overwriting a real one', () => {
    const clean = sanitizeProperties({ ev: 'app_open', $ip: '203.0.113.42' });
    expect(clean.$ip).toBe('0.0.0.0');
  });

  it('adds $ip even when the incoming properties have none', () => {
    expect(sanitizeProperties({ ev: 'app_open' }).$ip).toBe('0.0.0.0');
  });
});
