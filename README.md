# PIXAL 2.0

PIXAL 2.0 — 정성윤이 만든 AI 에이전트

HuggingFace `google/gemma-4-E2B-it-assistant` 모델을 직접 사용하는 멀티모달 AI 에이전트입니다.

## 기능

- 🧠 **사고 수준 조절**: 낮음/보통/높음/최대 드롭다운으로 AI의 생각 깊이 조절
- 🎵 **멀티모달**: 이미지, 비디오, 오디오 파일을 텍스트와 함께 제출 (Python 처리)
- 🔧 **14가지 도구**: 코드 실행, 셸, 파일 작업, 이미지/오디오/비디오 처리, 데이터 분석, PDF 생성, QR 코드, 번역, 파일 변환 등
- 📊 **아코디언 사고 과정**: 모든 생각 단계를 펼치기/접기 가능한 아코디언으로 표시
- 📡 **스트리밍 출력**: 모든 응답이 실시간 스트리밍
- 🐍 **Python 샌드박스**: 모든 패키지 설치, 쓰기 가능한 파일 시스템
- 🔗 **HuggingFace 직접 연동**: transformers.js 없이 Python transformers 라이브러리 사용

## 배포 (Tencent Cloud / EdgeOne)

1. [console.cloud.tencent.com/edgeone](https://console.cloud.tencent.com/edgeone) 접속
2. EdgeOne Makers에서 새 프로젝트 생성
3. 이 GitHub 리포지토리 연결
4. 환경 변수 설정:
   - `HUGGING_FACE_HUB_TOKEN`: HuggingFace API 토큰
   - `HF_LOCAL_MODE` (선택): `true`로 설정 시 샌드박스에서 모델 직접 다운로드 후 실행

## 환경 변수

| 변수 | 필수 | 설명 |
|------|------|------|
| `HUGGING_FACE_HUB_TOKEN` | 예 | HuggingFace API 토큰 |
| `HF_LOCAL_MODE` | 아니오 | `true` 시 로컬 모델 모드 (직접 다운로드) |

## 기술 스택

- **Frontend**: Next.js 16, React 19, Tailwind CSS
- **Backend**: EdgeOne Makers Functions (TypeScript)
- **AI Model**: HuggingFace google/gemma-4-E2B-it-assistant
- **Sandbox**: Python (transformers, PIL, OpenCV, librosa, whisper, pandas, matplotlib)

## 만든 사람

**정성윤** — 중학교 1학년 파이썬 프로그래머
