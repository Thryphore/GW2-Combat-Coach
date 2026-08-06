import { useEffect, useRef, useState, type FormEvent } from 'react';
import { answerBasicLogQuestion } from '../../ai/answerBasicQuestion.ts';
import type { AiContextPacket } from '../../ai/buildAiContext.ts';
import { isWebGpuAvailable, streamAiReply, type ChatMessage } from '../../ai/webllm.ts';
import { useSettings } from '../settings/SettingsContext.tsx';

interface UiMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

interface Props {
  /** Structured analysis packet for deterministic answers. */
  context: AiContextPacket;
  /** Plain-text log briefing for the model. */
  contextText: string;
  /** Changes when a new analysis bundle is shown — clears the chat. */
  conversationKey: string;
}

let messageSeq = 0;
function nextId(): string {
  messageSeq += 1;
  return `m-${messageSeq}`;
}

export function AiChatPanel({ context, contextText, conversationKey }: Props) {
  const { settings } = useSettings();
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [loadProgress, setLoadProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setMessages([]);
    setDraft('');
    setBusy(false);
    setLoadProgress(null);
    setError(null);
  }, [conversationKey]);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, loadProgress]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const text = draft.trim();
    if (!text || busy) return;

    const history: ChatMessage[] = messages.map((message) => ({
      role: message.role,
      content: message.content,
    }));

    const userMessage: UiMessage = { id: nextId(), role: 'user', content: text };
    const assistantId = nextId();
    setDraft('');
    setError(null);

    const basic = answerBasicLogQuestion(text, context, history);
    if (basic) {
      setMessages((prev) => [...prev, userMessage, { id: assistantId, role: 'assistant', content: basic }]);
      return;
    }

    if (!isWebGpuAvailable()) {
      setError('Local AI needs WebGPU. Use the latest Chrome or Edge, then try again.');
      return;
    }

    setBusy(true);
    setLoadProgress('Starting…');
    setMessages((prev) => [...prev, userMessage, { id: assistantId, role: 'assistant', content: '' }]);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      await streamAiReply({
        choice: settings.aiModel,
        contextText,
        history,
        userMessage: text,
        signal: controller.signal,
        onProgress: (progress) => {
          const pct = Number.isFinite(progress.progress)
            ? ` ${Math.round(progress.progress * 100)}%`
            : '';
          setLoadProgress(
            progress.progress >= 1
              ? 'Loading…'
              : `${progress.text || 'Downloading…'}${pct}`,
          );
        },
        onDelta: (full) => {
          setLoadProgress(null);
          setMessages((prev) =>
            prev.map((message) =>
              message.id === assistantId ? { ...message, content: full } : message,
            ),
          );
        },
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      const message = err instanceof Error ? err.message : 'Local AI failed.';
      setError(message);
      setMessages((prev) =>
        prev.filter((entry) => entry.id !== assistantId || entry.content.trim().length > 0),
      );
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setBusy(false);
      setLoadProgress(null);
    }
  }

  return (
    <section className="rounded-2xl border border-ink-700 bg-ink-850/70 p-4 sm:p-5">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-semibold tracking-wide text-ink-400 uppercase">
            Ask about this log
          </h2>
          <span className="rounded border border-warn-500/50 bg-warn-500/10 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-warn-500 uppercase">
            Beta
          </span>
        </div>
        <p className="mt-1 text-xs leading-relaxed text-ink-400">
          Experimental AI insights. Answers can be wrong or made up — double-check against the
          findings below. Best for simple questions like DPS or top priorities.
        </p>
      </div>

      <div
        ref={listRef}
        className="mt-4 max-h-72 space-y-3 overflow-y-auto rounded-xl border border-ink-800 bg-ink-900/50 p-3"
      >
        {messages.map((message) => (
          <div
            key={message.id}
            className={
              message.role === 'user'
                ? 'ml-6 rounded-xl bg-brand-500/15 px-3 py-2 text-sm text-ink-100'
                : 'mr-6 rounded-xl bg-ink-800/80 px-3 py-2 text-sm whitespace-pre-wrap text-ink-200'
            }
          >
            {message.content || (busy ? '…' : '')}
          </div>
        ))}
        {loadProgress && <p className="text-xs text-ink-400">{loadProgress}</p>}
      </div>

      {error && (
        <p className="mt-2 text-sm text-warn-500" role="alert">
          {error}
        </p>
      )}

      <form onSubmit={onSubmit} className="mt-3 flex gap-2">
        <input
          type="text"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder='Try “What was my DPS?” or “How can I improve?” — treat open-ended answers as unverified.'
          disabled={busy}
          className="min-w-0 flex-1 rounded-xl border border-ink-700 bg-ink-900 px-3 py-2.5 text-sm text-ink-100 placeholder:text-ink-500 focus:border-brand-400 focus:outline-none disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={busy || draft.trim().length === 0}
          className="shrink-0 rounded-xl bg-brand-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? '…' : 'Ask'}
        </button>
      </form>
    </section>
  );
}
