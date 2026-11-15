# scripts/verify — acceptance tooling (PLD/OS X1)

Zero-dependency Node 22 ESM scripts (Node built-in `WebSocket`/`fetch` + system Chrome over CDP).
Chrome path: `C:/Program Files/Google/Chrome/Application/chrome.exe`, override with `CHROME_PATH`.

## Data safety (read first)

- Never point a server at real data (the `…工作日誌` folder). Only ever use a **fresh copy of `backend/data/example`**.
- Never use ports 3000 / 3001. Convention: **3114 = branch under test, 3115 = baseline (main), 3116 = spare**.
- Always `NO_OPEN_BROWSER=1`. Never run `npm start` / `npm run dev` from the main checkout.
- `serve.mjs` enforces all of this (refuses 3000/3001 and any path containing `工作日誌`) and writes a **marker**
  `<scratch>/serve-<port>.json` (`{port, root, dataDir, …}`, removed on exit). `safety.mjs` uses that marker as proof
  that a port serves a scratch copy; every script that mutates server data (seeding, saving a record, exporting) first checks it
  (`--scratch` must be the same directory you gave `serve.mjs`; default `%TEMP%/pld-verify`).
- Mutations that the scripts do on the scratch data (all idempotent or harmless): `c1` seeds record 4 into the trash and a 1×1 PNG on
  record 3 (identically on both servers, only before `dialog` / `lightbox`); `os-e2e` E5 creates one record (copy of the first record),
  E6 lightbox seeds the same photo. Restart `serve.mjs` for pristine data.

### Export Excel rule (匯出 Excel)

Finding (backend/server.js `app.post("/api/export-xlsx")`): the file is always `path.join(DATA_DIR, "工作日誌.xlsx")`
(`writeSnapshotXlsx(store.records, outPath)` in `backend/lib/xlsx.js`); no request parameter or env var other than `DATA_DIR`
moves it. With `serve.mjs`, `DATA_DIR` is the scratch copy, so the export stays inside it. **Before any script clicks 匯出 Excel it must call
`exportTargetInScratch(url, scratch)` from `safety.mjs`** (static check of the served root's `server.js` + marker; nothing is exported by the check). It
returns `{ok, outPath, evidence}`; if `ok` is false (route changed, `DATA_DIR` not inside scratch, no marker) **skip the click and say so**.
`os-e2e --only e1` does exactly that. A human verifier must do the same: only export against a `serve.mjs` server and
confirm the toast path points into the scratch folder.

## Starting servers

Build first (`npm run build` in each worktree → `web/dist`), then (run in the background):

```
node scripts/verify/serve.mjs --root <branch worktree> --port 3114 --scratch <scratch dir>
node scripts/verify/serve.mjs --root <main worktree>   --port 3115 --scratch <scratch dir>
```

Flags: `--root` worktree, `--port`, `--data-from` (default `backend/data/example`, relative to root), `--scratch`
(default `%TEMP%/pld-verify`). It copies the example data to `<scratch>/data-<port>-XXXX`, spawns `node backend/server.js` with
`DATA_DIR`, `PORT`, `NO_OPEN_BROWSER=1`, writes the marker, prints the URL and runs until killed. Stop it when done (it is a plain
node process listening on the port).

## Scripts

| script | purpose | needs OS UI |
|---|---|---|
| `cdp.mjs` | CDP driver: `Browser.launch({port, headless, userDataDir, args})`, `newPage({…, contextOf})` (`contextOf: page` = new tab in the same profile), `goto`, `eval`, `waitFor`, `addInitScript`, `throttleCPU`, `webglRenderer`, `key/keyDown/keyUp` (modifiers bitmask, Ctrl = 2), `insertText`, `mouse*`/`click`, `clickEl`, `rectOf`, `screenshot`, `startScreencast`, `setViewport`, `setMedia`. | – |
| `snap.mjs` | `takeSnap(page,{scope})`, `diffSnaps(a,b,{ignoreProps,ignoreRect,ignoreWidthRelated,ignoreCustoms,ignoreOffsetY})`. | – |
| `safety.mjs` | scratch-server proof, `exportTargetInScratch`, idempotent seeding (`seedPhoto`, `seedTrash`), `firstRecordId`. | – |
| `c1.mjs` | S1 / S4(b) comparator (two servers, per scenario / width / theme). | S4(b) only |
| `os-bundle.mjs`, `bundle-graph.mjs` | A5 + P4 + HB4 bundle checks on `web/dist`; grouped (`os`, `holo-core`, `holo-ch01`–`ch07`). | – |
| `os-handoff.mjs` | I1–I4 (transition input gating, overlay, rapid enter/Esc). | yes |
| `os-e2e.mjs` | E2 E3 E5 E6 E7, device gate, mode persistence, EXIT TO WEB, sidebar button, WebGL fallback, E1 export guard. | yes |
| `os-shots.mjs` | design-review material (hub, strips, stations, palette, gate). | yes |
| `os-perf.mjs` | P1 fps (headed, real GPU) and P2 rAF attribution. | yes |
| `os-p6.mjs` | P6 heap growth (forced GC) + WebGL resource release, branch and main side by side. | yes |
| `holo-seed.mjs` | HOLO synthetic records + photos, written straight into a scratch server's `DATA_DIR` (1k / 5k / 20k). | – |
| `holo-ime.mjs` | HF3 automated part: Chinese IME composition in the H1 lab slate (CDP `Input.imeSetComposition`). | lab |
| `holo-perf.mjs` | HP1 / HP2 / HP5 / HP7 + slate typing latency (headed, real GPU, 4× CPU option). | lab |
| `holo-slate-compare.mjs` | Slate positioning, method P (projection) vs C (CSS3DRenderer): sharpness, hit, focus ring, frame cost, red lines. | lab |
| `holo-still.mjs` | Reduced-motion stillness (spec §4.2): pixel diff 0, runtime toggle both ways, legacy `?scene=machine` falls back to the spiral. | lab |
| `verify-holo.mjs` | **One-command verification** (`npm run verify:holo`): CI six steps + static red lines + lab bundle + c1 zero-diff + OS regression + H1 lab scripts, one JSON and one summary line (section below). | partly |
| `holo-baseline.json` | Thresholds `verify-holo.mjs` reads (test-count baseline, c1 combination counts, OS check counts, perf gates, shim list). Update after every merged PR. | – |
| `os-common.mjs` | selectors (`SEL`, `hudCh(n)`), page hook, helpers (`waitPhase` auto-passes B1, `passB1(page)`), `Reporter`. | – |
| `serve.mjs` | safe server launcher. | – |

## verify-holo.mjs — `npm run verify:holo` (H2-0)

```
npm run verify:holo -- [--base <main worktree>] [--quick] [--full] [--only a,b] [--out <dir>] [--allow-software] [--diff-base main]
```

`--full` additionally runs `os-handoff-4x` (the same os-handoff at CPU 4x, more than 25 minutes). **Use `--full`** for: every L2 round of H2-5, the last L2 round of every phase from H3 on, and any PR that touches the input gate, the transitions or `useBlocker`. Without `--full` that item is `N/A` (not counted in the totals, does not make the run INCOMPLETE).

Delivery and L1 run the full version; `--quick` (groups A and B, about 3 minutes) is for the coordinator while developing. Zero new dependencies (`cdp.mjs`, `serve.mjs`, `safety.mjs`). The script calls the existing scripts and reads their output files / exit codes; it does not re-implement them.

| id | group | what | threshold (numbers live in `holo-baseline.json`) |
|---|---|---|---|
| ci-check | A | `npm run check` | exit 0 |
| ci-test | A | `npm test` | exit 0, 0 failed, passed >= baseline, skipped <= baseline |
| ci-typecheck | A | `npm run typecheck` | exit 0 |
| ci-test-web | A | `npm run test:web` | exit 0, 0 failed, tests and files >= baseline |
| ci-build | A | `npm run build` | exit 0 |
| ci-bundle | A | `npm run verify:os-bundle` | exit 0 (A5, A5-holo, entry gzip delta <= 2 KB, group limits) |
| entry-delta-vs-base | A | web entry gzip of this worktree minus the `--base` worktree, both measured with `os-bundle.mjs --dist … --json` (gzip -9 of the entry static-graph JS) | delta <= `entry.deltaVsBaseMaxBytes` (+100 B); SKIP without `--base`. `bundle-baseline.json` is **not** updated (HB1: the whole plan may add at most 2048 B over it); `ci-bundle` keeps that limit. If H2 would push the total past 2048 B, stop and ask the designer |
| tests-untouched | B | `git diff --name-status <diff-base>...HEAD -- '*.test.*'` | only status `A`; any `M` / `D` / `R` is FAIL (files listed) |
| redline-grep | B | added lines of `git diff <diff-base>...HEAD` | five rules, any hit FAIL: (1) View Transitions API in code, (2) `pld.theme` written outside `theme.ts`, (3) personal absolute path or the real-data folder name in a new file, (4) any change in a `package.json` dependency block, (5) a shim (list = `shims` in `holo-baseline.json`) that is not a pure `export … from` |
| lab-bundle | C | lab build (`VITE_HOLO_LAB=1`, output to a scratch dir through `WEB_OUT_DIR`) + `os-bundle --expect-holo` | exit 0, holo-core <= 220 KiB |
| c1-web | C | `c1.mjs --base 3115 --new 3114`, 3 themes x 375/900/1280 x all scenarios | 0 diffs, 0 ACTFAIL, combination count == `c1.webCombos` (guards against deleted scenarios) |
| c1-os | C | c1 `--scope main --ignore-offset-y`, both sides `?mode=os`, standard-light, 1280 and 1024 wide (`c1.osWidths`), the 9 S4(b) scenarios = 18 combinations | 0 diffs, 0 ACTFAIL, combinations == `c1.osCombos` (18). The DeviceGate screen itself (< 1024x600) is not a c1 combination: `os-e2e` GATE / E2.gate-dirty own it |
| os-e2e | C | `os-e2e.mjs` | 0 FAIL, 0 SKIP, pass >= `osE2e.pass`, MANUAL <= `osE2e.manual` (E1 is manual by design) |
| os-handoff | C | `os-handoff.mjs` (I1–I4), args from `osHandoff.args` (headed, CPU 1x by default, `--allow-deviated`) | 0 FAIL, samples >= `osHandoff.samples`, conclusive passes (samples - fail - DEVIATED) >= `osHandoff.conclusiveMin`, **DEVIATED <= floor(`osHandoff.baselineDeviated` x 1.5)** (else INVALID, escalate to L2); the DEVIATED count is reported in `value` |
| os-handoff-4x | C | the same at CPU 4x, only with `--full` (otherwise `N/A`); thresholds in `osHandoff4x` | same rules with the `osHandoff4x` numbers |
| holo-ime | D | `holo-ime.mjs`, method proj, freeze on and off | all PASS; window not focused = INVALID |
| holo-still | D | `holo-still.mjs` | reduced-motion pixel diff 0, control diff > 0 |
| holo-perf | D | `holo-perf.mjs --modes fps`, 5k records | idle and operating median >= 55 fps; software renderer = INVALID |
| holo-perf-20k | D | same, 20k records | >= 30 fps |

Output:

- `<out>/verify-holo.json`: `{schema, head, base, summary, items:[{id, group, status, value, threshold, durationMs, log, reason}], …}`. Every item is always present; `status` is `PASS` | `FAIL` | `SKIP` | `INVALID` | `N/A` (os-handoff-4x without `--full`); a SKIP or INVALID carries a `reason` (no `--base`, `--quick`, `--only`, software renderer, window not focused, build failed, a command timed out after 40 minutes…). `log` is the item's full output, relative to `<out>` (`logs/<id>.log`). Sub-results (c1, os-e2e, … JSON and screenshots) are in `<out>/<script>/`.
- Last stdout line: `VERIFY:HOLO <PASS|FAIL|INCOMPLETE> 17/19 pass, 1 fail (c1-web), 1 skip (holo-perf) — <path to json>`.
- Exit code: 0 all PASS | 1 any FAIL | 2 no FAIL but some SKIP / INVALID. **2 is not a pass**: L1 escalates to L2.

Servers and builds: the script starts its own scratch servers with `serve.mjs` (always a copy of the example data in a fresh temp folder; `assertScratchServer` first): **3114** this worktree (default `web/dist`), **3115** the `--base` worktree (its `web/dist`; built there if missing, no source change), **3116** this worktree's lab build. The lab build goes to a scratch folder (`WEB_OUT_DIR=<abs dir>` read by `web/vite.config.ts`, default stays `dist`; the server gets `WEB_DIST_DIR`), so it never overwrites `web/dist`. A port that already answers is never reused (INVALID). D group data: `holo-seed.mjs` writes 5000 records (20000 for holo-perf-20k) into the 3116 scratch copy. Everything is stopped at the end, on failure and on Ctrl+C.

Prerequisites for the full run: the `--base` worktree of main (kept untouched under `pld-wt/`, `npm install` done), a visible desktop with a real GPU for group D, Chrome at `CHROME_PATH`. The B group compares against `--diff-base` (default `main`, the local branch), so commit first: uncommitted changes are not in `main...HEAD`.

`holo-baseline.json` is measured, not guessed (its `measuredOn` block names the machine and date; DEVIATED counts and fps are machine-specific). **Any change to `holo-baseline.json` must be explained in the PR body**, and L2 reads its diff line by line. Re-measure: re-run `npm test` / `npm run test:web` on the new main after every merge and write the numbers (they only grow). `shims` stays `[]` until H2-6 moves files into `features/os/core/`; then list every old path there (repo-relative, e.g. `web/src/features/os/…`).

X4 note: a fresh tab (no `sessionStorage pld.os.boot`) shows B1 (`[data-os="b1"]`, PRESS ANY KEY) before the boot; `waitPhase(p, 'hub')` and `os-e2e settled()` press one key via `passB1`. Deep links to a station, short boots and reduced motion after the first pass have no B1. Audio debug hooks: `?osdebug=audio` → `window.__osAudio()`, `window.__osAudioRender(id)` (see docs/os-mode-spec.md X4 notes).

DOM contract used by the OS scripts: `<html data-mode="os" data-os-phase="hub|entering-pre|entering-post|station|exiting-pre|exiting-post|switching-pre|switching-post">`,
`[data-os="hud"]`, `[data-os="hud-ch"][data-ch="CH-0N"]` (`aria-current="true"` = selected), `[data-os="statusbar|clock|exit"]`,
`[data-os="palette|palette-input|palette-list|palette-error"]`, `[data-os="station|back|live|hub|overlay|device-gate|device-gate-web|enter-os"]`, `canvas#os-overlay[data-active]`.

## c1.mjs — style / layout / AX comparison (S1, S4(b))

```
node scripts/verify/c1.mjs --base http://localhost:3115/ --new http://localhost:3114/ --theme all --out verify-out/c1 --scratch <scratch dir>
```

- `--base`, `--new` base URLs. `--base-query` / `--new-query` extra query per side, e.g. `--new-query "?mode=os"`
  (query goes **before** the `#`, the scenario route follows). `--theme cyber` appends `theme=cyber` to both sides
  (unless that side's query already sets `theme`).
- `--theme standard-light|standard-dark|cyber|cyber-light|all` (comma list ok). `all` = standard-light, standard-dark, cyber(dark).
- `--widths 375,900,1280`, `--scenarios dashboard,records,new,calendar,trash,settings,report,detail,more-panel,form-validation,lightbox,dialog`
  (default all; `more-panel` only at 375). Scenarios run plain-first, data-dependent ones (`lightbox`, `dialog`) last.
- `--scope main` snapshots only that subtree (paths relative to the scope root; `:root` custom-property diffs skipped).
  `--ignore-width-related` skips width-derived props and rect x/w (S4(b): OS frame has a different width).
  **`--ignore-offset-y`** (needs `--scope`) subtracts the scope root's own y from every rect y, i.e. ignores the vertical offset of the whole
  `<main>` caused by the OS frame bar (56 px) while still comparing the layout inside it.
  **`--ignore-vertical`** skips every height-related difference (rect y/h, `height`/`block-size`/`min-/max-height`, `top`/`bottom`/`inset-block`, `grid-template-rows`, origins) so each element is compared by computed style keyed by DOM path,
  independent of the height/offset difference of `<main>` (OS frame bar + different viewport height stretch every descendant vertically; `--ignore-offset-y` alone left ~525 vertical diffs). Width-related diffs are still reported
  unless `--ignore-width-related` is also given. Self-test: the same server on both sides must give 0 diffs.
  `--new-storage k=v,k2=v2` sets localStorage entries on the `--new` side only (new-document script), e.g. `pld.os.crt=off|std|max` for the three CRT intensities.
- **Determinism (new)**: before each snapshot every finite animation/transition is finished and every infinite one (cyber cursor blink, scanlines…) is
  paused at t=0. Default `--freeze all` first injects a style that forces `animation-duration/-delay` and `transition-duration/-delay` to `0s` on every element and pseudo-element
  (X5 §5.2, no timing-induced false diffs), then runs the JS finish/hold pass; `--freeze css` = CSS only, `--freeze js` = JS only, `--freeze none`. `Date` is pinned to 2026-01-12 09:00 +08:00 and the timezone to Asia/Taipei
  (`--no-freeze-time` to disable) – removes the minute-rollover flake of the new-record form and "today" highlighting.
- **Act failures fail (new)**: a `wait`/`act` step that cannot be performed prints `ACTFAIL`, counts as a failure and the exit code is 1; it is never compared silently un-acted.
  (X0 clicked without scrolling and silently missed off-screen buttons, e.g. `form-validation`; clicks now scroll into view first.)
- **Data-dependent scenarios (new)**: `dialog` needs a trashed record, `lightbox` needs a record with a photo. The example data has neither, so right before those scenarios
  c1 seeds both servers identically via the API (`seedTrash` record 4, `seedPhoto` record 3), **only on servers proven to be serve.mjs scratch servers** (`--scratch`).
  Without proof the scenarios ACTFAIL (they never run silently).
  X5 §5.3: every overlay scenario (`dialog`, `lightbox`, `detail`, `more-panel`) has an `opened` check that is re-evaluated after the settle delay: if the dialog/lightbox is not really open, the scenario is an ACTFAIL (a failure), not a pass. `--no-seed` disables seeding (data must already exist).
- OS mode on the `--new` side: pass `--new-query "?mode=os"`; the capture waits for `data-os-phase="station"`.
- `--ax` / `--no-ax` AX-tree comparison (default: on only when not scoped). `--shots`, `--settle`, `--settle-after`, `--verbose`, `--cdp-port`, `--headed`.
- Output: one line per scenario (`OK` / `DIFF` / `ACTFAIL`), JSON in `<out>/c1-result.json`. Exit 1 if any style/rect/pseudo/text/missing/extra/AX diff or any ACTFAIL
  (animation counts, `data-fx`, new custom properties are informational).
- With `--scope main`, portal content (dialogs, lightbox, more-panel) is outside `main` and not compared.

S1 (web mode must be identical): `--base :3115 --new :3114 --theme all --widths 375,900,1280` (expect 0 diffs, 0 ACTFAIL).
S4(b), once per CRT level (`off`, `std`, `max`):
`--base http://localhost:3114/ --base-query "?theme=cyber" --new http://localhost:3114/ --new-query "?mode=os" --new-storage pld.os.crt=std --theme standard-light --scope main --ignore-offset-y --ignore-vertical --ignore-width-related --widths 1280 --scenarios dashboard,records,new,calendar,trash,settings,report,detail,form-validation`
(web Cyber = `?theme=cyber`; the base and new sides may be the same server because mode is chosen by query). Drop `--ignore-width-related` to list the width-related differences (OS `<main>` is 1100 px wide vs 1056/1041 px next to the web sidebar; every element inside shifts x / changes w accordingly).
(At 1280 only: the OS shell needs ≥1024 wide, below that the device gate replaces the station.)

## os-handoff.mjs — I1–I4

```
node scripts/verify/os-handoff.mjs --url http://localhost:3114/ [--throttles 1,4] [--only i1,key,switch,i2,i3,i4] [--kinds enter,exit,switch] [--reps 3]
   [--viewport 1440x900] [--osdebug a,b] [--enter-step 50 --exit-step 50 --switch-step 25] [--tolerance 25] [--attempts 3] [--strict-focus] [--allow-deviated] [--headed] [--out dir]
```

- Hook (`os-common.mjs HOOK_SRC`): stamps every `data-os-phase` change and every pointer/key event with `performance.now()`. The click/key is **armed before the
  transition is triggered** (`__at(phase, since, offset, lead)`), so it is issued at *phase-change stamp + offset*; the **achieved** offset is then computed from the stamps.
  A sample whose achieved offset differs from the planned one by more than `--tolerance` (25 ms) or that lands in another phase is **DEVIATED**: retried (CDP latency compensation is learned),
  and if it never lands it is reported as DEVIATED – inconclusive, never counted as a pass. A behavioural failure at any achieved offset inside the pre phase is a FAIL.
- Exit code: 1 any FAIL; 3 no FAIL but DEVIATED samples; 0 clean (`--allow-deviated` turns 3 into 0).
- **Precision caveat**: software GL (headless default, SwiftShader) saturates the renderer main thread right after a transition starts, so early offsets (≤ ~150 ms) are often not reachable (many DEVIATED).
  For authoritative numbers use `--headed` on a GPU machine (as for P1); for a headless smoke use `--viewport 1024x640 --osdebug nobloom,nosway`. Hub canvas load is the dominant factor.
- I1 pointer: ENTER 0..850 step 50 × {over `/records` sort control, over HUD CH-02}; EXIT 0..**300** step 50 × over HUD CH-02 (pre-handoff window; the 300..900 ms remainder is covered by I2 below); SWITCH (CH-02→CH-01, via `location.hash` and via palette `dash`) 0..75 step 25 × {over ◀ HUB, over a dashboard KPI card}.
  Asserts: phase jumps to `station`/`hub`, hash unchanged (no `sort=asc`, no navigation), no dialog, underlying control not focused, no phase regression after the jump (stale timers), then the second click on the real target works.
- I1 keyboard (`--only key`): Enter and Space at several offsets, **focus placed on a real control** (enter: another HUD button / EXIT; exit: the sort control; switch: ◀ HUB). The control must not act; the keydown target and focus
  placement are printed. If every candidate is inert the focus falls to `body` (noted; `--strict-focus` turns that into a FAIL).
- I2: first click 0/10/25/50 ms after the `*-post` stamp (enter/switch) must hit the destination target (pointerdown target label checked, then the effect: `sort=asc` / `entering-pre` / `exiting-pre`).
  **EXIT is sampled further: 0/10/25/50/100/200/300/400/500/600 ms after `exiting-post`, i.e. 300..900 ms after the transition start** (X5 §5.1: the whole 900 ms is covered; the last offset may land in the `hub` end phase, which is accepted because input must be live there too). None of these clicks may be swallowed.
- I3: 12×7 grid + corners + centre sampled every frame/16 ms over palette open/close, enter, short switch and exit: overlay computed `pointer-events:none` in every phase, never returned by `elementFromPoint`, all 8 phases seen (missing ones listed).
- I4: hub → 10 × (Enter/click on HUD CH-02, 100 ms, Esc, 100 ms) + a final enter (keyboard and pointer variants). After settling: exactly one stable `data-os-phase` token, route ⇔ phase (`#/os` ⇔ hub), no `#os-overlay[data-active=true]`, overlay `display:none`, one live region,
  no dialog, focus on a HUD button (hub) or inside `#main` (station), state unchanged 600 ms later.
- Writes `<out>/result.json` (every sample with planned/achieved offset), prints a matrix.

## os-e2e.mjs — functional checks

```
node scripts/verify/os-e2e.mjs --url http://localhost:3114/ --scratch <scratch dir> [--only e2,e3,e5,e6,e7,gate,persist,exit,sidebar,webgl,e1] [--list] [--osdebug nobloom,nosway] [--headed] [--shots] [--out dir]
```

`--only` matches check ids by prefix (e.g. `E2.new.back`). Each check prints PASS / FAIL / SKIP / MANUAL with evidence; screenshots of the last page on FAIL in `<out>/shots`; `<out>/result.json`.
Exit 1 on any FAIL. SKIP (e.g. mutating check without scratch proof) and MANUAL are never passes.

| id | covers | notes |
|---|---|---|
| `E2.new.*`, `E2.settings.*`, `E2.edit-form` | E2: Esc / ◀ HUB / history back / palette `dash` on a dirty form → confirm dialog; cancel keeps route, phase `station`, no transition (checked from the phase log); confirming ◀ HUB plays EXIT | |
| `E3.history` | back/forward: hub→ch enter, ch→hub exit, ch→ch switching, same channel none | |
| `E3.direct` | direct `#/records/<id>/edit` → station, edit form, no entry transition | id from the served data |
| `E5.drill`, `E5.detail`, `E5.save-toast` | chart drill, detail 編輯 (same channel: no transition per §3.3) / 複製為新紀錄 (switching), save redirect + toast 「查看」 | `E5.save-toast` creates a record (scratch proof required) |
| `E6.*` | one Esc closes only: detail sheet (+ a second Esc leaves), confirm dialog, popover, combobox, lightbox, palette | lightbox: photo seeded on a proven scratch server; otherwise the photo must already exist. If the lightbox does not open the check FAILS (never SKIP) |
| `E7.focus/title/skip-link/print` | focus on `#main` after every page change (not on first load), `document.title` for 7 routes + edit, skip link, print layout (OS chrome hidden, `<main>` rect and PDF page count equal to web mode) | print PDF count needs headless |
| `GATE` | device gate at 1000×700, 1280×500, 1023×768 (shown) / 1024×600, 1280×720 (hidden); no hub/HUD/outlet/canvas while gated; button → web persisted; cold gated load enters without transition | |
| `PERSIST` | `pld.mode` in localStorage, reload, new tab (same profile), `?mode=` override + URL cleanup (other query kept), X0 `sessionStorage` key removal, no cross-tab sync, throwing storage | |
| `EXIT` | EXIT TO WEB from hub (→ `/dashboard`) and palette `exit` at a station (keeps path); theme per `pld.theme` (standard & cyber), focus `#main`, `pld.mode=web` | |
| `SIDEBAR` | `[data-os="enter-os"]` rendered only ≥1024 (0 elements at 1023/900/375), click → hub without reload, focus on the selected HUD button | |
| `WEBGL` | second Chrome with `--disable-webgl --disable-3d-apis`: toast 「顯示卡不支援，已改用網頁模式」, `pld.mode=web`, cyber for this load only, route kept (hub → `/dashboard`) | SKIP if the flags are not honoured |
| `E1` | **MANUAL** (see below) + export guard report + export click only if the guard passes and a 匯出 Excel control exists in the OS shell | |

Not automatable / left to the independent verifier by hand: **E1** (new record with photo upload, edit, delete/restore/permanent delete, report printing, settings save – compare with web mode; photo capture and print dialogs are unreliable over CDP),
**E4** final judgement (the script reports print rects, PDF page counts and screenshot hashes as proxies), **S5** moiré at 100/125/150 % Windows scaling, **P1/P6** on the real GPU (`os-perf.mjs` headed; `os-p6.mjs`), audio/UX feel (§9.7), real touch behaviour, screen-reader announcements of the live region
(the script only checks DOM text), design-review judgement of the shots.

## os-shots.mjs — design review material (§9.6)

```
node scripts/verify/os-shots.mjs --url http://localhost:3114/ --out verify-out/os-shots [--only hub,station,palette,gate,strips] [--headed] [--osdebug nobloom] [--strip-width 1600]
```

Saves `hub-1920x1080.png` (+ selection moved to CH-05), `station-{records,dashboard}-{1280,1920}.png`, `palette-open-hub.png`, `palette-error-station.png`, `device-gate-1000x700.png`, `device-gate-1280x500.png`
and frame strips `strips/{enter,exit,short-hash,short-palette}.png` (CDP screencast frames matched to planned offsets measured from the phase stamp; labels show the real frame offset and phase; individual frames in `frames/`; `index.html` lists everything).
Strips are for design judgement, not pixel-exact; software GL yields fewer distinct frames, use `--headed` on the GPU machine for smooth ones.

## os-bundle.mjs — A5 + P4 + HB4 (groups)

```
node scripts/verify/os-bundle.mjs [--dist web/dist] [--baseline <bytes>] [--baseline-file f] [--write-baseline] [--expect-holo] [--json out.json]
```

- Parses `index.html` entry `<script type=module>` + `modulepreload` links; follows static `import…from"./x.js"`, `import"./x.js"`,
  `export…from"./x.js"` (not `import()`, not `__vitePreload` arrays).
- A5 FAIL if any chunk in that static graph has a name matching `three|fiber|OsShell|features/os`, contains three markers
  (`__THREE__`, `WebGLRenderer`, `WebGLRenderTarget`, `@react-three`, `BufferGeometry`, `WebGLProgram`) or holo engine markers
  (`__holoLab`, `holo-slate`, `holo-root`, `holo-world`; plus `HoloLabPage` / `/_holo` unless `--expect-holo`).
- **A5-holo** (default build): `dist/.vite/manifest.json` has no source under `features/holo/` and no JS/CSS file in the whole dist contains those markers.
- **Groups** (HB4; gzip -9, JS only, 1 KiB = 1024 B): `os` 300 KiB (lazy chunks matching the three/OS name/marker rules plus their lazy static deps),
  `holo-core` 220 KiB, `holo-ch01`…`holo-ch07` 60 KiB each. A chunk is counted once, in the first group that reaches it (os first), so the three
  shared with OS is not counted twice. Holo groups come from the manifest (`build.manifest` in `web/vite.config.ts`; adds only `.vite/manifest.json`, changes no chunk):
  a lazy chunk whose source is `src/features/holo/**` is `holo-core`, `src/features/holo/(channels/)ch0N/**` is `holo-chN`; each group is those chunks
  plus their static imports not already in the entry graph or an earlier group. **A group with no chunks prints `SKIP (not built yet)` and never fails.**
- P4: entry static-graph JS gzip(-9) minus baseline must be <= 2048 B (baseline from `--baseline` or `bundle-baseline.json`
  `{ "entryGzipBytes": N }`; missing => skipped with a notice); OS group <= 300 KiB. Reports entry CSS gzip too.
- **Lab build**: `VITE_HOLO_LAB=1 npm run build` then `node scripts/verify/os-bundle.mjs --expect-holo` measures `holo-core` (HB2 prototype figure) and requires it to exist.
  Run a plain `npm run build` afterwards so `web/dist` is the default build again (CI step 6 and the A5-holo check expect that).
- `--write-baseline` writes `scripts/verify/bundle-baseline.json` from the current dist — run it on a **main** build.

## os-perf.mjs — P1 / P2

```
node scripts/verify/os-perf.mjs --url http://localhost:3114/ [--only p1,p2] [--dist web/dist] [--osdebug nobloom,nosway,nophosphor | --no-bloom --no-sway --no-phosphor] [--duration 10] [--p2-seconds 3]
```

- P1 launches **headed** Chrome (needs a visible desktop + real GPU), 1920×1080, `?mode=os[&osdebug=…]`. Prints the WebGL renderer;
  SwiftShader/llvmpipe/software ⇒ `INVALID`, exit 2. Hub idle 10 s rAF deltas ⇒ median fps (pass ≥ 55) and p5 fps; repeated at 4× CPU (pass ≥ 30).
- P2 wraps `requestAnimationFrame` (new-document script), loads the station (direct load and by clicking the **selected HUD channel button**
  `[data-os="hud-ch"][aria-current="true"]`), waits for phase `station`, records stacks for 3 s and counts calls whose stack contains a file of an OS lazy chunk
  (computed from `--dist`, or `--os-chunks a.js,b.js`). Expect 0; other callers (react, entry, radix, sonner…) are listed for information.
- Results in `<out>/result.json`. Exit 1 on failure.

## holo-seed.mjs — synthetic data (§11.2)

```
node scripts/verify/serve.mjs --root <worktree> --port 3114          # background; example data copy
node scripts/verify/holo-seed.mjs 3114 5000 [--scratch dir] [--photos 2] [--seed 1] [--end YYYY-MM-DD]
```

- Refuses anything that is not a `serve.mjs` scratch server (`assertScratchServer`: no 3000/3001, marker required, no real-data folder name, `DATA_DIR` inside scratch).
- Writes `data.json` (temp file + rename) and `照片/<YYYYMMDD>/seed-<id>-<n>.png` directly (posting 20k records through the API would rewrite data.json 20k times).
  The running server reads data.json on every request: no restart. Run it again to replace the data (it keeps `_meta` and replaces `records`);
  before writing, it deletes the previous run's photos: only files named `seed-<id>-<n>.png` directly inside `照片/<YYYYMMDD>/` (and date folders left empty), only after the scratch check passed.
  Any other file in `照片/` (example photos, other names) is left alone.
- Distribution: 15 equipment, 22 categories; severity 13 / 66 / 20 / 1 %; status 10 % 待處理, 5 % 追蹤中; at most 11 records a day, the span follows from the count
  (ends today, or `--end`); durations are consistent with `severityFromDuration`; photos binomial(2N, ½) per record (mean N, default 2), flat-colour PNG with the id and date in a 5×7 font, <= 50 KB.
- Reads everything back (count, unique ids, every photo file exists) and prints the distribution. 5k takes seconds, 20k about 80 s.
- Unit tests: `test/holoSeed.test.js` (runs in `npm test`).

## The H1 lab scripts (need the LAB build: `VITE_HOLO_LAB=1 npm run build`)

```
node scripts/verify/holo-ime.mjs   --url http://localhost:3114/ [--methods proj,css3d] [--freeze 1,0] [--out dir]
node scripts/verify/holo-perf.mjs  --url http://localhost:3114/ --n 5000 [--throttle 4] [--modes fps,hp2,hp5,input,hp7] [--duration 10] [--soak 300]
node scripts/verify/holo-slate-compare.mjs --url http://localhost:3114/ [--out dir]
node scripts/verify/holo-still.mjs --url http://localhost:3114/ [--gap 700] [--out dir] [--allow-software]
```

- All four launch **headed** Chrome (`cdp.mjs`) and write nothing to the app data. `holo-perf` and `holo-still` stop with `INVALID` (exit 2) when the WebGL renderer is SwiftShader / llvmpipe / software.
- `holo-ime` (HF3, automated half): for each positioning method × freeze setting, drives the slate while the (script-driven) world moves: the spiral does not turn by itself, so the script drifts the yaw and flips the cursor one day back and forth, which moves the slate anchor: composition then Enter (plain and IME-style key 229), ArrowDown/Up, Escape in the `<input>`,
  the `<textarea>` and the `Combobox`; checks no dropped text, no newline / option / submit during composition, and that Enter outside composition does submit. Key events during CDP composition are sent as keydown+keyup only
  (no char event), like a real IME. **Not measurable here: where the OS candidate window appears** - that is the manual Zhuyin session.
- `holo-perf`: `fps` = HP1 (median rAF fps, idle and operating; gates 55 for 5k, 30 for 20k, 30 for 5k at 4× CPU) · `hp2` slate open (proj) + world still · `hp5` readyMs (mount → first frame that contains the world) split into data load, engine (critical part), buildSpiral, scene build, first world frame and other (they add up to readyMs) · `input` keydown → next frame in the slate ·
  `hp7` thumbnails: (a) decoding / resident / textures sampled every 250 ms for `--soak` s, heap after forced GC every 15 s; (b) TTL test without slot pressure: two disjoint sparse windows (A + B ≤ 24 thumbnails), cursor held on B after visiting A, resident must not drop before ~28 s, must drop at 29–33 s by A's count with `released` growing by the same amount (needs sparse photo windows, i.e. two disjoint 7-day windows with 3–12 photo cards each; with dense data such a pair may not exist, then the script prints `FAIL ... seed sparser data, e.g. holo-seed.mjs <port> 1000 --photos 0.5` and exits 1. 1k records at the default 2 photos did not have one, 1k at `--photos 0.5` did). fps cannot exceed the display refresh
  (a blank headed page measures ~56 fps on the dev machine), so the 55 fps gate is judged against that cap.
- `holo-still`: reduced-motion stillness (spec §4.2). spiral × crt std/off/max (the H1 machine sample was removed; the spiral does not turn by itself, also asserted; a legacy `?scene=machine` URL must fall back to the spiral) with `prefers-reduced-motion: reduce` emulated: two screenshots 0.7 s apart must be identical (control run without reduced motion must differ);
  then the runtime toggle in both directions (load normal → reduce → normal, and load reduced → normal → reduced): the world must be still / moving again within 1 s of each `Emulation.setEmulatedMedia`. Hides the lab's fps readout. Exit 1 on failure.
- `holo-slate-compare`: the six comparison points of spec §3.3 for `proj`, `css3d` (fixed plane) and `css3d-billboard`; results in `<out>/result.json` plus PNG crops.
  Sharpness uses one fixed-size crop (240×40 CSS px) around a fixed test-text block the script adds to the slate, identical for every method; click hits are reported as `hitRateInView` (controls whose centre is on screen) and `offscreenFraction` separately.
- Page hooks: `#/_holo?slate=proj|css3d|off&crt=off|std|max&freeze=0&bb=1&holodebug=1`; with `holodebug=1` `window.__holoLab()` returns frames, `timing` (HP5 split),  `renderer.info`, camera, spiral counts, thumbnail stats and the slate probe
  (`resetProbe()`, `setView(yaw, pitch, dist)`, `moveCursor(d)`, `setCursor(day)` are properties of the function).

## os-p6.mjs — P6 (X5 §5.4 fixed method)

```
# 3114 = branch, 3115 = main/baseline (both started with serve.mjs); headed Chrome on the GPU machine
node scripts/verify/os-p6.mjs --url http://localhost:3114/ --base http://localhost:3115/ [--cycles 20] [--warmup 1] [--rounds 1]
```

- One script, one Chrome launch, both servers measured (separate browser contexts, interleaved; `--rounds N` alternates the order, medians are used).
- **Every heap read is preceded by `HeapProfiler.collectGarbage`** (3 passes) and read with `Runtime.getHeapUsage().usedSize`. Heap baseline = post-GC heap at the hub after
  `--warmup` enter/exit cycles (default 1: the first enter loads the lazy OS chunks, which is not growth); heap after `--cycles` (default 20) further cycles is compared to it.
  Growth vs the cold first hub is printed too (informational).
- Cycle = click the selected HUD channel button, wait `station`, click ◀ HUB, wait `hub` (`--settle` ms pause after each phase).
- **Pass (branch)**: post-GC growth <= `--max-growth` (10 %) **or** <= main's growth + `--max-over-main` (1 percentage point); **and** the WebGL counts from `window.__osGl()`
  (page loaded with `?osdebug=gldebug`) — geometries, textures, renderTargets — are back to (<=) the baseline taken at the hub before the cycles. A missing `__osGl`/counter is a FAIL, not a skip.
  Without `--base` only the absolute 10 % rule applies (printed).
- The WebGL renderer is recorded; software renderer or `--headless` ⇒ `INVALID`, exit 2 (spec §9.4), unless `--allow-software` (then informational, e.g. smoke runs).
- Exit 0 pass / 1 fail / 2 invalid. Results in `<out>/result.json` (all raw heap/GL numbers per round and side).
