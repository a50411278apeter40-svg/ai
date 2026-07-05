/**
 * PIXAL2.0 Agent Handler — EdgeOne Makers Functions
 * ==================================================
 *
 * Runs google/gemma-4-E2B-it ENTIRELY LOCALLY via the Python `transformers`
 * library inside the EdgeOne sandbox — no remote HF Inference API is ever
 * called. See ./_local_model.ts for the persistent-server implementation
 * and the correct Gemma 4 chat-template / multimodal input format.
 *
 * File path: agents/chat/index.ts → maps to **POST /chat**
 *
 * Conversation logging: every event (user message, thinking steps, tool
 * calls, tool outputs, final response) is appended in real time via
 * context.store.appendMessage — but ONLY when the request includes a
 * logged-in userId. This matches the "save only when logged in" requirement.
 */

import { getHFToken, useAssistantModel, THINKING_CONFIGS, ThinkingLevel } from "../_model";
import { buildSystemPrompt } from "./_skills";
import {
  executeTool,
  uploadFileToSandbox,
  setupSandbox,
  processMultimodalInSandbox,
  getFileType,
  isMultimodal,
  ToolCall,
} from "./_tools";
import {
  ensureModelServer,
  generateWithLocalModel,
  LocalMessage,
  ContentPart,
} from "./_local_model";
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

  plainText = text.replace(toolBlockRegex, '').trim();

  return { plainText, toolCalls };
}

/** Extract thinking content from <think> tags */
function extractThinking(text: string): { thinking: string; response: string } {
  let thinking = '';
  let response = text;

  const thinkRegex = /<think>\s*\n?([\s\S]*?)\n?<\/think>/g;
  const match = thinkRegex.exec(text);
  if (match) {
    thinking = match[1].trim();
    response = text.replace(thinkRegex, '').trim();
  }

  return { thinking, response };
}

/** In-process file cache for session persistence */
const _sessionFileCache = new Map<string, Array<{ name: string; base64: string }>>();

/** Session sandbox package-install tracking */
const _sessionSandboxSetup = new Set<string>();

export async function onRequest(context: any) {
  const ctxEnv: Record<string, string | undefined> = context.env ?? process.env;
  const body = context.request.body ?? {};

  let message = typeof body.message === 'string' ? body.message.trim() : '';
  const uploadedFiles: Array<{ name: string; base64: string }> = body.files ?? [];
  const thinkingLevel: ThinkingLevel = (body.thinkingLevel as ThinkingLevel) || 'medium';

  // Only present when the user is logged in on the frontend — controls
  // whether this conversation gets auto-saved via context.store.
  const userId: string | undefined =
    typeof body.userId === 'string' && body.userId.trim() ? body.userId.trim() : undefined;

  if (!message) {
    return new Response(JSON.stringify({ error: "'message' is required" }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const signal: AbortSignal | undefined = context.request.signal;
  // EdgeOne Makers requires a valid `makers-conversation-id` header
  // (6-36 chars, [0-9a-zA-Z-_.]) — the frontend generates and persists one.
  const conversationId: string = context.conversation_id || '';
  const sandbox = context.sandbox ?? null;
  const hfToken = getHFToken(ctxEnv);
  const useAssistant = useAssistantModel(ctxEnv);

  if (!sandbox) {
    return new Response(
      JSON.stringify({
        error:
          '이 에이전트는 로컬 모델(transformers)만 사용하며 실행에 샌드박스가 필요합니다. EdgeOne Makers 프로젝트에서 Sandbox 기능이 활성화되어 있는지 확인하세요.',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }

  if (!hfToken) {
    return new Response(
      JSON.stringify({
        error:
          'HUGGING_FACE_HUB_TOKEN이 필요합니다. Gemma 모델은 gated 모델이라 다운로드에 승인된 HF 토큰이 필요합니다. EdgeOne 환경 변수에 설정하세요.',
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
    `[request] cid=${conversationId}, msg="${message.slice(0, 80)}...", files=${filesToUpload.length}, thinking=${thinkingLevel}, userId=${userId ?? 'none'}`
  );

  // ─── Conversation storage: only active when logged in ───
  const storeAvailable = Boolean(context.store && typeof context.store.appendMessage === 'function');
  const saveEnabled = Boolean(userId) && storeAvailable;

  const logMessage = (
    role: 'user' | 'assistant' | 'system' | 'tool',
    content: string,
    metadata?: Record<string, any>
  ) => {
    if (!saveEnabled || !conversationId) return;
    try {
      const p = Promise.resolve(
        context.store.appendMessage({ conversationId, role, content, userId, metadata })
      ).catch((e: any) => logger.error('[store] appendMessage failed:', e?.message));
      if (typeof context.waitUntil === 'function') context.waitUntil(p);
    } catch (e) {
      logger.error('[store] appendMessage threw:', (e as Error).message);
    }
  };

  if (saveEnabled && typeof context.store.updateConversation === 'function') {
    try {
      const p = Promise.resolve(
        context.store.updateConversation({ conversationId, userId, title: message.slice(0, 60) })
      ).catch(() => {});
      if (typeof context.waitUntil === 'function') context.waitUntil(p);
    } catch {}
  }

  return createSSEResponse(async function* (signal) {
    logMessage('user', message, {
      type: 'user_message',
      files: filesToUpload.map(f => f.name),
      thinkingLevel,
    });

    // 1. Sandbox setup — install packages
    yield sseEvent({ type: 'thinking_start', content: '샌드박스 환경 준비 중...' });
    logMessage('system', '샌드박스 환경 준비 중...', { type: 'phase' });

    let sandboxWorking = false;
    if (conversationId && _sessionSandboxSetup.has(conversationId)) {
      sandboxWorking = true;
    } else {
      try {
        await sandbox.commands.run('ls /tmp', { timeout: 10 });
        sandboxWorking = true;

        yield sseEvent({ type: 'thinking_content', content: '패키지 설치 및 파일 시스템 설정 중...' });
        logMessage('system', '패키지 설치 및 파일 시스템 설정 중...', { type: 'phase' });

        const setupOk = await setupSandbox(sandbox);
        if (setupOk && conversationId) _sessionSandboxSetup.add(conversationId);

        yield sseEvent({ type: 'thinking_content', content: '샌드박스 준비 완료.' });
        logMessage('system', '샌드박스 준비 완료.', { type: 'phase' });
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

    if (!sandboxWorking) {
      const errMsg = '샌드박스를 사용할 수 없어 로컬 모델을 실행할 수 없습니다.';
      yield sseEvent({ type: 'error_message', content: errMsg });
      logMessage('system', errMsg, { type: 'error' });
      yield sseEvent({ type: 'done', content: '' });
      return;
    }

    // 2. Ensure the persistent local model server (loads google/gemma-4-E2B-it once)
    yield sseEvent({ type: 'thinking_start', content: '로컬 AI 모델 서버 확인 중...' });
    const serverStatus = await ensureModelServer(
      sandbox,
      conversationId,
      hfToken,
      useAssistant,
      (msg) => {
        // best-effort progress ping; consumed below via polling loop instead
      }
    );
    yield sseEvent({ type: 'thinking_content', content: serverStatus.message });
    logMessage('system', serverStatus.message, { type: 'model_server' });
    yield sseEvent({ type: 'thinking_end' });

    if (!serverStatus.ready) {
      const errMsg = `로컬 모델 서버를 시작하지 못했습니다: ${serverStatus.message}`;
      yield sseEvent({ type: 'error_message', content: errMsg });
      logMessage('system', errMsg, { type: 'error' });
      yield sseEvent({ type: 'done', content: '' });
      return;
    }

    // 3. Upload files to sandbox
    if (filesToUpload.length > 0) {
      yield sseEvent({ type: 'thinking_start', content: '파일 업로드 중...' });
      for (const file of filesToUpload) {
        const ok = await uploadFileToSandbox(sandbox, file);
        const msg = ok ? `파일 업로드 완료: ${file.name}` : `파일 업로드 실패: ${file.name}`;
        yield sseEvent({ type: 'thinking_content', content: msg });
        logMessage('system', msg, { type: 'file_upload', file: file.name, success: ok });
      }
      yield sseEvent({ type: 'thinking_end' });
    }

    // 4. Lightweight metadata analysis for multimodal files (dimensions, duration, etc.)
    //    The actual pixel/audio data is fed to the model natively (see content parts below) —
    //    this text is only extra context, not a substitute for real multimodal input.
    let multimodalContext = '';
    const multimodalFiles = filesToUpload.filter(f => isMultimodal(getFileType(f.name)));
    // Gemma 4 E2B natively supports text + image + audio (no native video input)
    const nativeMultimodalFiles = multimodalFiles.filter(f => getFileType(f.name) !== 'video');

    if (multimodalFiles.length > 0) {
      yield sseEvent({ type: 'thinking_start', content: '멀티모달 파일 분석 중 (Python)...' });
      for (const file of multimodalFiles) {
        const fileType = getFileType(file.name);
        yield sseEvent({ type: 'thinking_content', content: `${fileType} 파일 처리 중: ${file.name}` });
        const analysis = await processMultimodalInSandbox(sandbox, file.name, fileType);
        multimodalContext += `\n\n[File: ${file.name} (${fileType})]\n${analysis}`;
        yield sseEvent({ type: 'thinking_content', content: `${file.name} 분석 완료` });
        logMessage('system', analysis, { type: 'multimodal_analysis', file: file.name, fileType });
      }
      yield sseEvent({ type: 'thinking_end' });
    }

    // 5. Build messages — Gemma 4 chat template: content is a list of parts.
    //    Images/audio are passed as REAL file paths so the model sees/hears
    //    them natively, not just a text description.
    const hasFiles = filesToUpload.length > 0;
    const hasMultimodal = multimodalFiles.length > 0;
    const systemPrompt = buildSystemPrompt(thinkingLevel, hasFiles, hasMultimodal);

    const userContentParts: ContentPart[] = [];
    for (const file of nativeMultimodalFiles) {
      const fileType = getFileType(file.name);
      const sandboxPath = `/tmp/${file.name}`;
      if (fileType === 'image') userContentParts.push({ type: 'image', path: sandboxPath });
      else if (fileType === 'audio') userContentParts.push({ type: 'audio', path: sandboxPath });
    }
    const textForModel = message + (multimodalContext ? `\n\n[업로드된 파일 정보]\n${multimodalContext}` : '');
    userContentParts.push({ type: 'text', text: textForModel });

    const messages: LocalMessage[] = [
      { role: 'system', content: [{ type: 'text', text: systemPrompt }] },
      { role: 'user', content: userContentParts },
    ];

    // 6. Agent loop
    const config = THINKING_CONFIGS[thinkingLevel];
    let iteration = 0;
    let finalResponse = '';

    while (iteration < config.maxIterations) {
      iteration++;
      const iterMsg = `생각 중... (단계 ${iteration}/${config.maxIterations})`;
      yield sseEvent({ type: 'thinking_start', content: iterMsg });
      logMessage('assistant', iterMsg, { type: 'thinking', iteration });

      let rawResponse = '';
      try {
        rawResponse = await generateWithLocalModel(sandbox, messages, thinkingLevel);
        yield sseEvent({ type: 'text_chunk', content: rawResponse });
      } catch (e) {
        const err = e as Error;
        logger.error(`[model] iteration ${iteration} error:`, err.message);
        const errMsg = `로컬 모델 호출 실패: ${err.message}`;
        yield sseEvent({ type: 'error_message', content: errMsg });
        logMessage('system', errMsg, { type: 'error' });
        yield sseEvent({ type: 'thinking_end' });
        break;
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
        logMessage('assistant', thinking, { type: 'thinking', iteration });
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
        yield sseEvent({ type: 'tool_call', tool: toolCall.tool, arguments: toolCall.arguments });
        logMessage('tool', JSON.stringify({ tool: toolCall.tool, arguments: toolCall.arguments }), {
          type: 'tool_call',
          tool: toolCall.tool,
          arguments: toolCall.arguments,
        });

        const result = await executeTool(toolCall, sandbox);

        yield sseEvent({
          type: 'tool_output',
          tool: toolCall.tool,
          output: result.output,
          success: result.success,
        });
        logMessage('tool', result.output, { type: 'tool_output', tool: toolCall.tool, success: result.success });

        if (result.file) {
          yield sseEvent({
            type: 'file_download',
            path: result.file,
            filename: result.file.split('/').pop() || 'file',
          });
          logMessage('system', `파일 생성됨: ${result.file}`, { type: 'file_download', path: result.file });
        }

        // Feed tool result back to model (text turns from here on)
        messages.push({ role: 'assistant', content: [{ type: 'text', text: rawResponse }] });
        messages.push({
          role: 'user',
          content: [{ type: 'text', text: `[도구 결과: ${toolCall.tool}]\n${result.output}` }],
        });
      }
    }

    // 7. Done — log the final assistant response
    yield sseEvent({ type: 'done', content: finalResponse });
    if (finalResponse) {
      logMessage('assistant', finalResponse, { type: 'final' });
    }
  }, signal);
}
