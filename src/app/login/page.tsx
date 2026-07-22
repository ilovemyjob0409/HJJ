'use client';

import { useState } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Card from '@/components/ui/Card';
import Logo from '@/components/ui/Logo';
import ThemeToggle from '@/components/ui/ThemeToggle';
import { useToast } from '@/components/ui/Toast';

export default function LoginPage() {
  const router = useRouter();
  const { showToast } = useToast();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    const result = await signIn('credentials', { email, password, redirect: false });
    if (result?.error) {
      setError('帳號或密碼錯誤');
      return;
    }
    showToast('登入成功');
    router.push('/');
  }

  return (
    <div className="relative flex min-h-screen flex-col md:flex-row">
      <div className="absolute right-3 top-3 z-10 sm:right-6 sm:top-6">
        <ThemeToggle />
      </div>
      <div className="hidden flex-1 flex-col items-center justify-center gap-2 bg-cream p-10 text-center md:flex">
        <Logo className="w-48" />
        <p className="text-sm text-inkMuted">一站式請假／補課／調課平台</p>
      </div>
      <div className="flex flex-1 items-center justify-center bg-cream p-6 md:bg-card md:p-10">
        <Card className="w-full max-w-sm md:shadow-none">
          <Logo className="mb-4 h-8 w-auto md:hidden" />
          <h2 className="mb-4 hidden text-lg font-bold text-ink md:block">登入</h2>
          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            <Input type="text" placeholder="帳號" value={email} onChange={(e) => setEmail(e.target.value)} required />
            <Input type="password" placeholder="密碼" value={password} onChange={(e) => setPassword(e.target.value)} required />
            {error && <p className="text-sm text-rejected">{error}</p>}
            <Button type="submit" className="w-full">
              登入
            </Button>
          </form>
        </Card>
      </div>
    </div>
  );
}
