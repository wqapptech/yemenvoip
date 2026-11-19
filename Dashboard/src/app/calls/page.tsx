'use client';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { collection, count, getAggregateFromServer, limit, onSnapshot, orderBy, query, sum, where } from 'firebase/firestore';
import { fbDb } from '@/lib/firebase';
import { useAuth } from '../providers';
import { useI18n } from '@/lib/i18n';
import Header from '@/components/Header';

interface Call {
  id: string;
  calldateMs?: number;
  src?: string;
  dst?: string;
  duration?: number;
  billsec?: number;
  disposition?: string;
}

type Cat = 'answered' | 'noanswer' | 'busy' | 'failed' | 'notaccepted';
const CAT_TO_DISP: Record<Cat, string> = { answered: 'ANSWERED', noanswer: 'NO ANSWER', busy: 'BUSY', failed: 'FAILED', notaccepted: 'NOT ACCEPTED' };
type DispFilter = 'all' | Cat;
type RangeFilter = 'today' | '7d' | '30d' | 'all';

function catOf(d?: string): Cat {
  const x = (d || '').toUpperCase();
  if (x === 'ANSWERED') return 'answered';
  if (x === 'NO ANSWER') return 'noanswer';
  if (x === 'BUSY') return 'busy';
  if (x === 'NOT ACCEPTED') return 'notaccepted';
  return 'failed';
}

const CAT_TONE: Record<Cat, string> = {
  answered: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  noanswer: 'bg-amber-50 text-amber-700 ring-amber-200',
  busy: 'bg-amber-50 text-amber-700 ring-amber-200',
  failed: 'bg-rose-50 text-rose-700 ring-rose-200',
  notaccepted: 'bg-violet-50 text-violet-700 ring-violet-200',
};
const CAT_LABEL: Record<Cat, string> = {
  answered: 'dispAnswered',
  noanswer: 'dispNoAnswer',
  busy: 'dispBusy',
  failed: 'dispFailed',
  notaccepted: 'dispNotAccepted',
};
const CAT_DOT: Record<Cat, string> = {
  answered: 'bg-emerald-500',
  noanswer: 'bg-amber-500',
  busy: 'bg-amber-500',
  failed: 'bg-rose-500',
  notaccepted: 'bg-violet-500',
};

function fmtDur(s?: number): string {
  if (!s) return '0s';
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return m > 0 ? `${m}m ${sec}s` : `${sec}s`;
}

function fmtTalk(sec: number): string {
  const m = Math.floor(sec / 60);
  const r = sec % 60;
  if (m >= 60) return `${Math.floor(m / 60)}h ${m % 60}m`;
  return `${m}m ${r}s`;
}

const RANGE_MS: Record<RangeFilter, number> = {
  today: 24 * 3600 * 1000,
  '7d': 7 * 24 * 3600 * 1000,
  '30d': 30 * 24 * 3600 * 1000,
  all: Infinity,
};

export default function CallsPage() {
  const { user, ready } = useAuth();
  const { t, lang } = useI18n();
  const router = useRouter();
  const [calls, setCalls] = useState<Call[] | null>(null);
  const [disp, setDisp] = useState<DispFilter>('all');
  const [range, setRange] = useState<RangeFilter>('today');
  const [q, setQ] = useState('');
  const [stats, setStats] = useState({ total: 0, answered: 0, noanswer: 0, notaccepted: 0, failed: 0, talkSec: 0 });

  useEffect(() => { if (ready && !user) router.replace('/login'); }, [ready, user, router]);

  useEffect(() => {
    if (!user) return;
    const base = collection(fbDb(), 'calls');
    const asc = disp !== 'all';
    // 'all': most recent calls (single-field index).
    // A disposition chip: filter server-side AND bound by range, ordered ASC so
    // it uses the existing (disposition, calldateMs ASC) index; we reverse to
    // newest-first client-side. This surfaces that type even when it's hours back.
    let qy;
    if (asc) {
      const cutoff = RANGE_MS[range] === Infinity ? 0 : Date.now() - RANGE_MS[range];
      qy = query(base, where('disposition', '==', CAT_TO_DISP[disp as Cat]),
        where('calldateMs', '>=', cutoff), orderBy('calldateMs', 'asc'), limit(500));
    } else {
      qy = query(base, orderBy('calldateMs', 'desc'), limit(500));
    }
    const unsub = onSnapshot(
      qy,
      (snap) => {
        const rows = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Record<string, unknown>) })) as Call[];
        setCalls(asc ? rows.reverse() : rows);
      },
      () => setCalls([]),
    );
    return () => unsub();
  }, [user, disp, range]);

  // Summary stats come from server-side aggregation over the FULL range (not the
  // capped list fetch), so counts/talk time are accurate regardless of volume.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    const run = async () => {
      const cutoff = RANGE_MS[range] === Infinity ? 0 : Date.now() - RANGE_MS[range];
      const base = collection(fbDb(), 'calls');
      const rc = where('calldateMs', '>=', cutoff);
      // Each aggregation runs independently so one that lacks an index (the
      // talk-time sum needs a (calldateMs, billsec) index) can't zero the rest.
      const num = (r: PromiseSettledResult<{ data: () => Record<string, unknown> }>, k: string) =>
        r.status === 'fulfilled' ? (Number(r.value.data()[k]) || 0) : null;
      const [totalR, ansR, naR, naccR, talkR] = await Promise.allSettled([
        getAggregateFromServer(query(base, rc), { c: count() }),
        getAggregateFromServer(query(base, rc, where('disposition', '==', 'ANSWERED')), { c: count() }),
        getAggregateFromServer(query(base, rc, where('disposition', '==', 'NO ANSWER')), { c: count() }),
        getAggregateFromServer(query(base, rc, where('disposition', '==', 'NOT ACCEPTED')), { c: count() }),
        getAggregateFromServer(query(base, rc), { talk: sum('billsec') }),
      ]);
      if (cancelled) return;
      setStats((prev) => {
        const total = num(totalR, 'c');
        const answered = num(ansR, 'c');
        const noanswer = num(naR, 'c');
        const notaccepted = num(naccR, 'c');
        const talkSec = num(talkR, 'talk');
        const t = total ?? prev.total;
        const a = answered ?? prev.answered;
        const na = noanswer ?? prev.noanswer;
        const nacc = notaccepted ?? prev.notaccepted;
        return {
          total: t,
          answered: a,
          noanswer: na,
          notaccepted: nacc,
          failed: Math.max(t - a - na - nacc, 0),
          talkSec: talkSec ?? prev.talkSec,
        };
      });
    };
    run();
    const id = setInterval(run, 30000);
    return () => { cancelled = true; clearInterval(id); };
  }, [user, range]);

  const now = Date.now();

  const filtered = useMemo(() => {
    if (!calls) return [];
    const needle = q.trim();
    const cutoff = RANGE_MS[range] === Infinity ? 0 : now - RANGE_MS[range];
    return calls.filter((c) => {
      if (disp !== 'all' && catOf(c.disposition) !== disp) return false;
      if (cutoff && (c.calldateMs ?? 0) < cutoff) return false;
      if (needle && !(`${c.src ?? ''}`.includes(needle) || `${c.dst ?? ''}`.includes(needle))) return false;
      return true;
    });
  }, [calls, disp, range, q, now]);

  const asr = stats.total ? Math.round((stats.answered / stats.total) * 100) : 0;

  if (!ready || !user) {
    return <div className="flex min-h-screen items-center justify-center text-slate-400">{t('loading')}</div>;
  }

  const fmtWhen = (ms?: number) =>
    ms ? new Date(ms).toLocaleString(lang === 'ar' ? 'ar' : 'en-GB', {
      day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
    }) : '—';

  const dispChips: { key: DispFilter; label: string }[] = [
    { key: 'all', label: t('filterAll') },
    { key: 'answered', label: t('dispAnswered') },
    { key: 'noanswer', label: t('dispNoAnswer') },
    { key: 'notaccepted', label: t('dispNotAccepted') },
    { key: 'failed', label: t('dispFailed') },
  ];
  const rangeChips: { key: RangeFilter; label: string }[] = [
    { key: 'today', label: t('rangeToday') },
    { key: '7d', label: t('range7d') },
    { key: '30d', label: t('range30d') },
    { key: 'all', label: t('rangeAll') },
  ];

  const Stat = ({ label, value, tone }: { label: string; value: string | number; tone: string }) => (
    <div className="rounded-2xl bg-white p-3 text-center shadow-sm">
      <div className={'text-xl font-bold tabular-nums ' + tone}>{value}</div>
      <div className="mt-0.5 text-[11px] font-medium text-slate-500">{label}</div>
    </div>
  );

  const Chip = ({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) => (
    <button
      onClick={onClick}
      className={
        'shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold transition ' +
        (active ? 'bg-slate-800 text-white shadow-sm' : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50')
      }
    >
      {children}
    </button>
  );

  return (
    <div className="min-h-screen">
      <Header />
      <main className="mx-auto max-w-3xl p-4">
        {/* Summary */}
        <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label={t('callsCount')} value={stats.total} tone="text-slate-800" />
          <Stat label={t('answered')} value={stats.answered} tone="text-emerald-600" />
          <Stat label={t('noAnswer')} value={stats.noanswer} tone="text-amber-600" />
          <Stat label={t('notAccepted')} value={stats.notaccepted} tone="text-violet-600" />
        </div>
        <div className="mb-3 rounded-2xl bg-white px-4 py-2.5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500">{t('answerRate')}</span>
            <span className="text-sm font-bold tabular-nums text-sky-600">{asr}%</span>
          </div>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-100">
            <div className="h-full rounded-full bg-sky-500 transition-all" style={{ width: `${asr}%` }} />
          </div>
          <div className="mt-2 flex items-center justify-between border-t border-slate-100 pt-2">
            <span className="text-xs font-medium text-slate-500">{t('talkTime')}</span>
            <span className="text-sm font-bold tabular-nums text-slate-700">{fmtTalk(Math.max(stats.talkSec - stats.notaccepted * 8, 0))}</span>
          </div>
        </div>

        {/* Search */}
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          inputMode="numeric"
          dir="ltr"
          placeholder={t('searchCalls')}
          className="mb-3 w-full rounded-2xl bg-white px-4 py-2.5 text-sm shadow-sm outline-none ring-1 ring-slate-200 placeholder:text-slate-400 focus:ring-slate-400"
        />

        {/* Filters */}
        <div className="mb-2 flex gap-2 overflow-x-auto pb-1">
          {dispChips.map((c) => (
            <Chip key={c.key} active={disp === c.key} onClick={() => setDisp(c.key)}>{c.label}</Chip>
          ))}
        </div>
        <div className="mb-3 flex gap-2 overflow-x-auto pb-1">
          {rangeChips.map((c) => (
            <Chip key={c.key} active={range === c.key} onClick={() => setRange(c.key)}>{c.label}</Chip>
          ))}
        </div>

        {/* List */}
        {calls === null ? (
          <p className="py-16 text-center text-slate-400">{t('loading')}</p>
        ) : filtered.length === 0 ? (
          <p className="py-16 text-center text-slate-400">{calls.length === 0 ? t('noCalls') : t('noMatch')}</p>
        ) : (
          <>
            <div className="mb-2 px-1 text-[11px] text-slate-400">
              {t('showingN')} {filtered.length} {t('ofN')} {calls.length} {t('callsLower')}
            </div>
            <div className="space-y-2">
              {filtered.map((c) => {
                const k = catOf(c.disposition);
                return (
                  <div key={c.id} className="flex items-center justify-between gap-3 rounded-2xl bg-white p-3 shadow-sm">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <span className={'h-2 w-2 shrink-0 rounded-full ' + CAT_DOT[k]} />
                      <div className="min-w-0">
                        <div className="truncate text-sm font-bold text-slate-800" dir="ltr">
                          {c.src || '—'} <span className="text-slate-300">→</span> {c.dst || '—'}
                        </div>
                        <div className="mt-0.5 text-xs text-slate-500">
                          {fmtWhen(c.calldateMs)} · {fmtDur(c.billsec ?? c.duration)}
                        </div>
                      </div>
                    </div>
                    <span className={'shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ' + CAT_TONE[k]}>
                      {t(CAT_LABEL[k])}
                    </span>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
