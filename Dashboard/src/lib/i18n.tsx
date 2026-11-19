'use client';
import React, { createContext, useContext, useEffect, useState } from 'react';

export type Lang = 'en' | 'ar';
type Entry = { en: string; ar: string };

const D: Record<string, Entry> = {
  appName:     { en: 'SIM Monitor',    ar: 'مراقبة الشرائح' },
  signIn:      { en: 'Sign in',        ar: 'تسجيل الدخول' },
  email:       { en: 'Email',          ar: 'البريد الإلكتروني' },
  password:    { en: 'Password',       ar: 'كلمة المرور' },
  signingIn:   { en: 'Signing in…',    ar: 'جارٍ الدخول…' },
  signInError: { en: 'Wrong email or password', ar: 'بريد أو كلمة مرور غير صحيحة' },
  logout:      { en: 'Log out',        ar: 'تسجيل الخروج' },
  registered:  { en: 'Registered',     ar: 'مسجّلة' },
  problems:    { en: 'Problems',       ar: 'مشاكل' },
  idle:        { en: 'Idle',           ar: 'خاملة' },
  sims:        { en: 'SIMs',           ar: 'الشرائح' },
  port:        { en: 'SIM',            ar: 'شريحة' },
  operator:    { en: 'Operator',       ar: 'المشغّل' },
  signal:      { en: 'Signal',         ar: 'الإشارة' },
  balance:     { en: 'Balance',        ar: 'الرصيد' },
  loading:     { en: 'Loading…',       ar: 'جارٍ التحميل…' },
  noData:      { en: 'No SIMs inserted yet', ar: 'لا توجد شرائح مُدخلة بعد' },
  updated:     { en: 'Updated',        ar: 'آخر تحديث' },
  refresh:     { en: 'Refresh',        ar: 'تحديث' },
  refreshing:  { en: 'Refreshing…',    ar: 'جارٍ التحديث…' },
  justNow:     { en: 'just now',       ar: 'الآن' },
  refreshBalance:  { en: 'Check balances', ar: 'فحص الأرصدة' },
  balanceRequested:{ en: 'Checking…',      ar: 'جارٍ الفحص…' },
  balanceSentHint: { en: 'Balance check requested — cards update within about a minute', ar: 'تم طلب فحص الرصيد — تُحدَّث البطاقات خلال دقيقة تقريبًا' },
  navSims:     { en: 'SIMs',           ar: 'الشرائح' },
  navCalls:    { en: 'Calls',          ar: 'المكالمات' },
  callHistory: { en: 'Call history',   ar: 'سجل المكالمات' },
  today:       { en: 'Today',          ar: 'اليوم' },
  allTime:     { en: 'All time',       ar: 'الإجمالي' },
  callsCount:  { en: 'Calls',          ar: 'المكالمات' },
  answered:    { en: 'Answered',       ar: 'مُجابة' },
  noAnswer:    { en: 'No answer',      ar: 'بدون رد' },
  failedCalls: { en: 'Failed',         ar: 'فاشلة' },
  notAccepted: { en: 'Not accepted',   ar: 'مرفوضة' },
  answerRate:  { en: 'Answer rate',    ar: 'نسبة الرد' },
  avgDuration: { en: 'Avg duration',   ar: 'متوسط المدة' },
  noCallData:  { en: 'No call data yet', ar: 'لا توجد بيانات مكالمات بعد' },
  sms:         { en: 'SMS',            ar: 'الرسائل' },
  smsStats:    { en: 'SMS',            ar: 'الرسائل' },
  sent:        { en: 'Sent',           ar: 'مُرسلة' },
  received:    { en: 'Received',       ar: 'مُستلمة' },
  smsFailed:   { en: 'Failed',         ar: 'فاشلة' },
  noSmsData:   { en: 'No SMS data yet', ar: 'لا توجد بيانات رسائل بعد' },
  close:       { en: 'Close',          ar: 'إغلاق' },
  callLog:     { en: 'Call log',       ar: 'سجل المكالمات' },
  whenCol:     { en: 'Time',           ar: 'الوقت' },
  dialed:      { en: 'Dialed',         ar: 'الرقم المطلوب' },
  fromCol:     { en: 'From',           ar: 'من' },
  duration:    { en: 'Duration',       ar: 'المدة' },
  result:      { en: 'Result',         ar: 'النتيجة' },
  noCalls:     { en: 'No calls recorded yet', ar: 'لا توجد مكالمات مُسجّلة بعد' },
  dispAnswered:{ en: 'Answered',       ar: 'مُجابة' },
  dispNoAnswer:{ en: 'No answer',      ar: 'لم يُرد' },
  dispBusy:    { en: 'Busy',           ar: 'مشغول' },
  dispFailed:  { en: 'Failed',         ar: 'فشلت' },
  dispNotAccepted: { en: 'Not accepted', ar: 'مرفوضة' },
  searchCalls: { en: 'Search number…', ar: 'ابحث برقم…' },
  filterAll:   { en: 'All',            ar: 'الكل' },
  rangeToday:  { en: 'Last 24h',       ar: 'آخر 24 ساعة' },
  range7d:     { en: '7 days',         ar: '7 أيام' },
  range30d:    { en: '30 days',        ar: '30 يوم' },
  rangeAll:    { en: 'All time',       ar: 'كل الفترة' },
  noMatch:     { en: 'No calls match these filters', ar: 'لا توجد مكالمات مطابقة' },
  showingN:    { en: 'Showing',        ar: 'عرض' },
  ofN:         { en: 'of',             ar: 'من' },
  callsLower:  { en: 'calls',          ar: 'مكالمة' },
  busy:        { en: 'Busy',           ar: 'مشغول' },
  talkTime:    { en: 'Talk time (answered)', ar: 'مدة المكالمات المُجابة' },
  minUnit:        { en: 'min',          ar: 'د' },
  minutesLeft:    { en: 'Minutes left',  ar: 'الدقائق المتبقية' },
  smsLeft:        { en: 'SMS left',      ar: 'الرسائل المتبقية' },
  until:          { en: 'until',         ar: 'حتى' },
  fetchMinutes:   { en: 'Fetch minutes', ar: 'جلب الدقائق' },
  fetchingMinutes:{ en: 'Fetching…',     ar: 'جارٍ الجلب…' },
  minutesSentHint:{ en: 'Sends *122# from inserted SIMs; the bundle reply arrives by SMS shortly.', ar: 'يرسل *122# من الشرائح؛ يصل رد الباقة برسالة قصيرة بعد قليل.' },
  lastTopup:   { en: 'Last top-up',    ar: 'آخر تعبئة' },
  units:       { en: 'units',          ar: 'وحدة' },
  recharge:    { en: 'Recharge',       ar: 'شحن' },
  needsRecharge:{ en: 'Recharge needed', ar: 'يحتاج إعادة شحن' },
  mobileNumber:    { en: 'Number',        ar: 'الرقم' },
  fetchNumbers:    { en: 'Fetch numbers', ar: 'جلب الأرقام' },
  fetchingNumbers: { en: 'Fetching…',     ar: 'جارٍ الجلب…' },
  numberSentHint:  { en: 'Sends MMN to 333 from SIMs without a number — replies arrive within a minute or two', ar: 'يرسل MMN إلى 333 من الشرائح بدون رقم — تصل الردود خلال دقيقة أو اثنتين' },
  portLabel:   { en: 'Port',          ar: 'منفذ' },
  ports:       { en: 'Ports',         ar: 'المنافذ' },
  slotLabel:   { en: 'Slot',          ar: 'فتحة' },
  activeLabel: { en: 'Active',        ar: 'نشطة' },
  lowBalance:  { en: 'Low balance',   ar: 'رصيد منخفض' },
  stale:       { en: 'Stale',         ar: 'قديمة' },
  staleNote:   { en: 'not updating — may be removed', ar: 'لا تُحدَّث — قد تكون مُزالة' },
};

interface Ctx { lang: Lang; dir: 'rtl' | 'ltr'; t: (k: string) => string; toggle: () => void; }
const I18nContext = createContext<Ctx | null>(null);

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLang] = useState<Lang>('ar');
  useEffect(() => {
    try { const s = localStorage.getItem('lang'); if (s === 'en' || s === 'ar') setLang(s); } catch {}
  }, []);
  const dir = lang === 'ar' ? 'rtl' : 'ltr';
  useEffect(() => {
    if (typeof document !== 'undefined') { document.documentElement.lang = lang; document.documentElement.dir = dir; }
    try { localStorage.setItem('lang', lang); } catch {}
  }, [lang, dir]);
  const t = (k: string) => D[k] ? D[k][lang] : k;
  const toggle = () => setLang((l) => (l === 'ar' ? 'en' : 'ar'));
  return <I18nContext.Provider value={{ lang, dir, t, toggle }}>{children}</I18nContext.Provider>;
}

export function useI18n(): Ctx {
  const c = useContext(I18nContext);
  if (!c) throw new Error('useI18n must be used within I18nProvider');
  return c;
}
