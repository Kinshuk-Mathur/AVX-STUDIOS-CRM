# AVX CRM — Netlify final setup

The CRM code and Firebase data migration are ready locally. The live Netlify site still needs this setup and the updated code.

Open https://app.netlify.com/projects/avxstudioscrm/configuration/env

Add these variables for Production (Functions scope, if available):

| Key                           | Value                                                             |
| ----------------------------- | ----------------------------------------------------------------- |
| FIREBASE_PROJECT_ID           | avx-crm-509a3                                                     |
| FIREBASE_SERVICE_ACCOUNT_JSON | Entire contents of your private avx-crm.json file; mark it Secret |
| APP_ORIGIN                    | https://avxstudioscrm.netlify.app                                 |

The private JSON is located at /Users/kinshukmathur/Developer/avx crm/avx-crm.json. Paste its complete JSON object into the secret value field, not the file path. Do not paste the JSON into chat or put it in Git. If scope selection is unavailable, use all scopes.

Do not add NEXT_PUBLIC_ to these keys. Do not set the local GOOGLE_APPLICATION_CREDENTIALS path on Netlify. DATABASE_URL is no longer required by the web app.

Then commit/push the updated project code from /Users/kinshukmathur/Developer/avx crm and let Netlify deploy it. Build command: npm run build. Changing environment variables without deploying the migration code will not switch the old live app to Firestore.

Sign in using your existing owner username and password. Your owner account was preserved. Member requests appear under Viewer Access. If you need a new password, run:

```sh
cd "/Users/kinshukmathur/Developer/avx crm"
APP_ORIGIN=https://avxstudioscrm.netlify.app npm run owner:setup
```

Open the private link printed in your terminal after the updated site is deployed. The link expires in 30 minutes.

Local app: http://localhost:3000/login
Checks passed: 21 emulator tests, lint, types and production build.
