import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DigestRow, ReadNight } from './types.js';

type RunEvent = {
  at: string;
  time: number;
  job: string;
  owner: string | null;
  status: DigestRow['lastStatus'];
  error: string | null;
};

type JobRuns = {
  row: DigestRow;
  firstTime: number;
  lastTime: number;
  lastErrorTime: number;
};

function parseEvent(line: string): RunEvent | null {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return null;
  }

  if (typeof value !== 'object' || value === null || Array.isArray(value)
    || !('at' in value) || typeof value.at !== 'string'
    || !('job' in value) || typeof value.job !== 'string' || value.job.trim() === ''
    || !('owner' in value) || (typeof value.owner !== 'string' && value.owner !== null)
    || !('status' in value) || (value.status !== 'ok' && value.status !== 'retry' && value.status !== 'fail')) {
    return null;
  }

  const time = Date.parse(value.at);
  const error = 'error' in value ? value.error : undefined;
  if (!Number.isFinite(time) || (error !== undefined && typeof error !== 'string')) {
    return null;
  }

  return {
    at: value.at, time, job: value.job, owner: value.owner,
    status: value.status, error: error ?? null,
  };
}

export const readNight: ReadNight = (runsDir, night) => {
  const contents = readFileSync(join(runsDir, `${night}.jsonl`), 'utf8');
  const lines = contents === '' ? [] : contents.split(/\r?\n/);
  if (lines.at(-1) === '') lines.pop();

  const jobs = new Map<string, JobRuns>();
  let malformedLines = 0;

  for (const line of lines) {
    const event = parseEvent(line);
    if (event === null) {
      malformedLines += 1;
      continue;
    }

    const current = jobs.get(event.job);
    if (current === undefined) {
      jobs.set(event.job, {
        row: {
          job: event.job, owner: event.owner, runs: 1,
          retries: event.status === 'retry' ? 1 : 0,
          lastStatus: event.status, lastError: event.error,
          firstAt: event.at, lastAt: event.at,
        },
        firstTime: event.time,
        lastTime: event.time,
        lastErrorTime: event.error === null ? -Infinity : event.time,
      });
      continue;
    }

    current.row.runs += 1;
    if (event.status === 'retry') current.row.retries += 1;
    if (event.time < current.firstTime) {
      current.firstTime = event.time;
      current.row.firstAt = event.at;
    }
    if (event.time >= current.lastTime) {
      current.lastTime = event.time;
      current.row.lastAt = event.at;
      current.row.lastStatus = event.status;
      current.row.owner = event.owner;
    }
    if (event.error !== null && event.time >= current.lastErrorTime) {
      current.lastErrorTime = event.time;
      current.row.lastError = event.error;
    }
  }

  const rows = [...jobs.values()].map(({ row }) => row)
    .sort((left, right) => left.job < right.job ? -1 : left.job > right.job ? 1 : 0);
  return { rows, malformedLines };
};
