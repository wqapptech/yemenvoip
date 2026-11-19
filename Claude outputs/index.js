const functions = require('@google-cloud/functions-framework');
const {Firestore, FieldValue} = require('@google-cloud/firestore');

const db = new Firestore();
const TOKEN = process.env.PUSH_TOKEN || '';

// --- Balance extraction (SabaFon) -------------------------------------------
// Reply looks like: "رصيدك هو0.01وحدة يمكنك استهلاكه خلال26يوم ..."
// The balance is the number right after "هو" and before "وحد(ة)".
function extractBalance(text) {
  if (!text) return null;
  let m = text.match(/هو\s*([0-9]+(?:\.[0-9]+)?)\s*وحد/);        // anchored (best)
  if (m) return m[1];
  m = text.match(/رصيد[^0-9]*([0-9]+(?:\.[0-9]+)?)/);            // "رصيد ... <num>"
  if (m) return m[1];
  m = text.match(/([0-9]+\.[0-9]+)/);                            // first decimal
  if (m) return m[1];
  return null;
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

functions.http('receiveStatus', async (req, res) => {
  if (!TOKEN || req.query.token !== TOKEN) {
    return res.status(403).send('forbidden');
  }

  // Inspection endpoint: GET ...?token=...&debug=1 -> last non-status payload seen.
  if (req.method === 'GET' && req.query.debug) {
    const snap = await db.collection('debug').doc('lastUssd').get();
    return res.status(200).json(snap.exists ? snap.data() : {empty: true});
  }

  const body = req.body || {};

  // ---- Status push (unchanged) -------------------------------------------
  if (body.type === 'dev-status' && Array.isArray(body.status)) {
    const now = FieldValue.serverTimestamp();
    const batch = db.batch();
    for (const p of body.status) {
      const ref = db.collection('sims').doc(String(p.port));
      batch.set(ref, {
        port: p.port ?? null, st: p.st ?? null, bal: p.bal ?? null,
        opr: p.opr ?? null, sig: p.sig ?? null, sn: p.sn ?? null,
        imsi: p.imsi ?? null, iccid: p.iccid ?? null, imei: p.imei ?? null,
        active: p.active ?? null, inserted: p.inserted ?? null,
        slot_active: p.slot_active ?? null, sim: p.sim ?? null,
        deviceIp: body.ip ?? null, mac: body.mac ?? null, updatedAt: now,
      }, {merge: true});
    }
    await batch.commit();
    return res.status(200).json({code: 200, reason: 'OK', count: body.status.length});
  }

  // ---- Anything else: treat as a received message / USSD reply -----------
  const texts = [];
  collectText(body, texts);
  const joined = texts.join(' \n ');
  const balance = extractBalance(joined);
  const port = findPort(body);

  // Always store a snapshot so we can see the exact schema the gateway uses.
  await db.collection('debug').doc('lastUssd').set({
    at: FieldValue.serverTimestamp(),
    type: body.type ?? null,
    port, balance,
    texts: texts.slice(0, 20),
    rawBody: JSON.stringify(body).slice(0, 5000),
  });

  // If we got both a balance and a port, write it to that port's active slot.
  let wrote = null;
  if (balance != null && port != null) {
    const base = portBase(port);
    const snap = await db.collection('sims').where('inserted', '==', 1).get();
    let target = null;
    snap.forEach((d) => {
      if (portBase(d.id) !== base) return;
      const data = d.data();
      if (data.active === 1 || data.slot_active === 1) target = d.id;   // prefer active slot
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
});
