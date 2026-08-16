import type {
  Annotation,
  EditOp,
  Group,
  Session,
  TagDef,
  Transcript,
} from './types';
import { DEFAULT_TAGS, GROUP_COLORS } from './types';

const SESSIONS_KEY = 'expression-practice-sessions:v1';
const GROUPS_KEY = 'expression-practice-groups:v1';
const TAGS_KEY = 'expression-practice-tags:v1';

function isAnnotation(value: unknown): value is Annotation {
  const a = value as Record<string, unknown> | null;
  return (
    !!a &&
    typeof a.id === 'string' &&
    typeof a.start === 'number' &&
    typeof a.end === 'number' &&
    typeof a.tag === 'string' &&
    typeof a.note === 'string'
  );
}

function isEditOp(value: unknown): value is EditOp {
  const o = value as Record<string, unknown> | null;
  return (
    !!o &&
    typeof o.id === 'string' &&
    (o.kind === 'delete' || o.kind === 'replace' || o.kind === 'insert') &&
    typeof o.sentenceIndex === 'number' &&
    typeof o.start === 'number' &&
    typeof o.end === 'number' &&
    typeof o.text === 'string'
  );
}

function migrateSession(raw: unknown): Session | null {
  const s = raw as Record<string, unknown> | null;
  if (!s || typeof s.id !== 'string') return null;
  const createdAt = typeof s.createdAt === 'number' ? s.createdAt : Date.now();

  let transcripts: Transcript[] | null = null;
  if (Array.isArray(s.transcripts)) {
    const list = s.transcripts
      .map((t): Transcript | null => {
        const tr = t as Record<string, unknown> | null;
        if (!tr || typeof tr.original !== 'string') return null;
        return {
          id: typeof tr.id === 'string' ? tr.id : '',
          createdAt:
            typeof tr.createdAt === 'number' ? tr.createdAt : createdAt,
          title: typeof tr.title === 'string' ? tr.title : '',
          original: tr.original,
          annotations: Array.isArray(tr.annotations)
            ? tr.annotations.filter(isAnnotation)
            : [],
          editOps: Array.isArray(tr.editOps)
            ? tr.editOps.filter(isEditOp)
            : [],
        };
      })
      .filter((t): t is Transcript => t !== null);
    const seen = new Set<string>();
    transcripts = list.map((t, i) => {
      const base = t.id || `t-${s.id}-${i}`;
      let id = base;
      let n = 2;
      while (seen.has(id)) id = `${base}-${n++}`;
      seen.add(id);
      return { ...t, id };
    });
  } else if (typeof s.original === 'string' && s.original.trim()) {
    transcripts = [
      {
        id: `t-${s.id}-0`,
        createdAt,
        title: '',
        original: s.original,
        annotations: Array.isArray(s.annotations)
          ? s.annotations.filter(isAnnotation)
          : [],
        editOps: Array.isArray(s.editOps) ? s.editOps.filter(isEditOp) : [],
      },
    ];
  }
  if (!transcripts || transcripts.length === 0) return null;

  return {
    id: s.id,
    title: typeof s.title === 'string' ? s.title : '未命名练习',
    createdAt,
    groupId: typeof s.groupId === 'string' ? s.groupId : null,
    transcripts,
  };
}

export function loadSessions(): Session[] {
  try {
    const raw = localStorage.getItem(SESSIONS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(migrateSession)
      .filter((s): s is Session => s !== null);
  } catch {
    return [];
  }
}

export function saveSessions(sessions: Session[]): void {
  try {
    localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions));
  } catch {
    // 存储已满或不可用时静默忽略
  }
}

export function loadGroups(): Group[] {
  try {
    const raw = localStorage.getItem(GROUPS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const groups = parsed.filter(
      (g): g is Record<string, unknown> =>
        !!g &&
        typeof (g as Record<string, unknown>).id === 'string' &&
        typeof (g as Record<string, unknown>).name === 'string',
    );
    return groups.map((g, i) => ({
      id: g.id as string,
      name: g.name as string,
      color:
        typeof g.color === 'string'
          ? g.color
          : GROUP_COLORS[i % GROUP_COLORS.length],
    }));
  } catch {
    return [];
  }
}

export function saveGroups(groups: Group[]): void {
  try {
    localStorage.setItem(GROUPS_KEY, JSON.stringify(groups));
  } catch {
    // 静默忽略
  }
}

export function loadTags(): TagDef[] {
  try {
    const raw = localStorage.getItem(TAGS_KEY);
    if (!raw) return DEFAULT_TAGS;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return DEFAULT_TAGS;
    const tags = parsed.filter(
      (t): t is TagDef =>
        !!t &&
        typeof (t as TagDef).id === 'string' &&
        typeof (t as TagDef).label === 'string' &&
        typeof (t as TagDef).color === 'string',
    );
    return tags.length > 0 ? tags : DEFAULT_TAGS;
  } catch {
    return DEFAULT_TAGS;
  }
}

export function saveTags(tags: TagDef[]): void {
  try {
    localStorage.setItem(TAGS_KEY, JSON.stringify(tags));
  } catch {
    // 静默忽略
  }
}
