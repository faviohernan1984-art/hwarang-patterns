# President provisioning: Production preparation

Do not execute against Production until the operator has explicit authorization.
The existing `provision:president` and `president:password` remain Emulator-only.

Future command (this does not initialize a password):

```text
npm run provision:president:production -- --apply --project hwarang-patterns-production --room ROOM_ID --email PRESIDENT_EMAIL
```

Required process environment:

- `PATTERNS_ADMIN_ENV=production`
- `GOOGLE_APPLICATION_CREDENTIALS`: absolute path to an external service-account JSON belonging exclusively to `hwarang-patterns-production`.

Keep the file outside this repository, with restricted filesystem access. Never
commit it or put it in any `VITE_*` variable. Use a dedicated Patterns account
with only the IAM permissions needed for Auth user/claims management and
Firestore document transactions. No credential is created by these scripts.
There is no ADC, metadata, Firebase CLI credential or Emulator fallback.
Emulator variables, DEV Admin flags and conflicting project variables abort.
Do not load the local `.env` into this command.

This creates or reuses one Auth user without setting a password, reserves the
UID and Room, and initializes only `control/current`, `meta/current` and
`publicState/current` under `rooms/ROOM_ID`. It also writes Admin-only journals
`_presidentAssignments/HASH_OF_UID` and `_roomProvisioning/ROOM_ID`.
Claims `{ roomId, role: president }` are assigned last. Existing incompatible
claims, disabled users and unsafe/unverified Rooms cause an error. Repeating a
compatible operation preserves existing Room data and recovers interruptions.
An Auth user can remain unassigned if a later step fails; rerun the exact
operation after inspecting the journal. Do not delete or reassign it blindly.
Auth and Firestore are not one transaction: only trusted, serialized operators
should manage assignments. Other Admin writers can bypass these safeguards.
A separate authorized password activation flow is still required.

Offline tests: `npm run test:provision:production`. These use only validation,
temporary synthetic credential fixtures and in-memory stubs; no cloud calls.
