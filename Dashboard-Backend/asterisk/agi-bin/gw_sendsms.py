#!/usr/bin/env python3
"""AGI: gw_sendsms.py <to>
Sends an SMS through the Skyline gateway, trying the SIM ports listed in the
SMS_PORTS channel variable (comma-separated, priority order) until one succeeds.
So a message still goes out as long as ANY listed SIM is healthy.

Channel variables read via the AGI protocol (safe for commas/quotes/Arabic):
  SMSBODY   - the message text
  SMS_PORTS - e.g. "29,25,30"  (falls back to AGI arg 2 if unset)
Arg 1 = destination number.
"""
import sys, re, json, urllib.request, urllib.parse


def agi_read_env():
    while True:
        line = sys.stdin.readline()
        if not line or line.strip() == '':
            break


def agi_get_var(name):
    sys.stdout.write('GET VARIABLE %s\n' % name)
    sys.stdout.flush()
    resp = sys.stdin.readline().strip()        # "200 result=1 (value)"
    m = re.search(r'\((.*)\)\s*$', resp)
    return m.group(1) if m else ''


def load_env(path='/opt/sim-collector/collector.env'):
    cfg = {}
    try:
        for ln in open(path):
            ln = ln.strip()
            if ln and not ln.startswith('#') and '=' in ln:
                k, v = ln.split('=', 1)
                cfg[k.strip()] = v.strip().strip('"').strip("'")
    except Exception as e:
        sys.stderr.write('gw_sendsms: cannot read %s: %s\n' % (path, e))
    return cfg


def send_one(host, skport, user, pw, port, to, body):
    coding = 0 if body.isascii() else 1       # 0 = GSM-7 Latin, 1 = UCS2 Arabic
    payload = json.dumps({
        "type": "send-sms", "task_num": 1,
        "tasks": [{"tid": 1, "from": str(port), "to": str(to),
                   "sms": body, "smstype": 0, "coding": coding}],
    }, ensure_ascii=False).encode('utf-8')
    url = "http://%s:%s/goip_post_sms.html?%s" % (host, skport,
          urllib.parse.urlencode({'username': user, 'password': pw}))
    req = urllib.request.Request(url, data=payload, headers={'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            raw = r.read().decode('utf-8', 'ignore')
    except Exception as e:
        sys.stderr.write('gw_sendsms port=%s POST failed: %s\n' % (port, e))
        return False
    try:
        d = json.loads(raw)
        st = (d.get('status') or [{}])[0].get('status', '')
        ok = str(d.get('code')) in ('200', '0') and st.strip().startswith('0')
    except Exception:
        ok, st = False, raw[:80]
    sys.stderr.write('gw_sendsms port=%s to=%s ok=%s status=%r raw=%s\n'
                     % (port, to, ok, st, raw[:160]))
    return ok


def main():
    agi_read_env()
    to = sys.argv[1] if len(sys.argv) > 1 else ''
    body = agi_get_var('SMSBODY')
    ports_raw = agi_get_var('SMS_PORTS') or (sys.argv[2] if len(sys.argv) > 2 else '')
    ports = [p.strip() for p in ports_raw.split(',') if p.strip()]
    if not (to and body and ports):
        sys.stderr.write('gw_sendsms: missing to/body/ports (to=%r ports=%r)\n' % (to, ports))
        return 1

    cfg = load_env()
    host = cfg.get('SK_HOST', '192.168.8.10')
    skport = cfg.get('SK_PORT', '80')
    user = cfg.get('SK_USER', '')
    pw = cfg.get('SK_PASS', '')

    for port in ports:
        if send_one(host, skport, user, pw, port, to, body):
            sys.stderr.write('gw_sendsms: SENT on port %s to %s\n' % (port, to))
            return 0
        sys.stderr.write('gw_sendsms: port %s failed, trying next\n' % port)
    sys.stderr.write('gw_sendsms: ALL ports failed for to=%s (tried %s)\n' % (to, ','.join(ports)))
    return 1


if __name__ == '__main__':
    sys.exit(main())
