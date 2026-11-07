/**
 * Reads `art-history` rounds for the local viewer.
 * Notes are parsed leniently: a file still being written yields a partial
 * round instead of throwing.
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

const HEADER_KEYS = ['When', 'Seed', 'Distances', 'Frame', 'Target'] as const;
type HeaderKey = (typeof HEADER_KEYS)[number];
type NoteField = 'title' | 'when' | 'seed' | 'distances' | 'frame' | 'target';

const PNG_LINE = /^[^/\\\s]+\.png$/i;
const LABEL_LINE = /^([A-Za-z][A-Za-z ]*):\s*(.*)$/;
const DISTANCE = /-(\d+)\.png$/i;

export type ParsedFrame = {
  file: string;
  prose: string;
  scores: string;
};

export type ParsedNotes = {
  title: string;
  when: string;
  seed: string;
  distances: string;
  frame: string;
  target: string;
  summary: string;
  frames: ParsedFrame[];
};

export type HistoryImage = {
  file: string;
  distance: number | null;
  prose: string;
  scores: string;
  mtimeMs: number;
};

export type HistoryRound = {
  folder: string;
  title: string;
  when: string;
  seed: string;
  distances: string;
  frame: string;
  target: string;
  summary: string;
  images: HistoryImage[];
};

export type HistoryCatalog = {
  rounds: HistoryRound[];
};

type OpenFrame = {
  file: string;
  prose: string[];
  scores: string[];
  inScores: boolean;
};

type RoundDraft = HistoryRound & { mtimeMs: number };

function isHeaderKey(key: string): key is HeaderKey {
  return (HEADER_KEYS as readonly string[]).includes(key);
}

function headerField(key: HeaderKey): NoteField {
  switch (key) {
    case 'When':
      return 'when';
    case 'Seed':
      return 'seed';
    case 'Distances':
      return 'distances';
    case 'Frame':
      return 'frame';
    case 'Target':
      return 'target';
  }
}

function emptyNotes(): ParsedNotes {
  return {
    title: '',
    when: '',
    seed: '',
    distances: '',
    frame: '',
    target: '',
    summary: '',
    frames: [],
  };
}

function isEnoent(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && err.code === 'ENOENT';
}

function joinLines(lines: string[]): string {
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start] === '') start += 1;
  while (end > start && lines[end - 1] === '') end -= 1;
  return lines.slice(start, end).join('\n');
}

function appendLine(current: string, line: string): string {
  return current.length === 0 ? line : `${current}\n${line}`;
}

function isSafeSegment(name: string): boolean {
  return (
    name.length > 0 &&
    name !== '.' &&
    name !== '..' &&
    !name.includes('/') &&
    !name.includes('\\') &&
    !name.includes('\0')
  );
}

function isSafePng(name: string): boolean {
  return isSafeSegment(name) && name.toLowerCase().endsWith('.png');
}

/** Distance suffix in `snapshot-mode7-120.png`. Missing when the name has none. */
export function distanceFromFilename(file: string): number | null {
  const raw = DISTANCE.exec(file)?.[1];
  if (raw === undefined) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

/**
 * Header `Label:` lines fill the round fields. A following line that is not
 * itself a label stays with the previous field, so a wrapped Target still
 * attaches. An image block runs from a bare `*.png` line until the next
 * filename, a `Scores:` line, or a `Round:` line.
 */
export function parseNotes(text: string): ParsedNotes {
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const notes = emptyNotes();
  const summary: string[] = [];
  let mode: 'header' | 'image' | 'summary' = 'header';
  let lastField: NoteField | null = null;
  let frame: OpenFrame | null = null;
  let sawTitle = false;

  const flush = (): void => {
    if (!frame) return;
    notes.frames.push({
      file: frame.file,
      prose: joinLines(frame.prose),
      scores: joinLines(frame.scores),
    });
    frame = null;
  };

  const appendField = (line: string): void => {
    const field = lastField ?? 'title';
    notes[field] = appendLine(notes[field], line);
    lastField = field;
    if (field === 'title') sawTitle = true;
  };

  for (const raw of source.split(/\r?\n/)) {
    const line = raw.trim();

    if (mode === 'summary') {
      if (PNG_LINE.test(line)) {
        mode = 'image';
        frame = { file: line, prose: [], scores: [], inScores: false };
        continue;
      }
      if (line === '') {
        if (summary.length > 0) summary.push('');
        continue;
      }
      summary.push(line);
      continue;
    }

    if (line === '') {
      if (mode === 'image' && frame && !frame.inScores && frame.prose.length > 0) {
        frame.prose.push('');
      }
      continue;
    }

    if (PNG_LINE.test(line)) {
      flush();
      mode = 'image';
      frame = { file: line, prose: [], scores: [], inScores: false };
      continue;
    }

    const labeled = LABEL_LINE.exec(line);
    const key = labeled?.[1];

    if (key === 'Round') {
      flush();
      mode = 'summary';
      summary.push(line);
      continue;
    }

    if (key === 'Scores' && mode === 'image' && frame) {
      frame.inScores = true;
      frame.scores.push(line);
      continue;
    }

    if (mode === 'header') {
      if (key && isHeaderKey(key)) {
        const field = headerField(key);
        notes[field] = labeled?.[2] ?? '';
        lastField = field;
        sawTitle = true;
        continue;
      }
      if (!sawTitle && !key) {
        notes.title = line;
        lastField = 'title';
        sawTitle = true;
        continue;
      }
      appendField(line);
      continue;
    }

    if (frame) {
      if (frame.inScores) frame.scores.push(line);
      else frame.prose.push(line);
    }
  }

  flush();
  notes.summary = joinLines(summary);
  return notes;
}

function compareImages(a: HistoryImage, b: HistoryImage): number {
  if (a.distance === null && b.distance === null) return a.file.localeCompare(b.file);
  if (a.distance === null) return 1;
  if (b.distance === null) return -1;
  if (a.distance !== b.distance) return a.distance - b.distance;
  return a.file.localeCompare(b.file);
}

function leadingNumber(folder: string): number | null {
  const raw = /^(\d+)/.exec(folder)?.[1];
  if (raw === undefined) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function compareRounds(a: RoundDraft, b: RoundDraft): number {
  const aNumber = leadingNumber(a.folder);
  const bNumber = leadingNumber(b.folder);
  if (aNumber !== null && bNumber !== null) {
    if (aNumber !== bNumber) return bNumber - aNumber;
    return b.folder.localeCompare(a.folder);
  }
  if (aNumber !== null) return -1;
  if (bNumber !== null) return 1;
  if (a.mtimeMs !== b.mtimeMs) return b.mtimeMs - a.mtimeMs;
  return b.folder.localeCompare(a.folder);
}

export async function readCatalog(root: string): Promise<HistoryCatalog> {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (err) {
    if (isEnoent(err)) return { rounds: [] };
    throw err;
  }

  const drafts: RoundDraft[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const folder = entry.name;
    const dir = join(root, folder);
    let dirStat;
    try {
      dirStat = await stat(dir);
    } catch (err) {
      if (isEnoent(err)) continue;
      throw err;
    }

    let parsed = emptyNotes();
    try {
      const text = await readFile(join(dir, 'notes.txt'), 'utf8');
      parsed = parseNotes(text);
    } catch (err) {
      if (!isEnoent(err)) throw err;
    }

    const described = new Map<string, ParsedFrame>();
    for (const item of parsed.frames) {
      if (!described.has(item.file)) described.set(item.file, item);
    }

    let listed;
    try {
      listed = await readdir(dir, { withFileTypes: true });
    } catch (err) {
      if (isEnoent(err)) continue;
      throw err;
    }

    const images: HistoryImage[] = [];
    for (const fileEntry of listed) {
      if (!fileEntry.isFile() || !fileEntry.name.toLowerCase().endsWith('.png')) continue;
      const filePath = join(dir, fileEntry.name);
      let fileStat;
      try {
        fileStat = await stat(filePath);
      } catch (err) {
        if (isEnoent(err)) continue;
        throw err;
      }
      const describedFrame = described.get(fileEntry.name);
      images.push({
        file: fileEntry.name,
        distance: distanceFromFilename(fileEntry.name),
        prose: describedFrame?.prose ?? '',
        scores: describedFrame?.scores ?? '',
        mtimeMs: fileStat.mtimeMs,
      });
    }
    images.sort(compareImages);

    drafts.push({
      folder,
      title: parsed.title.trim() || folder,
      when: parsed.when,
      seed: parsed.seed,
      distances: parsed.distances,
      frame: parsed.frame,
      target: parsed.target,
      summary: parsed.summary,
      images,
      mtimeMs: dirStat.mtimeMs,
    });
  }

  drafts.sort(compareRounds);
  return {
    rounds: drafts.map(({ mtimeMs: _mtimeMs, ...round }) => round),
  };
}

/** Absolute PNG path inside `root`, or null when the request escapes it. */
export function resolveMediaPath(root: string, folder: string, file: string): string | null {
  if (!isSafeSegment(folder) || !isSafePng(file)) return null;
  const rootResolved = resolve(root);
  const full = resolve(rootResolved, folder, file);
  const rel = relative(rootResolved, full);
  if (rel === '' || isAbsolute(rel) || rel.startsWith('..') || rel.split(sep).length !== 2) {
    return null;
  }
  return full;
}
