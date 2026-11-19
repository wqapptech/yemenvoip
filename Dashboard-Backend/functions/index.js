const {onRequest} = require('firebase-functions/v2/https');
const {defineSecret} = require('firebase-functions/params');
const admin = require('firebase-admin');

admin.initializeApp();
const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;

// Shared secret that the gateway appends as ?token=... on every push.
const PUSH_TOKEN = defineSecret('PUSH_TOKEN');

// --- Balance extraction (SabaFon) -------------------------------------------
// Reply looks like: "رصيدك هو0.01وحدة يمكنك استهلاكه خلال26يوم ..."
// The balance is the number right after "هو" and before "وحد(ة)".
function extractBalance(text) {
  if (!text) return null;
  // Only accept a number that is explicitly the balance: it sits between the
  // keyword (هو / رصيد) and the unit (وحدة). The old loose "first decimal"
  // fallback grabbed dates, validity periods and port ids (e.g. 25.02) from
  // non-balance replies, so it is gone — a reply we cannot parse returns null
  // and nothing is written (the gateway's own bal stays the source).
  let m = text.match(/هو\s*([0-9]+(?:\.[0-9]+)?)\s*وحد/);        // "هو <num> وحدة"
  if (m) return m[1];
  m = text.match(/رصيد[^0-9]{0,20}([0-9]+(?:\.[0-9]+)?)\s*وحد/); // "رصيد ... <num> وحدة"
  if (m) return m[1];
  return null;
}

// SabaFon self-number from the MMN reply: a Yemen mobile number 7XXXXXXXX
// (optionally prefixed with 967). Returns the 9-digit local form, or null.
function extractMsisdn(text) {
  if (!text) return null;
  const m = String(text).match(/(?:00?967)?\s*(7\d{8})(?!\d)/);
  return m ? m[1] : null;
}

// Convert Arabic-Indic digits (U+0660..U+0669) to ASCII so numbers parse
// regardless of the script SabaFon used.
function normDigits(s) {
  return String(s == null ? '' : s).replace(/[\u0660-\u0669]/g,
    (d) => String(d.charCodeAt(0) - 0x0660));
}

// Recursively gather strings from the payload, base64-decoding where it helps.
function collectText(v, out) {
  if (v == null) return;
  if (typeof v === 'string') {
    out.push(v);
    if (v.length >= 8 && /^[A-Za-z0-9+/=\r\n]+$/.test(v)) {
      try {
        const d = Buffer.from(v, 'base64').toString('utf8');
        if (d && /[؀-ۿ]/.test(d)) out.push(d);         // decoded Arabic
      } catch (e) { /* not base64 */ }
    }
  } else if (Array.isArray(v)) {
    for (const x of v) collectText(x, out);
  } else if (typeof v === 'object') {
    for (const k of Object.keys(v)) collectText(v[k], out);
  }
}

// Find the first value under any key literally named "port".
function findPort(o) {
  if (o == null || typeof o !== 'object') return null;
  for (const k of Object.keys(o)) {
    if (/^port$/i.test(k) && (typeof o[k] === 'string' || typeof o[k] === 'number')) {
      return String(o[k]);
    }
  }
  for (const k of Object.keys(o)) {
    const r = findPort(o[k]);
    if (r) return r;
  }
  return null;
}

const portBase = (v) => { const m = String(v).match(/\d+/); return m ? m[0] : null; };

exports.gatewayPush = onRequest(
  {region: 'europe-west4', secrets: [PUSH_TOKEN], cors: false},
  async (req, res) => {
    const token = PUSH_TOKEN.value();
    if (!token || req.query.token !== token) {
      return res.status(403).send('forbidden');
    }

    // Inspection endpoint: GET ...?token=...&debug=1 -> last non-status payload.
    if (req.method === 'GET' && req.query.debug) {
      const snap = await db.collection('debug').doc('lastUssd').get();
      return res.status(200).json(snap.exists ? snap.data() : {empty: true});
    }

    // VM polls this to learn whether the dashboard asked for a balance refresh,
    // and which ports currently hold inserted SIMs (so it only queries those).
    if (req.method === 'GET' && req.query['balance-pending'] != null) {
      const ctl = await db.collection('control').doc('balanceRequest').get();
      const ra = ctl.exists ? ctl.data().requestedAt : null;
      const requestedAt = ra && typeof ra.toMillis === 'function' ? ra.toMillis() : null;
      // One target per port: the currently-active inserted slot (the SIM that
      // answers *102#). Falls back to the first inserted slot if none is flagged.
      const snap = await db.collection('sims').where('inserted', '==', 1).get();
      const byPort = {};
      snap.docs.forEach((d) => {
        const base = String(d.id).split('.')[0];
        if (!/^\d+$/.test(base)) return;
        const dd = d.data();
        const active = dd.active === 1 || dd.slot_active === 1;
        if (!byPort[base] || active) byPort[base] = { port: base, id: d.id, active };
      });
      const targets = Object.values(byPort).sort((a, b) => Number(a.port) - Number(b.port));
      return res.status(200).json({code: 200, reason: 'OK', requestedAt, targets});
    }

    // VM polls this for a "fetch numbers" request. Returns only the inserted
    // SIMs that still have NO stored number, so we never pay to re-query a known one.
    if (req.method === 'GET' && req.query['number-pending'] != null) {
      const ctl = await db.collection('control').doc('numberRequest').get();
      const ra = ctl.exists ? ctl.data().requestedAt : null;
      const requestedAt = ra && typeof ra.toMillis === 'function' ? ra.toMillis() : null;
      const snap = await db.collection('sims').where('inserted', '==', 1).get();
      const byPort = {};
      snap.docs.forEach((d) => {
        const dd = d.data();
        if (dd.msisdn) return;                      // already known -> skip
        const base = String(d.id).split('.')[0];
        if (!/^\d+$/.test(base)) return;
        const active = dd.active === 1 || dd.slot_active === 1;
        if (!byPort[base] || active) byPort[base] = { port: base, id: d.id, active };
      });
      const targets = Object.values(byPort).sort((a, b) => Number(a.port) - Number(b.port));
      return res.status(200).json({code: 200, reason: 'OK', requestedAt, targets});
    }

    // VM polls this for a "fetch minutes" (*122#) request -> inserted active SIMs.
    if (req.method === 'GET' && req.query['minutes-pending'] != null) {
      const ctl = await db.collection('control').doc('minutesRequest').get();
      const ra = ctl.exists ? ctl.data().requestedAt : null;
      const requestedAt = ra && typeof ra.toMillis === 'function' ? ra.toMillis() : null;
      const snap = await db.collection('sims').where('inserted', '==', 1).get();
      const byPort = {};
      snap.docs.forEach((d) => {
        const base = String(d.id).split('.')[0];
        if (!/^\d+$/.test(base)) return;
        const dd = d.data();
        const active = dd.active === 1 || dd.slot_active === 1;
        if (!byPort[base] || active) byPort[base] = { port: base, id: d.id, active };
      });
      const targets = Object.values(byPort).sort((a, b) => Number(a.port) - Number(b.port));
      return res.status(200).json({code: 200, reason: 'OK', requestedAt, targets});
    }

    // Parse the body; fall back to rawBody if it wasn't parsed as JSON.
    let body = req.body || {};
    if ((typeof body !== 'object' || Object.keys(body).length === 0) && req.rawBody) {
      const raw = req.rawBody.toString('utf8');
      try { body = JSON.parse(raw); } catch (e) { body = {raw}; }
    }
    console.log('GWPUSH_V3 type=' + (body && body.type) + ' rowsArr=' + Array.isArray(body && body.rows));

    // ---- Status push (unchanged behaviour) -------------------------------
    if (body.type === 'dev-status' && Array.isArray(body.status)) {
      const now = FieldValue.serverTimestamp();
      if (body.status[0]) console.log('DEVSTATUS_KEYS=' + Object.keys(body.status[0]).join(',') + ' sample=' + JSON.stringify(body.status[0]));
      const batch = db.batch();
      for (const p of body.status) {
        const ref = db.collection('sims').doc(String(p.port));
        batch.set(ref, {
          port: p.port ?? null, st: p.st ?? null, bal: p.bal ?? null,
          opr: p.opr ?? null, sig: p.sig ?? null, sn: p.sn ?? null,
          imsi: p.imsi ?? null, iccid: p.iccid ?? null, imei: p.imei ?? null,
          active: p.active ?? null, inserted: p.inserted ?? null,
          slot_active: p.slot_active ?? null, sim: p.sim ?? null,
          led: p.led ?? null, network: p.network ?? null,
          deviceIp: body.ip ?? null, mac: body.mac ?? null, updatedAt: now,
        }, {merge: true});
      }
      await batch.commit();

      // --- Root-cause ghost cleanup ---------------------------------------
      // When a SIM is removed, or the gateway rotates a port to a different
      // slot, that slot simply stops appearing in the push — but its doc keeps
      // inserted==1 forever, so the dashboard counts SIMs that are no longer
      // there. Every SIM in THIS push just had updatedAt bumped to ~now, so any
      // doc still flagged inserted==1 whose updatedAt is older than the grace
      // window is no longer physically inserted -> clear its flag. The query
      // matches only such stale docs, so it reads ~0 rows once things are clean
      // (free-tier friendly), and it never touches a SIM seen within the grace
      // window. Guarded so a status write never fails on its account.
      let pruned = 0;
      try {
        const graceMs = Number(process.env.INSERTED_GRACE_MS || 15 * 60 * 1000);
        const cutoff = admin.firestore.Timestamp.fromMillis(Date.now() - graceMs);
        const stale = await db.collection('sims')
          .where('inserted', '==', 1)
          .where('updatedAt', '<', cutoff)
          .get();
        if (!stale.empty) {
          const clean = db.batch();
          stale.forEach((d) => {
            clean.set(d.ref, {inserted: 0, insertedClearedAt: now}, {merge: true});
            pruned++;
          });
          await clean.commit();
        }
      } catch (e) {
        // Missing composite index (until it finishes building) or a transient
        // error: skip cleanup this round, never fail the status push.
        console.warn('inserted-reconcile skipped:', e && e.message);
      }

      return res.status(200).json({code: 200, reason: 'OK', count: body.status.length, pruned});
    }

    // ---- Live per-port status poll (real active-slot st) v2 --------------
    // The native status push freezes st at 6, so the collector also polls
    // goip_get_status.html and forwards the ACTIVE slot's true code here as
    // `liveSt` (0 no-SIM, 3 registered, 5 no-balance, 6 reg-fail, 9 SIM error).
    // Kept in its own fields so it never collides with the push's `st`, and it
    // does NOT touch updatedAt (that drives the inserted/stale reconcile).
    if (body.type === 'live-status' && Array.isArray(body.rows)) {
      const now = FieldValue.serverTimestamp();
      const batch = db.batch();
      let n = 0;
      for (const r of body.rows) {
        const id = String((r && r.id) || '');
        if (!/^\d+\.\d+$/.test(id)) continue;
        batch.set(db.collection('sims').doc(id), {
          liveSt: r.liveSt ?? null,
          liveNet: r.net ?? null,
          liveStActive: r.active ?? null,
          liveStAt: now,
        }, {merge: true});
        n++;
      }
      await batch.commit();
      return res.status(200).json({code: 200, reason: 'OK', count: n});
    }

    // ---- Call records (CDRs) from the VM Asterisk collector --------------
    if (body.type === 'cdr' && Array.isArray(body.rows)) {
      const now = FieldValue.serverTimestamp();
      const batch = db.batch();
      for (const r of body.rows) {
        const id = String(r.uniqueid || r.id || `${r.calldateMs}-${r.src}-${r.dst}`);
        const rawDisp = r.disposition ?? null;
        const disp = (rawDisp === 'ANSWERED' && Number(r.billsec) === 8) ? 'NOT ACCEPTED' : rawDisp;
        batch.set(db.collection('calls').doc(id), {
          calldateMs: r.calldateMs ?? null,
          calldate: r.calldate ?? null,
          src: r.src ?? null,
          dst: r.dst ?? null,
          duration: r.duration ?? null,
          billsec: r.billsec ?? null,
          disposition: disp,
          rawDisposition: rawDisp,
          channel: r.channel ?? null,
          dstchannel: r.dstchannel ?? null,
          updatedAt: now,
        }, {merge: true});
      }
      await batch.commit();
      return res.status(200).json({code: 200, reason: 'OK', count: body.rows.length});
    }

    // ---- Per-SIM call statistics from the gateway call-stat poller -------
    // Collector forwards the raw gateway arrays for both windows; we map fields
    // here. Gateway entry: {port, slot, calls, connected, con_failed, asr, acd, ...}
    if (body.type === 'call-stat') {
      const idOf = (s) => String(s.port) + '.' + String(s.slot).padStart(2, '0');
      const mapEntry = (s) => {
        const calls = Number(s.calls) || 0;
        const alerted = Number(s.alerted) || 0;
        const answered = Number(s.connected) || 0;
        // On this firmware con_failed = calls - connected (ALL unconnected), so
        // it can't tell no-answer from hard failure. `alerted` can: a call that
        // reached ringing but wasn't picked up is a no-answer; a call that never
        // alerted (operator reject, congestion, SIM blocked) is a real failure.
        // Clamp each piece so total = answered + noAnswer + failed.
        const connectedC = Math.min(answered, calls);
        const alertedC = Math.min(Math.max(alerted, connectedC), calls);
        const noAnswer = alertedC - connectedC;      // rang, not answered
        const failed = calls - alertedC;             // never rang = real failure
        return {
          total: calls,
          answered: connectedC,
          noAnswer: noAnswer,
          failed: failed,
          asr: s.asr ?? null,
          acd: s.acd ?? null,
        };
      };
      const today = {}, total = {};
      for (const s of (body.today || [])) if (s && s.port != null) today[idOf(s)] = mapEntry(s);
      for (const s of (body.total || [])) if (s && s.port != null) total[idOf(s)] = mapEntry(s);

      const zero = { total: 0, answered: 0, noAnswer: 0, failed: 0, asr: 0, acd: 0 };
      const now = FieldValue.serverTimestamp();
      const batch = db.batch();
      let n = 0;
      // Write only SIMs that have ever made a call (cumulative > 0) — keeps
      // idle/empty slots out of the collection.
      for (const id of Object.keys(total)) {
        if ((total[id].total || 0) <= 0) continue;
        batch.set(db.collection('sims').doc(id), {
          calls: { today: today[id] || zero, total: total[id] },
          callsAt: now,
        }, {merge: true});
        n++;
      }
      await batch.commit();
      return res.status(200).json({code: 200, reason: 'OK', count: n});
    }

    // ---- On-demand balance (USSD reply from the inquiry poller) ----------
    // rows: [{id:"29.03", port:"29", text:"رصيدك هو0.01وحدة..."}]. We parse the
    // balance and write it to balance/balanceNum/balanceAt — a field the status
    // push never touches, so a fresh on-demand reading is not overwritten.
    if (body.type === 'balance' && Array.isArray(body.rows)) {
      const now = FieldValue.serverTimestamp();
      let inserted = null; // lazy-loaded only if we must resolve a port -> slot
      const batch = db.batch();
      let n = 0;
      for (const r of body.rows) {
        const text = (r && r.text) || '';
        const bal = extractBalance(text);
        if (bal == null) continue;
        let id = String((r && r.id) || '');
        if (!/^\d+\.\d+$/.test(id)) {
          const base = portBase((r && (r.port != null ? r.port : r.id)) || '');
          if (!base) continue;
          if (!inserted) inserted = await db.collection('sims').where('inserted', '==', 1).get();
          let target = null;
          inserted.forEach((d) => {
            if (portBase(d.id) !== base) return;
            const dd = d.data();
            if (dd.active === 1 || dd.slot_active === 1) target = d.id;
            else if (!target) target = d.id;
          });
          if (!target) continue;
          id = target;
        }
        batch.set(db.collection('sims').doc(id), {
          balance: bal, balanceNum: parseFloat(bal), balanceAt: now,
        }, {merge: true});
        n++;
      }
      await batch.commit();
      return res.status(200).json({code: 200, reason: 'OK', count: n});
    }

    // ---- Per-SIM SMS statistics from the gateway sms-stat poller ---------
    if (body.type === 'sms-stat') {
      const idOf = (s) => String(s.port) + '.' + String(s.slot).padStart(2, '0');
      const mapEntry = (s) => ({
        sent: Number(s.sent_ok != null ? s.sent_ok : s.sent) || 0,
        received: Number(s.received != null ? s.received : s.recv) || 0,
        failed: Number(s.sent_failed != null ? s.sent_failed : s.failed) || 0,
      });
      const today = {}, total = {};
      for (const s of (body.today || [])) if (s && s.port != null) today[idOf(s)] = mapEntry(s);
      for (const s of (body.total || [])) if (s && s.port != null) total[idOf(s)] = mapEntry(s);

      const zero = { sent: 0, received: 0, failed: 0 };
      const now = FieldValue.serverTimestamp();
      const batch = db.batch();
      let m = 0;
      for (const id of Object.keys(total)) {
        const tt = total[id];
        if ((tt.sent + tt.received + tt.failed) <= 0) continue; // skip idle SIMs
        batch.set(db.collection('sims').doc(id), {
          sms: { today: today[id] || zero, total: tt },
          smsStatAt: now,
        }, {merge: true});
        m++;
      }
      await batch.commit();
      return res.status(200).json({code: 200, reason: 'OK', count: m});
    }

    // ---- SIM SMS signals from the VM sms poller -------------------------
    // rows: [{port, text}] where port is the exact "NN.SS" slot that received
    // the SabaFon message. We extract a reported balance ("رصيدك هو X وحدة")
    // and/or a top-up amount ("استلمت X وحدة") and write them to that SIM.
    if (body.type === 'ussd' && Array.isArray(body.rows)) {
      const now = FieldValue.serverTimestamp();
      const batch = db.batch();
      let n = 0;
      for (const r of body.rows) {
        const text = (r && r.text) || '';
        const id = String((r && r.port) || '');
        if (!/^\d+\.\d+$/.test(id)) continue;   // need an exact port.slot id

        const upd = {};
        const bal = extractBalance(text);                 // reported balance
        if (bal != null) {
          upd.smsBalance = bal;
          upd.smsBalanceNum = parseFloat(bal);
          upd.smsBalanceAt = now;
        }
        const t = text.match(/استلمت\s*([0-9]+(?:\.[0-9]+)?)\s*وحد/);  // top-up
        if (t) {
          upd.lastTopup = parseFloat(t[1]);
          upd.lastTopupAt = now;
          upd.needsRecharge = false;   // a top-up clears a prior warning
        }
        // SabaFon "please recharge / validity ending" warning.
        if (/اعادة\s*شحن|شارفت\s*على\s*الانتهاء/.test(text)) {
          upd.needsRecharge = true;
          upd.rechargeAt = now;
        }
        // Self-number reply: SabaFon answers from the SIM's own number;
        // text is "<n> available now" and digits may be Arabic-Indic.
        const from = String((r && r.from) || '');
        if (from.includes('333') || /رقمك|your\s*number/i.test(text)
            || /متاح|متوفر/.test(text)) {
          const mn = extractMsisdn(normDigits(text)) || extractMsisdn(normDigits(from));
          if (mn) { upd.msisdn = mn; upd.msisdnAt = now; }
        }
        // SabaFon bundle summary from *122#: remaining local minutes / SMS + expiry.
        const minM = text.match(/(\d+)\s*\/\s*دقيقة/);
        if (minM) {
          upd.minutes = parseInt(minM[1], 10);
          upd.minutesAt = now;
          const expM = text.match(/دقيقة[^]*?حتى\s*([0-9]{4}-[0-9]{2}-[0-9]{2})/);
          if (expM) upd.minutesExp = expM[1];
        }
        const smsBM = text.match(/(\d+)\s*\/\s*رسالة/);
        if (smsBM) { upd.smsBundle = parseInt(smsBM[1], 10); upd.smsBundleAt = now; }
        if (Object.keys(upd).length === 0) continue;
        batch.set(db.collection('sims').doc(id), upd, {merge: true});
        n++;
      }
      await batch.commit();
      return res.status(200).json({code: 200, reason: 'OK', count: n});
    }

    // ---- Anything else: received message / USSD reply --------------------
    // The gateway's HTTP SMS-forward sends fields as query params (and/or body).
    const q = {...(req.query || {})};
    delete q.token; delete q.debug;
    const scan = {query: q, body};

    const texts = [];
    collectText(scan, texts);
    const joined = texts.join(' \n ');
    const balance = extractBalance(joined);
    const port = findPort(scan);

    // Store a snapshot so we can see the exact schema the gateway uses.
    await db.collection('debug').doc('lastUssd').set({
      at: FieldValue.serverTimestamp(),
      type: body.type ?? null,
      method: req.method,
      query: q,
      port, balance,
      texts: texts.slice(0, 20),
      rawBody: JSON.stringify(body).slice(0, 5000),
    });

    // If we have a balance and a port, write it to that port's active slot.
    let wrote = null;
    if (balance != null && port != null) {
      const base = portBase(port);
      const snap = await db.collection('sims').where('inserted', '==', 1).get();
      let target = null;
      snap.forEach((d) => {
        if (portBase(d.id) !== base) return;
        const data = d.data();
        if (data.active === 1 || data.slot_active === 1) target = d.id; // prefer active slot
        else if (!target) target = d.id;
      });
      if (target) {
        await db.collection('sims').doc(target).set({
          balance: balance,
          balanceNum: parseFloat(balance),
          balanceAt: FieldValue.serverTimestamp(),
        }, {merge: true});
        wrote = target;
      }
    }

    return res.status(200).json({code: 200, reason: 'OK', balance, port, wrote});
  }
);
