/**
 * Tests the QR-generation CLI script. `parseArgs`/`main` are covered
 * directly (fast, no subprocess); one end-to-end case actually runs the
 * generator into a temp directory to confirm real files come out the other
 * end. This file lives alongside the script rather than under tests/,
 * consistent with how src/**'s *.test.ts files are colocated with their
 * source.
 */
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { main, parseArgs } from './generate-qr.ts';

describe('parseArgs', () => {
  it('accepts --url <value> (space-separated) form', () => {
    expect(parseArgs(['--url', 'https://event.example.com'])).toEqual({
      url: 'https://event.example.com/',
      allowInsecure: false,
    });
  });

  it('accepts --url=<value> form', () => {
    expect(parseArgs(['--url=https://event.example.com'])).toEqual({
      url: 'https://event.example.com/',
      allowInsecure: false,
    });
  });

  it('throws when --url is missing', () => {
    expect(() => parseArgs([])).toThrow(/missing --url/i);
  });

  it('throws when --url is not an absolute URL', () => {
    expect(() => parseArgs(['--url', 'not-a-url'])).toThrow(/absolute url/i);
  });

  it('rejects an http:// URL by default', () => {
    expect(() => parseArgs(['--url', 'http://event.example.com'])).toThrow(/https/i);
  });

  it('accepts an http:// URL when --allow-insecure is passed', () => {
    expect(parseArgs(['--url', 'http://localhost:5173', '--allow-insecure'])).toEqual({
      url: 'http://localhost:5173/',
      allowInsecure: true,
    });
  });

  it('never silently treats a preview/localhost URL as production-ready', () => {
    expect(() => parseArgs(['--url', 'http://localhost:5173'])).toThrow();
  });
});

describe('main (end-to-end file generation)', () => {
  let tmpDir: string;
  let originalCwd: string;
  let originalArgv: string[];

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'photoframe-qr-test-'));
    originalCwd = process.cwd();
    originalArgv = process.argv;
    process.chdir(tmpDir);
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    process.argv = originalArgv;
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('writes a valid SVG and PNG encoding the given URL into ./qr', async () => {
    process.argv = ['node', 'generate-qr.ts', '--url', 'https://event.example.com/photo'];
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await main();

    const svg = await readFile(join(tmpDir, 'qr', 'event-qr.svg'), 'utf8');
    expect(svg).toContain('<svg');

    const png = await readFile(join(tmpDir, 'qr', 'event-qr.png'));
    // PNG magic bytes.
    expect(png.subarray(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('https://event.example.com/photo'));
    logSpy.mockRestore();
  });

  it('rejects a plain http URL end-to-end, writing nothing', async () => {
    process.argv = ['node', 'generate-qr.ts', '--url', 'http://event.example.com'];
    await expect(main()).rejects.toThrow(/https/i);
    await expect(readFile(join(tmpDir, 'qr', 'event-qr.svg'))).rejects.toThrow();
  });
});
