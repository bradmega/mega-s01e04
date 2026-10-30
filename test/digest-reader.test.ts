import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readNight } from '../src/digest/reader.js';

const tempDirs: string[] = [];

function runsWith(contents: string): string {
  const runsDir = mkdtempSync(join(tmpdir(), 'rig-reader-'));
  tempDirs.push(runsDir);
  writeFileSync(join(runsDir, '2026-10-28.jsonl'), contents);
  return runsDir;
}

afterEach(() => {
  for (const runsDir of tempDirs.splice(0)) {
    rmSync(runsDir, { recursive: true, force: true });
  }
});

describe('readNight', () => {
  it('reads the supplied night into five sorted jobs and counts its bad line', () => {
    expect(readNight('runs', '2026-10-28')).toEqual({
      malformedLines: 1,
      rows: [
        {
          job: 'digest/render', owner: null, runs: 1, retries: 0,
          lastStatus: 'ok', lastError: null,
          firstAt: '2026-10-29T05:41:09+01:00', lastAt: '2026-10-29T05:41:09+01:00',
        },
        {
          job: 'fixtures/refresh', owner: 'rook', runs: 4, retries: 3,
          lastStatus: 'ok', lastError: 'upstream 503',
          firstAt: '2026-10-29T01:30:00+01:00', lastAt: '2026-10-29T01:37:00+01:00',
        },
        {
          job: 'lane/sync', owner: 'rook', runs: 8, retries: 1,
          lastStatus: 'ok', lastError: 'lock held',
          firstAt: '2026-10-28T23:00:06+01:00', lastAt: '2026-10-29T05:00:04+01:00',
        },
        {
          job: 'notes/backup', owner: 'lane-07', runs: 1, retries: 0,
          lastStatus: 'fail', lastError: 'quota exceeded',
          firstAt: '2026-10-29T04:00:01+01:00', lastAt: '2026-10-29T04:00:01+01:00',
        },
        {
          job: 'rig/rotate-logs', owner: 'lane-07', runs: 1, retries: 0,
          lastStatus: 'ok', lastError: null,
          firstAt: '2026-10-28T23:00:02+01:00', lastAt: '2026-10-28T23:00:02+01:00',
        },
      ],
    });
  });

  it('uses event times across offsets and keeps the last recorded error from unsorted input', () => {
    const runsDir = runsWith([
      { at: '2026-10-29T03:00:00+01:00', job: 'job', status: 'ok', owner: null },
      { at: '2026-10-29T01:30:00Z', job: 'job', status: 'retry', owner: 'new', error: 'latest error' },
      { at: '2026-10-29T02:00:00+02:00', job: 'job', status: 'fail', owner: 'old', error: 'first error' },
    ].map((event) => JSON.stringify(event)).join('\n'));

    expect(readNight(runsDir, '2026-10-28')).toEqual({
      malformedLines: 0,
      rows: [{
        job: 'job', owner: null, runs: 3, retries: 1, lastStatus: 'ok',
        lastError: 'latest error', firstAt: '2026-10-29T02:00:00+02:00',
        lastAt: '2026-10-29T03:00:00+01:00',
      }],
    });
  });

  it('uses the later line when event times match', () => {
    const runsDir = runsWith([
      { at: '2026-10-29T02:00:00Z', job: 'job', status: 'retry', owner: 'first', error: 'first' },
      { at: '2026-10-29T02:00:00Z', job: 'job', status: 'fail', owner: 'second', error: 'second' },
    ].map((event) => JSON.stringify(event)).join('\n'));

    expect(readNight(runsDir, '2026-10-28').rows[0]).toMatchObject({
      owner: 'second', lastStatus: 'fail', lastError: 'second', runs: 2, retries: 1,
    });
  });

  it('counts invalid JSON and invalid event fields without losing valid rows', () => {
    const valid = { at: '2026-10-29T02:00:00Z', job: 'valid', status: 'ok', owner: null };
    const invalid = [
      null, [], 42, 'text', {},
      { ...valid, at: 42 }, { ...valid, at: 'not a date' },
      { ...valid, job: 42 }, { ...valid, job: '' },
      { ...valid, status: 'running' }, { ...valid, owner: 42 },
      { at: valid.at, job: valid.job, status: valid.status },
      { ...valid, error: { message: 'bad' } },
    ];
    const runsDir = runsWith([
      '{broken', ...invalid.map((event) => JSON.stringify(event)), '', JSON.stringify(valid),
    ].join('\r\n') + '\r\n');

    expect(readNight(runsDir, '2026-10-28')).toEqual({
      malformedLines: invalid.length + 2,
      rows: [{
        job: 'valid', owner: null, runs: 1, retries: 0, lastStatus: 'ok', lastError: null,
        firstAt: valid.at, lastAt: valid.at,
      }],
    });
  });

  it('sorts jobs consistently and handles prototype property names', () => {
    const runsDir = runsWith(['z', '__proto__', 'A', 'a', 'constructor'].map((job) => JSON.stringify({
      at: '2026-10-29T02:00:00Z', job, status: 'ok', owner: null,
    })).join('\n'));

    expect(readNight(runsDir, '2026-10-28').rows.map((row) => row.job))
      .toEqual(['A', '__proto__', 'a', 'constructor', 'z']);
  });

  it('returns no rows for an empty file', () => {
    expect(readNight(runsWith(''), '2026-10-28')).toEqual({ rows: [], malformedLines: 0 });
  });

  it('propagates ENOENT for a missing night', () => {
    expect(() => readNight(runsWith(''), '2026-10-27')).toThrow(expect.objectContaining({ code: 'ENOENT' }));
  });
});
