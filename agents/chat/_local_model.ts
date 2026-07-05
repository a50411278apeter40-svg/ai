/**
 * Local model runner for PIXAL2.0 — google/gemma-4-E2B-it via `transformers`
 * ============================================================================
 * Runs the model 100% locally, inside the EdgeOne sandbox, via the Python
 * `transformers` library. There is NO call to any remote inference API.
 *
 * Because a ~multi-billion-parameter model would be far too slow to
 * download + load into memory on every single chat message, this module
 * starts a small persistent Python HTTP server INSIDE the sandbox the first
 * time a conversation needs it. The model is loaded into memory once; every
 * following turn in that same session just sends a request to
 * `http://127.0.0.1:8765` (loopback inside the sandbox — the Node backend
 * never talks to it from outside).
 *
 * Model input format follows the official Gemma 4 usage:
 *   processor.apply_chat_template(messages, tokenize=True, return_dict=True,
 *     return_tensors="pt", add_generation_prompt=True)
 * with `messages` content built as a list of {type: "text"/"image"/"audio"}
 * parts (Gemma 4 is natively multimodal for image + audio on the E2B model).
 */

import { HF_MODEL_ID, HF_ASSISTANT_MODEL_ID, ThinkingLevel, THINKING_CONFIGS } from '../_model';

const MODEL_SERVER_PORT = 8765;
const WORK_DIR = '/tmp/pixal_work';
const SERVER_SCRIPT_PATH = `${WORK_DIR}/model_server.py`;
const SERVER_LOG_PATH = `${WORK_DIR}/model_server.log`;
const REQUEST_FILE_PATH = `${WORK_DIR}/request.json`;

export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image'; path: string }
  | { type: 'audio'; path: string };

export interface LocalMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | ContentPart[];
}

interface Sandbox {
  commands?: {
    run(cmd: string, opts?: any): Promise<{ stdout: string; stderr: string; exitCode?: number }>;
  };
  files?: {
    write(path: string, content: string): Promise<void>;
    read(path: string): Promise<string>;
  };
}

function shellEscape(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** Builds the Python HTTP server script that stays resident for the session */
function buildServerScript(useAssistant: boolean): string {
  return `
import os, sys, json, traceback
from http.server import BaseHTTPRequestHandler, HTTPServer

os.environ.setdefault("HF_HOME", "${WORK_DIR}/hf_cache")
os.environ.setdefault("TRANSFORMERS_CACHE", "${WORK_DIR}/hf_cache")

HF_TOKEN = os.environ.get("HUGGING_FACE_HUB_TOKEN") or os.environ.get("HF_TOKEN")
if HF_TOKEN:
    try:
        from huggingface_hub import login
        login(token=HF_TOKEN)
    except Exception as e:
        print(f"[model_server] HF login warning: {e}", file=sys.stderr, flush=True)

import torch
from transformers import AutoProcessor, AutoModelForImageTextToText

MODEL_ID = "${HF_MODEL_ID}"
ASSISTANT_MODEL_ID = "${HF_ASSISTANT_MODEL_ID}"
USE_ASSISTANT = ${useAssistant ? 'True' : 'False'}

print("[model_server] loading processor for " + MODEL_ID + " ...", flush=True)
processor = AutoProcessor.from_pretrained(MODEL_ID, padding_side="left")

print("[model_server] loading model weights (first run can take a while)...", flush=True)
model = AutoModelForImageTextToText.from_pretrained(
    MODEL_ID,
    dtype=torch.bfloat16,
    device_map="auto",
)

assistant_model = None
if USE_ASSISTANT:
    try:
        from transformers import AutoModelForCausalLM
        assistant_model = AutoModelForCausalLM.from_pretrained(
            ASSISTANT_MODEL_ID,
            dtype=torch.bfloat16,
            device_map="auto",
        )
        print("[model_server] speculative-decoding assistant model loaded", flush=True)
    except Exception as e:
        print(f"[model_server] assistant model unavailable, continuing without it: {e}", flush=True)
        assistant_model = None

print("[model_server] READY", flush=True)


def build_content_part(part):
    ptype = part.get("type")
    if ptype == "image":
        return {"type": "image", "path": part["path"]}
    if ptype == "audio":
        return {"type": "audio", "path": part["path"]}
    return {"type": "text", "text": part.get("text", "")}


class Handler(BaseHTTPRequestHandler):
    def _send(self, status, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/health":
            self._send(200, {"status": "ok"})
        else:
            self._send(404, {"error": "not found"})

    def do_POST(self):
        if self.path != "/generate":
            self._send(404, {"error": "not found"})
            return
        try:
            length = int(self.headers.get("Content-Length", 0))
            raw = self.rfile.read(length)
            req = json.loads(raw)
            raw_messages = req["messages"]
            max_new_tokens = int(req.get("max_new_tokens", 2048))
            temperature = float(req.get("temperature", 0.7))

            messages = []
            for m in raw_messages:
                content = m["content"]
                if isinstance(content, str):
                    messages.append({"role": m["role"], "content": content})
                else:
                    messages.append({
                        "role": m["role"],
                        "content": [build_content_part(p) for p in content],
                    })

            inputs = processor.apply_chat_template(
                messages,
                tokenize=True,
                return_dict=True,
                return_tensors="pt",
                add_generation_prompt=True,
            ).to(model.device)
            input_len = inputs["input_ids"].shape[-1]

            gen_kwargs = dict(max_new_tokens=max_new_tokens, do_sample=temperature > 0.0)
            if temperature > 0.0:
                gen_kwargs["temperature"] = temperature
            if assistant_model is not None:
                gen_kwargs["assistant_model"] = assistant_model

            with torch.inference_mode():
                output = model.generate(**inputs, **gen_kwargs)

            text = processor.decode(output[0][input_len:], skip_special_tokens=True)
            self._send(200, {"text": text})
        except Exception as e:
            traceback.print_exc()
            self._send(500, {"error": str(e)})

    def log_message(self, format, *args):
        pass


server = HTTPServer(("127.0.0.1", ${MODEL_SERVER_PORT}), Handler)
server.serve_forever()
`;
}

/** In-process cache: which conversations already have a healthy server */
const _serverEnsured = new Set<string>();

async function runCmd(sandbox: Sandbox, cmd: string, timeout = 15): Promise<string> {
  try {
    const r = await sandbox.commands!.run(cmd, { timeout });
    return (r.stdout || '') + (r.stderr || '');
  } catch {
    return '';
  }
}

async function isServerHealthy(sandbox: Sandbox): Promise<boolean> {
  const out = await runCmd(
    sandbox,
    `curl -s -m 3 http://127.0.0.1:${MODEL_SERVER_PORT}/health || true`,
    8
  );
  return out.includes('"status"') && out.includes('ok');
}

/**
 * Ensure the persistent local-model Python server is running inside the
 * sandbox. First call for a session starts it and waits (polling) for the
 * model to finish loading; later calls are a cheap health check.
 */
export async function ensureModelServer(
  sandbox: Sandbox,
  conversationId: string,
  hfToken: string,
  useAssistant: boolean,
  onProgress?: (message: string) => void
): Promise<{ ready: boolean; message: string }> {
  if (!sandbox?.commands || !sandbox?.files) {
    return { ready: false, message: '샌드박스 명령/파일 API를 사용할 수 없습니다.' };
  }

  if (conversationId && _serverEnsured.has(conversationId) && (await isServerHealthy(sandbox))) {
    return { ready: true, message: '모델 서버 재사용 중.' };
  }
  if (await isServerHealthy(sandbox)) {
    if (conversationId) _serverEnsured.add(conversationId);
    return { ready: true, message: '모델 서버 이미 실행 중.' };
  }

  await runCmd(sandbox, `mkdir -p ${WORK_DIR} && chmod 777 ${WORK_DIR}`);
  await sandbox.files.write(SERVER_SCRIPT_PATH, buildServerScript(useAssistant));

  const tokenEnv = hfToken ? `HUGGING_FACE_HUB_TOKEN=${shellEscape(hfToken)} ` : '';

  onProgress?.(`로컬 모델 서버 시작 중 (${HF_MODEL_ID} 다운로드/로딩 — 처음엔 몇 분 걸릴 수 있음)...`);

  await runCmd(
    sandbox,
    `cd ${WORK_DIR} && ${tokenEnv}nohup python3 ${SERVER_SCRIPT_PATH} > ${SERVER_LOG_PATH} 2>&1 & disown; echo started`,
    10
  );

  // Poll — first run downloads several GB of weights, can take minutes.
  const maxAttempts = 60; // up to ~10 minutes
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise(r => setTimeout(r, 10_000));
    if (await isServerHealthy(sandbox)) {
      if (conversationId) _serverEnsured.add(conversationId);
      return { ready: true, message: '모델 서버 준비 완료.' };
    }
    if (i % 3 === 2) {
      const log = await runCmd(sandbox, `tail -n 3 ${SERVER_LOG_PATH} 2>/dev/null || true`, 8);
      const lastLine = log.trim().split('\n').filter(Boolean).pop();
      if (lastLine) onProgress?.(`모델 로딩 중... (${lastLine})`);
    }
  }

  const log = await runCmd(sandbox, `tail -n 40 ${SERVER_LOG_PATH} 2>/dev/null || true`, 8);
  return { ready: false, message: `모델 서버가 제한 시간 내에 준비되지 않았습니다.\n${log}` };
}

/** Send one generation request to the running local model server. */
export async function generateWithLocalModel(
  sandbox: Sandbox,
  messages: LocalMessage[],
  thinkingLevel: ThinkingLevel
): Promise<string> {
  if (!sandbox?.files || !sandbox?.commands) {
    throw new Error('샌드박스가 준비되지 않아 로컬 모델을 호출할 수 없습니다.');
  }

  const config = THINKING_CONFIGS[thinkingLevel];
  const payload = JSON.stringify({
    messages,
    max_new_tokens: config.maxTokens,
    temperature: config.temperature,
  });

  await sandbox.files.write(REQUEST_FILE_PATH, payload);

  const out = await runCmd(
    sandbox,
    `curl -s -m 280 -X POST http://127.0.0.1:${MODEL_SERVER_PORT}/generate -H "Content-Type: application/json" -d @${REQUEST_FILE_PATH}`,
    290
  );

  if (!out.trim()) {
    throw new Error('로컬 모델 서버로부터 응답이 없습니다 (타임아웃일 수 있음).');
  }

  let parsed: any;
  try {
    parsed = JSON.parse(out);
  } catch {
    throw new Error(`로컬 모델 서버 응답 파싱 실패: ${out.slice(0, 500)}`);
  }

  if (parsed.error) {
    throw new Error(`로컬 모델 생성 오류: ${parsed.error}`);
  }

  return parsed.text || '';
}
