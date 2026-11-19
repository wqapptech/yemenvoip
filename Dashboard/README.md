# SIM Monitor Dashboard

Next.js (App Router) + Firebase. Arabic/English, mobile-first. Reads live SIM
status from Firestore (collection `sims`, written by the gateway status push).

## 1. Install
```
npm install
```

## 2. Firebase web config
Firebase console -> Project settings -> Your apps -> add a **Web app** -> copy the config.
Then:
```
cp .env.local.example .env.local
```
and fill the `NEXT_PUBLIC_FIREBASE_*` values from that config.

## 3. Create your login
Firebase console -> **Authentication** -> Sign-in method -> enable **Email/Password**.
Then **Users -> Add user** (email + password). That is your dashboard login.

## 4. Firestore rules (lets signed-in users read `sims`)
```
npm i -g firebase-tools   # if not installed
firebase login
firebase deploy --only firestore:rules
```

## 5. Run locally
```
npm run dev     # http://localhost:3000
```

## 6. Deploy from your filesystem (no GitHub needed)
```
firebase experiments:enable webframeworks
firebase deploy
```

## Later: App Hosting + GitHub
`apphosting.yaml` is already included. Push this folder to a GitHub repo, then
Firebase console -> **App Hosting** -> create a backend from the repo. Move the
`NEXT_PUBLIC_*` values into `apphosting.yaml` env there. No code changes needed.
