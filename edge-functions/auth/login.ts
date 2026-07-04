/**
 * PIXAL2.0 — 로그인 (Log In)
 * ===========================
 * File path: edge-functions/auth/login.ts → maps to POST /auth/login
 *
 * 별도의 인증 체계(JWT, 세션, 비밀번호 해싱) 없이 KV에 저장된 사용자
 * 레코드와 단순 비교만 수행한다. (요구사항: "인증은 하지말고")
 */

interface LoginBody {
  identifier?: string; // 이메일 또는 사용자명
  password?: string;
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=UTF-8' },
  });
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

  let body: LoginBody = {};
  try {
    body = await context.request.json();
  } catch {
    return jsonResponse({ error: "요청 본문(JSON)을 읽을 수 없습니다." }, 400);
  }
  const identifier = (body.identifier ?? '').trim();
  const password = body.password ?? '';

  if (!identifier || !password) {
    return jsonResponse({ error: '이메일(또는 사용자명)과 비밀번호를 입력해주세요.' }, 400);
  }

  try {
    const isEmail = identifier.includes('@');
    const lookupKey = isEmail
      ? `user_email:${identifier.toLowerCase()}`
      : `user_username:${identifier.toLowerCase()}`;

    const userId = await kv.get(lookupKey);
    if (!userId) {
      return jsonResponse({ error: '존재하지 않는 계정입니다.' }, 401);
    }

    const raw = await kv.get(`user:${userId}`);
    if (!raw) {
      return jsonResponse({ error: '계정 정보를 찾을 수 없습니다.' }, 401);
    }

    const user = JSON.parse(raw);
    if (user.password !== password) {
      return jsonResponse({ error: '비밀번호가 일치하지 않습니다.' }, 401);
    }

    const { password: _pw, ...safeUser } = user;
    return jsonResponse({ user: safeUser }, 200);
  } catch (e) {
    return jsonResponse({ error: `로그인 처리 중 오류: ${(e as Error).message}` }, 500);
  }
}
