/**
 * PIXAL2.0 Agent Handler — EdgeOne Makers Functions
 * ==================================================
 *
 * Uses HuggingFace google/gemma-4-E2B-it-assistant model directly.
 * NO @anthropic-ai/claude-agent-sdk, NO transformers.js.
 * Custom agent loop with tool calling, streaming, and multimodal support.
 *
 * File path: agents/chat/index.ts → maps to **POST /chat**
 */

import {
  HF_MODEL_ID,
  getChatCompletionsURL,
  getHFToken,
  THINKING_CONFIGS,
  ThinkingLevel,
  isLocalMode,
} from "../_model";
import { buildSystemPrompt } from "./_skills";
import {
  executeTool,
  uploadFileToSandbox,
  setupSandbox,
  processMultimodalInSandbox,
  getFileType,
  isMultimodal,
  ToolCall,
  shellQuote,
} from "./_tools";
import { createLogger, sseEvent, createSSEResponse } from "../_shared";

const logger = createLogger("chat");

// EPIPE guard
process.stdout?.on?.("error", (err: any) => {
  if (err?.code === "EPIPE") return;
});
process.stderr?.on?.("error", (err: any) => {
  if (err?.code === "EPIPE") return;
});
process.on("uncaughtException", (err: any) => {
  if (err?.code === "EPIPE") return;
  console.error("[chat] uncaughtException:", err);
  throw err;
});

/** Parse tool calls from model response text */
function parseToolCalls(text: string): { plainText: string; toolCalls: ToolCall[] } {
  const toolCalls: ToolCall[] = [];
  let plainText = text;

  // Match ```tool ... ``` blocks
  const toolBlockRegex = /```tool\s*\n?([\s\S]*?)```/g;
  let match;
  while ((match = toolBlockRegex.exec(text)) !== null) {
    try {
      const parsed = JSON.parse(match[1].trim());
      if (parsed.tool) {
        toolCalls.push({ tool: parsed.tool, arguments: parsed.arguments || {} });
      }
    } catch {}
  }

  // Also try inline JSON tool format: {"tool": "...", "arguments": {...}}
  if (toolCalls.length === 0) {
    const inlineRegex = /\{"tool"\s*:\s*"([^"]+)"\s*,\s*"arguments"\s*:\s*(\{[^}]*\})\}/g;
    while ((match = inlineRegex.exec(text)) !== null) {
      try {
        toolCalls.push({
          tool: match[1],
          arguments: JSON.parse(match[2]),
        });
      } catch {}
    }
  }

  // Remove tool blocks from plain text
  plainText = text.replace(toolBlockRegex, '').trim();

  return { plainText, toolCalls };
}

/** Extract thinking content from <think> tags */
function extractThinking(text: string): { thinking: string; response: string } {
  let thinking = '';
  let response = text;

  // Match <think>...</think> tags
  const thinkRegex = /<think>\s*\n?([\s\S]*?)\n?<\/think>/g;
  const match = thinkRegex.exec(text);
  if (match) {
    thinking = match[1].trim();
    response = text.replace(thinkRegex, '').trim();
  }

  return { thinking, response };
}

/** Call HuggingFace Inference API with streaming */
async function* callHFModel(
  messages: Array<{ role: string; content: string }>,
  apiKey: string,
  thinkingLevel: ThinkingLevel,
  signal?: AbortSignal
): AsyncGenerator<string> {
  const config = THINKING_CONFIGS[thinkingLevel];
  const url = getChatCompletionsURL();

  const body: Record<string, any> = {
    model: HF_MODEL_ID,
    messages,
    stream: true,
    max_tokens: config.maxTokens,
    temperature: config.temperature,
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal,
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => response.statusText);
    throw new Error(`HF API error ${response.status}: ${errText}`);
  }

  if (!response.body) {
    throw new Error('No response body from HF API');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (signal?.aborted) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith('data: ')) continue;
      const data = trimmed.slice(6);
      if (data === '[DONE]') return;
      try {
        const parsed = JSON.parse(data);
        const content = parsed.choices?.[0]?.delta?.content || '';
        if (content) yield content;
      } catch {}
    }
  }
}

/** Run model locally in sandbox via Python transformers (direct download) */
async function runLocalModel(
  sandbox: any,
  messages: Array<{ role: string; content: string }>,
  thinkingLevel: ThinkingLevel,
  signal?: AbortSignal
): Promise<string> {
  const config = THINKING_CONFIGS[thinkingLevel];
  const messagesJson = JSON.stringify(messages);

  const code = `
import json, sys
messages = ${messagesJson}

try:
    from transformers import AutoModelForCausalLM, AutoTokenizer
    import torch

    model_id = "${HF_MODEL_ID}"
    tokenizer = AutoTokenizer.from_pretrained(model_id, trust_remote_code=True)
    model = AutoModelForCausalLM.from_pretrained(
        model_id,
        torch_dtype=torch.float16,
        device_map="auto",
        trust_remote_code=True
    )

    text = tokenizer.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
    inputs = tokenizer(text, return_tensors="pt").to(model.device)

    outputs = model.generate(
        **inputs,
        max_new_tokens=${config.maxTokens},
        temperature=${config.temperature},
        do_sample=True,
        pad_token_id=tokenizer.eos_token_id
    )

    input_len = inputs["input_ids"].shape[1]
    response = tokenizer.decode(outputs[0][input_len:], skip_special_tokens=True)
    print(response)
except Exception as e:
    print(f"ERROR: {e}")
    sys.exit(1)
`;

  if (sandbox?.runCode) {
    const result = await sandbox.runCode(code, { language: 'python' });
    return result.stdout || result.stderr || '';
  } else if (sandbox?.commands) {
    const tmpFile = '/tmp/__pixal_run.py';
    await sandbox.files?.write(tmpFile, code);
    const r = await sandbox.commands.run(`python3 ${tmpFile}`, { timeout: 300 });
    return r.stdout || r.stderr || '';
  }

  throw new Error('No sandbox code execution available for local model');
}

/** In-process file cache for session persistence */
const _sessionFileCache = new Map<string, Array<{ name: string; base64: string }>>();

/** Session sandbox setup tracking */
const _sessionSandboxSetup = new Set<string>();

export async function onRequest(context: any) {
  const ctxEnv: Record<string, string | undefined> = context.env ?? process.env;
  const body = context.request.body ?? {};

  let message = typeof body.message === 'string' ? body.message.trim() : '';
  const uploadedFiles: Array<{ name: string; base64: string }> = body.files ?? [];
  const thinkingLevel: ThinkingLevel = (body.thinkingLevel as ThinkingLevel) || 'medium';

  if (!message) {
    return new Response(JSON.stringify({ error: "'message' is required" }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const signal: AbortSignal | undefined = context.request.signal;
  const conversationId: string = context.conversation_id || '';
  const sandbox = context.sandbox ?? null;
  const hfToken = getHFToken(ctxEnv);
  const localMode = isLocalMode(ctxEnv);

  if (!hfToken && !localMode) {
    return new Response(
      JSON.stringify({
        error: 'HUGGING_FACE_HUB_TOKEN is required. Set it in your EdgeOne environment variables.',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // Session file cache
  const cachedFiles = conversationId ? _sessionFileCache.get(conversationId) ?? [] : [];
  if (conversationId && uploadedFiles.length > 0) {
    const mergedMap = new Map(cachedFiles.map(f => [f.name, f]));
    uploadedFiles.forEach(f => mergedMap.set(f.name, f));
    _sessionFileCache.set(conversationId, Array.from(mergedMap.values()));
  }
  const filesToUpload = uploadedFiles.length > 0
    ? _sessionFileCache.get(conversationId) ?? uploadedFiles
    : cachedFiles;

  logger.log(
    `[request] cid=${conversationId}, msg="${message.slice(0, 80)}...", files=${filesToUpload.length}, thinking=${thinkingLevel}`
  );

  return createSSEResponse(async function* (signal) {
    // 1. Sandbox setup — install packages & make writable
    let sandboxWorking = false;
    if (sandbox) {
      yield sseEvent({ type: 'thinking_start', content: '샌드박스 환경 준비 중...' });

      if (conversationId && _sessionSandboxSetup.has(conversationId)) {
        sandboxWorking = true;
      } else {
        try {
          await sandbox.commands.run('ls /tmp', { timeout: 10 });
          sandboxWorking = true;

          yield sseEvent({ type: 'thinking_content', content: '패키지 설치 및 파일 시스템 설정 중...' });
          const setupOk = await setupSandbox(sandbox);
          if (setupOk && conversationId) {
            _sessionSandboxSetup.add(conversationId);
          }
          yield sseEvent({ type: 'thinking_content', content: '샌드박스 준비 완료.' });
        } catch {
          for (let attempt = 0; attempt < 2; attempt++) {
            await new Promise(r => setTimeout(r, 2000));
            try {
              await sandbox.commands.run('ls /tmp', { timeout: 10 });
              sandboxWorking = true;
              yield sseEvent({ type: 'thinking_content', content: `샌드박스 준비 완료 (재시도 ${attempt + 1}).` });
              break;
            } catch {}
          }
        }
      }
      yield sseEvent({ type: 'thinking_end' });
    }

    // 2. Upload files to sandbox
    if (sandboxWorking && filesToUpload.length > 0) {
      yield sseEvent({ type: 'thinking_start', content: '파일 업로드 중...' });
      for (const file of filesToUpload) {
        const ok = await uploadFileToSandbox(sandbox, file);
        yield sseEvent({
          type: 'thinking_content',
          content: ok ? `파일 업로드 완료: ${file.name}` : `파일 업로드 실패: ${file.name}`,
        });
      }
      yield sseEvent({ type: 'thinking_end' });
    }

    // 3. Process multimodal files (image, video, audio) in Python
    let multimodalContext = '';
    const multimodalFiles = filesToUpload.filter(f => isMultimodal(getFileType(f.name)));

    if (sandboxWorking && multimodalFiles.length > 0) {
      yield sseEvent({ type: 'thinking_start', content: '멀티모달 파일 분석 중 (Python)...' });
      for (const file of multimodalFiles) {
        const fileType = getFileType(file.name);
        yield sseEvent({ type: 'thinking_content', content: `${fileType} 파일 처리 중: ${file.name}` });
        const analysis = await processMultimodalInSandbox(sandbox, file.name, fileType);
        multimodalContext += `\n\n[File: ${file.name} (${fileType})]\n${analysis}`;
        yield sseEvent({ type: 'thinking_content', content: `${file.name} 분석 완료` });
      }
      yield sseEvent({ type: 'thinking_end' });
    }

    // 4. Build messages
    const hasFiles = filesToUpload.length > 0;
    const hasMultimodal = multimodalFiles.length > 0;
    const systemPrompt = buildSystemPrompt(thinkingLevel, hasFiles, hasMultimodal);
    const userContent = message + (multimodalContext ? `\n\n[업로드된 파일 정보]\n${multimodalContext}` : '');

    const messages: Array<{ role: string; content: string }> = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent },
    ];

    // 5. Agent loop
    const config = THINKING_CONFIGS[thinkingLevel];
    let iteration = 0;
    let finalResponse = '';

    while (iteration < config.maxIterations) {
      iteration++;
      yield sseEvent({
        type: 'thinking_start',
        content: `생각 중... (단계 ${iteration}/${config.maxIterations})`,
      });

      let rawResponse = '';

      try {
        if (localMode && sandboxWorking) {
          // Direct model download & inference in sandbox (Python transformers)
          rawResponse = await runLocalModel(sandbox, messages, thinkingLevel, signal);
          yield sseEvent({ type: 'text_chunk', content: rawResponse });
        } else {
          // HF Inference API with streaming
          for await (const chunk of callHFModel(messages, hfToken, thinkingLevel, signal)) {
            rawResponse += chunk;
            yield sseEvent({ type: 'text_chunk', content: chunk });
          }
        }
      } catch (e) {
        const err = e as Error;
        logger.error(`[model] iteration ${iteration} error:`, err.message);

        // Fallback: local → API
        if (localMode && sandboxWorking && hfToken) {
          yield sseEvent({ type: 'thinking_content', content: '로컬 모델 실패, HF API로 전환 중...' });
          try {
            for await (const chunk of callHFModel(messages, hfToken, thinkingLevel, signal)) {
              rawResponse += chunk;
              yield sseEvent({ type: 'text_chunk', content: chunk });
            }
          } catch (e2) {
            yield sseEvent({ type: 'error_message', content: `모델 호출 실패: ${(e2 as Error).message}` });
            yield sseEvent({ type: 'thinking_end' });
            break;
          }
        } else {
          yield sseEvent({ type: 'error_message', content: `모델 호출 실패: ${err.message}` });
          yield sseEvent({ type: 'thinking_end' });
          break;
        }
      }

      if (!rawResponse) {
        yield sseEvent({ type: 'thinking_content', content: '빈 응답 수신.' });
        yield sseEvent({ type: 'thinking_end' });
        break;
      }

      // Parse thinking and response
      const { thinking, response } = extractThinking(rawResponse);
      if (thinking) {
        yield sseEvent({ type: 'thinking_content', content: thinking });
      }

      // Parse tool calls
      const { plainText, toolCalls } = parseToolCalls(response);
      yield sseEvent({ type: 'thinking_end' });

      if (toolCalls.length === 0) {
        finalResponse = plainText;
        break;
      }

      // Execute tool calls
      for (const toolCall of toolCalls) {
        yield sseEvent({
          type: 'tool_call',
          tool: toolCall.tool,
          arguments: toolCall.arguments,
        });

        const result = await executeTool(toolCall, sandboxWorking ? sandbox : null);

        yield sseEvent({
          type: 'tool_output',
          tool: toolCall.tool,
          output: result.output,
          success: result.success,
        });

        if (result.file) {
          yield sseEvent({
            type: 'file_download',
            path: result.file,
            filename: result.file.split('/').pop() || 'file',
          });
        }

        // Feed tool result back to model
        messages.push({ role: 'assistant', content: rawResponse });
        messages.push({
          role: 'user',
          content: `[도구 결과: ${toolCall.tool}]\n${result.output}`,
        });
      }
    }

    // 6. Done
    yield sseEvent({ type: 'done', content: finalResponse });
  }, signal);
}
