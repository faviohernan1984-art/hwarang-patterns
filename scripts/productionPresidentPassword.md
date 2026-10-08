# Production President password activation

Future authorized command, from the repository directory:

```text
npm run president:password:production -- --apply --project hwarang-patterns-production --email PRESIDENT_EMAIL
```

Requires `PATTERNS_ADMIN_ENV=production` and `GOOGLE_APPLICATION_CREDENTIALS`
pointing to a dedicated Patterns service-account JSON outside this repository.
It uses the existing productionAdmin restrictions and accepts no Emulator
variables or conflicting projects. No password CLI argument, password
environment variable or piped stdin is supported.

Run in an interactive terminal. Enter a new password of 12-128 characters and
repeat it; neither entry is echoed. Cancellation, EOF or mismatch aborts.
The command can initialize or replace a password on an existing President.
It cannot create users, assign claims or write Firestore documents.

Room identity comes only from the existing Auth claims. Before updating Auth,
it reads the completed `_roomProvisioning/ROOM` journal, the corresponding
`_presidentAssignments/HASH_OF_UID` reservation and all three minimum Room
documents. Missing or incompatible state stops the update. It rereads the user
immediately before updating the password. Other privileged Admin operators must
serialize account/assignment changes: Auth and Firestore are not one transaction.
No Firestore marker is written, so subsequent authorized runs can change the
password again. The local `president:password` remains Emulator-only.

Offline tests: `npm run test:password:production`.
