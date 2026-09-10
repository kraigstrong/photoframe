/**
 * Guards the routing contract in `vercel.json`. Both rewrite families it
 * checks fail *silently* in production if removed — nothing in the app can
 * report the breakage — so they are asserted here rather than trusted to
 * survive a future config cleanup.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

interface VercelConfig {
  rewrites: { source: string; destination: string }[];
}

const config = JSON.parse(readFileSync('vercel.json', 'utf8')) as VercelConfig;
const sources = config.rewrites.map((rewrite) => rewrite.source);

describe('PostHog reverse proxy rewrites', () => {
  it.each(['/ingest/static/:path(.*)', '/ingest/array/:path(.*)', '/ingest/:path(.*)'])(
    'keeps %s using the :path(.*) matcher',
    (source) => {
      expect(sources).toContain(source);
    },
  );

  it('never uses a :path* matcher, which does not match the trailing slash posthog-js posts to', () => {
    const ingestRewrites = config.rewrites.filter((rewrite) =>
      rewrite.source.startsWith('/ingest'),
    );
    expect(ingestRewrites.length).toBeGreaterThan(0);
    for (const rewrite of ingestRewrites) {
      expect(rewrite.source).not.toMatch(/:path\*/);
    }
  });
});

describe('printed-QR event path', () => {
  // The QR codes printed for the event encode
  // https://frame.brightbench.app/panther-prowl-2026. The app ignores the
  // path today; the rewrite exists so that URL is already valid, and stays
  // valid if per-event routing is added later. Deleting it 404s every
  // printed code.
  it.each(['/panther-prowl-2026', '/panther-prowl-2026/'])('serves the app at %s', (source) => {
    const rewrite = config.rewrites.find((candidate) => candidate.source === source);
    expect(rewrite?.destination).toBe('/index.html');
  });

  it('does not serve the app from a catch-all, so mistyped paths still 404', () => {
    const catchAll = config.rewrites.find(
      (rewrite) => rewrite.destination === '/index.html' && /:\w+|\*|\(\.\*\)/.test(rewrite.source),
    );
    expect(catchAll).toBeUndefined();
  });
});
