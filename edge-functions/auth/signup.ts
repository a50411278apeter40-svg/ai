/**
 * PIXAL2.0 — 회원가입 (Sign Up)
 * =============================
 * File path: edge-functions/auth/signup.ts → maps to POST /auth/signup
 *
 * 요구사항에 따라 별도의 인증(비밀번호 해싱, JWT, 세션 등)은 구현하지 않는다.
 * 이메일, 사용자명, 비밀번호, 이름을 KV 저장소에 그대로 저장한다.
 *
 * ⚠️ 이 프로젝트는 학습/개인용 목적의 간단한 구현입니다.
 *    실제 서비스라면 반드시 비밀번호 해싱(bcrypt 등)과 실제 인증을 추가해야 합니다.
 *
 * KV 네임스페이스를 EdgeOne Makers 콘솔에서 생성한 뒤, 이 프로젝트에
 * 변수명 "my_kv" 로 바인딩해야 합니다. (README 참고)
 */

interface SignupBody {
  email?: string;
  username?: string;
  password?: string;
  name?: string;
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=UTF-8' },
  });
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export async function onRequestPost(context: any) {
  const kv = context.env?.my_kv;

  if (!kv) {
    return jsonResponse(
      {
        error:
          'KV storage(my_kv)가 바인딩되지 않았습니다. EdgeOne Makers 콘솔에서 KV 네임스페이스를 만들고 프로젝트에 "my_kv"로 바인딩한 뒤 다시 배포하세요.',
      },
      500
    );
  }

  let body: SignupBody = {};
  try {
    body = await context.request.json();
  } catch {
    return jsonResponse({ error: "요청 본문(JSON)을 읽을 수 없습니다." }, 400);
  }
  const email = (body.email ?? '').trim().toLowerCase();
  const username = (body.username ?? '').trim();
  const password = body.password ?? '';
  const name = (body.name ?? '').trim();

  if (!email || !username || !password || !name) {
    return jsonResponse({ error: '이메일, 사용자명, 비밀번호, 이름을 모두 입력해주세요.' }, 400);
  }
  if (!isValidEmail(email)) {
    return jsonResponse({ error: '올바른 이메일 형식이 아닙니다.' }, 400);
  }
  if (username.length < 2 || username.length > 32) {
    return jsonResponse({ error: '사용자명은 2~32자여야 합니다.' }, 400);
  }
  if (password.length < 4) {
    return jsonResponse({ error: '비밀번호는 최소 4자 이상이어야 합니다.' }, 400);
  }

  try {
    // 중복 확인
    const existingByEmail = await kv.get(`user_email:${email}`);
    if (existingByEmail) {
      return jsonResponse({ error: '이미 가입된 이메일입니다.' }, 409);
    }
    const existingByUsername = await kv.get(`user_username:${username.toLowerCase()}`);
    if (existingByUsername) {
      return jsonResponse({ error: '이미 사용 중인 사용자명입니다.' }, 409);
    }

    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();

    const userRecord = { id, email, username, password, name, createdAt };

    await kv.put(`user:${id}`, JSON.stringify(userRecord));
    await kv.put(`user_email:${email}`, id);
    await kv.put(`user_username:${username.toLowerCase()}`, id);

    // 비밀번호는 응답에 포함하지 않음
    const { password: _pw, ...safeUser } = userRecord;
    return jsonResponse({ user: safeUser }, 201);
  } catch (e) {
    return jsonResponse({ error: `회원가입 처리 중 오류: ${(e as Error).message}` }, 500);
  }
}
