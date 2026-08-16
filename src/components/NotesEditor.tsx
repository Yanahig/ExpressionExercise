import { useEffect, useMemo, useRef, useState } from 'react';
import type { Annotation, EditOp, Session, TagDef, Transcript } from '../types';
import { FALLBACK_TAG } from '../types';
import {
  buildOriginalMarkers,
  buildRevisedSegments,
  formatDateTime,
  formatDuration,
  hexToRgba,
  splitSentences,
  type Sentence,
} from '../utils';
import { useSpeechRecognition } from '../hooks/useSpeechRecognition';

type ToolbarPanel = 'actions' | 'annotate' | 'replace' | 'insert';
type TranscriptMode = 'original' | 'edit' | 'final';

interface ToolbarState {
  transcriptIndex: number;
  sentenceIndex: number;
  start: number;
  end: number;
  left: number;
  top: number;
  panel: ToolbarPanel;
  text: string;
  tag: string;
  note: string;
  error: string | null;
}

interface Piece {
  text: string;
  start: number;
  end: number;
  marker: 'plain' | 'deleted' | 'replaced' | 'inserted';
  annIds: string[];
  opId: string | null;
}

interface NotesEditorProps {
  session: Session;
  tags: TagDef[];
  flashId: string | null;
  onAddAnnotation: (
    transcriptId: string,
    annotation: Omit<Annotation, 'id' | 'createdAt'>,
  ) => void;
  onAddEditOp: (
    sessionId: string,
    transcriptId: string,
    op: Omit<EditOp, 'id'>,
  ) => boolean;
  onRemoveEditOp: (
    sessionId: string,
    transcriptId: string,
    opId: string,
  ) => void;
  onAddTranscript: (sessionId: string, text: string) => void;
  onDeleteTranscript: (sessionId: string, transcriptId: string) => void;
  onRenameTranscript: (
    sessionId: string,
    transcriptId: string,
    title: string,
  ) => void;
  onRenameSession: (sessionId: string, title: string) => void;
}

function buildPieces(
  sentence: Sentence,
  ops: EditOp[],
  annotations: Annotation[],
): Piece[] {
  const localAnns = annotations
    .map((a) => ({
      ann: a,
      start: Math.max(0, a.start - sentence.start),
      end: Math.min(sentence.text.length, a.end - sentence.start),
    }))
    .filter((x) => x.end > x.start)
    .sort((a, b) => a.start - b.start || a.end - b.end);

  const markers = buildOriginalMarkers(sentence.text, ops);
  const pieces: Piece[] = [];

  for (const m of markers) {
    if (m.kind === 'inserted') {
      pieces.push({
        text: m.text,
        start: m.start,
        end: m.start,
        marker: m.kind,
        annIds: [],
        opId: m.opId,
      });
      continue;
    }
    let cursor = m.start;
    for (const ann of localAnns) {
      if (ann.end <= m.start || ann.start >= m.end) continue;
      if (ann.start > cursor) {
        pieces.push({
          text: m.text.slice(cursor - m.start, ann.start - m.start),
          start: cursor,
          end: ann.start,
          marker: m.kind,
          annIds: [],
          opId: m.opId,
        });
      }
      const s = Math.max(cursor, ann.start);
      const e = Math.min(m.end, ann.end);
      if (e > s) {
        pieces.push({
          text: m.text.slice(s - m.start, e - m.start),
          start: s,
          end: e,
          marker: m.kind,
          annIds: [ann.ann.id],
          opId: m.opId,
        });
      }
      cursor = Math.max(cursor, e);
    }
    if (cursor < m.end) {
      pieces.push({
        text: m.text.slice(cursor - m.start, m.end - m.start),
        start: cursor,
        end: m.end,
        marker: m.kind,
        annIds: [],
        opId: m.opId,
      });
    }
  }
  return pieces;
}

function offsetInSentence(
  container: HTMLElement,
  node: Node,
  offset: number,
): number {
  if (node === container) {
    let sum = 0;
    for (let i = 0; i < offset && i < container.childNodes.length; i++) {
      const child = container.childNodes[i] as HTMLElement | null;
      const s = Number(child?.getAttribute('data-start') ?? 0);
      const e = Number(child?.getAttribute('data-end') ?? s);
      sum += Math.max(0, e - s);
    }
    return sum;
  }
  if (node.nodeType === Node.TEXT_NODE) {
    const el = node.parentElement;
    if (el?.hasAttribute('data-start')) {
      return Number(el.getAttribute('data-start')) + offset;
    }
  }
  if (node instanceof HTMLElement && node.hasAttribute('data-start')) {
    return Number(node.getAttribute('data-start')) + offset;
  }
  return 0;
}

export default function NotesEditor({
  session,
  tags,
  flashId,
  onAddAnnotation,
  onAddEditOp,
  onRemoveEditOp,
  onAddTranscript,
  onDeleteTranscript,
  onRenameTranscript,
  onRenameSession,
}: NotesEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const undoPopRef = useRef<HTMLDivElement>(null);
  const deletePopRef = useRef<HTMLDivElement>(null);
  const renamePopRef = useRef<HTMLDivElement>(null);
  const [toolbar, setToolbar] = useState<ToolbarState | null>(null);
  const [undoPop, setUndoPop] = useState<{
    transcriptId: string;
    opId: string;
    left: number;
    top: number;
  } | null>(null);
  const [modes, setModes] = useState<Record<string, TranscriptMode>>({});
  const [deletePop, setDeletePop] = useState<{
    transcriptId: string;
    left: number;
    top: number;
  } | null>(null);
  const [renamePop, setRenamePop] = useState<{
    transcriptId: string;
    left: number;
    top: number;
  } | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [seconds, setSeconds] = useState(0);

  const speech = useSpeechRecognition((text) => {
    const t = text.trim();
    if (t) onAddTranscript(session.id, t);
  });

  const transcripts = session.transcripts;
  const prevCountRef = useRef(transcripts.length);
  const sentenceLists = useMemo(
    () => transcripts.map((t) => splitSentences(t.original)),
    [transcripts],
  );

  const modeFor = (id: string): TranscriptMode => modes[id] ?? 'edit';

  useEffect(() => {
    if (transcripts.length > prevCountRef.current) {
      const added = transcripts
        .slice(prevCountRef.current)
        .map((t) => t.id);
      setModes((prev) => {
        const next = { ...prev };
        added.forEach((id) => {
          next[id] = 'original';
        });
        return next;
      });
    }
    prevCountRef.current = transcripts.length;
  }, [transcripts]);

  useEffect(() => {
    if (!speech.listening) {
      setSeconds(0);
      return;
    }
    const timer = window.setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => window.clearInterval(timer);
  }, [speech.listening]);

  useEffect(() => {
    if (!toolbar) return;
    const onMouseDown = (e: MouseEvent) => {
      if (toolbarRef.current && !toolbarRef.current.contains(e.target as Node)) {
        setToolbar(null);
      }
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [toolbar]);

  useEffect(() => {
    if (!undoPop) return;
    const onMouseDown = (e: MouseEvent) => {
      if (undoPopRef.current && !undoPopRef.current.contains(e.target as Node)) {
        setUndoPop(null);
      }
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [undoPop]);

  useEffect(() => {
    if (!deletePop) return;
    const onMouseDown = (e: MouseEvent) => {
      if (
        deletePopRef.current &&
        !deletePopRef.current.contains(e.target as Node)
      ) {
        setDeletePop(null);
      }
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [deletePop]);

  useEffect(() => {
    if (!renamePop) return;
    const onMouseDown = (e: MouseEvent) => {
      if (
        renamePopRef.current &&
        !renamePopRef.current.contains(e.target as Node)
      ) {
        setRenamePop(null);
      }
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [renamePop]);

  useEffect(() => {
    if (!flashId || !containerRef.current) return;
    const els = Array.from(
      containerRef.current.querySelectorAll<HTMLElement>(
        `[data-ann-ids~="${flashId}"]`,
      ),
    );
    els.forEach((el) => el.classList.add('flash'));
    els[0]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const timer = window.setTimeout(
      () => els.forEach((el) => el.classList.remove('flash')),
      1600,
    );
    return () => window.clearTimeout(timer);
  }, [flashId, modes]);

  useEffect(() => {
    if (!flashId) return;
    const owner = transcripts.find((t) =>
      t.annotations.some((a) => a.id === flashId),
    );
    if (owner && modeFor(owner.id) === 'final') {
      setModes((prev) => ({ ...prev, [owner.id]: 'original' }));
    }
  }, [flashId, transcripts, modes]);

  const opsFor = (transcript: Transcript, sentenceIndex: number) =>
    transcript.editOps.filter((o) => o.sentenceIndex === sentenceIndex);

  const openToolbar = (
    e: React.MouseEvent,
    transcriptIndex: number,
    sentenceIndex: number,
  ) => {
    const container = e.currentTarget as HTMLElement;
    const sel = window.getSelection();
    const sentence = sentenceLists[transcriptIndex]?.[sentenceIndex];
    if (!sel || !sentence) return;
    if (sel.rangeCount === 0) {
      setToolbar(null);
      return;
    }
    const range = sel.getRangeAt(0);
    if (!container.contains(range.commonAncestorContainer)) {
      setToolbar(null);
      return;
    }
    const startOffset = offsetInSentence(
      container,
      range.startContainer,
      range.startOffset,
    );
    const endOffset = offsetInSentence(
      container,
      range.endContainer,
      range.endOffset,
    );
    const localStart = Math.max(
      0,
      Math.min(startOffset, endOffset, sentence.text.length),
    );
    const localEnd = Math.max(
      localStart,
      Math.min(Math.max(startOffset, endOffset), sentence.text.length),
    );
    const rect = range.getBoundingClientRect();
    const TOOLBAR_WIDTH = 360;
    const left = Math.min(
      Math.max(8, rect.left),
      window.innerWidth - TOOLBAR_WIDTH - 8,
    );
    const top = rect.top - 70 >= 8 ? rect.top - 70 : rect.bottom + 10;
    setToolbar({
      transcriptIndex,
      sentenceIndex,
      start: localStart,
      end: localEnd,
      left,
      top,
      panel: 'actions',
      text: '',
      tag: tags[0]?.id ?? '',
      note: '',
      error: null,
    });
  };

  const closeToolbar = () => {
    setToolbar(null);
    window.getSelection()?.removeAllRanges();
  };

  const toolbarTranscript = toolbar
    ? transcripts[toolbar.transcriptIndex]
    : undefined;
  const toolbarSentence =
    toolbar && toolbarTranscript
      ? sentenceLists[toolbar.transcriptIndex]?.[toolbar.sentenceIndex]
      : undefined;

  const doDelete = () => {
    if (!toolbar || !toolbarTranscript || !toolbarSentence) return;
    if (toolbar.start === toolbar.end) {
      setToolbar((t) =>
        t ? { ...t, error: '请先选中要删除的文字' } : t,
      );
      return;
    }
    const ok = onAddEditOp(session.id, toolbarTranscript.id, {
      kind: 'delete',
      sentenceIndex: toolbar.sentenceIndex,
      start: toolbar.start,
      end: toolbar.end,
      text: '',
    });
    if (ok) closeToolbar();
    else {
      setToolbar((t) =>
        t ? { ...t, error: '该范围与已有编辑重叠，请调整后重试' } : t,
      );
    }
  };

  const doReplace = () => {
    if (!toolbar || !toolbarTranscript) return;
    if (toolbar.start === toolbar.end) {
      setToolbar((t) =>
        t ? { ...t, error: '请先选中要修改的文字' } : t,
      );
      return;
    }
    const t = toolbar.text.trim();
    if (!t) {
      setToolbar((tb) => (tb ? { ...tb, error: '请输入修改后的文字' } : tb));
      return;
    }
    const ok = onAddEditOp(session.id, toolbarTranscript.id, {
      kind: 'replace',
      sentenceIndex: toolbar.sentenceIndex,
      start: toolbar.start,
      end: toolbar.end,
      text: t,
    });
    if (ok) closeToolbar();
    else {
      setToolbar((tb) =>
        tb ? { ...tb, error: '该范围与已有编辑重叠，请调整后重试' } : tb,
      );
    }
  };

  const doInsert = () => {
    if (!toolbar || !toolbarTranscript) return;
    const t = toolbar.text.trim();
    if (!t) {
      setToolbar((tb) => (tb ? { ...tb, error: '请输入要插入的文字' } : tb));
      return;
    }
    const ok = onAddEditOp(session.id, toolbarTranscript.id, {
      kind: 'insert',
      sentenceIndex: toolbar.sentenceIndex,
      start: toolbar.start,
      end: toolbar.start,
      text: t,
    });
    if (ok) closeToolbar();
    else {
      setToolbar((tb) =>
        tb ? { ...tb, error: '该位置与已有编辑重叠，请换个位置' } : tb,
      );
    }
  };

  const saveAnnotation = () => {
    if (!toolbar || !toolbarTranscript || !toolbarSentence) return;
    const selectedTag = tags.some((t) => t.id === toolbar.tag)
      ? toolbar.tag
      : tags[0]?.id;
    if (!selectedTag) {
      setToolbar((tb) => (tb ? { ...tb, error: '请先创建标签' } : tb));
      return;
    }
    onAddAnnotation(toolbarTranscript.id, {
      start: toolbarSentence.start + toolbar.start,
      end: toolbarSentence.start + toolbar.end,
      tag: selectedTag,
      note: toolbar.note.trim(),
    });
    closeToolbar();
  };

  const openDeletePop = (e: React.MouseEvent, transcriptId: string) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const left = Math.min(
      Math.max(8, rect.left),
      window.innerWidth - 300 - 8,
    );
    const top =
      rect.bottom + 8 + 140 > window.innerHeight
        ? Math.max(8, rect.top - 130)
        : rect.bottom + 8;
    setDeletePop({ transcriptId, left, top });
  };

  const openRenamePop = (e: React.MouseEvent, transcript: Transcript) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const left = Math.min(
      Math.max(8, rect.left),
      window.innerWidth - 300 - 8,
    );
    const top =
      rect.bottom + 8 + 140 > window.innerHeight
        ? Math.max(8, rect.top - 130)
        : rect.bottom + 8;
    setRenameValue(transcript.title);
    setRenamePop({ transcriptId: transcript.id, left, top });
  };

  const submitRename = () => {
    if (renamePop) {
      onRenameTranscript(session.id, renamePop.transcriptId, renameValue);
    }
    setRenamePop(null);
  };

  const renderOriginal = (
    transcript: Transcript,
    sentence: Sentence,
    readonly = false,
  ) => {
    const ops = readonly ? [] : opsFor(transcript, sentence.index);
    const pieces = buildPieces(sentence, ops, transcript.annotations);
    return (
      <div
        className="note-original"
        onMouseUp={
          readonly
            ? undefined
            : (e) =>
                openToolbar(
                  e,
                  transcripts.indexOf(transcript),
                  sentence.index,
                )
        }
      >
        {pieces.map((p, i) => {
          const ann = p.annIds.length
            ? transcript.annotations.find((a) => a.id === p.annIds[0])
            : undefined;
          const def = ann
            ? tags.find((t) => t.id === ann.tag) ?? FALLBACK_TAG
            : null;
          const op = p.opId ? ops.find((o) => o.id === p.opId) : undefined;
          let cls = 'note-piece';
          if (p.marker === 'deleted') cls += ' marker-deleted';
          else if (p.marker === 'replaced') cls += ' marker-replaced';
          else if (p.marker === 'inserted') cls += ' marker-inserted';
          if (p.annIds.length) cls += ' hl';

          const style: React.CSSProperties | undefined =
            ann && def ? { background: hexToRgba(def.color, 0.22) } : undefined;

          let title: string | undefined;
          if (op) {
            title =
              p.marker === 'deleted'
                ? '已删除，点击撤销'
                : p.marker === 'replaced'
                  ? `改为：${op.text}`
                  : `插入：${op.text}，点击撤销`;
          } else if (ann && def) {
            title = `【${def.label}】${ann.note ? ` ${ann.note}` : ''}`;
          }

          const spanProps: React.HTMLAttributes<HTMLSpanElement> &
            Record<'data-start' | 'data-end' | 'data-ann-ids', string | undefined> =
            {
              className: cls,
              style,
              title,
              'data-start': String(p.start),
              'data-end': String(p.end),
              'data-ann-ids': p.annIds.length ? p.annIds.join(' ') : undefined,
            };

          if (op && !readonly) {
            spanProps.onMouseUp = (ev) => ev.stopPropagation();
            spanProps.onClick = (ev) => {
              ev.stopPropagation();
              const rect = ev.currentTarget.getBoundingClientRect();
              const left = Math.min(
                Math.max(8, rect.left),
                window.innerWidth - 300 - 8,
              );
              const top =
                rect.bottom + 8 + 140 > window.innerHeight
                  ? Math.max(8, rect.top - 130)
                  : rect.bottom + 8;
              setUndoPop({
                transcriptId: transcript.id,
                opId: op.id,
                left,
                top,
              });
            };
          }

          return (
            <span key={i} {...spanProps}>
              {p.marker === 'inserted' ? '⌃' : p.text}
            </span>
          );
        })}
      </div>
    );
  };

  const renderRevised = (transcript: Transcript, sentence: Sentence) => {
    const ops = opsFor(transcript, sentence.index);
    if (ops.length === 0) return null;
    const segments = buildRevisedSegments(sentence.text, ops);
    return (
      <div className="note-revised">
        {segments.map((s, i) =>
          s.changed ? (
            <span key={i} className="revised-changed">
              {s.text}
            </span>
          ) : (
            <span key={i}>{s.text}</span>
          ),
        )}
      </div>
    );
  };

  const renderFinal = (transcript: Transcript, sentence: Sentence) => {
    const ops = opsFor(transcript, sentence.index);
    const segments = buildRevisedSegments(sentence.text, ops);
    return (
      <div className="note-final">
        {segments.map((s, i) =>
          s.changed ? (
            <span key={i} className="revised-changed">
              {s.text}
            </span>
          ) : (
            <span key={i}>{s.text}</span>
          ),
        )}
      </div>
    );
  };

  const totalWords = transcripts.reduce((n, t) => n + t.original.length, 0);
  const totalAnnotations = transcripts.reduce(
    (n, t) => n + t.annotations.length,
    0,
  );
  const totalEdits = transcripts.reduce((n, t) => n + t.editOps.length, 0);

  return (
    <div className="editor-view">
      <div className="editor-header">
        <div>
          <input
            className="editor-title-input"
            value={session.title}
            onChange={(e) => onRenameSession(session.id, e.target.value)}
            placeholder="未命名练习"
            title="点击修改记录标题"
          />
          <p className="editor-meta">
            {formatDateTime(session.createdAt)} · {transcripts.length} 语稿 ·
            共 {totalWords} 字 · {totalEdits} 处编辑 · {totalAnnotations} 条批注
          </p>
        </div>
      </div>

      <div className="notes-editor" ref={containerRef}>
        {transcripts.length === 0 ? (
          <div className="notes-empty">还没有语稿</div>
        ) : (
          transcripts.map((transcript, ti) => {
            const mode = modeFor(transcript.id);
            return (
              <section key={transcript.id} className="panel transcript-panel">
                <div className="transcript-head">
                  <div className="transcript-head-left">
                    <span className="transcript-label">
                      {transcript.title || `语稿 ${ti + 1}`}
                    </span>
                    <button
                      type="button"
                      className="transcript-rename"
                      title="重命名语稿"
                      onClick={(e) => openRenamePop(e, transcript)}
                    >
                      ✎
                    </button>
                    <span className="transcript-meta">
                      {formatDateTime(transcript.createdAt)} ·{' '}
                      {transcript.original.length} 字 ·{' '}
                      {transcript.annotations.length} 条批注 ·{' '}
                      {transcript.editOps.length} 处编辑
                    </span>
                  </div>
                  <div className="transcript-tools">
                    <div className="mode-switch">
                      {(
                        [
                          ['original', '原稿'],
                          ['edit', '编辑'],
                          ['final', '终稿'],
                        ] as const
                      ).map(([m, label]) => (
                        <button
                          key={m}
                          type="button"
                          className={`mode-btn ${
                            mode === m ? 'active' : ''
                          }`}
                          onClick={() =>
                            setModes((prev) => ({
                              ...prev,
                              [transcript.id]: m,
                            }))
                          }
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    <button
                      type="button"
                      className="transcript-delete"
                      title="删除语稿"
                      onClick={(e) => openDeletePop(e, transcript.id)}
                    >
                      ✕
                    </button>
                  </div>
                </div>
                <div className="note-paragraph">
                  {(sentenceLists[ti] ?? []).map((sentence) => {
                    const hasEdit =
                      opsFor(transcript, sentence.index).length > 0;
                    return (
                      <div
                        key={sentence.index}
                        className={`note-sentence ${
                          mode !== 'edit' ? 'readonly' : ''
                        } ${hasEdit ? 'has-edit' : ''}`}
                      >
                        {mode === 'edit' &&
                          renderOriginal(transcript, sentence)}
                        {mode === 'edit' &&
                          renderRevised(transcript, sentence)}
                        {mode === 'original' &&
                          renderOriginal(transcript, sentence, true)}
                        {mode === 'final' && renderFinal(transcript, sentence)}
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          })
        )}
      </div>

      <section className="panel record-panel">
        <div className="panel-head">
          <span className="panel-title">新增语稿</span>
          <span className="panel-tip">
            在下方录音，新的语稿会自动追加到本记录
          </span>
        </div>
        <div className="record-row">
          <button
            type="button"
            className={`mic-btn small ${speech.listening ? 'recording' : ''}`}
            onClick={speech.listening ? speech.stop : speech.start}
            disabled={!speech.supported}
          >
            {speech.listening ? <span className="mic-stop">■</span> : '🎤'}
          </button>
          <div className="record-info">
            <span className={`status-dot ${speech.listening ? 'on' : ''}`} />
            <span>
              {speech.listening
                ? `正在聆听… ${formatDuration(seconds)}`
                : speech.supported
                  ? '点击开始录音'
                  : '当前浏览器不支持语音识别，请使用 Chrome 或 Edge'}
            </span>
          </div>
        </div>
        {speech.error && <div className="record-error">{speech.error}</div>}
        <div className="record-live-box">
          {speech.finalText && <div className="live-final">{speech.finalText}</div>}
          {speech.interim && <div className="live-interim">{speech.interim}</div>}
          {!speech.finalText && !speech.interim && (
            <div className="record-placeholder">
              录音内容会实时显示在这里，结束后自动生成新语稿
            </div>
          )}
        </div>
      </section>

      {toolbar && toolbarTranscript && toolbarSentence && (
        <div
          className="ann-toolbar"
          ref={toolbarRef}
          style={{ left: toolbar.left, top: toolbar.top }}
        >
          <div className="toolbar-snippet">
            {toolbar.start === toolbar.end
              ? `插入位置：…${toolbarSentence.text.slice(
                  Math.max(0, toolbar.start - 8),
                  toolbar.start,
                )}▌${toolbarSentence.text.slice(
                  toolbar.start,
                  toolbar.start + 8,
                )}`
              : `“${toolbarSentence.text.slice(
                  toolbar.start,
                  toolbar.end,
                )}”`}
          </div>

          {toolbar.panel === 'actions' && (
            <div className="toolbar-actions-row">
              {toolbar.start === toolbar.end ? (
                <button
                  type="button"
                  className="btn-save"
                  onClick={() =>
                    setToolbar({ ...toolbar, panel: 'insert', error: null })
                  }
                >
                  ＋ 增加
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    className="btn-annotate"
                    onClick={() =>
                      setToolbar({ ...toolbar, panel: 'annotate', error: null })
                    }
                  >
                    批注
                  </button>
                  <button
                    type="button"
                    className="btn-danger"
                    onClick={doDelete}
                  >
                    删除
                  </button>
                  <button
                    type="button"
                    className="btn-save"
                    onClick={() =>
                      setToolbar({ ...toolbar, panel: 'replace', error: null })
                    }
                  >
                    修改
                  </button>
                </>
              )}
              <button
                type="button"
                className="btn-cancel"
                onClick={closeToolbar}
              >
                取消
              </button>
            </div>
          )}

          {toolbar.panel === 'annotate' && (
            <>
              <div className="toolbar-tags">
                {tags.length === 0 ? (
                  <div className="toolbar-tags-empty">请先在左侧新增标签</div>
                ) : (
                  tags.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      className={
                        toolbar.tag === t.id ? 'tag-btn active' : 'tag-btn'
                      }
                      onClick={() =>
                        setToolbar({ ...toolbar, tag: t.id, error: null })
                      }
                    >
                      <span className="dot" style={{ background: t.color }} />
                      {t.label}
                    </button>
                  ))
                )}
              </div>
              <input
                className="toolbar-note"
                value={toolbar.note}
                onChange={(e) =>
                  setToolbar({ ...toolbar, note: e.target.value })
                }
                placeholder="补充备注（可选）"
              />
              <div className="toolbar-actions">
                <button
                  type="button"
                  className="btn-cancel"
                  onClick={() =>
                    setToolbar({ ...toolbar, panel: 'actions' })
                  }
                >
                  返回
                </button>
                <button
                  type="button"
                  className="btn-save"
                  onClick={saveAnnotation}
                  disabled={tags.length === 0}
                >
                  保存批注
                </button>
              </div>
            </>
          )}

          {toolbar.panel === 'replace' && (
            <>
              <input
                className="toolbar-note"
                value={toolbar.text}
                onChange={(e) =>
                  setToolbar({ ...toolbar, text: e.target.value, error: null })
                }
                placeholder="改为…"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter') doReplace();
                }}
              />
              <div className="toolbar-actions">
                <button
                  type="button"
                  className="btn-cancel"
                  onClick={() =>
                    setToolbar({ ...toolbar, panel: 'actions' })
                  }
                >
                  返回
                </button>
                <button type="button" className="btn-save" onClick={doReplace}>
                  确定
                </button>
              </div>
            </>
          )}

          {toolbar.panel === 'insert' && (
            <>
              <input
                className="toolbar-note"
                value={toolbar.text}
                onChange={(e) =>
                  setToolbar({ ...toolbar, text: e.target.value, error: null })
                }
                placeholder="插入文字…"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter') doInsert();
                }}
              />
              <div className="toolbar-actions">
                <button
                  type="button"
                  className="btn-cancel"
                  onClick={() =>
                    setToolbar({ ...toolbar, panel: 'actions' })
                  }
                >
                  返回
                </button>
                <button type="button" className="btn-save" onClick={doInsert}>
                  确定
                </button>
              </div>
            </>
          )}

          {toolbar.error && (
            <div className="toolbar-error">{toolbar.error}</div>
          )}
        </div>
      )}

      {undoPop && (
        <div
          className="mini-popover"
          ref={undoPopRef}
          style={{ left: undoPop.left, top: undoPop.top }}
        >
          <div className="mini-popover-title">撤销这处编辑？</div>
          <div className="toolbar-actions">
            <button
              type="button"
              className="btn-cancel"
              onClick={() => setUndoPop(null)}
            >
              取消
            </button>
            <button
              type="button"
              className="btn-danger"
              onClick={() => {
                onRemoveEditOp(session.id, undoPop.transcriptId, undoPop.opId);
                setUndoPop(null);
              }}
            >
              撤销
            </button>
          </div>
        </div>
      )}

      {deletePop && (
        <div
          className="mini-popover"
          ref={deletePopRef}
          style={{ left: deletePop.left, top: deletePop.top }}
        >
          <div className="mini-popover-title">
            {transcripts.length <= 1
              ? '这是最后一条语稿，无法删除。如需删除，请在左侧历史记录中删除整条记录。'
              : '删除这条语稿？删除后无法恢复。'}
          </div>
          <div className="toolbar-actions">
            {transcripts.length <= 1 ? (
              <button
                type="button"
                className="btn-save"
                onClick={() => setDeletePop(null)}
              >
                知道了
              </button>
            ) : (
              <>
                <button
                  type="button"
                  className="btn-cancel"
                  onClick={() => setDeletePop(null)}
                >
                  取消
                </button>
                <button
                  type="button"
                  className="btn-danger"
                  onClick={() => {
                    onDeleteTranscript(session.id, deletePop.transcriptId);
                    setToolbar(null);
                    setUndoPop(null);
                    setDeletePop(null);
                  }}
                >
                  删除
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {renamePop && (
        <div
          className="mini-popover"
          ref={renamePopRef}
          style={{ left: renamePop.left, top: renamePop.top }}
        >
          <div className="mini-popover-title">重命名语稿</div>
          <input
            className="toolbar-note"
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            placeholder="输入语稿名称"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter') submitRename();
            }}
          />
          <div className="toolbar-actions">
            <button
              type="button"
              className="btn-cancel"
              onClick={() => setRenamePop(null)}
            >
              取消
            </button>
            <button type="button" className="btn-save" onClick={submitRename}>
              保存
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
