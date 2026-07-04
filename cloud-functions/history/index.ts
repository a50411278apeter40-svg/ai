/**
 * PIXAL2.0 — 대화 기록 조회
 * ===========================
 * File path: cloud-functions/history/index.ts → maps to GET /history
 *
 * 로그인한 사용자의 저장된 대화 목록/메시지를 조회한다.
 * cloud-functions/ 에서는 context.agent.store 로 conversation storage에 접근한다.
 *
 * Query params:
 *   - userId (required): 조회할 사용자 ID
 *   - conversationId (optional): 특정 대화의 메시지 조회. 없으면 대화 목록만 반환.
 */

import { createLogger } from '../_logger';

const logger = createLogger('history');

export async function onRequest(context: any) {
  const url = new URL(context.request.url);
  const userId = url.searchParams.get('userId');
  const conversationId = url.searchParams.get('conversationId');

  if (!userId) {
    return new Response(JSON.stringify({ error: 'userId가 필요합니다.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json; charset=UTF-8' },
    });
  }

  const store = context.agent?.store;
  if (!store) {
    return new Response(
      JSON.stringify({ error: '대화 저장소를 사용할 수 없습니다 (context.agent.store 없음).' }),
      { status: 500, headers: { 'Content-Type': 'application/json; charset=UTF-8' } }
    );
  }

  try {
    if (conversationId) {
      // 특정 대화의 메시지 조회
      const messages = await store.getMessages({
        conversationId,
        limit: 200,
        order: 'asc',
      });
      return new Response(JSON.stringify({ conversationId, messages }), {
        status: 200,
        headers: { 'Content-Type': 'application/json; charset=UTF-8' },
      });
    }

    // 사용자의 대화 목록 조회
    const conversations = await store.listConversations({ userId, limit: 50 });
    return new Response(JSON.stringify({ conversations }), {
      status: 200,
      headers: { 'Content-Type': 'application/json; charset=UTF-8' },
    });
  } catch (e) {
    logger.error('history fetch error:', (e as Error).message);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json; charset=UTF-8' },
    });
  }
}
