import type { Handler } from 'hono';
import { readNight } from './reader.js';

const NIGHT_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function digestApiHandler(runsDir: string): Handler {
  return (c) => {
    const night = c.req.param('night');
    if (night.length !== 10 || !NIGHT_PATTERN.test(night)) {
      return c.json({ error: 'Night not found' }, 404);
    }

    try {
      // Keep the reader's order so this response matches the HTML digest.
      return c.json(readNight(runsDir, night).rows);
    } catch (error) {
      if (isMissingFile(error)) return c.json({ error: 'Night not found' }, 404);
      throw error;
    }
  };
}

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}
