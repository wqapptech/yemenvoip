'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { fbAuth } from '@/lib/firebase';
import { useI18n } from '@/lib/i18n';

export default function LoginPage() {
  const { t, lang, toggle } = useI18n();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(false);
    try {
      await signInWithEmailAndPassword(fbAuth(), email.trim(), pw);
      router.replace('/dashboard');
    } catch { setErr(true); } finally { setBusy(false); }
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <form onSubmit={submit} className="w-full max-w-sm rounded-3xl bg-white p-7 shadow-xl">
        <div className="mb-7 flex items-center justify-between">
          <h1 className="text-2xl font-extrabold">{t('appName')}</h1>
          <button type="button" onClick={toggle} className="rounded-full border border-slate-200 px-3 py-1 text-sm font-semibold">
            {lang === 'ar' ? 'EN' : 'ع'}
          </button>
        </div>
        <label className="mb-1 block text-sm font-medium text-slate-600">{t('email')}</label>
        <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} dir="ltr"
          className="mb-4 w-full rounded-2xl border border-slate-300 px-4 py-3 text-base outline-none focus:border-slate-900" />
        <label className="mb-1 block text-sm font-medium text-slate-600">{t('password')}</label>
        <input type="password" required value={pw} onChange={(e) => setPw(e.target.value)} dir="ltr"
          className="mb-4 w-full rounded-2xl border border-slate-300 px-4 py-3 text-base outline-none focus:border-slate-900" />
        {err && <p className="mb-3 text-sm font-medium text-rose-600">{t('signInError')}</p>}
        <button disabled={busy}
          className="w-full rounded-2xl bg-slate-900 py-3 text-base font-bold text-white transition active:scale-[0.99] disabled:opacity-60">
          {busy ? t('signingIn') : t('signIn')}
        </button>
      </form>
    </main>
  );
}
