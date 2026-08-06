import type { AiModelChoice } from './models.ts';
import { webllmModelId } from './models.ts';
import { sanitizeModelReply } from './sanitizeModelReply.ts';

export interface AiLoadProgress {
  text: string;
  progress: number;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

type Engine = {
  reload: (modelId: string) => Promise<void>;
  unload: () => Promise<void>;
  chat: {
    completions: {
      create: (request: {
        messages: ChatMessage[];
        stream?: boolean;
        temperature?: number;
        max_tokens?: number;
      }) => Promise<
        | { choices: { message?: { content?: string | null } }[] }
        | AsyncIterable<{ choices: { delta?: { content?: string | null } }[] }>
      >;
    };
  };
};

type WebllmModule = {
  CreateMLCEngine: (
    modelId: string,
    config?: { initProgressCallback?: (report: { text: string; progress: number }) => void },
  ) => Promise<Engine>;
};

let webllmModule: WebllmModule | null = null;
let engine: Engine | null = null;
let loadedModelId: string | null = null;
let loadPromise: Promise<Engine> | null = null;
let loadingFor: string | null = null;

const MAX_HISTORY_MESSAGES = 6;

export const AI_SYSTEM_PROMPT = [
  'You are a Guild Wars 2 combat coach.',
  'Answer ONLY from the LOG BRIEFING in the user message.',
  'Output plain text only: no markdown, no bold, no headings, no nested bullets.',
  'Use at most 4 short lines or "- " bullets. Do not dump the whole briefing.',
  'If the question is about something not in the briefing (healing, tanking, pathing, etc.), reply with one sentence that it is not in this report.',
  'Never invent roles, healing comparisons, or skills that are not written in the briefing.',
].join(' ');

export function isWebGpuAvailable(): boolean {
  return typeof navigator !== 'undefined' && 'gpu' in navigator;
}

async function loadWebllm(): Promise<WebllmModule> {
  if (webllmModule) return webllmModule;
  webllmModule = (await import('@mlc-ai/web-llm')) as unknown as WebllmModule;
  return webllmModule;
}

export async function ensureAiEngine(
  choice: AiModelChoice,
  onProgress?: (progress: AiLoadProgress) => void,
): Promise<Engine> {
  if (!isWebGpuAvailable()) {
    throw new Error(
      'This browser does not support WebGPU. Try the latest Chrome or Edge to use local AI chat.',
    );
  }

  const modelId = webllmModelId(choice);

  if (engine && loadedModelId === modelId) {
    return engine;
  }

  if (loadPromise && loadingFor === modelId) {
    return loadPromise;
  }

  loadingFor = modelId;
  loadPromise = (async () => {
    const mod = await loadWebllm();
    const progressCb = onProgress
      ? (report: { text: string; progress: number }) => {
          onProgress({ text: report.text, progress: report.progress });
        }
      : undefined;

    if (engine && loadedModelId && loadedModelId !== modelId) {
      onProgress?.({
        text: `Switching to ${modelId}…`,
        progress: 0,
      });
      await engine.reload(modelId);
      loadedModelId = modelId;
      return engine;
    }

    engine = await mod.CreateMLCEngine(modelId, {
      initProgressCallback: progressCb,
    });
    loadedModelId = modelId;
    return engine;
  })();

  try {
    return await loadPromise;
  } finally {
    if (loadingFor === modelId) {
      loadPromise = null;
      loadingFor = null;
    }
  }
}

function recentHistory(history: ChatMessage[]): ChatMessage[] {
  return history
    .filter((message) => message.role === 'user' || message.role === 'assistant')
    .slice(-MAX_HISTORY_MESSAGES);
}

export async function streamAiReply(options: {
  choice: AiModelChoice;
  /** Plain-text log briefing from formatAiContextForPrompt. */
  contextText: string;
  history: ChatMessage[];
  userMessage: string;
  onProgress?: (progress: AiLoadProgress) => void;
  onDelta: (text: string) => void;
  signal?: AbortSignal;
}): Promise<string> {
  const engineInstance = await ensureAiEngine(options.choice, options.onProgress);
  if (options.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }

  // Re-attach the briefing on every turn so tiny models do not "forget" findings.
  const messages: ChatMessage[] = [
    { role: 'system', content: AI_SYSTEM_PROMPT },
    ...recentHistory(options.history),
    {
      role: 'user',
      content: [
        'LOG BRIEFING:',
        options.contextText,
        '',
        'QUESTION:',
        options.userMessage,
        '',
        'Reply in plain text only (no markdown). Max 4 short bullets. If the topic is not in the briefing, say so in one sentence.',
      ].join('\n'),
    },
  ];

  const completion = await engineInstance.chat.completions.create({
    messages,
    stream: true,
    temperature: 0.15,
    max_tokens: 220,
  });

  let full = '';
  const emit = (raw: string) => {
    full = raw;
    options.onDelta(sanitizeModelReply(raw));
  };

  if (Symbol.asyncIterator in Object(completion)) {
    for await (const chunk of completion as AsyncIterable<{
      choices: { delta?: { content?: string | null } }[];
    }>) {
      if (options.signal?.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }
      const delta = chunk.choices[0]?.delta?.content;
      if (delta) {
        emit(full + delta);
      }
    }
  } else {
    const nonStream = completion as { choices: { message?: { content?: string | null } }[] };
    emit(nonStream.choices[0]?.message?.content ?? '');
  }

  return sanitizeModelReply(full);
}
