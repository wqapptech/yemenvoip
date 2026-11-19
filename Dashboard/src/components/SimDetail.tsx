'use client';
import { useState } from 'react';
import { statusInfo, toneCard, toneDot, pickBalance, needsTopup } from '@/lib/status';
import { useI18n } from '@/lib/i18n';
import type { Sim, CallStat, SmsStat } from './SimGrid';

function fmtDur(s?: number): string {
  if (s == null) return '—';
  const m = Math.floor(s / 60);
  const sec = Math.round(s % 60);
  return m > 0 ? `${m}m ${sec}s` : `${sec}s`;
}

function cleanOpr(o?: string): string {
  if (!o) return '—';
  const s = o.trim();
  if (s === '' || s === '0') return '—';
  const words = s.replace(/^\d+\s*/, '').split(/\s+/);
  return words.length && words[0] ? words[0] : s;
}

export default function SimDetail({ sim, onClose }: { sim: Sim | null; onClose: () => void }) {
  const { t, lang } = useI18n();
  const [win, setWin] = useState<'today' | 'total'>('today');
  if (!sim) return null;

  const info = statusInfo(Number(sim.st ?? 0));
  const label = lang === 'ar' ? info.ar : info.en;
  const bal = pickBalance(sim) ?? undefined;
  const showRecharge = needsTopup(sim);
  const stat: CallStat | undefined = sim.calls ? sim.calls[win] : undefined;
  const hasCalls = !!(sim.calls && (sim.calls.today || sim.calls.total));
  const smsStat: SmsStat | undefined = sim.sms ? sim.sms[win] : undefined;
  const hasSms = !!(sim.sms && (sim.sms.today || sim.sms.total));

  return (
    <div
      className="fixed inset-0 z-20 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-white p-5 shadow-xl sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* header */}
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className={'h-3 w-3 rounded-full ' + toneDot[info.tone]} />
            <span className="text-lg font-extrabold text-slate-800">
              {t('port')} {sim.port ?? sim.id}
            </span>
          </div>
          <button
            onClick={onClose}
            className="rounded-full bg-slate-100 px-3 py-1 text-sm font-semibold text-slate-600"
          >
            {t('close')}
          </button>
        </div>

        {showRecharge && (
          <div className="mb-3 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm font-bold text-amber-800">⚠ {t('needsRecharge')}</div>
        )}
        {/* status + basic info */}
        <div className={'mb-4 rounded-2xl border p-4 ' + toneCard[info.tone]}>
          <div className="text-base font-extrabold text-slate-800">{label}</div>
          <div className="mt-3 space-y-1 text-sm text-slate-600">
            <Row label={t('operator')} value={cleanOpr(sim.opr)} />
            <Row label={t('mobileNumber')} value={sim.msisdn || '—'} />
            <Row label={t('signal')} value={sim.sig != null && sim.sig < 99 ? String(sim.sig) : '—'} />
            <Row label={t('balance')} value={bal != null && bal !== '' ? String(bal) : '—'} />
            <Row
              label={t('minutesLeft')}
              value={sim.minutes != null
                ? `${sim.minutes} ${t('minUnit')}${sim.minutesExp ? ' · ' + t('until') + ' ' + sim.minutesExp : ''}`
                : '—'}
            />
            {sim.smsBundle != null && (
              <Row label={t('smsLeft')} value={`${sim.smsBundle}`} />
            )}
            {sim.lastTopup != null && (
              <Row label={t('lastTopup')} value={`${sim.lastTopup} ${t('units')}`} />
            )}
          </div>
        </div>

        {/* call history */}
        <div className="mb-1 flex items-center justify-between">
          <h3 className="text-sm font-bold text-slate-700">{t('callHistory')}</h3>
          {(hasCalls || hasSms) && (
            <div className="flex rounded-full bg-slate-100 p-0.5 text-xs font-semibold">
              <button
                onClick={() => setWin('today')}
                className={'rounded-full px-3 py-1 ' + (win === 'today' ? 'bg-white shadow-sm text-slate-800' : 'text-slate-500')}
              >
                {t('today')}
              </button>
              <button
                onClick={() => setWin('total')}
                className={'rounded-full px-3 py-1 ' + (win === 'total' ? 'bg-white shadow-sm text-slate-800' : 'text-slate-500')}
              >
                {t('allTime')}
              </button>
            </div>
          )}
        </div>

        {!hasCalls ? (
          <p className="py-8 text-center text-sm text-slate-400">{t('noCallData')}</p>
        ) : (
          <div className="mt-2 grid grid-cols-2 gap-3">
            <Tile label={t('callsCount')} value={stat?.total ?? 0} tone="text-slate-800" />
            <Tile label={t('answered')} value={stat?.answered ?? 0} tone="text-emerald-600" />
            <Tile label={t('noAnswer')} value={stat?.noAnswer ?? 0} tone="text-amber-600" />
            <Tile label={t('failedCalls')} value={stat?.failed ?? 0} tone="text-rose-600" />
            <Tile label={t('answerRate')} value={stat?.asr != null ? stat.asr + '%' : '—'} tone="text-sky-600" />
            <div className="col-span-2">
              <Tile label={t('avgDuration')} value={fmtDur(stat?.acd)} tone="text-slate-800" />
            </div>
          </div>
        )}

        {/* sms stats */}
        <div className="mt-4 mb-1">
          <h3 className="text-sm font-bold text-slate-700">{t('smsStats')}</h3>
        </div>
        {!hasSms ? (
          <p className="py-6 text-center text-sm text-slate-400">{t('noSmsData')}</p>
        ) : (
          <div className="mt-2 grid grid-cols-3 gap-3">
            <Tile label={t('sent')} value={smsStat?.sent ?? 0} tone="text-emerald-600" />
            <Tile label={t('received')} value={smsStat?.received ?? 0} tone="text-sky-600" />
            <Tile label={t('smsFailed')} value={smsStat?.failed ?? 0} tone="text-rose-600" />
          </div>
        )}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2">
      <span>{label}</span>
      <span className="font-semibold text-slate-800">{value}</span>
    </div>
  );
}

function Tile({ label, value, tone }: { label: string; value: string | number; tone: string }) {
  return (
    <div className="rounded-2xl bg-slate-50 p-3 text-center">
      <div className={'text-2xl font-extrabold ' + tone}>{value}</div>
      <div className="mt-0.5 text-xs font-medium text-slate-500">{label}</div>
    </div>
  );
}
