import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

const BOOK_FILE = 'a_roar_in_harlem.txt';

/**
 * Where the cleaned book text lives. Production runs from /app and ships src/assets next to dist,
 * so cwd/src/assets is first; the other candidates cover dev, tests and a dist-relative layout.
 */
function candidatePaths(): string[] {
  return [
    join(process.cwd(), 'src', 'assets', 'seed', BOOK_FILE),
    join(__dirname, '..', 'assets', 'seed', BOOK_FILE),
    join(__dirname, '..', '..', 'src', 'assets', 'seed', BOOK_FILE),
    join(process.cwd(), 'dist', 'src', 'assets', 'seed', BOOK_FILE),
  ];
}

/** The cleaned manuscript, or null when the asset is not on disk. */
export function loadBookText(): string | null {
  for (const p of candidatePaths()) {
    if (existsSync(p)) return readFileSync(p, 'utf8');
  }
  return null;
}
