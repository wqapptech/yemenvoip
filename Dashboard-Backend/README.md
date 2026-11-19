# Dashboard-Backend

Firebase Cloud Functions that receive the Skyline GP 532-256 gateway HTTP pushes
and write them to Firestore for the SIM Monitor dashboard.

Function: **gatewayPush** (region `europe-west4`)
- Handles the gateway **status push** (`type: dev-status`) → upserts each SIM into
  the `sims` collection (unchanged behaviour).
- Handles **received messages / USSD replies** → extracts the SabaFon balance
  (`هو<number>وحدة`) and writes `balance` / `balanceNum` to that port's active-slot
  SIM doc. The status push never overwrites it (separate field).
- `GET ...?token=<TOKEN>&debug=1` → returns the last non-status payload it saw
  (for verifying the gateway's push format).

Auth: every request must include `?token=<PUSH_TOKEN>`, stored as a Firebase secret.

## One-time setup
```
cd functions
npm install
cd ..

# Set the shared token (use the SAME value the gateway already appends as ?token=...)
firebase functions:secrets:set PUSH_TOKEN
```

## Deploy
```
firebase deploy --only functions
```
After deploy, note the function URL printed in the output
(`https://gatewaypush-xxxxx-ew.a.run.app` or the cloudfunctions.net URL).

## Point the gateway at it
In the gateway web UI (http://192.168.8.10):
- **Status Notification** → set the push URL to `<FUNCTION_URL>?token=<PUSH_TOKEN>`
- **SMS Settings** (received-message forwarding) → set the same `<FUNCTION_URL>?token=<PUSH_TOKEN>`

## Notes
- Node 22 runtime. Uses `firebase-admin` (Firestore) and `firebase-functions` v2.
- An older `receiveStatus` function (deployed via gcloud/Cloud Shell) may still exist.
  This project deploys a separate `gatewayPush` function; point the gateway URLs at it
  and delete the old `receiveStatus` when convenient.
