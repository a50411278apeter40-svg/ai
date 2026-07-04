'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const router = useRouter();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!identifier.trim() || !password) {
      setError('이메일(또는 사용자명)과 비밀번호를 입력해주세요.');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: identifier.trim(), password }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || '로그인에 실패했습니다.');
        setLoading(false);
        return;
      }

      localStorage.setItem('pixal_user', JSON.stringify(data.user));
      router.push('/');
    } catch (e) {
      setError('네트워크 오류가 발생했습니다. 다시 시도해주세요.');
      setLoading(false);
    }
  };

  return (
    <div className="h-screen flex items-center justify-center bg-gray-950 px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center space-y-2">
          <div className="text-4xl">🤖</div>
          <h1 className="text-2xl font-bold text-white">PIXAL 2.0</h1>
          <p className="text-sm text-gray-400">로그인하고 대화 기록을 자동으로 저장하세요</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 bg-gray-900 border border-gray-800 rounded-2xl p-6">
          {error && (
            <div className="text-sm text-red-400 bg-red-950/40 border border-red-900/50 rounded-lg px-3 py-2">
              {error}
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1.5">이메일 또는 사용자명</label>
            <input
              type="text"
              value={identifier}
              onChange={e => setIdentifier(e.target.value)}
              placeholder="you@example.com"
              className="w-full px-3 py-2.5 rounded-lg bg-gray-800 text-gray-100 placeholder-gray-500 outline-none focus:ring-2 focus:ring-blue-500 text-sm"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1.5">비밀번호</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full px-3 py-2.5 rounded-lg bg-gray-800 text-gray-100 placeholder-gray-500 outline-none focus:ring-2 focus:ring-blue-500 text-sm"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium transition-colors"
          >
            {loading ? '로그인 중...' : '로그인'}
          </button>

          <p className="text-center text-xs text-gray-500">
            계정이 없으신가요?{' '}
            <Link href="/signup" className="text-blue-400 hover:text-blue-300 font-medium">
              회원가입
            </Link>
          </p>
        </form>

        <div className="text-center">
          <Link href="/" className="text-xs text-gray-500 hover:text-gray-400">
            ← 로그인 없이 계속하기
          </Link>
        </div>
      </div>
    </div>
  );
}
