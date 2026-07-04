'use client';

import { createContext, useContext, useState, ReactNode } from 'react';

type Locale = 'ko' | 'en' | 'zh';

export const translations = {
  ko: {
    title: 'PIXAL 2.0',
    description: '정성윤이 만든 AI — 무엇이든 할 수 있습니다',
    dropFiles: '파일을 드롭하거나 클릭하여 업로드',
    process: '전송',
    clear: '지우기',
    processing: '처리 중...',
    supportedTypes: '이미지, 비디오, 오디오, PDF, 문서 지원',
    thinkingLevel: '사고 수준',
    low: '낮음',
    medium: '보통',
    high: '높음',
    max: '최대',
    thinking: '생각 과정',
    steps: '단계',
    expandAll: '모두 펼치기',
    collapseAll: '모두 접기',
    uploadFile: '파일 업로드',
    sendMessage: '전송',
    stop: '중지',
    typeMessage: '메시지를 입력하거나 파일을 첨부하세요...',
    enterToSend: 'Enter로 전송, Shift+Enter로 줄바꿈',
    fileQueue: '파일 목록',
    noFiles: '첨부된 파일이 없습니다',
    taskComplete: '완료',
    preparingEnv: '환경 준비 중...',
    analyzingFiles: '파일 분석 중...',
    multimodal: '멀티모달',
    image: '이미지',
    video: '비디오',
    audio: '오디오',
  },
  en: {
    title: 'PIXAL 2.0',
    description: 'AI by 정성윤 — can do anything',
    dropFiles: 'Drop files or click to upload',
    process: 'Send',
    clear: 'Clear',
    processing: 'Processing...',
    supportedTypes: 'Supports image, video, audio, PDF, documents',
    thinkingLevel: 'Thinking Level',
    low: 'Low',
    medium: 'Medium',
    high: 'High',
    max: 'Max',
    thinking: 'Thinking Process',
    steps: 'steps',
    expandAll: 'Expand All',
    collapseAll: 'Collapse All',
    uploadFile: 'Upload File',
    sendMessage: 'Send',
    stop: 'Stop',
    typeMessage: 'Type a message or attach files...',
    enterToSend: 'Enter to send, Shift+Enter for newline',
    fileQueue: 'File Queue',
    noFiles: 'No files attached',
    taskComplete: 'Done',
    preparingEnv: 'Preparing environment...',
    analyzingFiles: 'Analyzing files...',
    multimodal: 'Multimodal',
    image: 'Image',
    video: 'Video',
    audio: 'Audio',
  },
  zh: {
    title: 'PIXAL 2.0',
    description: '정성윤制作的AI — 无所不能',
    dropFiles: '拖放文件或点击上传',
    process: '发送',
    clear: '清除',
    processing: '处理中...',
    supportedTypes: '支持图片、视频、音频、PDF、文档',
    thinkingLevel: '思考级别',
    low: '低',
    medium: '中',
    high: '高',
    max: '最大',
    thinking: '思考过程',
    steps: '步骤',
    expandAll: '全部展开',
    collapseAll: '全部折叠',
    uploadFile: '上传文件',
    sendMessage: '发送',
    stop: '停止',
    typeMessage: '输入消息或附加文件...',
    enterToSend: 'Enter发送，Shift+Enter换行',
    fileQueue: '文件队列',
    noFiles: '没有附加文件',
    taskComplete: '完成',
    preparingEnv: '准备环境...',
    analyzingFiles: '分析文件...',
    multimodal: '多模态',
    image: '图片',
    video: '视频',
    audio: '音频',
  },
};

interface I18nContextType {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: typeof translations.ko;
}

const I18nContext = createContext<I18nContextType>({
  locale: 'ko',
  setLocale: () => {},
  t: translations.ko,
});

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState<Locale>('ko');
  const t = translations[locale];
  return (
    <I18nContext.Provider value={{ locale, setLocale, t }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n() {
  return useContext(I18nContext);
}
