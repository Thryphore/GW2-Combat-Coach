/** User-facing local AI model choices persisted in settings. */
export type AiModelChoice = 'qwen-0.5b' | 'llama-1b';

export const DEFAULT_AI_MODEL: AiModelChoice = 'qwen-0.5b';

export const AI_MODEL_OPTIONS: {
  id: AiModelChoice;
  label: string;
  description: string;
  /** WebLLM prebuilt model id. */
  webllmId: string;
}[] = [
  {
    id: 'qwen-0.5b',
    label: 'Qwen 0.5B (default)',
    description: 'Smaller download (~250–300 MB). Good for basic questions about this log.',
    webllmId: 'Qwen2.5-0.5B-Instruct-q4f16_1-MLC',
  },
  {
    id: 'llama-1b',
    label: 'Llama 3.2 1B',
    description: 'Larger download (~600–900 MB). Usually clearer answers; first load is slower.',
    webllmId: 'Llama-3.2-1B-Instruct-q4f16_1-MLC',
  },
];

export function webllmModelId(choice: AiModelChoice): string {
  return AI_MODEL_OPTIONS.find((option) => option.id === choice)?.webllmId ?? AI_MODEL_OPTIONS[0].webllmId;
}

export function isAiModelChoice(value: unknown): value is AiModelChoice {
  return value === 'qwen-0.5b' || value === 'llama-1b';
}
