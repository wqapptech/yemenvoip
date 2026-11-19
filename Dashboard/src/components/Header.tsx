'use client';
import Link from 'next/link';
import { signOut } from 'firebase/auth';
import { useRouter, usePathname } from 'next/navigation';
import { fbAuth } from '@/lib/firebase';
import { useI18n } from '@/lib/i18n';

export default function Header() {
  const { t, lang, toggle } = useI18n();
  const router = useRouter();
  const path = usePathname();

  const tab = (href: string, label: string) => {
    const active = path === href;
    return (
      <Link
        href={href}
        className={
          'rounded-full px-3 py-1 text-sm font-semibold transition ' +
          (active ? 'bg-slate-800 text-white' : 'text-slate-600 hover:bg-slate-100')
        }
      >
        {label}
      </Link>
    );
  };

  return (
    <header className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-slate-200 bg-white px-4 py-3">
      <div className="flex items-center gap-3">
        <h1 className="text-lg font-extrabold">{t('appName')}</h1>
        <nav className="flex items-center gap-1">
          {tab('/dashboard', t('navSims'))}
          {tab('/calls', t('navCalls'))}
        </nav>
      </div>
      <div className="flex items-center gap-2">
        <button onClick={toggle} className="rounded-full border border-slate-200 px-3 py-1 text-sm font-semibold">
          {lang === 'ar' ? 'EN' : 'ع'}
        </button>
        <button
          onClick={async () => { await signOut(fbAuth()); router.replace('/login'); }}
          className="rounded-full bg-slate-100 px-3 py-1 text-sm font-semibold text-slate-700"
        >
          {t('logout')}
        </button>
      </div>
    </header>
  );
}
