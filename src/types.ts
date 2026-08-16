export interface TagDef {
  id: string;
  label: string;
  color: string;
}

export const DEFAULT_TAGS: TagDef[] = [
  { id: 'pause', label: '卡顿', color: '#C08A4B' },
  { id: 'redundant', label: '冗余', color: '#BE7A6E' },
  { id: 'awkward', label: '用词不当', color: '#8F7B93' },
  { id: 'good', label: '好句', color: '#7A8B6F' },
  { id: 'other', label: '其他', color: '#7D8A96' },
];

export const FALLBACK_TAG: TagDef = {
  id: '__deleted__',
  label: '已删除标签',
  color: '#9C9C94',
};

export interface Annotation {
  id: string;
  start: number;
  end: number;
  tag: string;
  note: string;
  createdAt: number;
}

export type EditOpKind = 'delete' | 'replace' | 'insert';

export interface EditOp {
  id: string;
  kind: EditOpKind;
  sentenceIndex: number;
  start: number;
  end: number;
  text: string;
}

export interface Transcript {
  id: string;
  createdAt: number;
  title: string;
  original: string;
  annotations: Annotation[];
  editOps: EditOp[];
}

export interface Session {
  id: string;
  title: string;
  createdAt: number;
  groupId: string | null;
  transcripts: Transcript[];
}

export interface Group {
  id: string;
  name: string;
  color: string;
}

export const GROUP_COLORS: string[] = [
  '#C08A4B',
  '#BE7A6E',
  '#8F7B93',
  '#7A8B6F',
  '#7D8A96',
  '#A67C52',
  '#8A7668',
  '#5F8A8B',
];
