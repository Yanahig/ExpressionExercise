import type { EditOp, EditOpKind } from './types';

export function uid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function formatDateTime(ts: number): string {
  return new Date(ts).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatDuration(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60)
    .toString()
    .padStart(2, '0');
  const s = (totalSeconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

export function hexToRgba(hex: string, alpha: number): string {
  let h = hex.replace('#', '').trim();
  if (h.length === 3) {
    h = h
      .split('')
      .map((c) => c + c)
      .join('');
  }
  const n = Number.parseInt(h, 16);
  if (Number.isNaN(n) || h.length !== 6) {
    return `rgba(150, 150, 140, ${alpha})`;
  }
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export interface Sentence {
  index: number;
  paragraph: number;
  text: string;
  start: number;
  end: number;
}

const SENTENCE_ENDERS = new Set(['。', '！', '？', '；', '…']);
const SENTENCE_CLOSERS = new Set(['”', '』', '」', '）', '】', '》', '"', "'"]);

export function splitSentences(text: string): Sentence[] {
  const sentences: Sentence[] = [];
  let paragraph = 0;
  let sentenceStart = 0;
  let i = 0;

  const push = (rawStart: number, rawEnd: number) => {
    const raw = text.slice(rawStart, rawEnd);
    const leading = raw.length - raw.trimStart().length;
    const trailing = raw.length - raw.trimEnd().length;
    const trimmed = raw.trim();
    if (!trimmed) return;
    sentences.push({
      index: sentences.length,
      paragraph,
      text: trimmed,
      start: rawStart + leading,
      end: rawEnd - trailing,
    });
  };

  while (i < text.length) {
    const ch = text[i];
    if (ch === '\n' || ch === '\r') {
      push(sentenceStart, i);
      sentenceStart = i + 1;
      i += 1;
      if (ch === '\r' && text[i] === '\n') {
        sentenceStart += 1;
        i += 1;
      }
      paragraph += 1;
      continue;
    }
    if (SENTENCE_ENDERS.has(ch)) {
      let j = i + 1;
      while (j < text.length && SENTENCE_CLOSERS.has(text[j])) j += 1;
      push(sentenceStart, j);
      sentenceStart = j;
      i = j;
      continue;
    }
    i += 1;
  }
  push(sentenceStart, text.length);
  return sentences;
}

export interface OriginalMarkerSegment {
  text: string;
  start: number;
  end: number;
  kind: 'plain' | 'deleted' | 'replaced' | 'inserted';
  opId: string | null;
}

export function buildOriginalMarkers(
  text: string,
  ops: EditOp[],
): OriginalMarkerSegment[] {
  const sorted = [...ops].sort((a, b) => a.start - b.start || a.end - b.end);
  const segments: OriginalMarkerSegment[] = [];
  let cursor = 0;
  for (const op of sorted) {
    if (op.kind === 'insert') {
      if (op.start < cursor) continue;
      if (op.start > cursor) {
        segments.push({
          text: text.slice(cursor, op.start),
          start: cursor,
          end: op.start,
          kind: 'plain',
          opId: null,
        });
      }
      segments.push({
        text: op.text,
        start: op.start,
        end: op.start + op.text.length,
        kind: 'inserted',
        opId: op.id,
      });
      cursor = Math.max(cursor, op.start);
      continue;
    }
    const end = Math.min(op.end, text.length);
    if (op.start > cursor) {
      segments.push({
        text: text.slice(cursor, op.start),
        start: cursor,
        end: op.start,
        kind: 'plain',
        opId: null,
      });
    }
    if (end > op.start) {
      segments.push({
        text: text.slice(op.start, end),
        start: op.start,
        end,
        kind: op.kind === 'delete' ? 'deleted' : 'replaced',
        opId: op.id,
      });
    }
    cursor = Math.max(cursor, end);
  }
  if (cursor < text.length) {
    segments.push({
      text: text.slice(cursor),
      start: cursor,
      end: text.length,
      kind: 'plain',
      opId: null,
    });
  }
  return segments;
}

export interface RevisedSegment {
  text: string;
  changed: boolean;
}

export function buildRevisedSegments(
  text: string,
  ops: EditOp[],
): RevisedSegment[] {
  const sorted = [...ops].sort((a, b) => a.start - b.start || a.end - b.end);
  const segments: RevisedSegment[] = [];
  let cursor = 0;
  for (const op of sorted) {
    if (op.kind === 'insert') {
      if (op.start > cursor) {
        segments.push({ text: text.slice(cursor, op.start), changed: false });
      }
      if (op.start >= cursor) {
        segments.push({ text: op.text, changed: true });
      }
      cursor = Math.max(cursor, op.start);
      continue;
    }
    const end = Math.min(op.end, text.length);
    if (op.start > cursor) {
      segments.push({ text: text.slice(cursor, op.start), changed: false });
    }
    if (op.kind === 'replace') {
      segments.push({ text: op.text, changed: true });
    }
    cursor = Math.max(cursor, end);
  }
  if (cursor < text.length) {
    segments.push({ text: text.slice(cursor), changed: false });
  }
  return segments;
}

export function opsConflict(
  existing: EditOp[],
  kind: EditOpKind,
  start: number,
  end: number,
): boolean {
  for (const op of existing) {
    if (kind === 'insert') {
      const p = start;
      if (op.kind === 'insert') {
        if (op.start === p) return true;
      } else if (p > op.start && p < op.end) {
        return true;
      }
    } else if (op.kind === 'insert') {
      if (op.start > start && op.start < end) return true;
    } else if (op.start < end && op.end > start) {
      return true;
    }
  }
  return false;
}
