'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

export default function SignupPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!email.trim() || !username.trim() || !password || !name.trim()) {
      setError('모든 항목을 입력해주세요.');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim(),
          username: username.trim(),
          password,
          name: name.trim(),
        }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || '회원가입에 실패했습니다.');
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
    <div className="h-screen flex items-center justify-center bg-gray-950 px-4 overflow-y-auto py-8">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center space-y-2">
          <div className="text-4xl">🤖</div>
          <h1 className="text-2xl font-bold text-white">PIXAL 2.0 회원가입</h1>
          <p className="text-sm text-gray-400">정성윤이 만든 AI와 함께하세요</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 bg-gray-900 border border-gray-800 rounded-2xl p-6">
          {error && (
            <div className="text-sm text-red-400 bg-red-950/40 border border-red-900/50 rounded-lg px-3 py-2">
              {error}
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1.5">이름</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="홍길동"
              className="w-full px-3 py-2.5 rounded-lg bg-gray-800 text-gray-100 placeholder-gray-500 outline-none focus:ring-2 focus:ring-blue-500 text-sm"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1.5">이메일</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="w-full px-3 py-2.5 rounded-lg bg-gray-800 text-gray-100 placeholder-gray-500 outline-none focus:ring-2 focus:ring-blue-500 text-sm"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1.5">사용자명</label>
            <input
              type="text"
              value={username}
              onChange={e => setUsername(e.target.value)}
              placeholder="pixal_user"
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
            {loading ? '가입 중...' : '회원가입'}
          </button>

          <p className="text-center text-xs text-gray-500">
            이미 계정이 있으신가요?{' '}
            <Link href="/login" className="text-blue-400 hover:text-blue-300 font-medium">
              로그인
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
