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
- 👤 **로그인 / 회원가입**: 이메일·사용자명·비밀번호·이름을 저장 (실제 인증 없음, 단순 저장/조회)
- 💾 **대화 기록 자동 저장**: 로그인한 사용자에 한해 모든 대화(생각 과정 + 도구 호출/결과 포함)를 실시간으로 자동 저장

## 배포 (Tencent Cloud / EdgeOne Makers)

1. [console.cloud.tencent.com/edgeone](https://console.cloud.tencent.com/edgeone) 접속
2. EdgeOne Makers에서 새 프로젝트 생성 후 이 GitHub 리포지토리 연결
3. **환경 변수 설정** (프로젝트 설정 → 환경 변수):
   - `HUGGING_FACE_HUB_TOKEN`: HuggingFace API 토큰 (필수)
   - `HF_LOCAL_MODE` (선택): `true`로 설정 시 샌드박스에서 모델 직접 다운로드 후 실행
4. **로그인/회원가입 기능을 쓰려면 KV Storage를 반드시 설정해야 합니다** (아래 참고)
5. 배포(Deploy) 실행

### KV Storage 설정 (회원가입/로그인에 필수)

로그인·회원가입 기능은 EdgeOne Makers의 **KV Storage**에 사용자 정보(이메일, 사용자명, 비밀번호, 이름)를 저장합니다. 콘솔에서 아래 순서로 한 번 설정해야 합니다:

1. EdgeOne Makers 콘솔 → **Storage(스토리지) → KV** 메뉴로 이동
2. KV 계정이 없다면 "Apply Now(신청)" 클릭 (무료 1GB 제공)
3. **네임스페이스 생성** (예: `pixal_users`)
4. 프로젝트 상세 페이지 → **KV Storage** 메뉴에서 방금 만든 네임스페이스를 **바인딩**
   - ⚠️ 바인딩할 때 변수명(Variable Name)은 반드시 **`my_kv`** 로 지정해야 합니다 (코드에서 이 이름으로 참조함)
5. 바인딩 후 프로젝트를 다시 배포(Deploy)

설정하지 않으면 회원가입/로그인 API가 "KV storage가 바인딩되지 않았습니다" 에러를 반환합니다. (채팅 자체는 로그인 없이도 정상 동작합니다.)

### 대화 기록 저장 확인

로그인한 사용자의 대화 기록은 EdgeOne Makers의 **Conversation Storage** (`context.store`, 별도 설정 불필요)에 자동으로 저장됩니다. 저장된 기록은 다음 API로 조회할 수 있습니다:

- `GET /history?userId=<사용자ID>` — 대화 목록 조회
- `GET /history?userId=<사용자ID>&conversationId=<대화ID>` — 특정 대화의 전체 메시지(생각 과정 + 도구 호출/결과 포함) 조회

## 환경 변수

| 변수 | 필수 | 설명 |
|------|------|------|
| `HUGGING_FACE_HUB_TOKEN` | 예 | HuggingFace API 토큰 |
| `HF_LOCAL_MODE` | 아니오 | `true` 시 로컬 모델 모드 (직접 다운로드) |

## 보안 관련 안내 ⚠️

로그인/회원가입 기능은 **요구사항에 따라 실제 인증(비밀번호 해싱, JWT, 세션 등)을 구현하지 않았습니다.** 비밀번호는 KV에 평문으로 저장되고, 로그인은 단순 문자열 비교만 수행합니다. 이는 학습/개인용 프로젝트에 적합한 수준이며, 실제 서비스에 배포할 경우 반드시 비밀번호 해싱과 안전한 인증 체계를 추가해야 합니다.

## 기술 스택

- **Frontend**: Next.js 16, React 19, Tailwind CSS
- **Backend**: EdgeOne Makers Functions (Agents / Cloud Functions / Edge Functions)
- **AI Model**: HuggingFace google/gemma-4-E2B-it-assistant
- **Sandbox**: Python (transformers, PIL, OpenCV, librosa, whisper, pandas, matplotlib)
- **Storage**: EdgeOne Makers Conversation Storage (대화 기록) + KV Storage (사용자 계정)

## 만든 사람

**정성윤** — 중학교 1학년 파이썬 프로그래머
