'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { marked } from 'marked';
import { useI18n } from '@/lib/i18n';
import { DeployButtons } from './components/deploy-buttons';

marked.setOptions({ gfm: true, breaks: true });

// ============ Types ============

export interface FileItem {
  id: string;
  name: string;
  type: 'image' | 'video' | 'audio' | 'pdf' | 'word' | 'excel' | 'csv' | 'text';
  size: string;
  status: 'queued' | 'processing' | 'done' | 'error';
  base64?: string;
  preview?: string; // for image thumbnails
}

type ThinkingLevel = 'low' | 'medium' | 'high' | 'max';

interface ThinkingStep {
  id: string;
  title: string;
  content: string;
  expanded: boolean;
  type: 'thinking' | 'tool_call' | 'tool_output' | 'error';
  toolName?: string;
  toolArgs?: Record<string, any>;
  toolOutput?: string;
  toolSuccess?: boolean;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  thinkingSteps: ThinkingStep[];
  files?: FileItem[];
  fileDownloads?: Array<{ path: string; filename: string }>;
  isStreaming: boolean;
  thinkingLevel: ThinkingLevel;
}

// ============ Markdown Renderer ============

function MarkdownBlock({ content }: { content: string }) {
  const html = marked.parse(content) as string;
  return <div className="prose-chat" dangerouslySetInnerHTML={{ __html: html }} />;
}

// ============ Accordion Thinking Step ============

function AccordionStep({
  step,
  onToggle,
  isDark,
}: {
  step: ThinkingStep;
  onToggle: () => void;
  isDark: boolean;
}) {
  const iconMap: Record<string, string> = {
    thinking: '🧠',
    tool_call: '🔧',
    tool_output: '📤',
    error: '❌',
  };

  const colorMap: Record<string, string> = isDark
    ? {
        thinking: 'border-blue-800/40 bg-blue-950/20',
        tool_call: 'border-amber-800/40 bg-amber-950/20',
        tool_output: 'border-green-800/40 bg-green-950/20',
        error: 'border-red-800/40 bg-red-950/20',
      }
    : {
        thinking: 'border-blue-200 bg-blue-50/50',
        tool_call: 'border-amber-200 bg-amber-50/50',
        tool_output: 'border-green-200 bg-green-50/50',
        error: 'border-red-200 bg-red-50/50',
      };

  return (
    <div className={`rounded-lg border overflow-hidden text-xs ${colorMap[step.type] || ''}`}>
      {/* Accordion Header */}
      <button
        onClick={onToggle}
        className={`w-full flex items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-opacity-50 ${isDark ? 'hover:bg-white/5' : 'hover:bg-black/5'}`}
      >
        <svg
          className={`w-3 h-3 flex-shrink-0 transition-transform duration-200 ${step.expanded ? 'rotate-90' : ''} ${isDark ? 'text-gray-400' : 'text-gray-500'}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
        <span className="flex-shrink-0">{iconMap[step.type] || '📋'}</span>
        <span className={`flex-1 truncate font-medium ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
          {step.title}
        </span>
        {step.type === 'tool_output' && (
          <span className={`text-[10px] px-1.5 py-0.5 rounded ${step.toolSuccess ? (isDark ? 'bg-green-900/40 text-green-300' : 'bg-green-100 text-green-700') : (isDark ? 'bg-red-900/40 text-red-300' : 'bg-red-100 text-red-700')}`}>
            {step.toolSuccess ? 'OK' : 'ERR'}
          </span>
        )}
      </button>

      {/* Accordion Content */}
      {step.expanded && (
        <div className={`border-t ${isDark ? 'border-white/10' : 'border-black/10'}`}>
          <div className="px-3 py-2.5 space-y-1.5">
            {step.toolArgs && Object.keys(step.toolArgs).length > 0 && (
              <div>
                <span className={`text-[10px] font-medium ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>입력:</span>
                <pre className={`mt-0.5 p-2 rounded text-[10px] overflow-x-auto ${isDark ? 'bg-black/30 text-gray-300' : 'bg-white/50 text-gray-600'}`}>
                  {JSON.stringify(step.toolArgs, null, 2)}
                </pre>
              </div>
            )}
            {step.content && (
              <div className={`leading-relaxed ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>
                {step.content}
              </div>
            )}
            {step.toolOutput && (
              <div>
                <span className={`text-[10px] font-medium ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>출력:</span>
                <pre className={`mt-0.5 p-2 rounded text-[10px] overflow-x-auto max-h-40 ${isDark ? 'bg-black/30 text-gray-300' : 'bg-white/50 text-gray-600'}`}>
                  {step.toolOutput}
                </pre>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ============ Thinking Section (Master Accordion) ============

function ThinkingSection({
  steps,
  isLive,
  isDark,
  title,
}: {
  steps: ThinkingStep[];
  isLive: boolean;
  isDark: boolean;
  title: string;
}) {
  const [allExpanded, setAllExpanded] = useState(false);
  const [masterCollapsed, setMasterCollapsed] = useState(false);

  const toggleStep = (id: string) => {
    const step = steps.find(s => s.id === id);
    if (step) step.expanded = !step.expanded;
  };

  const expandAll = () => {
    steps.forEach(s => s.expanded = true);
    setAllExpanded(true);
  };

  const collapseAll = () => {
    steps.forEach(s => s.expanded = false);
    setAllExpanded(false);
  };

  return (
    <div className={`rounded-xl border overflow-hidden ${isDark ? 'bg-gray-900/30 border-gray-700/40' : 'bg-gray-50/80 border-gray-200'}`}>
      {/* Master Header */}
      <div className={`flex items-center gap-2 px-3 py-2.5 border-b ${isDark ? 'border-gray-700/40' : 'border-gray-200'}`}>
        <button
          onClick={() => setMasterCollapsed(!masterCollapsed)}
          className={`flex items-center gap-2 text-left flex-1`}
        >
          <svg
            className={`w-3.5 h-3.5 flex-shrink-0 transition-transform duration-200 ${masterCollapsed ? '' : 'rotate-90'} ${isDark ? 'text-gray-400' : 'text-gray-500'}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
          {isLive ? (
            <span className="w-3 h-3 rounded-full border-2 border-blue-400 border-t-transparent animate-spin flex-shrink-0" />
          ) : (
            <span className="text-sm flex-shrink-0">🧠</span>
          )}
          <span className={`text-xs font-medium ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>
            {isLive ? '처리 중...' : `${title} · ${steps.length}단계`}
          </span>
        </button>
        {!masterCollapsed && steps.length > 1 && (
          <div className="flex items-center gap-1.5">
            <button
              onClick={expandAll}
              className={`text-[10px] px-1.5 py-0.5 rounded ${isDark ? 'text-gray-400 hover:bg-white/10' : 'text-gray-500 hover:bg-black/5'}`}
            >
              모두 펼치기
            </button>
            <button
              onClick={collapseAll}
              className={`text-[10px] px-1.5 py-0.5 rounded ${isDark ? 'text-gray-400 hover:bg-white/10' : 'text-gray-500 hover:bg-black/5'}`}
            >
              모두 접기
            </button>
          </div>
        )}
      </div>

      {/* Steps */}
      {!masterCollapsed && (
        <div className="px-3 py-2.5 space-y-1.5">
          {steps.map(step => (
            <AccordionStep
              key={step.id}
              step={step}
              onToggle={() => toggleStep(step.id)}
              isDark={isDark}
            />
          ))}
          {isLive && (
            <div className={`flex items-center gap-1.5 pt-0.5 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
              <span className="w-1 h-1 rounded-full bg-current animate-pulse" />
              <span>진행 중...</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ============ Thinking Level Dropdown ============

function ThinkingLevelDropdown({
  value,
  onChange,
  isDark,
}: {
  value: ThinkingLevel;
  onChange: (level: ThinkingLevel) => void;
  isDark: boolean;
}) {
  const [open, setOpen] = useState(false);

  const levels: { value: ThinkingLevel; label: string; desc: string; icon: string }[] = [
    { value: 'low', label: '낮음', desc: '간단한 응답', icon: '🟢' },
    { value: 'medium', label: '보통', desc: '단계별 추론', icon: '🟡' },
    { value: 'high', label: '높음', desc: '심층 분석', icon: '🟠' },
    { value: 'max', label: '최대', desc: '완전한 분석', icon: '🔴' },
  ];

  const current = levels.find(l => l.value === value) || levels[1];

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
          isDark ? 'bg-gray-800 hover:bg-gray-700 text-gray-300' : 'bg-gray-100 hover:bg-gray-200 text-gray-700'
        }`}
      >
        <span>{current.icon}</span>
        <span>사고 수준: {current.label}</span>
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className={`absolute right-0 top-full mt-1 z-20 rounded-lg border shadow-lg overflow-hidden min-w-[180px] ${
            isDark ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'
          }`}>
            {levels.map(level => (
              <button
                key={level.value}
                onClick={() => {
                  onChange(level.value);
                  setOpen(false);
                }}
                className={`w-full flex items-center gap-2 px-3 py-2 text-left text-xs transition-colors ${
                  level.value === value
                    ? (isDark ? 'bg-blue-900/30 text-blue-300' : 'bg-blue-50 text-blue-700')
                    : (isDark ? 'hover:bg-gray-700 text-gray-300' : 'hover:bg-gray-50 text-gray-700')
                }`}
              >
                <span>{level.icon}</span>
                <div className="flex-1">
                  <div className="font-medium">{level.label}</div>
                  <div className={`text-[10px] ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>{level.desc}</div>
                </div>
                {level.value === value && (
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ============ Helpers ============

function getFileType(name: string): FileItem['type'] {
  const ext = name.split('.').pop()?.toLowerCase() || '';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'tiff'].includes(ext)) return 'image';
  if (['mp4', 'avi', 'mov', 'mkv', 'webm', 'flv', 'wmv', 'm4v'].includes(ext)) return 'video';
  if (['mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a', 'wma', 'opus'].includes(ext)) return 'audio';
  if (['pdf'].includes(ext)) return 'pdf';
  if (['doc', 'docx'].includes(ext)) return 'word';
  if (['xls', 'xlsx'].includes(ext)) return 'excel';
  if (['csv'].includes(ext)) return 'csv';
  return 'text';
}

function getFileIcon(type: FileItem['type']): string {
  switch (type) {
    case 'image': return '🖼️';
    case 'video': return '🎬';
    case 'audio': return '🎵';
    case 'pdf': return '📄';
    case 'word': return '📝';
    case 'excel': return '📊';
    case 'csv': return '📋';
    default: return '📃';
  }
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(',')[1] || '');
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function readFileAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ============ Main Component ============

export default function HomePage() {
  const { locale, setLocale, t } = useI18n();
  const isDark = true; // Default dark theme

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [files, setFiles] = useState<FileItem[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [thinkingLevel, setThinkingLevel] = useState<ThinkingLevel>('medium');
  const abortRef = useRef<AbortController | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const scrollToBottom = useCallback(() => {
    setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, 50);
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  // Handle file selection
  const handleFileSelect = useCallback(async (selectedFiles: FileList | null) => {
    if (!selectedFiles) return;

    const newFiles: FileItem[] = [];
    for (let i = 0; i < selectedFiles.length; i++) {
      const file = selectedFiles[i];
      const id = `f-${Date.now()}-${i}`;
      const type = getFileType(file.name);
      const base64 = await readFileAsBase64(file);
      let preview: string | undefined;

      if (type === 'image') {
        preview = await readFileAsDataURL(file);
      }

      newFiles.push({
        id,
        name: file.name,
        type,
        size: formatFileSize(file.size),
        status: 'queued',
        base64,
        preview,
      });
    }

    setFiles(prev => [...prev, ...newFiles]);
  }, []);

  // Drag and drop
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    handleFileSelect(e.dataTransfer.files);
  }, [handleFileSelect]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
  }, []);

  // Remove file
  const removeFile = useCallback((id: string) => {
    setFiles(prev => prev.filter(f => f.id !== id));
  }, []);

  // Send message
  const sendMessage = useCallback(async () => {
    if ((!input.trim() && files.length === 0) || isProcessing) return;

    const userFiles = [...files];
    const userMessage = input.trim() || '(파일만 업로드)';
    const msgId = `msg-${Date.now()}`;

    const userMsg: ChatMessage = {
      id: msgId,
      role: 'user',
      content: userMessage,
      files: userFiles,
      isStreaming: false,
      thinkingLevel,
    };

    const assistantMsg: ChatMessage = {
      id: `assistant-${msgId}`,
      role: 'assistant',
      content: '',
      thinkingSteps: [],
      isStreaming: true,
      thinkingLevel,
    };

    setMessages(prev => [...prev, userMsg, assistantMsg]);
    setInput('');
    setFiles([]);
    setIsProcessing(true);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      // Prepare files for API
      const apiFiles = userFiles.map(f => ({
        name: f.name,
        base64: f.base64 || '',
      }));

      const response = await fetch('/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: userMessage,
          files: apiFiles,
          thinkingLevel,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errText = await response.text().catch(() => 'Unknown error');
        throw new Error(errText);
      }

      // Process SSE stream
      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response body');

      const decoder = new TextDecoder();
      let buffer = '';
      let accumulatedText = '';
      let currentThinkingStep: ThinkingStep | null = null;
      const allThinkingSteps: ThinkingStep[] = [];

      const updateAssistant = (updates: Partial<ChatMessage>) => {
        setMessages(prev => prev.map(m =>
          m.id === `assistant-${msgId}` ? { ...m, ...updates } : m
        ));
      };

      const addThinkingStep = (step: ThinkingStep) => {
        allThinkingSteps.push(step);
        updateAssistant({ thinkingSteps: [...allThinkingSteps] });
      };

      const updateLastThinkingStep = (updates: Partial<ThinkingStep>) => {
        if (allThinkingSteps.length > 0) {
          Object.assign(allThinkingSteps[allThinkingSteps.length - 1], updates);
          updateAssistant({ thinkingSteps: [...allThinkingSteps] });
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6);
          if (!data) continue;

          try {
            const event = JSON.parse(data);

            switch (event.type) {
              case 'ping':
                break;

              case 'thinking_start': {
                if (currentThinkingStep) {
                  // Close previous step
                }
                currentThinkingStep = {
                  id: `step-${Date.now()}-${Math.random()}`,
                  title: event.content || '생각 중...',
                  content: '',
                  expanded: false,
                  type: 'thinking',
                };
                addThinkingStep(currentThinkingStep);
                break;
              }

              case 'thinking_content': {
                if (currentThinkingStep) {
                  currentThinkingStep.content += (event.content || '') + '\n';
                  currentThinkingStep.title = currentThinkingStep.content.split('\n')[0].slice(0, 80);
                  updateLastThinkingStep({});
                }
                break;
              }

              case 'thinking_end': {
                currentThinkingStep = null;
                break;
              }

              case 'tool_call': {
                currentThinkingStep = {
                  id: `tool-${Date.now()}-${Math.random()}`,
                  title: `도구 호출: ${event.tool}`,
                  content: '',
                  expanded: false,
                  type: 'tool_call',
                  toolName: event.tool,
                  toolArgs: event.arguments,
                };
                addThinkingStep(currentThinkingStep);
                break;
              }

              case 'tool_output': {
                if (currentThinkingStep && currentThinkingStep.type === 'tool_call') {
                  currentThinkingStep.toolOutput = event.output;
                  currentThinkingStep.toolSuccess = event.success;
                  currentThinkingStep.type = 'tool_output';
                  currentThinkingStep.title = `결과: ${event.tool}`;
                  updateLastThinkingStep({});
                }
                currentThinkingStep = null;
                break;
              }

              case 'text_chunk': {
                accumulatedText += event.content || '';
                updateAssistant({ content: accumulatedText });
                break;
              }

              case 'file_download': {
                const downloads = messages.find(m => m.id === `assistant-${msgId}`)?.fileDownloads || [];
                downloads.push({ path: event.path, filename: event.filename });
                updateAssistant({ fileDownloads: downloads });
                break;
              }

              case 'error_message': {
                accumulatedText += `\n\n⚠️ 오류: ${event.content}`;
                updateAssistant({ content: accumulatedText });
                break;
              }

              case 'done': {
                if (event.content) {
                  accumulatedText = event.content;
                  updateAssistant({ content: accumulatedText });
                }
                break;
              }
            }
          } catch {}
        }
      }

      updateAssistant({ isStreaming: false });
    } catch (e) {
      const err = e as Error;
      if (err.name !== 'AbortError') {
        updateAssistant({
          content: `⚠️ 오류가 발생했습니다: ${err.message}`,
          isStreaming: false,
        });
      } else {
        updateAssistant({ isStreaming: false });
      }
    } finally {
      setIsProcessing(false);
      abortRef.current = null;
    }
  }, [input, files, isProcessing, thinkingLevel, messages]);

  // Stop processing
  const stopProcessing = useCallback(() => {
    abortRef.current?.abort();
    setIsProcessing(false);
  }, []);

  // Clear chat
  const clearChat = useCallback(() => {
    setMessages([]);
    setFiles([]);
  }, []);

  return (
    <div className="h-screen flex flex-col" onDrop={handleDrop} onDragOver={handleDragOver}>
      {/* Header */}
      <header className={`flex items-center justify-between px-4 py-3 border-b flex-shrink-0 ${
        isDark ? 'bg-gray-900/80 border-gray-800' : 'bg-white border-gray-200'
      }`}>
        <div className="flex items-center gap-3">
          <h1 className={`text-lg font-bold ${isDark ? 'text-white' : 'text-gray-900'}`}>
            PIXAL 2.0
          </h1>
          <span className={`text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
            by 정성윤
          </span>
        </div>
        <div className="flex items-center gap-3">
          <ThinkingLevelDropdown
            value={thinkingLevel}
            onChange={setThinkingLevel}
            isDark={isDark}
          />
          <DeployButtons
            templateSlug="pixal2-agent"
            githubUrl="https://github.com/a50411278apeter40-svg/ai"
            lang={locale === 'zh' ? 'zh' : 'en'}
          />
        </div>
      </header>

      {/* Chat Area */}
      <div className="flex-1 overflow-y-auto px-4 py-6 space-y-6">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center space-y-4">
            <div className="text-6xl">🤖</div>
            <h2 className={`text-2xl font-bold ${isDark ? 'text-white' : 'text-gray-900'}`}>
              PIXAL 2.0
            </h2>
            <p className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'} max-w-md`}>
              무엇이든 물어보세요. 이미지, 비디오, 오디오 파일을 업로드하여 함께 질문할 수 있습니다.
            </p>
            <div className={`flex flex-wrap gap-2 justify-center max-w-lg`}>
              {[
                { label: '📊 데이터 분석', msg: 'CSV 파일을 분석해줘' },
                { label: '🖼️ 이미지 처리', msg: '이미지를 PNG로 변환해줘' },
                { label: '🎵 오디오 전사', msg: '오디오 파일을 텍스트로 변환해줘' },
                { label: '🎬 비디오 분석', msg: '비디오에서 프레임을 추출해줘' },
                { label: '📄 PDF 생성', msg: '보고서 PDF를 만들어줘' },
                { label: '🐍 Python 실행', msg: 'Python 코드를 실행해줘' },
              ].map((s, i) => (
                <button
                  key={i}
                  onClick={() => setInput(s.msg)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    isDark ? 'bg-gray-800 hover:bg-gray-700 text-gray-300' : 'bg-gray-100 hover:bg-gray-200 text-gray-700'
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map(msg => (
          <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-3xl w-full ${msg.role === 'user' ? 'ml-auto' : 'mr-auto'}`}>
              {/* User message */}
              {msg.role === 'user' && (
                <div className={`rounded-2xl px-4 py-3 ${
                  isDark ? 'bg-blue-600 text-white' : 'bg-blue-500 text-white'
                }`}>
                  {msg.content && <p className="text-sm mb-2">{msg.content}</p>}
                  {msg.files && msg.files.length > 0 && (
                    <div className="flex flex-wrap gap-2 mt-2">
                      {msg.files.map(f => (
                        <div key={f.id} className={`flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs ${
                          isDark ? 'bg-blue-500/50' : 'bg-blue-400/30'
                        }`}>
                          <span>{getFileIcon(f.type)}</span>
                          <span>{f.name}</span>
                          <span className="opacity-60">{f.size}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Assistant message */}
              {msg.role === 'assistant' && (
                <div className="space-y-3">
                  {/* Thinking steps (accordion) */}
                  {msg.thinkingSteps.length > 0 && (
                    <ThinkingSection
                      steps={msg.thinkingSteps}
                      isLive={msg.isStreaming}
                      isDark={isDark}
                      title="생각 과정"
                    />
                  )}

                  {/* Response text */}
                  {msg.content && (
                    <div className={`rounded-2xl px-4 py-3 ${isDark ? 'bg-gray-800/50' : 'bg-gray-50'}`}>
                      <div className="relative">
                        <MarkdownBlock content={msg.content} />
                        {msg.isStreaming && (
                          <span className="inline-block w-1.5 h-4 ml-0.5 align-middle rounded-sm bg-current opacity-60 animate-pulse" />
                        )}
                      </div>
                    </div>
                  )}

                  {/* File downloads */}
                  {msg.fileDownloads && msg.fileDownloads.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {msg.fileDownloads.map((fd, i) => (
                        <a
                          key={i}
                          href={`/file?path=${encodeURIComponent(fd.path)}`}
                          download={fd.filename}
                          className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors ${
                            isDark ? 'bg-green-900/30 hover:bg-green-900/50 text-green-300 border border-green-800/40' : 'bg-green-50 hover:bg-green-100 text-green-700 border border-green-200'
                          }`}
                        >
                          <span>📥</span>
                          <span>{fd.filename}</span>
                        </a>
                      ))}
                    </div>
                  )}

                  {/* Loading state with no content yet */}
                  {msg.isStreaming && !msg.content && msg.thinkingSteps.length === 0 && (
                    <div className="flex items-center gap-2">
                      <span className="w-4 h-4 rounded-full border-2 border-blue-400 border-t-transparent animate-spin" />
                      <span className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>대기 중...</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* File Preview Area */}
      {files.length > 0 && (
        <div className={`px-4 py-2 border-t flex flex-wrap gap-2 ${isDark ? 'border-gray-800' : 'border-gray-200'}`}>
          {files.map(f => (
            <div
              key={f.id}
              className={`relative group flex items-center gap-2 px-3 py-2 rounded-lg text-xs ${
                isDark ? 'bg-gray-800 border border-gray-700' : 'bg-gray-100 border border-gray-200'
              }`}
            >
              {f.preview && f.type === 'image' ? (
                <img src={f.preview} alt={f.name} className="w-8 h-8 object-cover rounded" />
              ) : (
                <span className="text-lg">{getFileIcon(f.type)}</span>
              )}
              <div>
                <div className={`font-medium ${isDark ? 'text-gray-200' : 'text-gray-700'}`}>{f.name}</div>
                <div className={`text-[10px] ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>{f.size}</div>
              </div>
              <button
                onClick={() => removeFile(f.id)}
                className={`ml-1 w-5 h-5 flex items-center justify-center rounded-full transition-colors ${
                  isDark ? 'hover:bg-gray-700 text-gray-400' : 'hover:bg-gray-200 text-gray-500'
                }`}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Input Area */}
      <div className={`px-4 py-3 border-t flex-shrink-0 ${isDark ? 'bg-gray-900/80 border-gray-800' : 'bg-white border-gray-200'}`}>
        <div className="flex items-end gap-2">
          {/* File upload button */}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.md,.json,.xml,.html,.py,.js,.ts,.css"
            className="hidden"
            onChange={e => {
              handleFileSelect(e.target.files);
              e.target.value = '';
            }}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            className={`flex-shrink-0 w-10 h-10 rounded-xl flex items-center justify-center transition-colors ${
              isDark ? 'bg-gray-800 hover:bg-gray-700 text-gray-300' : 'bg-gray-100 hover:bg-gray-200 text-gray-700'
            }`}
            title="파일 업로드 (이미지, 비디오, 오디오, 문서)"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 100 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
            </svg>
          </button>

          {/* Text input */}
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
              }
            }}
            placeholder="메시지를 입력하거나 파일을 첨부하세요... (Enter로 전송, Shift+Enter로 줄바꿈)"
            rows={1}
            className={`flex-1 resize-none rounded-xl px-4 py-2.5 text-sm outline-none transition-colors max-h-32 ${
              isDark
                ? 'bg-gray-800 text-gray-100 placeholder-gray-500 focus:ring-2 focus:ring-blue-500'
                : 'bg-gray-100 text-gray-900 placeholder-gray-400 focus:ring-2 focus:ring-blue-400'
            }`}
            style={{ minHeight: '40px' }}
          />

          {/* Send/Stop button */}
          {isProcessing ? (
            <button
              onClick={stopProcessing}
              className="flex-shrink-0 w-10 h-10 rounded-xl bg-red-600 hover:bg-red-700 text-white flex items-center justify-center transition-colors"
              title="중지"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" />
              </svg>
            </button>
          ) : (
            <button
              onClick={sendMessage}
              disabled={!input.trim() && files.length === 0}
              className="flex-shrink-0 w-10 h-10 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed text-white flex items-center justify-center transition-colors"
              title="전송"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
              </svg>
            </button>
          )}

          {/* Clear button */}
          {messages.length > 0 && !isProcessing && (
            <button
              onClick={clearChat}
              className={`flex-shrink-0 w-10 h-10 rounded-xl flex items-center justify-center transition-colors ${
                isDark ? 'bg-gray-800 hover:bg-gray-700 text-gray-400' : 'bg-gray-100 hover:bg-gray-200 text-gray-500'
              }`}
              title="대화 지우기"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M1 7h22M9 7V4a1 1 0 011-1h4a1 1 0 011 1v3" />
              </svg>
            </button>
          )}
        </div>
        <p className={`text-[10px] mt-1.5 ${isDark ? 'text-gray-600' : 'text-gray-400'}`}>
          이미지 · 비디오 · 오디오 · PDF · 문서 — 모든 파일을 텍스트와 함께 제출 가능
        </p>
      </div>
    </div>
  );
}
