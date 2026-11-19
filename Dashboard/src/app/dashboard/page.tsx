'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { collection, doc, getDocsFromServer, onSnapshot, query, serverTimestamp, setDoc, where } from 'firebase/firestore';
import { fbDb } from '@/lib/firebase';
import { useAuth } from '../providers';
import { useI18n, type Lang } from '@/lib/i18n';
import { simStatus, isStale, isLowBalance, portOf } from '@/lib/status';
import Header from '@/components/Header';
import SimGrid, { type Sim } from '@/components/SimGrid';
import SimDetail from '@/components/SimDetail';

function portNum(s: Sim): number {
  const p = String(s.port ?? s.id).replace('.', '');
  return parseInt(p, 10) || 0;
}

// Firestore Timestamp (or a plain {seconds}) -> millis.
function toMillis(v: unknown): number | null {
  const o = v as { toMillis?: () => number; seconds?: number } | null;
  if (o && typeof o.toMillis === 'function') return o.toMillis();
  if (o && typeof o.seconds === 'number') return o.seconds * 1000;
  return null;
}

// Relative "how long ago" in the active language.
function agoText(ms: number, now: number, lang: Lang, justNow: string): string {
  const sec = Math.max(0, Math.floor((now - ms) / 1000));
  if (sec < 5) return justNow;
  if (sec < 60) return lang === 'ar' ? `منذ ${sec} ثانية` : `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return lang === 'ar' ? `منذ ${min} دقيقة` : `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return lang === 'ar' ? `منذ ${hr} ساعة` : `${hr}h ago`;
  const d = Math.floor(hr / 24);
  return lang === 'ar' ? `منذ ${d} يوم` : `${d}d ago`;
}

function rows(snap: { docs: { id: string; data: () => Record<string, unknown> }[] }): Sim[] {
  const list = snap.docs.map((d) => ({ id: d.id, ...d.data() })) as Sim[];
  list.sort((a, b) => portNum(a) - portNum(b));
  return list;
}

export default function DashboardPage() {
  const { user, ready } = useAuth();
  const { t, lang } = useI18n();
  const router = useRouter();
  const [sims, setSims] = useState<Sim[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [balReq, setBalReq] = useState(false);
  const [numReq, setNumReq] = useState(false);
  const [minReq, setMinReq] = useState(false);
  const balReqAt = useRef(0);
  const [now, setNow] = useState<number>(() => Date.now());
  const [selected, setSelected] = useState<Sim | null>(null);
  const [showStale, setShowStale] = useState(false);

  // Every physically inserted SIM in the pool (not just the active slot).
  const simsQuery = useMemo(
    () => query(collection(fbDb(), 'sims'), where('inserted', '==', 1)),
    [],
  );

  useEffect(() => { if (ready && !user) router.replace('/login'); }, [ready, user, router]);

  // Live listener — updates automatically whenever the gateway pushes.
  useEffect(() => {
    if (!user) return;
    const unsub = onSnapshot(simsQuery, (snap) => setSims(rows(snap)), () => setSims([]));
    return () => unsub();
  }, [user, simsQuery]);

  // Tick once a second so the "updated X ago" label stays current.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // Force a fresh read straight from the server (bypasses local cache).
  async function doRefresh() {
    if (!user || refreshing) return;
    setRefreshing(true);
    try {
      const snap = await getDocsFromServer(simsQuery);
      setSims(rows(snap));
      setNow(Date.now());
    } catch { /* keep showing last known data */ }
    setRefreshing(false);
  }

  // Ask the gateway (via the VM) to re-query SabaFon balances now. We just write
  // the request; the VM picks it up within ~1 min and the new balances arrive on
  // the next status push, updating the cards live.
  async function requestBalance() {
    if (!user || balReq) return;
    balReqAt.current = Date.now();
    setBalReq(true);
    try {
      await setDoc(doc(fbDb(), 'control', 'balanceRequest'),
        { requestedAt: serverTimestamp(), by: user.uid }, { merge: true });
    } catch { /* ignore */ }
    // Safety: clear the spinner after 90s even if no update arrives.
    setTimeout(() => setBalReq(false), 90000);
  }

  // Ask the VM to send MMN->333 from SIMs that still have no stored number.
  async function requestNumbers() {
    if (!user || numReq) return;
    setNumReq(true);
    try {
      await setDoc(doc(fbDb(), 'control', 'numberRequest'),
        { requestedAt: serverTimestamp(), by: user.uid }, { merge: true });
    } catch { /* ignore */ }
    setTimeout(() => setNumReq(false), 90000);
  }

  // Ask the VM to send *122# from inserted SIMs to refresh remaining bundle minutes.
  async function requestMinutes() {
    if (!user || minReq) return;
    setMinReq(true);
    try {
      await setDoc(doc(fbDb(), 'control', 'minutesRequest'),
        { requestedAt: serverTimestamp(), by: user.uid }, { merge: true });
    } catch { /* ignore */ }
    setTimeout(() => setMinReq(false), 90000);
  }

  // Clear the "checking" state as soon as fresh balances land (any balanceAt
  // at or after the moment we asked).
  useEffect(() => {
    if (!balReq) return;
    for (const s of sims ?? []) {
      const ms = toMillis(s.balanceAt);
      if (ms != null && ms >= balReqAt.current - 3000) { setBalReq(false); return; }
    }
  }, [sims, balReq]);

  const lastUpdatedMs = useMemo(() => {
    let max: number | null = null;
    for (const s of sims ?? []) {
      const ms = toMillis(s.updatedAt);
      if (ms != null && (max == null || ms > max)) max = ms;
    }
    return max;
  }, [sims]);

  // Split live SIMs from ghosts (docs still inserted==1 but no longer pushed —
  // a SIM that was removed or moved slots). Ghosts go stale and are shown apart
  // so the headline count reflects what is physically inserted.
  const { fresh, stale } = useMemo(() => {
    const f: Sim[] = [], g: Sim[] = [];
    for (const s of sims ?? []) (isStale(s.updatedAt, now) ? g : f).push(s);
    return { fresh: f, stale: g };
  }, [sims, now]);

  const stats = useMemo(() => {
    let reg = 0, bad = 0, low = 0;
    const ports = new Set<string>();
    for (const s of fresh) {
      ports.add(portOf(s.port ?? s.id));
      const tone = simStatus(s).tone;
      if (tone === 'ok') reg++;
      else if (tone === 'bad') bad++;
      const bal = s.balance ?? s.bal ?? s.smsBalance;
      if (s.needsRecharge || isLowBalance(bal)) low++;
    }
    return { reg, bad, low, ports: ports.size, sims: fresh.length };
  }, [fresh]);

  if (!ready || !user) {
    return <div className="flex min-h-screen items-center justify-center text-slate-400">{t('loading')}</div>;
  }

  return (
    <div className="min-h-screen">
      <Header />
      <main className="mx-auto max-w-5xl p-4">
        <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <span className="text-xs font-medium text-slate-400">
            {t('updated')}: {lastUpdatedMs ? agoText(lastUpdatedMs, now, lang, t('justNow')) : '—'}
          </span>
          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
            <button
              onClick={requestNumbers}
              disabled={numReq}
              title={t('numberSentHint')}
              className="flex items-center gap-1.5 rounded-full border border-sky-200 bg-sky-50 px-3 py-1.5 text-sm font-semibold text-sky-700 shadow-sm transition active:scale-95 disabled:opacity-60"
            >
              <svg className={'h-4 w-4 ' + (numReq ? 'animate-pulse' : '')} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="7" y="2" width="10" height="20" rx="2" /><path d="M11 18h2" />
              </svg>
              {numReq ? t('fetchingNumbers') : t('fetchNumbers')}
            </button>
            <button
              onClick={requestMinutes}
              disabled={minReq}
              title={t('minutesSentHint')}
              className="flex items-center gap-1.5 rounded-full border border-teal-200 bg-teal-50 px-3 py-1.5 text-sm font-semibold text-teal-700 shadow-sm transition active:scale-95 disabled:opacity-60"
            >
              <svg className={'h-4 w-4 ' + (minReq ? 'animate-pulse' : '')} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="9" /><path d="M12 8v4l2 1" />
              </svg>
              {minReq ? t('fetchingMinutes') : t('fetchMinutes')}
            </button>
            <button
              onClick={requestBalance}
              disabled={balReq}
              title={t('balanceSentHint')}
              className="flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-3 py-1.5 text-sm font-semibold text-amber-700 shadow-sm transition active:scale-95 disabled:opacity-60"
            >
              <svg
                className={'h-4 w-4 ' + (balReq ? 'animate-spin' : '')}
                viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
              >
                <circle cx="12" cy="12" r="9" />
                <path d="M12 7v5l3 2" />
              </svg>
              {balReq ? t('balanceRequested') : t('refreshBalance')}
            </button>
            <button
              onClick={doRefresh}
              disabled={refreshing}
              className="flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 shadow-sm transition active:scale-95 disabled:opacity-50"
            >
              <svg
                className={'h-4 w-4 ' + (refreshing ? 'animate-spin' : '')}
                viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
              >
                <path d="M21 12a9 9 0 1 1-2.64-6.36" />
                <path d="M21 3v6h-6" />
              </svg>
              {refreshing ? t('refreshing') : t('refresh')}
            </button>
          </div>
        </div>
        {balReq && (
          <p className="mb-3 -mt-1 text-xs font-medium text-amber-600">{t('balanceSentHint')}</p>
        )}
        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label={t('ports')} value={stats.ports} tone="text-slate-800" sub={`${stats.sims} ${t('sims')}`} />
          <Stat label={t('registered')} value={stats.reg} tone="text-emerald-600" />
          <Stat label={t('problems')} value={stats.bad} tone="text-rose-600" />
          <Stat label={t('lowBalance')} value={stats.low} tone="text-amber-600" />
        </div>
        {sims === null ? (
          <p className="py-16 text-center text-slate-400">{t('loading')}</p>
        ) : fresh.length === 0 && stale.length === 0 ? (
          <p className="py-16 text-center text-slate-400">{t('noData')}</p>
        ) : (
          <>
            <SimGrid sims={fresh} onSelect={setSelected} />
            {stale.length > 0 && (
              <div className="mt-6">
                <button
                  onClick={() => setShowStale((v) => !v)}
                  className="flex w-full items-center justify-between gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-500"
                >
                  <span>{showStale ? '▾' : '▸'} {stale.length} {t('stale')}</span>
                  <span className="text-xs font-normal text-slate-400">{t('staleNote')}</span>
                </button>
                {showStale && (
                  <div className="mt-3">
                    <SimGrid sims={stale} onSelect={setSelected} />
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </main>
      <SimDetail
        sim={selected ? (sims?.find((x) => x.id === selected.id) ?? selected) : null}
        onClose={() => setSelected(null)}
      />
    </div>
  );
}

function Stat({ label, value, tone, sub }: { label: string; value: number; tone: string; sub?: string }) {
  return (
    <div className="rounded-2xl bg-white p-4 shadow-sm">
      <div className={'text-3xl font-extrabold ' + tone}>{value}</div>
      <div className="mt-1 text-sm font-medium text-slate-500">{label}</div>
      {sub && <div className="text-xs font-medium text-slate-400">{sub}</div>}
    </div>
  );
}
