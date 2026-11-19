export interface StatusInfo { en: string; ar: string; tone: 'ok' | 'warn' | 'bad' | 'idle' | 'empty'; }

const MAP: Record<number, StatusInfo> = {
  0:  { en: 'No SIM',              ar: 'لا توجد شريحة',     tone: 'empty' },
  1:  { en: 'Idle',                ar: 'خاملة',             tone: 'idle'  },
  2:  { en: 'Registering',         ar: 'جارٍ التسجيل',      tone: 'warn'  },
  3:  { en: 'Registered',          ar: 'مسجّلة',            tone: 'ok'    },
  4:  { en: 'In call',             ar: 'في مكالمة',         tone: 'ok'    },
  5:  { en: 'No balance',          ar: 'لا يوجد رصيد',      tone: 'bad'   },
  6:  { en: 'Registration failed', ar: 'فشل التسجيل',       tone: 'bad'   },
  7:  { en: 'Locked (device)',     ar: 'مقفلة (الجهاز)',    tone: 'bad'   },
  8:  { en: 'Locked by operator',  ar: 'محظورة من المشغّل', tone: 'bad'   },
  9:  { en: 'SIM error',           ar: 'خطأ في الشريحة',    tone: 'bad'   },
  11: { en: 'Card detected',       ar: 'تم اكتشاف الشريحة', tone: 'warn'  },
  12: { en: 'User locked',         ar: 'مقفلة يدويًا',      tone: 'idle'  },
  13: { en: 'Inter-calling',       ar: 'اتصال داخلي',       tone: 'ok'    },
  14: { en: 'Inter-call hold',     ar: 'انتظار داخلي',      tone: 'warn'  },
  15: { en: 'Accessing network',   ar: 'الوصول للشبكة',     tone: 'warn'  },
  16: { en: 'Module timeout',      ar: 'انتهت مهلة الوحدة', tone: 'bad'   },
};

export function statusInfo(st: number): StatusInfo {
  return MAP[st] ?? { en: 'Status ' + st, ar: 'الحالة ' + st, tone: 'idle' };
}

export const toneCard: Record<string, string> = {
  ok:    'bg-emerald-50 border-emerald-200',
  warn:  'bg-amber-50 border-amber-200',
  bad:   'bg-rose-50 border-rose-200',
  idle:  'bg-sky-50 border-sky-200',
  empty: 'bg-slate-50 border-slate-200',
};
export const toneDot: Record<string, string> = {
  ok: 'bg-emerald-500', warn: 'bg-amber-500', bad: 'bg-rose-500', idle: 'bg-sky-500', empty: 'bg-slate-300',
};

// --- Balance thresholds -----------------------------------------------------
// SabaFon balance (in units) at or below this flags a SIM for recharge.
// Adjust to match what counts as "low" for your call rates.
export const LOW_BALANCE = 5;

export function parseBalance(bal: unknown): number | null {
  if (bal == null || bal === '') return null;
  const n = typeof bal === 'number' ? bal : parseFloat(String(bal));
  return Number.isFinite(n) ? n : null;
}

// A real, positive reading at or below the threshold. 0.00 is treated as
// "not yet read" (idle/unqueried SIMs report 0.00), so it does not flag on its
// own — a genuinely dead SIM surfaces via status code 5 (No balance).
export function isLowBalance(bal: unknown): boolean {
  const n = parseBalance(bal);
  return n != null && n > 0 && n <= LOW_BALANCE;
}

// --- Freshness --------------------------------------------------------------
// The gateway pushes full status periodically, so a live SIM's updatedAt stays
// recent. A SIM that was physically removed keeps its inserted==1 doc (nothing
// resets it) but stops being pushed — so it goes stale. We surface that rather
// than let a ghost pad the count.
// Keep this in sync with the backend INSERTED_GRACE_MS (gatewayPush ghost
// cleanup). Both default to 15 min; to change the window, set BOTH env vars to
// the same value — NEXT_PUBLIC_INSERTED_GRACE_MS here and INSERTED_GRACE_MS on
// the function — so the UI's "stale" line and the data cleanup never diverge.
export const STALE_MS =
  Number(process.env.NEXT_PUBLIC_INSERTED_GRACE_MS) || 15 * 60 * 1000;

export function toMillis(v: unknown): number | null {
  const o = v as { toMillis?: () => number; seconds?: number } | null;
  if (o && typeof o.toMillis === 'function') return o.toMillis();
  if (o && typeof o.seconds === 'number') return o.seconds * 1000;
  return null;
}

// Stale only when we have a timestamp and it is older than the window.
// A missing timestamp (freshly written, pending serverTimestamp) is not stale.
export function isStale(updatedAt: unknown, now: number): boolean {
  const ms = toMillis(updatedAt);
  return ms != null && now - ms > STALE_MS;
}

// Port base ("29.03" -> "29") and slot number ("29.03" -> 3).
export function portOf(idOrPort: unknown): string {
  const m = String(idOrPort ?? '').match(/\d+/);
  return m ? m[0] : String(idOrPort ?? '');
}
export function slotOf(idOrPort: unknown): number | null {
  const m = String(idOrPort ?? '').match(/\.(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}


// --- Balance source selection ----------------------------------------------
// Two balance readings can exist on a SIM: the gateway's own `bal` (parsed by
// the gateway's USSD keyword config and refreshed on every status push) and the
// on-demand `balance` (written when the Check-balances button runs). Show
// whichever is NEWER — the push time for bal, balanceAt for the on-demand one.
// This stops a stale/mis-parsed on-demand value (which once looked like a port
// id, e.g. 25.02) from masking the gateway's live figure.
export function pickBalance(s: {
  bal?: unknown; balance?: unknown; smsBalance?: unknown;
  updatedAt?: unknown; balanceAt?: unknown;
}): string | number | null {
  const pushMs = toMillis(s.updatedAt);
  const onDemandMs = toMillis(s.balanceAt);
  const onDemand = s.balance;
  if (onDemand != null && onDemand !== '' &&
      onDemandMs != null && (pushMs == null || onDemandMs >= pushMs)) {
    return onDemand as string | number;      // on-demand reading is the newest
  }
  if (s.bal != null && s.bal !== '') return s.bal as string | number;
  if (onDemand != null && onDemand !== '') return onDemand as string | number;
  if (s.smsBalance != null && s.smsBalance !== '') return s.smsBalance as string | number;
  return null;
}


// --- Minutes bundle (from *122#) -------------------------------------------
// SabaFon local-network bundle minutes at or below this count as "low".
export const LOW_MINUTES = 5;

export function parseMinutes(m: unknown): number | null {
  if (typeof m === 'number') return Number.isFinite(m) ? m : null;
  if (m == null || m === '') return null;
  const n = parseInt(String(m), 10);
  return Number.isFinite(n) ? n : null;
}

// A SIM has "low minutes" only when we actually have a reading at/below the
// threshold. Unknown (never fetched via *122#) is NOT treated as low.
export function isLowMinutes(minutes: unknown): boolean {
  const n = parseMinutes(minutes);
  return n != null && n <= LOW_MINUTES;
}

// Needs top-up ONLY when BOTH are low: cash balance low AND bundle minutes low.
// A SIM still holding local minutes keeps terminating even at ~0 balance, so it
// is not flagged. If minutes were never fetched we can't confirm the second
// condition, so it does not flag on balance alone.
export function needsTopup(s: {
  bal?: unknown; balance?: unknown; smsBalance?: unknown;
  updatedAt?: unknown; balanceAt?: unknown; minutes?: unknown;
}): boolean {
  return isLowBalance(pickBalance(s)) && isLowMinutes(s.minutes);
}

// --- Derived SIM status (st is unreliable on this firmware) -----------------
// The gateway's status push reports st=6 for every slot regardless of reality,
// so per-SIM state is derived from fields that ARE reliable: live bundle
// minutes (from *122#), whether the slot is the active one, and inserted.
// Out-of-minutes is the condition that makes the gateway park (short-duration
// lock) a SIM, so it is surfaced distinctly from "low".
export function isOutOfMinutes(minutes: unknown): boolean {
  const n = parseMinutes(minutes);
  return n != null && n <= 0;
}

export interface SimStatus { en: string; ar: string; tone: 'ok' | 'warn' | 'bad' | 'idle' | 'empty'; }

export function simStatus(s: {
  active?: number; slot_active?: number; inserted?: number; minutes?: unknown; liveSt?: number;
}): SimStatus {
  const active = s.active === 1;
  const mins = parseMinutes(s.minutes);
  // liveSt is the real status code from the gateway poll (goip_get_status). It
  // reflects the slot's last selected-state, which is exactly what the gateway's
  // LED grid shows red — so a hard fault counts whether the slot is the active
  // one or a parked slot the gateway flags red.
  const ls = typeof s.liveSt === 'number' ? s.liveSt : null;

  if (ls === 5)  return { en: 'No balance',     ar: 'لا يوجد رصيد',      tone: 'bad' };
  if (ls === 6)  return { en: 'Not registered', ar: 'غير مسجّلة',        tone: 'bad' };
  if (ls === 9)  return { en: 'SIM error',      ar: 'خطأ في الشريحة',    tone: 'bad' };
  if (ls === 16) return { en: 'Module timeout', ar: 'انتهت مهلة الوحدة', tone: 'bad' };

  if (mins != null && mins <= 0) return { en: 'Out of minutes', ar: 'نفدت الدقائق', tone: 'bad' };
  if (active && (ls === 2 || ls === 15)) return { en: 'Registering', ar: 'جارٍ التسجيل', tone: 'warn' };
  if (mins != null && mins <= LOW_MINUTES) return { en: 'Low minutes', ar: 'دقائق منخفضة', tone: 'warn' };
  if (active) return { en: 'Active',  ar: 'نشطة',     tone: 'ok' };
  if (s.inserted === 1) return { en: 'Standby', ar: 'احتياطية', tone: 'idle' };
  return { en: 'Idle', ar: 'خاملة', tone: 'empty' };
}
