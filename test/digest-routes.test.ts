import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';

const tempDirs: string[] = [];
const night = '2026-10-30';

function makeRunsDir(files: Record<string, string> = {}): string {
  const runsDir = mkdtempSync(join(tmpdir(), 'rig-digest-routes-'));
  tempDirs.push(runsDir);
  for (const [name, contents] of Object.entries(files)) {
    writeFileSync(join(runsDir, name), contents);
  }
  return runsDir;
}

function appFor(runsDir: string) {
  return createApp({
    adapter: 'shim',
    installed: '2026-10-29T14:06:00+01:00',
    beatEverySeconds: 60,
    runsDir,
  });
}

afterEach(() => {
  for (const runsDir of tempDirs.splice(0)) {
    rmSync(runsDir, { recursive: true, force: true });
  }
});

describe('digest routes', () => {
  it('renders sorted jobs in HTML and returns the same rows as JSON when a line is malformed', async () => {
    const events = [
      { at: '2026-10-30T01:00:00Z', job: 'zeta/job', status: 'fail', owner: null, error: 'timeout' },
      { at: '2026-10-30T00:00:00Z', job: 'alpha/job', status: 'retry', owner: 'ana', error: 'waiting' },
    ];
    const runsDir = makeRunsDir({
      [`${night}.jsonl`]: `${events.map((event) => JSON.stringify(event)).join('\n')}\n{bad json\n`,
    });
    const app = appFor(runsDir);

    const htmlResponse = await app.request(`/digest/${night}`);
    const html = await htmlResponse.text();
    expect(htmlResponse.status).toBe(200);
    expect(htmlResponse.headers.get('content-type')).toContain('text/html');
    expect(html).toContain(`<h1>digest · ${night}</h1>`);
    expect(html).toContain('malformed lines: 1');

    const tableBody = html.match(/<tbody>([\s\S]*?)<\/tbody>/)?.[1] ?? '';
    expect(tableBody).toContain('alpha/job');
    expect(tableBody).toContain('zeta/job');
    expect(tableBody.indexOf('alpha/job')).toBeLessThan(tableBody.indexOf('zeta/job'));

    const jsonResponse = await app.request(`/api/digest/${night}`);
    expect(jsonResponse.status).toBe(200);
    expect(jsonResponse.headers.get('content-type')).toContain('application/json');
    const rows = await jsonResponse.json();
    expect(rows).toEqual([
      {
        job: 'alpha/job', owner: 'ana', runs: 1, retries: 1,
        lastStatus: 'retry', lastError: 'waiting',
        firstAt: '2026-10-30T00:00:00Z', lastAt: '2026-10-30T00:00:00Z',
      },
      {
        job: 'zeta/job', owner: null, runs: 1, retries: 0,
        lastStatus: 'fail', lastError: 'timeout',
        firstAt: '2026-10-30T01:00:00Z', lastAt: '2026-10-30T01:00:00Z',
      },
    ]);
  });

  it('renders an empty file and returns an empty JSON array', async () => {
    const app = appFor(makeRunsDir({ [`${night}.jsonl`]: '' }));

    const htmlResponse = await app.request(`/digest/${night}`);
    expect(htmlResponse.status).toBe(200);
    expect(await htmlResponse.text()).toContain('nothing ran');

    const jsonResponse = await app.request(`/api/digest/${night}`);
    expect(jsonResponse.status).toBe(200);
    expect(await jsonResponse.json()).toEqual([]);
  });

  it('returns 404 from both routes when the night has no file', async () => {
    const app = appFor(makeRunsDir());

    const htmlResponse = await app.request(`/digest/${night}`);
    expect(htmlResponse.status).toBe(404);

    const jsonResponse = await app.request(`/api/digest/${night}`);
    expect(jsonResponse.status).toBe(404);
  });
});
