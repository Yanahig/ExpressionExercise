import { useEffect, useMemo, useRef, useState } from 'react';
import type { Group, Session, TagDef, Transcript } from '../types';
import { FALLBACK_TAG } from '../types';
import { formatDateTime, hexToRgba } from '../utils';

interface SidebarProps {
  view: 'live' | 'editor';
  sessions: Session[];
  groups: Group[];
  tags: TagDef[];
  activeId: string | null;
  transcripts: Transcript[];
  filter: string | 'all';
  onFilterChange: (filter: string | 'all') => void;
  onSelectSession: (id: string) => void;
  onDeleteSession: (id: string) => void;
  onRenameSession: (sessionId: string, title: string) => void;
  onNewPractice: (groupId: string | null) => void;
  onJump: (id: string) => void;
  onDeleteAnnotation: (transcriptId: string, annotationId: string) => void;
  onAddGroup: (name: string) => void;
  onRenameGroup: (id: string, name: string) => void;
  onDeleteGroup: (id: string) => void;
  onAssignGroup: (sessionId: string, groupId: string | null) => void;
  onMoveSession: (dragId: string, targetId: string, before: boolean) => void;
  onMoveGroup: (dragId: string, targetId: string, before: boolean) => void;
  onMoveTag: (dragId: string, targetId: string, before: boolean) => void;
  onAddTag: (label: string, color: string) => void;
  onUpdateTag: (id: string, label: string, color: string) => void;
  onDeleteTag: (id: string) => void;
}

interface Rect {
  left: number;
  top: number;
}

type DeleteAction = 'session' | 'group' | 'tag' | 'annotation';

type PopoverState =
  | { kind: 'rename-group'; id: string; anchor: Rect }
  | { kind: 'rename-session'; id: string; anchor: Rect }
  | {
      kind: 'delete';
      action: DeleteAction;
      id: string;
      transcriptId?: string;
      anchor: Rect;
      message: string;
    };

const UNGROUPED_KEY = '__none__';
const RATIO_KEY = 'expression-practice-sidebar-ratio:v1';
const POPOVER_WIDTH = 300;
const GROUP_MIME = 'application/x-expression-group';
const TAG_MIME = 'application/x-expression-tag';

export default function Sidebar({
  view,
  sessions,
  groups,
  tags,
  activeId,
  transcripts,
  filter,
  onFilterChange,
  onSelectSession,
  onDeleteSession,
  onRenameSession,
  onNewPractice,
  onJump,
  onDeleteAnnotation,
  onAddGroup,
  onRenameGroup,
  onDeleteGroup,
  onAssignGroup,
  onMoveSession,
  onMoveGroup,
  onMoveTag,
  onAddTag,
  onUpdateTag,
  onDeleteTag,
}: SidebarProps) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [ratio, setRatio] = useState<number>(() => {
    try {
      const r = Number(localStorage.getItem(RATIO_KEY));
      if (Number.isFinite(r) && r >= 0.25 && r <= 0.75) return r;
    } catch {
      // 忽略读取失败
    }
    return 0.5;
  });
  const [dragging, setDragging] = useState(false);
  const [tab, setTab] = useState<'tags' | 'notes'>('tags');
  const [dragOver, setDragOver] = useState<string | null>(null);
  const [reorderTarget, setReorderTarget] = useState<{
    id: string;
    before: boolean;
  } | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [creatingTag, setCreatingTag] = useState(false);
  const [tagLabel, setTagLabel] = useState('');
  const [tagColor, setTagColor] = useState('#7A8B6F');
  const [editingTagId, setEditingTagId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState('');
  const [editColor, setEditColor] = useState('#7A8B6F');
  const [popover, setPopover] = useState<PopoverState | null>(null);
  const [renameValue, setRenameValue] = useState('');

  useEffect(() => {
    document.body.classList.toggle('sidebar-resizing', dragging);
    return () => document.body.classList.remove('sidebar-resizing');
  }, [dragging]);

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent) => {
      const body = bodyRef.current;
      if (!body) return;
      const rect = body.getBoundingClientRect();
      if (rect.height <= 0) return;
      const next = (e.clientY - rect.top) / rect.height;
      setRatio(Math.min(0.75, Math.max(0.25, next)));
    };
    const onUp = () => {
      setDragging(false);
      setRatio((r) => {
        try {
          localStorage.setItem(RATIO_KEY, String(r));
        } catch {
          // 忽略存储失败
        }
        return r;
      });
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [dragging]);

  useEffect(() => {
    if (!popover) return;
    const onDown = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setPopover(null);
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [popover]);

  const defFor = (tagId: string): TagDef =>
    tags.find((t) => t.id === tagId) ?? FALLBACK_TAG;

  const annotationItems = useMemo(
    () =>
      transcripts.flatMap((t) =>
        t.annotations.map((a) => ({
          ...a,
          original: t.original,
          transcriptId: t.id,
        })),
      ),
    [transcripts],
  );

  const counts: Record<string, number> = { all: annotationItems.length };
  let orphanCount = 0;
  tags.forEach((t) => {
    counts[t.id] = 0;
  });
  annotationItems.forEach((a) => {
    if (tags.some((t) => t.id === a.tag)) counts[a.tag] += 1;
    else orphanCount += 1;
  });

  const filtered =
    filter === 'all'
      ? annotationItems
      : filter === FALLBACK_TAG.id
        ? annotationItems.filter((a) => !tags.some((t) => t.id === a.tag))
        : annotationItems.filter((a) => a.tag === filter);

  const itemsIn = (groupId: string | null) =>
    sessions.filter((s) => (s.groupId ?? null) === groupId);

  const ungrouped = itemsIn(null);

  const tagUsage = (tagId: string) =>
    sessions.reduce(
      (n, s) =>
        n +
        s.transcripts.reduce(
          (m, t) => m + t.annotations.filter((a) => a.tag === tagId).length,
          0,
        ),
      0,
    );

  const anchorFromEvent = (e: React.MouseEvent): Rect => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const left = Math.min(
      Math.max(8, rect.left),
      window.innerWidth - POPOVER_WIDTH - 8,
    );
    const top =
      rect.bottom + 8 + 140 > window.innerHeight
        ? Math.max(8, rect.top - 130)
        : rect.bottom + 8;
    return { left, top };
  };

  const closePopover = () => {
    setPopover(null);
    setRenameValue('');
  };

  const openRenameGroup = (e: React.MouseEvent, group: Group) => {
    setRenameValue(group.name);
    setPopover({ kind: 'rename-group', id: group.id, anchor: anchorFromEvent(e) });
  };

  const openRenameSession = (e: React.MouseEvent, session: Session) => {
    setRenameValue(session.title);
    setPopover({
      kind: 'rename-session',
      id: session.id,
      anchor: anchorFromEvent(e),
    });
  };

  const openDelete = (
    e: React.MouseEvent,
    action: DeleteAction,
    id: string,
    message: string,
    transcriptId?: string,
  ) => {
    setPopover({
      kind: 'delete',
      action,
      id,
      transcriptId,
      anchor: anchorFromEvent(e),
      message,
    });
  };

  const submitRename = () => {
    if (popover?.kind === 'rename-group' && renameValue.trim()) {
      onRenameGroup(popover.id, renameValue);
    } else if (popover?.kind === 'rename-session') {
      onRenameSession(popover.id, renameValue);
    }
    closePopover();
  };

  const confirmDelete = () => {
    if (popover?.kind !== 'delete') return;
    const { action, id } = popover;
    if (action === 'session') onDeleteSession(id);
    else if (action === 'group') onDeleteGroup(id);
    else if (action === 'tag') onDeleteTag(id);
    else if (popover.transcriptId) onDeleteAnnotation(popover.transcriptId, id);
    closePopover();
  };

  const submitGroup = () => {
    if (!groupName.trim()) return;
    onAddGroup(groupName);
    setGroupName('');
    setCreatingGroup(false);
  };

  const startEditTag = (t: TagDef) => {
    setEditingTagId(t.id);
    setEditLabel(t.label);
    setEditColor(t.color);
  };

  const submitEditTag = () => {
    if (editingTagId && editLabel.trim()) {
      onUpdateTag(editingTagId, editLabel, editColor);
    }
    setEditingTagId(null);
  };

  const submitNewTag = () => {
    if (!tagLabel.trim()) return;
    onAddTag(tagLabel, tagColor);
    setTagLabel('');
    setTagColor('#7A8B6F');
    setCreatingTag(false);
  };

  const handleDragStart = (e: React.DragEvent, sessionId: string) => {
    e.dataTransfer.setData('text/plain', sessionId);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver =
    (key: string) =>
    (e: React.DragEvent): void => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      setDragOver(key);
    };

  const handleDrop =
    (groupId: string | null) =>
    (e: React.DragEvent): void => {
      e.preventDefault();
      const sessionId = e.dataTransfer.getData('text/plain');
      if (sessionId) onAssignGroup(sessionId, groupId);
      setDragOver(null);
    };

  const toggleGroup = (key: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const renderHistoryItem = (s: Session) => (
    <div
      key={s.id}
      className={`history-item ${s.id === activeId ? 'active' : ''}${
        reorderTarget?.id === s.id
          ? reorderTarget.before
            ? ' drop-before'
            : ' drop-after'
          : ''
      }`}
      draggable
      onDragStart={(e) => handleDragStart(e, s.id)}
      onDragEnd={() => {
        setDragOver(null);
        setReorderTarget(null);
      }}
      onDragOver={(e) => {
        const dragId = e.dataTransfer.getData('text/plain');
        const dragged = sessions.find((x) => x.id === dragId);
        if (!dragged || (dragged.groupId ?? null) !== (s.groupId ?? null)) {
          return;
        }
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'move';
        const rect = e.currentTarget.getBoundingClientRect();
        setReorderTarget({
          id: s.id,
          before: e.clientY < rect.top + rect.height / 2,
        });
      }}
      onDrop={(e) => {
        const dragId = e.dataTransfer.getData('text/plain');
        const dragged = sessions.find((x) => x.id === dragId);
        if (!dragged || (dragged.groupId ?? null) !== (s.groupId ?? null)) {
          return;
        }
        e.preventDefault();
        e.stopPropagation();
        const rect = e.currentTarget.getBoundingClientRect();
        onMoveSession(
          dragId,
          s.id,
          e.clientY < rect.top + rect.height / 2,
        );
        setReorderTarget(null);
        setDragOver(null);
      }}
      onClick={() => onSelectSession(s.id)}
    >
      <div className="history-title">{s.title || '未命名练习'}</div>
      <div className="history-meta">
        {formatDateTime(s.createdAt)} · {s.transcripts.length} 语稿 ·{' '}
        {s.transcripts.reduce((n, t) => n + t.annotations.length, 0)} 条批注
      </div>
      <div className="history-item-actions">
        <button
          type="button"
          className="icon-btn"
          title="重命名记录"
          onClick={(e) => {
            e.stopPropagation();
            openRenameSession(e, s);
          }}
        >
          ✎
        </button>
        <button
          type="button"
          className="icon-btn"
          title="删除记录"
          onClick={(e) => {
            e.stopPropagation();
            openDelete(
              e,
              'session',
              s.id,
              '确定删除这条练习记录吗？删除后无法恢复。',
            );
          }}
        >
          ✕
        </button>
      </div>
    </div>
  );

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <span className="brand-icon">🎙️</span>
        <div>
          <h1>表达练习</h1>
          <p>边说边改 · 提升表达</p>
        </div>
      </div>

      <div className="sidebar-body" ref={bodyRef}>
        <section
          className="sidebar-section history records-pane"
          style={{ height: `${ratio * 100}%` }}
        >
          <div className="records-toolbar">
            <span className="records-title">
              历史记录 <span className="count">{sessions.length}</span>
            </span>
            <button
              type="button"
              className="mini-btn"
              onClick={() => onNewPractice(null)}
            >
              ＋ 新建练习
            </button>
            <button
              type="button"
              className="mini-btn"
              onClick={() => setCreatingGroup(true)}
            >
              ＋ 新建分组
            </button>
          </div>

          {!creatingGroup ? null : (
            <div className="group-create-form">
              <input
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
                placeholder="分组名称"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter') submitGroup();
                }}
              />
              <button
                type="button"
                className="btn-mini primary"
                onClick={submitGroup}
              >
                添加
              </button>
              <button
                type="button"
                className="btn-mini"
                onClick={() => {
                  setCreatingGroup(false);
                  setGroupName('');
                }}
              >
                取消
              </button>
            </div>
          )}

          <div className="history-groups">
            {groups.map((g) => (
              <div
                key={g.id}
                className={`history-group ${
                  dragOver === g.id ? 'drop-target' : ''
                }${
                  reorderTarget?.id === g.id
                    ? reorderTarget.before
                      ? ' drop-before'
                      : ' drop-after'
                    : ''
                }`}
                style={{ borderLeftColor: g.color }}
                onDragOver={handleDragOver(g.id)}
                onDragLeave={() => setDragOver(null)}
                onDrop={handleDrop(g.id)}
              >
                <div
                  className="group-head"
                  onClick={() => toggleGroup(g.id)}
                  onDragOver={(e) => {
                    if (!e.dataTransfer.types.includes(GROUP_MIME)) return;
                    e.preventDefault();
                    e.stopPropagation();
                    e.dataTransfer.dropEffect = 'move';
                    const rect = e.currentTarget.getBoundingClientRect();
                    setReorderTarget({
                      id: g.id,
                      before: e.clientY < rect.top + rect.height / 2,
                    });
                  }}
                  onDrop={(e) => {
                    if (!e.dataTransfer.types.includes(GROUP_MIME)) return;
                    e.preventDefault();
                    e.stopPropagation();
                    const dragId = e.dataTransfer.getData(GROUP_MIME);
                    if (dragId && dragId !== g.id) {
                      const rect = e.currentTarget.getBoundingClientRect();
                      onMoveGroup(
                        dragId,
                        g.id,
                        e.clientY < rect.top + rect.height / 2,
                      );
                    }
                    setReorderTarget(null);
                  }}
                >
                  <span
                    className="drag-grip"
                    draggable
                    title="拖动调整分组顺序"
                    onClick={(e) => e.stopPropagation()}
                    onDragStart={(e) => {
                      e.stopPropagation();
                      e.dataTransfer.setData(GROUP_MIME, g.id);
                      e.dataTransfer.effectAllowed = 'move';
                    }}
                    onDragEnd={() => {
                      setReorderTarget(null);
                      setDragOver(null);
                    }}
                  >
                    ⋮⋮
                  </span>
                  <button
                    type="button"
                    className="group-toggle"
                    title={collapsed.has(g.id) ? '展开' : '折叠'}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleGroup(g.id);
                    }}
                  >
                    {collapsed.has(g.id) ? '▸' : '▾'}
                  </button>
                  <span
                    className="group-color-block"
                    style={{ background: g.color }}
                  />
                  <span className="group-name">{g.name}</span>
                  <span className="group-count">
                    {itemsIn(g.id).length} 条
                  </span>
                  <span
                    className="group-actions"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      type="button"
                      className="icon-btn"
                      title="在该分组新建练习"
                      onClick={() => onNewPractice(g.id)}
                    >
                      ＋
                    </button>
                    <button
                      type="button"
                      className="icon-btn"
                      title="重命名分组"
                      onClick={(e) => openRenameGroup(e, g)}
                    >
                      ✎
                    </button>
                    <button
                      type="button"
                      className="icon-btn"
                      title="删除分组"
                      onClick={(e) =>
                        openDelete(
                          e,
                          'group',
                          g.id,
                          `确定删除分组「${g.name}」吗？组内 ${itemsIn(g.id).length} 条练习会移到未分组。`,
                        )
                      }
                    >
                      ✕
                    </button>
                  </span>
                </div>
                {!collapsed.has(g.id) && (
                  <div className="group-items">
                    {itemsIn(g.id).map(renderHistoryItem)}
                  </div>
                )}
              </div>
            ))}

            {sessions.length === 0 && <p className="empty-tip">还没有练习记录</p>}

            {sessions.length > 0 && (
              <div
                className={`ungrouped-list ${
                  dragOver === UNGROUPED_KEY ? 'drop-target' : ''
                }`}
                onDragOver={handleDragOver(UNGROUPED_KEY)}
                onDragLeave={() => setDragOver(null)}
                onDrop={handleDrop(null)}
              >
                {ungrouped.length > 0 ? (
                  ungrouped.map(renderHistoryItem)
                ) : (
                  <div className="ungrouped-drop-hint">拖到此处移出分组</div>
                )}
              </div>
            )}
          </div>
        </section>

        <div
          className={`sidebar-divider ${dragging ? 'dragging' : ''}`}
          title="拖动调整上下栏大小"
          onMouseDown={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
        />

        <section className="sidebar-section bottom-pane">
          <div className="tab-bar">
            <button
              type="button"
              className={tab === 'tags' ? 'tab-btn active' : 'tab-btn'}
              onClick={() => setTab('tags')}
            >
              标签
            </button>
            <button
              type="button"
              className={tab === 'notes' ? 'tab-btn active' : 'tab-btn'}
              onClick={() => setTab('notes')}
            >
              批注
            </button>
          </div>

          <div className="pane-content">
            {tab === 'tags' ? (
              <div className="tag-manager">
                {tags.map((t) =>
                  editingTagId === t.id ? (
                    <div key={t.id} className="tag-form">
                      <input
                        value={editLabel}
                        onChange={(e) => setEditLabel(e.target.value)}
                        placeholder="标签名称"
                      />
                      <div className="tag-form-row">
                        <input
                          type="color"
                          value={editColor}
                          onChange={(e) => setEditColor(e.target.value)}
                          title="标签颜色"
                        />
                        <span
                          className="tag-form-preview"
                          style={{ color: editColor }}
                        >
                          {editLabel || '预览'}
                        </span>
                      </div>
                      <div className="tag-form-actions">
                        <button
                          type="button"
                          className="btn-mini primary"
                          onClick={submitEditTag}
                        >
                          保存
                        </button>
                        <button
                          type="button"
                          className="btn-mini"
                          onClick={() => setEditingTagId(null)}
                        >
                          取消
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div
                      key={t.id}
                      className={`tag-row${
                        reorderTarget?.id === t.id
                          ? reorderTarget.before
                            ? ' drop-before'
                            : ' drop-after'
                          : ''
                      }`}
                      onDragOver={(e) => {
                        if (!e.dataTransfer.types.includes(TAG_MIME)) return;
                        e.preventDefault();
                        e.dataTransfer.dropEffect = 'move';
                        const rect = e.currentTarget.getBoundingClientRect();
                        setReorderTarget({
                          id: t.id,
                          before: e.clientY < rect.top + rect.height / 2,
                        });
                      }}
                      onDrop={(e) => {
                        if (!e.dataTransfer.types.includes(TAG_MIME)) return;
                        e.preventDefault();
                        const dragId = e.dataTransfer.getData(TAG_MIME);
                        if (dragId && dragId !== t.id) {
                          const rect = e.currentTarget.getBoundingClientRect();
                          onMoveTag(
                            dragId,
                            t.id,
                            e.clientY < rect.top + rect.height / 2,
                          );
                        }
                        setReorderTarget(null);
                      }}
                    >
                      <span
                        className="drag-grip"
                        draggable
                        title="拖动调整标签顺序"
                        onDragStart={(e) => {
                          e.dataTransfer.setData(TAG_MIME, t.id);
                          e.dataTransfer.effectAllowed = 'move';
                        }}
                        onDragEnd={() => setReorderTarget(null)}
                      >
                        ⋮⋮
                      </span>
                      <span className="dot" style={{ background: t.color }} />
                      <span className="tag-label">{t.label}</span>
                      <button
                        type="button"
                        className="icon-btn"
                        title="编辑标签"
                        onClick={() => startEditTag(t)}
                      >
                        ✎
                      </button>
                      <button
                        type="button"
                        className="icon-btn"
                        title="删除标签"
                        onClick={(e) =>
                          openDelete(
                            e,
                            'tag',
                            t.id,
                            `确定删除标签「${t.label}」吗？${
                              tagUsage(t.id) > 0
                                ? `该标签正被 ${tagUsage(t.id)} 条批注使用，删除后显示为「${FALLBACK_TAG.label}」。`
                                : ''
                            }`,
                          )
                        }
                      >
                        ✕
                      </button>
                    </div>
                  ),
                )}

                {creatingTag ? (
                  <div className="tag-form">
                    <input
                      value={tagLabel}
                      onChange={(e) => setTagLabel(e.target.value)}
                      placeholder="新标签名称"
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') submitNewTag();
                      }}
                    />
                    <div className="tag-form-row">
                      <input
                        type="color"
                        value={tagColor}
                        onChange={(e) => setTagColor(e.target.value)}
                        title="标签颜色"
                      />
                      <span
                        className="tag-form-preview"
                        style={{ color: tagColor }}
                      >
                        {tagLabel || '预览'}
                      </span>
                    </div>
                    <div className="tag-form-actions">
                      <button
                        type="button"
                        className="btn-mini primary"
                        onClick={submitNewTag}
                      >
                        添加
                      </button>
                      <button
                        type="button"
                        className="btn-mini"
                        onClick={() => {
                          setCreatingTag(false);
                          setTagLabel('');
                        }}
                      >
                        取消
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="add-tag-btn"
                    onClick={() => setCreatingTag(true)}
                  >
                    ＋ 新增标签
                  </button>
                )}
              </div>
            ) : (
              <>
                <div className="section-title">按标签筛选批注</div>
                <div className="filter-row">
                  <button
                    type="button"
                    className={filter === 'all' ? 'chip active' : 'chip'}
                    onClick={() => onFilterChange('all')}
                  >
                    全部 {counts.all}
                  </button>
                  {tags.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      className={filter === t.id ? 'chip active' : 'chip'}
                      onClick={() => onFilterChange(t.id)}
                    >
                      <span className="dot" style={{ background: t.color }} />
                      {t.label} {counts[t.id]}
                    </button>
                  ))}
                  {orphanCount > 0 && (
                    <button
                      type="button"
                      className={
                        filter === FALLBACK_TAG.id ? 'chip active' : 'chip'
                      }
                      onClick={() => onFilterChange(FALLBACK_TAG.id)}
                    >
                      <span
                        className="dot"
                        style={{ background: FALLBACK_TAG.color }}
                      />
                      {FALLBACK_TAG.label} {orphanCount}
                    </button>
                  )}
                </div>

                <div className="ann-list">
                  {view !== 'editor' || !activeId ? (
                    <p className="empty-tip">
                      打开一个练习后，批注会显示在这里
                    </p>
                  ) : filtered.length === 0 ? (
                    <p className="empty-tip">
                      还没有批注，在右侧原文中选中文字即可添加
                    </p>
                  ) : (
                    filtered.map((a) => {
                      const def = defFor(a.tag);
                      const snippet = a.original.slice(a.start, a.end);
                      const shown =
                        snippet.length > 26
                          ? `${snippet.slice(0, 26)}…`
                          : snippet;
                      return (
                        <div key={a.id} className="ann-item">
                          <div className="ann-head">
                            <span
                              className="ann-tag"
                              style={{
                                color: def.color,
                                background: hexToRgba(def.color, 0.2),
                              }}
                            >
                              {def.label}
                            </span>
                            <div className="ann-actions">
                              <button
                                type="button"
                                className="icon-btn"
                                title="定位到原文"
                                onClick={() => onJump(a.id)}
                              >
                                🔍
                              </button>
                              <button
                                type="button"
                                className="icon-btn"
                                title="删除批注"
                                onClick={(e) =>
                                  openDelete(
                                    e,
                                    'annotation',
                                    a.id,
                                    '确定删除这条批注吗？',
                                    a.transcriptId,
                                  )
                                }
                              >
                                ✕
                              </button>
                            </div>
                          </div>
                          <div className="ann-snippet">“{shown}”</div>
                          {a.note && <div className="ann-note">备注：{a.note}</div>}
                        </div>
                      );
                    })
                  )}
                </div>
              </>
            )}
          </div>
        </section>
      </div>

      {popover && (
        <div
          className="mini-popover"
          ref={popoverRef}
          style={{ left: popover.anchor.left, top: popover.anchor.top }}
        >
          {popover.kind === 'rename-group' ||
          popover.kind === 'rename-session' ? (
            <>
              <div className="mini-popover-title">
                {popover.kind === 'rename-group' ? '重命名分组' : '重命名记录'}
              </div>
              <input
                className="toolbar-note"
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter') submitRename();
                }}
              />
              <div className="toolbar-actions">
                <button type="button" className="btn-cancel" onClick={closePopover}>
                  取消
                </button>
                <button type="button" className="btn-save" onClick={submitRename}>
                  保存
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="mini-popover-title">{popover.message}</div>
              <div className="toolbar-actions">
                <button type="button" className="btn-cancel" onClick={closePopover}>
                  取消
                </button>
                <button type="button" className="btn-danger" onClick={confirmDelete}>
                  删除
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </aside>
  );
}
