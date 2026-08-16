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
  onEndRef.current = onEnd;

  const start = useCallback(() => {
    const Ctor = getRecognizerCtor();
    if (!Ctor) return;

    finalRef.current = '';
    startedRef.current = false;
    stopRequestedRef.current = false;
    setFinalText('');
    setInterim('');
    setError(null);

    const rec = new Ctor();
    rec.lang = 'zh-CN';
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    rec.onstart = () => {
      startedRef.current = true;
      // 用户可能在识别真正启动前就点了停止（如权限确认中），
      // 启动后立即结束
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
        setError('未获得麦克风权限，请在浏览器地址栏左侧允许访问麦克风。');
      } else if (event.error === 'no-speech') {
        setError('没有检测到声音，请靠近麦克风再试一次。');
      } else if (event.error === 'network') {
        setError('网络连接失败，语音识别需要联网。');
      } else {
        setError(`语音识别出错：${event.error}`);
      }
    };

    rec.onend = () => {
      if (recRef.current === rec) recRef.current = null;
      startedRef.current = false;
      stopRequestedRef.current = false;
      setListening(false);
      setInterim('');
      onEndRef.current(finalRef.current);
    };

    try {
      rec.start();
      recRef.current = rec;
      setListening(true);
    } catch {
      setError('无法启动语音识别，请检查麦克风权限后重试。');
    }
  }, []);

  const stop = useCallback(() => {
    const rec = recRef.current;
    if (!rec) return;
    stopRequestedRef.current = true;
    // 识别尚未真正开始（例如正在等待麦克风权限），
    // 等 onstart 触发后再自动停止
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
    // 兜底：部分浏览器在 continuous 模式下 stop() 不生效，
    // 若一段时间内未结束则强制中止
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
      recRef.current?.abort();
    },
    [],
  );

  return { supported, listening, interim, finalText, error, start, stop };
}
