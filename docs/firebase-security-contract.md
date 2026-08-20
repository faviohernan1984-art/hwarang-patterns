# Firebase security contract (local proposal)

This document describes a development/emulator proposal. It is not connected to the Patterns runtime and must not be deployed before a separate review.

## Identity claims

Every client identity is issued by a trusted backend and carries:

```text
role: "president" | "judge" | "public"
matchId: string
judgeId: string | null
arenaId: string | null
```

Future additions may include `eventId`, `roomId`, judge slot and ownership identifiers. A route, query parameter, local storage value or client-supplied role is never an authorization source.

## Access model

- President: reads and operates only the assigned match. Meta generation may stay unchanged or advance exactly once. Billing and Match Credit fields are excluded from client updates.
- Judge: reads match meta, public state and only the assigned judge document. The judge may make one POINTS or BINARY submission for the current `evaluationId`; it cannot mutate meta, clock, projection, result or another judge.
- Public: reads only `matches/{matchId}/public/state` for the assigned match. It cannot read meta, judges or clock and cannot write.
- Cross-match access and all unspecified paths are denied.
- `public/state` and `clock/state` are backend-written projections; all client writes, including President writes, are denied.

## Public projection

Future path: `matches/{matchId}/public/state`.

Allowed public content is limited to status (`PENDING`/`SENT`), revealed H/C/D outcome, public timing state, competitor display data and official result. It must never contain Technique, Power, Rhythm, Absolute Zero, POINTS cards, individual votes or arbitrary judging data.

## Authoritative clock

Future path: `matches/{matchId}/clock/state` with `evaluationId`, server-derived `startedAt`, `endsAt` and `timeExpired`. A trusted backend owns writes. Public timing is published only through the sanitized public projection.

## Trusted token issuer

Combat's existing Vercel endpoints already demonstrate a Firebase Admin boundary for license/payment work, but none is a role-token issuer. A future dedicated Admin endpoint should accept an authenticated, server-verifiable assignment credential; validate event/arena/room/match ownership and judge slot server-side; then call `createCustomToken(uid, claims)`. It must never accept an unrestricted client request for `role=president` or `judgeId=1`.

## Rooms and Match Credits

The match-scoped claim makes later `eventId`/`arenaId`/`roomId` isolation additive without trusting JOIN input. JOIN provisioning and ownership remain backend responsibilities.

Match Credits remain backend-only. The idempotency key is the finalized `evaluationId`: official result -> President banner CLOSE -> at most one ledger consumption. Firestore client rules must never grant direct credit decrement or increment access.
