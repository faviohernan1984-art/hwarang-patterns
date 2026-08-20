# Patterns GUP LAN E2E — assisted manual runbook

This runbook is local-only. Never continue if a browser request targets `firestore.googleapis.com` or project `hwarang-scoring`. The E2E project must be `demo-hwarang-scoring`.

## Current topology

- Test host LAN IP: `192.168.0.10` (`Wi-Fi`, subnet `192.168.0.0/24`). Re-check with `ipconfig` before every session because DHCP may change it.
- Vite: `http://192.168.0.10:5173`
- Firestore Emulator: `192.168.0.10:8080`
- Auth Emulator: `http://192.168.0.10:9099`
- Emulator UI: `http://127.0.0.1:4000` (host machine only)
- Routes: `/president`, `/public`, `/judge/1` through `/judge/5`.

`firebase.e2e.json` exposes only Firestore and Auth on LAN. The Emulator UI remains loopback-only. Use a trusted private network and close the processes immediately after the test.

## Mandatory blocker before a physical run

The current application initializes project `hwarang-scoring`, does not call `connectFirestoreEmulator`/`connectAuthEmulator`, and has no authenticated role session. Starting Vite alone would therefore connect real devices to production. Starting the Emulator does not redirect the browser automatically.

The prepared Firestore Rules require verified claims, so a meaningful physical test also needs a local-only identity bootstrap that signs each browser into Auth Emulator with President/Judge/Public claims. Simulated claims from `@firebase/rules-unit-testing` cannot be transferred to a real browser session.

Because this block explicitly forbids connecting Auth to runtime, do not run the physical mutation scenarios yet. A subsequent, explicitly authorized change must add an environment-gated E2E connector and trusted local token issuer. It must fail closed unless all of these are true:

```text
VITE_E2E_EMULATOR=true
projectId=demo-hwarang-scoring
hostname is localhost or the approved LAN host
Firestore host is explicitly supplied
Auth host is explicitly supplied
```

Production builds must tree-shake or reject this bootstrap. No role selector may exist outside the local trusted issuer.

## Session commands after the blocker is resolved

Open an elevated PowerShell only for temporary, subnet-scoped firewall rules:

```powershell
New-NetFirewallRule -DisplayName "Patterns E2E Vite 5173" -Direction Inbound -Action Allow -Protocol TCP -LocalPort 5173 -RemoteAddress LocalSubnet
New-NetFirewallRule -DisplayName "Patterns E2E Firestore 8080" -Direction Inbound -Action Allow -Protocol TCP -LocalPort 8080 -RemoteAddress LocalSubnet
New-NetFirewallRule -DisplayName "Patterns E2E Auth 9099" -Direction Inbound -Action Allow -Protocol TCP -LocalPort 9099 -RemoteAddress LocalSubnet
```

Terminal 1:

```powershell
$env:Path = 'C:\Program Files\Eclipse Adoptium\jdk-21.0.12.8-hotspot\bin;' + $env:Path
firebase.cmd emulators:start --config firebase.e2e.json --only firestore,auth --project demo-hwarang-scoring
```

Terminal 2, with the approved E2E-only environment variables:

```powershell
npm.cmd run dev:lan
```

Verify from each device that `http://192.168.0.10:5173` loads. In browser development tools or Emulator logs, confirm there are no requests to `firestore.googleapis.com` before creating test data.

At teardown:

```powershell
Remove-NetFirewallRule -DisplayName "Patterns E2E Vite 5173"
Remove-NetFirewallRule -DisplayName "Patterns E2E Firestore 8080"
Remove-NetFirewallRule -DisplayName "Patterns E2E Auth 9099"
```

Stop both processes and confirm ports are closed:

```powershell
Test-NetConnection 192.168.0.10 -Port 5173
Test-NetConnection 192.168.0.10 -Port 8080
Test-NetConnection 192.168.0.10 -Port 9099
```

## Device matrix and recording sheet

Record exact models and versions during execution; none were available to the automated agent.

| Role | Device/browser | URL | Expected identity |
|---|---|---|---|
| President A | Host browser | `/president` | president, match `patterns-e2e` |
| President B | Second browser/private profile | `/president` | president, same match |
| Judge A | Android/Chrome | `/judge/1` | judge 1, same match |
| Judge B | iPhone/Safari | `/judge/1` | judge 1, same match |
| Public | Optional second PC | `/public` | public, same match |

Use distinct Auth UIDs for the two Judge devices while giving both the same verified `judgeId=1` claim.

## Measurements

Use a monotonic stopwatch and Emulator timestamps. Record:

```text
normal SEND latency:
delayed SEND latency:
time from SEND to CONNECTION DELAYED:
time from reconnection to SENT:
accepted operations:
rejected operations:
final evaluationId:
final persisted judge payload:
final meta/result:
visual state on every client:
```

Do not add permanent production telemetry for this run.

## Scenarios

### Same Judge — POINTS

1. Prepare evaluation N in POINTS and START.
2. Android selects card A; iPhone selects a deliberately different card B.
3. Count down and press SEND nearly simultaneously.
4. Inspect `matches/patterns-e2e/judges/1` in Emulator UI.

Pass: exactly one complete card persists, `sent=true`, no field mixing, no overwrite, both devices converge to the persisted card/SENT state.

### Same Judge — BINARY

Repeat with A=HONG and B=CHONG. Pass: exactly one valid vote persists; never DRAW; both clients converge.

### Disconnect during SEND

Complete the card, press SEND, and immediately disable Wi-Fi on the Judge device. Record the transition time to `CONNECTION DELAYED`. Restore the same Wi-Fi. Pass: no second submission, persisted snapshot wins, UI converges to SENT.

Disabling Wi-Fi also removes access to the LAN Emulator. Do not switch to mobile data: the private `192.168.0.10` endpoint is intentionally unreachable from the internet.

### Real error and manual retry

Disable Wi-Fi before SEND and wait for the operation to reach confirmed ERROR rather than merely DELAYED. Confirm it is not marked SENT. Restore Wi-Fi and use only the visible manual retry. Pass: one valid persisted submission and no automatic duplicate.

### NEXT with an in-flight vote

Delay Judge N by disabling Wi-Fi after SEND. Complete/close N through the remaining valid test setup, then execute NEXT. Confirm meta is N+1 before restoring Judge Wi-Fi. Pass: the N write is rejected as stale and cannot modify N+1; Judge resets to the new evaluation.

### CLOSE with the final vote

At `00:00`, keep one active Judge unsent. CLOSE must remain disabled. Send the last vote over a deliberately weak/delayed Wi-Fi link. CLOSE becomes available only after the authoritative snapshot. Double-click CLOSE. Pass: exactly one official completion.

### Two Presidents

Using two authenticated President sessions, issue simultaneous START, simultaneous PAUSE, then rapid alternating START/PAUSE. Pass: coherent status/timestamp pair, non-negative time, unchanged `evaluationId`, no duplicated evaluation.

## Abort conditions

Abort immediately if:

- any request targets production;
- project ID is not `demo-hwarang-scoring`;
- Emulator is reachable from outside the trusted LAN;
- a device lacks an authenticated, server-issued emulator claim;
- persisted state differs from the expected generation;
- a temporary firewall rule is broader than `LocalSubnet`.
