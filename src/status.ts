import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { RigConfig } from './config.js';
import { lastBeat, type Beat } from './heartbeat.js';

export type NightEventStatus = 'ok' | 'retry' | 'fail';

export type NightStatusCounts = Record<NightEventStatus, number>;

export type NightSummary = {
  night: string;
  counts: NightStatusCounts;
};

export type Status = {
  adapter: string;
  installed: string;
  lastBeat: Beat | null;
  nights: NightSummary[];
};

type RunEvent = {
  at: string;
  job: string;
  status: NightEventStatus;
  owner: string | null;
  error?: string;
};

function isNightEventStatus(value: unknown): value is NightEventStatus {
  return value === 'ok' || value === 'retry' || value === 'fail';
}

function isRunEvent(value: unknown): value is RunEvent {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const event = value as Record<string, unknown>;
  return (
    typeof event.at === 'string' &&
    Number.isFinite(Date.parse(event.at)) &&
    typeof event.job === 'string' &&
    event.job.trim() !== '' &&
    isNightEventStatus(event.status) &&
    (event.owner === null || typeof event.owner === 'string') &&
    (event.error === undefined || typeof event.error === 'string')
  );
}

function emptyNightStatusCounts(): NightStatusCounts {
  return { ok: 0, retry: 0, fail: 0 };
}

// Count events rather than the final status of each job, so retries followed by success remain visible.
function nightStatusCounts(runsDir: string, night: string): NightStatusCounts {
  let contents: string;
  try {
    contents = readFileSync(join(runsDir, `${night}.jsonl`), 'utf8');
  } catch {
    return emptyNightStatusCounts();
  }

  const counts = emptyNightStatusCounts();
  for (const line of contents.split(/\r?\n/)) {
    if (line.trim() === '') continue;
    try {
      const event: unknown = JSON.parse(line);
      if (isRunEvent(event)) counts[event.status] += 1;
    } catch {
      // Ignore malformed lines, matching the digest reader's per-line resilience.
    }
  }
  return counts;
}

// Nights on disk = runs/<YYYY-MM-DD>.jsonl, newest first.
export function nightsOnDisk(runsDir: string): string[] {
  try {
    return readdirSync(runsDir)
      .filter((f) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f))
      .map((f) => f.slice(0, 10))
      .sort()
      .reverse();
  } catch {
    return [];
  }
}

export function readStatus(config: RigConfig): Status {
  return {
    adapter: config.adapter,
    installed: config.installed,
    lastBeat: lastBeat(),
    nights: nightsOnDisk(config.runsDir).map((night) => ({
      night,
      counts: nightStatusCounts(config.runsDir, night),
    })),
  };
}
