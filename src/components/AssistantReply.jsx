import {useEffect, useLayoutEffect, useState} from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {Check, Info} from 'lucide-react';
import './assistant-reply.css';

const markdownPlugins = [remarkGfm];
const markdownComponents = {
  table: ({node, ...props}) => <div className="reply-table-scroll"><table {...props}/></div>,
};

/** 只推进新回复的显示，message.text 始终保留供保存和后续对话使用的完整正文。 */
export default function AssistantReply({message, presentation, onProgress}) {
  const [animate] = useState(() => Boolean(
    presentation && !presentation.started &&
    !window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  ));
  const [visibleText, setVisibleText] = useState(() => animate ? '' : message.text);
  const [complete, setComplete] = useState(!animate);

  useEffect(() => {
    // 此标记只保存在 WeakMap 中；返回页面或恢复历史时不重播。
    // animate 由挂载时的 state 固定，StrictMode 重放 effect 仍能正确启动并清理。
    if (presentation) presentation.started = true;
    if (!animate) return;
    const characters = Array.from(message.text);
    const duration = Math.min(9000, Math.max(320, characters.length * 12));
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    let frame, startedAt, lastPaint = -Infinity, cancelled = false;
    const finish = () => {
      cancelAnimationFrame(frame);
      setVisibleText(message.text);
      setComplete(true);
    };
    const tick = now => {
      if (cancelled) return;
      startedAt ??= now;
      const count = Math.min(characters.length, Math.max(1, Math.floor(characters.length * (now - startedAt) / duration)));
      // 限制 Markdown 重解析频率，长回复也不需要每帧重排。
      if (now - lastPaint >= 40 || count === characters.length) {
        setVisibleText(characters.slice(0, count).join(''));
        lastPaint = now;
      }
      if (count === characters.length) setComplete(true);
      else frame = requestAnimationFrame(tick);
    };
    const onPreferenceChange = event => { if (event.matches) finish(); };
    media.addEventListener('change', onPreferenceChange);
    frame = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      media.removeEventListener('change', onPreferenceChange);
    };
  }, [animate, message.text, presentation]);

  useLayoutEffect(() => { if (animate) onProgress(); }, [animate, visibleText, complete, onProgress]);

  return (
    <div className={`assistant-reply${complete ? '' : ' reply-revealing'}`} aria-busy={!complete}>
      <div className="message-markdown"><Markdown skipHtml remarkPlugins={markdownPlugins} components={markdownComponents}>{visibleText}</Markdown></div>
      {complete && message.trace?.length > 0 && (
        <details className="tool-trace">
          <summary>查看执行过程（{message.trace.length} 步）</summary>
          <ol>{message.trace.map((step, index) => (
            <li key={index} className={step.status}>
              <span>{step.status === 'success' ? <Check size={13}/> : <Info size={13}/>} {step.label}</span>
              <small>{step.summary}</small>
            </li>
          ))}</ol>
        </details>
      )}
    </div>
  );
}
