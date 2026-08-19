import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

interface WebSpeechAlternative {
  transcript: string;
  confidence: number;
}

interface WebSpeechResult {
  isFinal: boolean;
  length: number;
  [index: number]: WebSpeechAlternative;
}

interface WebSpeechResultList {
  length: number;
  [index: number]: WebSpeechResult;
}

interface WebSpeechErrorEvent {
  error: string;
  message: string;
}

interface WebSpeechRecognizer {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onstart: (() => void) | null;
  onresult:
    | ((event: { resultIndex: number; results: WebSpeechResultList }) => void)
    | null;
  onerror: ((event: WebSpeechErrorEvent) => void) | null;
  onend: (() => void) | null;
}

type SpeechRecognizerCtor = new () => WebSpeechRecognizer;

function getRecognizerCtor(): SpeechRecognizerCtor | null {
  const w = window as unknown as Record<string, unknown>;
  const ctor = (w.SpeechRecognition ?? w.webkitSpeechRecognition) as
    | SpeechRecognizerCtor
    | undefined;
  return ctor ?? null;
}

export interface SpeechState {
  supported: boolean;
  listening: boolean;
  interim: string;
  finalText: string;
  error: string | null;
  start: () => void;
  stop: () => void;
}

const MAX_AUTO_RESTARTS = 3;
const RESTART_DELAY = 300;

export function useSpeechRecognition(
  onEnd: (finalText: string) => void,
): SpeechState {
  const supported = useMemo(() => getRecognizerCtor() !== null, []);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState('');
  const [finalText, setFinalText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const recRef = useRef<WebSpeechRecognizer | null>(null);
  const finalRef = useRef('');
  const onEndRef = useRef(onEnd);
  const startedRef = useRef(false);
  const stopRequestedRef = useRef(false);
  const manualStopRef = useRef(false);
  const autoRestartCountRef = useRef(0);
  const restartTimerRef = useRef<number | null>(null);
  onEndRef.current = onEnd;

  const clearRestartTimer = () => {
    if (restartTimerRef.current !== null) {
      window.clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }
  };

  // 创建并启动一次识别会话；不重置已积累的文字
  const beginRecognition = useCallback(() => {
    const Ctor = getRecognizerCtor();
    if (!Ctor) return;

    startedRef.current = false;
    stopRequestedRef.current = false;
    setInterim('');
    setError(null);

    const rec = new Ctor();
    rec.lang = 'zh-CN';
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    rec.onstart = () => {
      startedRef.current = true;
      // 用户在识别真正启动前点了停止（如权限确认中），启动后立即结束
      if (stopRequestedRef.current) {
        try {
          rec.stop();
        } catch {
          try {
            rec.abort();
          } catch {
            // 忽略异常
          }
        }
      }
    };

    rec.onresult = (event) => {
      let interimBuf = '';
      let finalBuf = finalRef.current;
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (!result[0]) continue;
        if (result.isFinal) {
          finalBuf += result[0].transcript;
        } else {
          interimBuf += result[0].transcript;
        }
      }
      finalRef.current = finalBuf;
      setFinalText(finalBuf);
      setInterim(interimBuf);
    };

    rec.onerror = (event) => {
      if (event.error === 'aborted') {
        // 主动中止时的正常事件，不提示错误
      } else if (event.error === 'not-allowed') {
        // 权限被拒：不再自动续录
        manualStopRef.current = true;
        setError('未获得麦克风权限，请在浏览器地址栏左侧允许访问麦克风。');
      } else if (event.error === 'no-speech') {
        // 静默处理，等待自动续录
      } else if (event.error === 'network') {
        setError('网络连接不稳定，正在尝试恢复录音…');
      } else {
        setError(`语音识别出错：${event.error}`);
      }
    };

    rec.onend = () => {
      if (recRef.current === rec) recRef.current = null;
      startedRef.current = false;
      stopRequestedRef.current = false;
      setInterim('');

      // 只有用户手动停止才结束录音
      if (manualStopRef.current) {
        setListening(false);
        onEndRef.current(finalRef.current);
        return;
      }

      // 浏览器语音服务自动结束时，自动续录，保持录音不中断
      if (autoRestartCountRef.current >= MAX_AUTO_RESTARTS) {
        autoRestartCountRef.current = 0;
        setListening(false);
        setError('语音识别服务中断，录音已停止，请手动重新开始。');
        onEndRef.current(finalRef.current);
        return;
      }
      autoRestartCountRef.current += 1;
      restartTimerRef.current = window.setTimeout(() => {
        restartTimerRef.current = null;
        if (!manualStopRef.current) {
          beginRecognition();
        }
      }, RESTART_DELAY);
    };

    try {
      rec.start();
      recRef.current = rec;
      setListening(true);
    } catch {
      setListening(false);
      setError('无法启动语音识别，请检查麦克风权限后重试。');
    }
  }, []);

  const start = useCallback(() => {
    clearRestartTimer();
    finalRef.current = '';
    manualStopRef.current = false;
    autoRestartCountRef.current = 0;
    setFinalText('');
    setInterim('');
    setError(null);
    beginRecognition();
  }, [beginRecognition]);

  const stop = useCallback(() => {
    clearRestartTimer();
    const rec = recRef.current;
    manualStopRef.current = true;
    if (!rec) {
      // 没有活动会话（例如还在等待权限），直接结束
      setListening(false);
      onEndRef.current(finalRef.current);
      return;
    }
    stopRequestedRef.current = true;
    // 识别尚未真正开始（例如正在等待麦克风权限），等 onstart 触发后再停止
    if (!startedRef.current) return;
    try {
      rec.stop();
    } catch {
      try {
        rec.abort();
      } catch {
        // 忽略异常
      }
    }
    // 兜底：部分浏览器在 continuous 模式下 stop() 不生效，强制中止
    window.setTimeout(() => {
      if (recRef.current === rec && startedRef.current) {
        try {
          rec.abort();
        } catch {
          // 忽略异常
        }
      }
    }, 2500);
  }, []);

  useEffect(
    () => () => {
      clearRestartTimer();
      recRef.current?.abort();
    },
    [],
  );

  return { supported, listening, interim, finalText, error, start, stop };
}
