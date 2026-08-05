import type { EILog } from './eiTypes.ts';
import type { LogSource } from './logSource.ts';

export type FetchStage = 'connecting' | 'downloading' | 'parsing';

export interface FetchProgress {
  stage: FetchStage;
  bytesReceived: number;
  /** Only known when the service sends a content-length header. */
  bytesTotal?: number;
}

export interface FetchLogOptions {
  signal?: AbortSignal;
  onProgress?: (progress: FetchProgress) => void;
}

export class LogFetchError extends Error {
  constructor(
    message: string,
    readonly source: LogSource,
  ) {
    super(message);
  }
}

/**
 * Elite Insights JSON for a long encounter routinely runs to tens of megabytes,
 * so the body is streamed and progress is reported as it arrives.
 */
export async function fetchEliteInsightsJson(
  source: LogSource,
  { signal, onProgress }: FetchLogOptions = {},
): Promise<EILog> {
  onProgress?.({ stage: 'connecting', bytesReceived: 0 });

  let response: Response;
  try {
    response = await fetch(source.jsonUrl, { signal, headers: { Accept: 'application/json' } });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new LogFetchError(
      `Could not reach ${source.serviceName}. Check your connection and that the link is public.`,
      source,
    );
  }

  if (!response.ok) {
    throw new LogFetchError(describeHttpFailure(response.status, source), source);
  }

  const lengthHeader = response.headers.get('content-length');
  const bytesTotal = lengthHeader ? Number(lengthHeader) : undefined;

  const text = response.body
    ? await readStream(response.body, bytesTotal, onProgress, signal)
    : await response.text();

  onProgress?.({ stage: 'parsing', bytesReceived: text.length, bytesTotal });

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new LogFetchError(`${source.serviceName} returned a response that was not valid JSON.`, source);
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new LogFetchError(`${source.serviceName} returned an unexpected response.`, source);
  }

  const maybeError = (parsed as { error?: unknown }).error;
  if (typeof maybeError === 'string' && maybeError) {
    throw new LogFetchError(`${source.serviceName} rejected that log: ${maybeError}`, source);
  }

  const log = parsed as EILog;
  if (!log.players?.length) {
    throw new LogFetchError(
      'That report has no player data, so there is nothing to analyze. Detailed JSON is only available for logs parsed with Elite Insights.',
      source,
    );
  }

  return log;
}

async function readStream(
  body: ReadableStream<Uint8Array>,
  bytesTotal: number | undefined,
  onProgress: FetchLogOptions['onProgress'],
  signal: AbortSignal | undefined,
): Promise<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let bytesReceived = 0;
  let text = '';
  let sinceLastReport = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      if (!value) continue;

      bytesReceived += value.byteLength;
      sinceLastReport += value.byteLength;
      text += decoder.decode(value, { stream: true });

      // Reporting every chunk would thrash React state on fast connections.
      if (sinceLastReport > 256 * 1024) {
        sinceLastReport = 0;
        onProgress?.({ stage: 'downloading', bytesReceived, bytesTotal });
      }
    }
  } finally {
    reader.releaseLock();
  }

  text += decoder.decode();
  onProgress?.({ stage: 'downloading', bytesReceived, bytesTotal });
  return text;
}

function describeHttpFailure(status: number, source: LogSource): string {
  if (status === 404) return `${source.serviceName} has no record of log "${source.id}".`;
  if (status === 403) {
    return `${source.serviceName} refused that log. It may be private, anonymized, or too old to have JSON available.`;
  }
  if (status === 429) return `${source.serviceName} is rate limiting requests. Wait a moment and try again.`;
  if (status >= 500) return `${source.serviceName} had a server error (${status}). Try again shortly.`;
  return `${source.serviceName} returned HTTP ${status}.`;
}
