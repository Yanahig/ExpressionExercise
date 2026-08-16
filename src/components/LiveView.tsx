import { useEffect, useState } from 'react';
import type { SpeechState } from '../hooks/useSpeechRecognition';
import { formatDuration } from '../utils';

export default function LiveView({
  supported,
  listening,
  interim,
  finalText,
  error,
  start,
  stop,
}: SpeechState) {
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    if (!listening) {
      setSeconds(0);
      return;
    }
    const timer = window.setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => window.clearInterval(timer);
  }, [listening]);

  return (
    <div className="live-view">
      <div className="live-card">
        <div className="live-top">
          <span className={`status-dot ${listening ? 'on' : ''}`} />
          <span className="live-status-text">
            {listening ? '正在聆听…' : '准备就绪'}
          </span>
          {listening && <span className="live-timer">{formatDuration(seconds)}</span>}
        </div>

        <button
          type="button"
          className={`mic-btn ${listening ? 'recording' : ''}`}
          onClick={listening ? stop : start}
          disabled={!supported}
        >
          {listening ? <span className="mic-stop">■</span> : '🎤'}
        </button>

        <p className="live-hint">
          {supported
            ? listening
              ? '点击按钮结束录音，转录结果会自动保存为一次练习'
              : '点击麦克风开始说话，语音会实时转成文字'
            : '当前浏览器不支持语音识别，请使用 Chrome 或 Edge 打开本页面'}
        </p>

        {error && <div className="live-error">{error}</div>}

        <div className="live-transcript-box">
          {finalText && <div className="live-final">{finalText}</div>}
          {interim && <div className="live-interim">{interim}</div>}
          {!finalText && !interim && (
            <div className="live-placeholder">说点什么吧，你的话会实时显示在这里…</div>
          )}
        </div>
      </div>
    </div>
  );
}
