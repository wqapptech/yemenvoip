# Collector (runs on the VM)

Two modes, both push to the `gatewayPush` Cloud Function (no Firestore creds on the VM).

- **cdr** — reads new rows from the Asterisk CDR database (`asteriskcdrdb.cdr`) and forwards
  them. Works today; needs only the local MySQL. Shows up in the dashboard **Calls** tab.
- **callstat** — polls the gateway's per-SIM call statistics (`goip_get_call_stat.html`)
  and forwards them into each SIM's `calls` field (seen in the SIM detail sheet).
  Needs the VPN route to `192.168.8.10` to be up.
- **inquiry** — on-demand balance refresh. When someone taps **Check balances** in the
  dashboard, a request is written to Firestore; this mode reads it from the Cloud
  Function (`?balance-pending=1`), sends `*102#` to the inserted SIMs' ports via the
  gateway USSD API, and the gateway parses the reply into `bal` (Balance Keywords must
  be set in Gateway Settings -> Mobile Setting). Needs the gateway route up.

Pure Python 3 standard library + the `mysql` CLI — nothing to `pip install`.

## Setup on the VM
```
sudo mkdir -p /opt/sim-collector /var/lib/sim-collector
sudo cp collector.py /opt/sim-collector/
cp collector.env.example /opt/sim-collector/collector.env
# edit collector.env with your token + DB creds (and gateway creds later)
nano /opt/sim-collector/collector.env
chmod +x /opt/sim-collector/collector.py
```

Test the CDR mode once:
```
set -a; . /opt/sim-collector/collector.env; set +a
python3 /opt/sim-collector/collector.py cdr
```
You should see `posted N CDRs` and rows appearing in the dashboard Calls tab.

## Cron
```
# CDR log — every minute
* * * * * set -a; . /opt/sim-collector/collector.env; set +a; /usr/bin/python3 /opt/sim-collector/collector.py cdr >> /var/log/sim-cdr.log 2>&1

# Per-SIM call stats — every 10 minutes (enable once the gateway route works)
*/10 * * * * set -a; . /opt/sim-collector/collector.env; set +a; /usr/bin/python3 /opt/sim-collector/collector.py callstat >> /var/log/sim-callstat.log 2>&1
```

## Notes
- The CDR collector is idempotent: rows are keyed by `uniqueid` and merged, so a re-run
  never duplicates. It tracks progress in `STATE_FILE`.
- The call-stat field names (`asr`, `acd`, counts) are a best-effort mapping. On first run,
  if nothing maps, it prints a `RAW call-stat` sample to the log — send me that and I'll
  pin the exact field names.

## Inquiry (on-demand balance) — test & cron
Manual one-shot test (force a query to a port, e.g. 29), watch the output and the dashboard:
```
set -a; . /opt/sim-collector/collector.env; set +a
python3 /opt/sim-collector/collector.py inquiry 29
```
A healthy reply from the gateway looks like `HTTP 200` with an `error_code`/`result` JSON.
Within ~20s the balance for port 29's active SIM should change on the dashboard.

Cron — service dashboard balance requests every minute:
```
* * * * * set -a; . /opt/sim-collector/collector.env; set +a; /usr/bin/python3 /opt/sim-collector/collector.py inquiry >> /var/log/sim-inquiry.log 2>&1
```
State file `/var/lib/sim-collector/inquiry_state` remembers the last serviced request
so a query only fires when the dashboard actually asks (not every minute).
