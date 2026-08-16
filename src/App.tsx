import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  Annotation,
  EditOp,
  Group,
  Session,
  TagDef,
  Transcript,
} from './types';
import { GROUP_COLORS } from './types';
import {
  loadGroups,
  loadSessions,
  loadTags,
  saveGroups,
  saveSessions,
  saveTags,
} from './storage';
import { useSpeechRecognition } from './hooks/useSpeechRecognition';
import { opsConflict, splitSentences, uid } from './utils';
import Sidebar from './components/Sidebar';
import LiveView from './components/LiveView';
import NotesEditor from './components/NotesEditor';

export default function App() {
  const [sessions, setSessions] = useState<Session[]>(loadSessions);
  const [groups, setGroups] = useState<Group[]>(loadGroups);
  const [tags, setTags] = useState<TagDef[]>(loadTags);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [view, setView] = useState<'live' | 'editor'>('live');
  const [filter, setFilter] = useState<string | 'all'>('all');
  const [flashId, setFlashId] = useState<string | null>(null);
  const pendingGroupRef = useRef<string | null>(null);

  useEffect(() => {
    saveSessions(sessions);
  }, [sessions]);

  useEffect(() => {
    saveGroups(groups);
  }, [groups]);

  useEffect(() => {
    saveTags(tags);
  }, [tags]);

  const handleEnd = useCallback((final: string) => {
    const text = final.trim();
    if (!text) return;
    const groupId = pendingGroupRef.current;
    pendingGroupRef.current = null;
    const transcript: Transcript = {
      id: uid(),
      createdAt: Date.now(),
      title: '',
      original: text,
      annotations: [],
      editOps: [],
    };
    const session: Session = {
      id: uid(),
      title: text.length > 16 ? `${text.slice(0, 16)}…` : text,
      createdAt: Date.now(),
      groupId,
      transcripts: [transcript],
    };
    setSessions((prev) => [session, ...prev].slice(0, 50));
    setActiveId(session.id);
    setView('editor');
    setFilter('all');
    setFlashId(null);
  }, []);

  const speech = useSpeechRecognition(handleEnd);

  const activeSession = sessions.find((s) => s.id === activeId) ?? null;

  const addAnnotation = (
    transcriptId: string,
    a: Omit<Annotation, 'id' | 'createdAt'>,
  ) => {
    if (!activeSession) return;
    const annotation: Annotation = { ...a, id: uid(), createdAt: Date.now() };
    setSessions((prev) =>
      prev.map((s) =>
        s.id === activeSession.id
          ? {
              ...s,
              transcripts: s.transcripts.map((t) =>
                t.id === transcriptId
                  ? { ...t, annotations: [...t.annotations, annotation] }
                  : t,
              ),
            }
          : s,
      ),
    );
  };

  const deleteAnnotation = (transcriptId: string, id: string) => {
    if (!activeSession) return;
    setSessions((prev) =>
      prev.map((s) =>
        s.id === activeSession.id
          ? {
              ...s,
              transcripts: s.transcripts.map((t) =>
                t.id === transcriptId
                  ? {
                      ...t,
                      annotations: t.annotations.filter((x) => x.id !== id),
                    }
                  : t,
              ),
            }
          : s,
      ),
    );
  };

  const deleteSession = (id: string) => {
    setSessions((prev) => prev.filter((s) => s.id !== id));
    if (activeId === id) {
      setActiveId(null);
      setView('live');
    }
  };

  const addGroup = (name: string) => {
    const n = name.trim();
    if (!n) return;
    setGroups((prev) =>
      prev.some((g) => g.name === n)
        ? prev
        : [
            ...prev,
            {
              id: uid(),
              name: n,
              color: GROUP_COLORS[prev.length % GROUP_COLORS.length],
            },
          ],
    );
  };

  const renameGroup = (id: string, name: string) => {
    const n = name.trim();
    if (!n) return;
    setGroups((prev) => prev.map((g) => (g.id === id ? { ...g, name: n } : g)));
  };

  const deleteGroup = (id: string) => {
    setGroups((prev) => prev.filter((g) => g.id !== id));
    setSessions((prev) =>
      prev.map((s) => (s.groupId === id ? { ...s, groupId: null } : s)),
    );
  };

  const assignGroup = (sessionId: string, groupId: string | null) => {
    setSessions((prev) =>
      prev.map((s) => (s.id === sessionId ? { ...s, groupId } : s)),
    );
  };

  const moveSession = (
    dragId: string,
    targetId: string,
    before: boolean,
  ) => {
    setSessions((prev) => {
      const from = prev.findIndex((s) => s.id === dragId);
      const to = prev.findIndex((s) => s.id === targetId);
      if (from < 0 || to < 0 || from === to) return prev;
      if ((prev[from].groupId ?? null) !== (prev[to].groupId ?? null)) {
        return prev;
      }
      const next = [...prev];
      const [item] = next.splice(from, 1);
      let index = next.findIndex((s) => s.id === targetId);
      if (!before) index += 1;
      next.splice(index, 0, item);
      return next;
    });
  };

  const moveGroup = (dragId: string, targetId: string, before: boolean) => {
    setGroups((prev) => {
      const from = prev.findIndex((g) => g.id === dragId);
      const to = prev.findIndex((g) => g.id === targetId);
      if (from < 0 || to < 0 || from === to) return prev;
      const next = [...prev];
      const [item] = next.splice(from, 1);
      let index = next.findIndex((g) => g.id === targetId);
      if (!before) index += 1;
      next.splice(index, 0, item);
      return next;
    });
  };

  const moveTag = (dragId: string, targetId: string, before: boolean) => {
    setTags((prev) => {
      const from = prev.findIndex((t) => t.id === dragId);
      const to = prev.findIndex((t) => t.id === targetId);
      if (from < 0 || to < 0 || from === to) return prev;
      const next = [...prev];
      const [item] = next.splice(from, 1);
      let index = next.findIndex((t) => t.id === targetId);
      if (!before) index += 1;
      next.splice(index, 0, item);
      return next;
    });
  };

  const addEditOp = (
    sessionId: string,
    transcriptId: string,
    op: Omit<EditOp, 'id'>,
  ): boolean => {
    const session = sessions.find((s) => s.id === sessionId);
    const transcript = session?.transcripts.find((t) => t.id === transcriptId);
    if (!session || !transcript) return false;
    const sentence = splitSentences(transcript.original)[op.sentenceIndex];
    if (!sentence) return false;
    const start = Math.max(0, Math.min(op.start, sentence.text.length));
    const end = Math.max(start, Math.min(op.end, sentence.text.length));
    if (op.kind !== 'insert' && end <= start) return false;
    const existing = transcript.editOps.filter(
      (e) => e.sentenceIndex === op.sentenceIndex,
    );
    if (opsConflict(existing, op.kind, start, end)) return false;
    const full: EditOp = { ...op, id: uid(), start, end };
    setSessions((prev) =>
      prev.map((s) =>
        s.id === sessionId
          ? {
              ...s,
              transcripts: s.transcripts.map((t) =>
                t.id === transcriptId
                  ? { ...t, editOps: [...t.editOps, full] }
                  : t,
              ),
            }
          : s,
      ),
    );
    return true;
  };

  const removeEditOp = (
    sessionId: string,
    transcriptId: string,
    opId: string,
  ) => {
    setSessions((prev) =>
      prev.map((s) =>
        s.id === sessionId
          ? {
              ...s,
              transcripts: s.transcripts.map((t) =>
                t.id === transcriptId
                  ? { ...t, editOps: t.editOps.filter((o) => o.id !== opId) }
                  : t,
              ),
            }
          : s,
      ),
    );
  };

  const addTranscript = (sessionId: string, text: string) => {
    const t = text.trim();
    if (!t) return;
    const transcript: Transcript = {
      id: uid(),
      createdAt: Date.now(),
      title: '',
      original: t,
      annotations: [],
      editOps: [],
    };
    setSessions((prev) =>
      prev.map((s) =>
        s.id === sessionId
          ? { ...s, transcripts: [...s.transcripts, transcript] }
          : s,
      ),
    );
  };

  const deleteTranscript = (sessionId: string, transcriptId: string) => {
    setSessions((prev) =>
      prev.map((s) => {
        if (s.id !== sessionId) return s;
        if (s.transcripts.length <= 1) return s;
        return {
          ...s,
          transcripts: s.transcripts.filter((t) => t.id !== transcriptId),
        };
      }),
    );
  };

  const renameTranscript = (
    sessionId: string,
    transcriptId: string,
    title: string,
  ) => {
    const t = title.trim();
    setSessions((prev) =>
      prev.map((s) =>
        s.id === sessionId
          ? {
              ...s,
              transcripts: s.transcripts.map((tr) =>
                tr.id === transcriptId ? { ...tr, title: t } : tr,
              ),
            }
          : s,
      ),
    );
  };

  const renameSession = (sessionId: string, title: string) => {
    setSessions((prev) =>
      prev.map((s) => (s.id === sessionId ? { ...s, title } : s)),
    );
  };

  const addTag = (label: string, color: string) => {
    const l = label.trim();
    if (!l) return;
    setTags((prev) => [...prev, { id: uid(), label: l, color }]);
  };

  const updateTag = (id: string, label: string, color: string) => {
    const l = label.trim();
    if (!l) return;
    setTags((prev) =>
      prev.map((t) => (t.id === id ? { ...t, label: l, color } : t)),
    );
  };

  const deleteTag = (id: string) => {
    setTags((prev) => prev.filter((t) => t.id !== id));
  };

  const startPractice = useCallback((groupId: string | null) => {
    pendingGroupRef.current = groupId;
    setActiveId(null);
    setView('live');
    setFilter('all');
    setFlashId(null);
  }, []);

  return (
    <div className="app">
      <Sidebar
        view={view}
        sessions={sessions}
        groups={groups}
        tags={tags}
        activeId={activeId}
        transcripts={activeSession?.transcripts ?? []}
        filter={filter}
        onFilterChange={setFilter}
        onSelectSession={(id) => {
          setActiveId(id);
          setView('editor');
          setFlashId(null);
        }}
        onDeleteSession={deleteSession}
        onRenameSession={renameSession}
        onNewPractice={startPractice}
        onJump={setFlashId}
        onDeleteAnnotation={deleteAnnotation}
        onAddGroup={addGroup}
        onRenameGroup={renameGroup}
        onDeleteGroup={deleteGroup}
        onAssignGroup={assignGroup}
        onMoveSession={moveSession}
        onMoveGroup={moveGroup}
        onMoveTag={moveTag}
        onAddTag={addTag}
        onUpdateTag={updateTag}
        onDeleteTag={deleteTag}
      />

      <main className="main">
        {view === 'live' ? (
          <LiveView {...speech} />
        ) : activeSession ? (
          <NotesEditor
            key={activeSession.id}
            session={activeSession}
            tags={tags}
            flashId={flashId}
            onAddAnnotation={addAnnotation}
            onAddEditOp={addEditOp}
            onRemoveEditOp={removeEditOp}
            onAddTranscript={addTranscript}
            onDeleteTranscript={deleteTranscript}
            onRenameTranscript={renameTranscript}
            onRenameSession={renameSession}
          />
        ) : (
          <div className="empty-state">
            <div className="empty-icon">🎙️</div>
            <h2>还没有练习记录</h2>
            <p>点击左侧「新建练习」，开始你的第一次表达练习</p>
          </div>
        )}
      </main>
    </div>
  );
}
