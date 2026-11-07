import { readFile } from 'node:fs/promises';
import { releaseNotes } from './lib/release-notes.mjs';

const changelog = await readFile(process.argv[3] ?? 'CHANGELOG.md', 'utf8');
process.stdout.write(releaseNotes(changelog, process.argv[2]));
