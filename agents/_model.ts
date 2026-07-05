/**
 * Model Configuration for PIXAL2.0
 * ===================================
 * IMPORTANT model-id note:
 *   "google/gemma-4-E2B-it-assistant" is NOT a standalone chat model — it's a
 *   Multi-Token-Prediction (MTP) "draft" model used only for speculative
 *   decoding, and must be paired with the real target model via
 *   `assistant_model=` in `.generate()`. Using it alone produces garbage.
 *   The real chat/multimodal model is "google/gemma-4-E2B-it".
 *
 * This project ALWAYS runs the model locally via the Python `transformers`
 * library inside the EdgeOne sandbox (no remote HF Inference API calls).
 * A small persistent Python HTTP server is started inside the sandbox so the
 * ~5B-parameter model is loaded into memory once per session instead of on
 * every single chat turn (see agents/chat/_local_model.ts).
 */

/** The real Gemma 4 E2B instruction-tuned multimodal model (text+image+audio) */
export const HF_MODEL_ID = 'google/gemma-4-E2B-it';

/** Optional speculative-decoding draft model — speeds up generation, never used alone */
export const HF_ASSISTANT_MODEL_ID = 'google/gemma-4-E2B-it-assistant';

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

/** Get HuggingFace API token from environment.
 * Gemma models are gated on the Hub, so this token is still required —
 * it's used to `huggingface_hub.login()` before downloading the weights,
 * NOT for calling any remote inference API. */
export function getHFToken(env?: Record<string, string | undefined>): string {
  return env?.HUGGING_FACE_HUB_TOKEN || env?.HF_TOKEN || '';
}

/** Whether to use the MTP assistant model for speculative decoding speedup.
 * Defaults to true; set HF_USE_ASSISTANT=false to disable if it causes issues. */
export function useAssistantModel(env?: Record<string, string | undefined>): boolean {
  return env?.HF_USE_ASSISTANT !== 'false';
}
