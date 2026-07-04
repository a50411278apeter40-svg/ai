/**
 * Model & HuggingFace Configuration for PIXAL2.0
 * ===============================================
 * Uses google/gemma-4-E2B-it-assistant from HuggingFace.
 * Supports both HF Inference API (remote) and local sandbox download (direct).
 * NO transformers.js — Python transformers library only (in sandbox).
 */

/** HuggingFace model identifier */
export const HF_MODEL_ID = 'google/gemma-4-E2B-it-assistant';

/** HuggingFace Inference API base URL */
export const HF_API_BASE = 'https://router.huggingface.co';

/** Thinking level configurations — controls reasoning depth, iterations, tokens */
export type ThinkingLevel = 'low' | 'medium' | 'high' | 'max';

export interface ThinkingConfig {
  label: string;
  promptInstruction: string;
  maxIterations: number;
  maxTokens: number;
  temperature: number;
}

export const THINKING_CONFIGS: Record<ThinkingLevel, ThinkingConfig> = {
  low: {
    label: 'Low',
    promptInstruction: 'Think briefly and respond directly. Use tools only when strictly necessary. Keep reasoning concise.',
    maxIterations: 3,
    maxTokens: 2048,
    temperature: 0.3,
  },
  medium: {
    label: 'Medium',
    promptInstruction: 'Think step by step before responding. Consider the best approach. Use tools when needed.',
    maxIterations: 5,
    maxTokens: 4096,
    temperature: 0.5,
  },
  high: {
    label: 'High',
    promptInstruction: 'Think deeply about the problem. Consider multiple approaches and evaluate trade-offs. Use tools extensively to gather information and verify results.',
    maxIterations: 8,
    maxTokens: 8192,
    temperature: 0.7,
  },
  max: {
    label: 'Max',
    promptInstruction: 'Think exhaustively. Consider ALL possible approaches. Use every available tool. Verify every result with additional checks. Leave no stone unturned. Provide the most comprehensive analysis possible.',
    maxIterations: 12,
    maxTokens: 16384,
    temperature: 0.9,
  },
};

/** Get HuggingFace API token from environment */
export function getHFToken(env?: Record<string, string | undefined>): string {
  return env?.HUGGING_FACE_HUB_TOKEN || env?.HF_TOKEN || '';
}

/** Check if local model mode is enabled (download & run in sandbox) */
export function isLocalMode(env?: Record<string, string | undefined>): boolean {
  return env?.HF_LOCAL_MODE === 'true';
}

/** Build the HF Inference API URL for chat completions */
export function getChatCompletionsURL(): string {
  return `${HF_API_BASE}/v1/chat/completions`;
}
