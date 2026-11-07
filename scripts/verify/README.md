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
| `os-bundle.mjs`, `bundle-graph.mjs` | A5 + P4 bundle checks on `web/dist`. | – |
| `os-handoff.mjs` | I1–I4 (transition input gating, overlay, rapid enter/Esc). | yes |
| `os-e2e.mjs` | E2 E3 E5 E6 E7, device gate, mode persistence, EXIT TO WEB, sidebar button, WebGL fallback, E1 export guard. | yes |
| `os-shots.mjs` | design-review material (hub, strips, stations, palette, gate). | yes |
| `os-perf.mjs` | P1 fps (headed, real GPU) and P2 rAF attribution. | yes |
| `os-common.mjs` | selectors (`SEL`, `hudCh(n)`), page hook, helpers (`waitPhase` auto-passes B1, `passB1(page)`), `Reporter`. | – |
| `serve.mjs` | safe server launcher. | – |

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
- **Determinism (new)**: before each snapshot every finite animation/transition is finished and every infinite one (cyber cursor blink, scanlines…) is
  paused at t=0 (`--freeze js`, default; `--freeze css` additionally injects `animation-play-state:paused; transition:none; caret-color:transparent` which
  also hides differences in those properties; `--freeze none`). `Date` is pinned to 2026-01-12 09:00 +08:00 and the timezone to Asia/Taipei
  (`--no-freeze-time` to disable) – removes the minute-rollover flake of the new-record form and "today" highlighting.
- **Act failures fail (new)**: a `wait`/`act` step that cannot be performed prints `ACTFAIL`, counts as a failure and the exit code is 1; it is never compared silently un-acted.
  (X0 clicked without scrolling and silently missed off-screen buttons, e.g. `form-validation`; clicks now scroll into view first.)
- **Data-dependent scenarios (new)**: `dialog` needs a trashed record, `lightbox` needs a record with a photo. The example data has neither, so right before those scenarios
  c1 seeds both servers identically via the API (`seedTrash` record 4, `seedPhoto` record 3), **only on servers proven to be serve.mjs scratch servers** (`--scratch`).
  Without proof the scenarios ACTFAIL (they never run silently). `--no-seed` disables seeding (data must already exist).
- OS mode on the `--new` side: pass `--new-query "?mode=os"`; the capture waits for `data-os-phase="station"`.
- `--ax` / `--no-ax` AX-tree comparison (default: on only when not scoped). `--shots`, `--settle`, `--settle-after`, `--verbose`, `--cdp-port`, `--headed`.
- Output: one line per scenario (`OK` / `DIFF` / `ACTFAIL`), JSON in `<out>/c1-result.json`. Exit 1 if any style/rect/pseudo/text/missing/extra/AX diff or any ACTFAIL
  (animation counts, `data-fx`, new custom properties are informational).
- With `--scope main`, portal content (dialogs, lightbox, more-panel) is outside `main` and not compared.

S1 (web mode must be identical): `--base :3115 --new :3114 --theme all --widths 375,900,1280` (expect 0 diffs, 0 ACTFAIL).
S4(b): `--base http://localhost:3115/ --base-query "?theme=cyber" --new http://localhost:3114/ --new-query "?mode=os" --theme standard-light --scope main --ignore-width-related --ignore-offset-y --widths 1280`.
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
- I1 pointer: ENTER 0..850 step 50 × {over `/records` sort control, over HUD CH-02}; EXIT 0..**300** step 50 × over HUD CH-02; SWITCH (CH-02→CH-01, via `location.hash` and via palette `dash`) 0..75 step 25 × {over ◀ HUB, over a dashboard KPI card}.
  Asserts: phase jumps to `station`/`hub`, hash unchanged (no `sort=asc`, no navigation), no dialog, underlying control not focused, no phase regression after the jump (stale timers), then the second click on the real target works.
- I1 keyboard (`--only key`): Enter and Space at several offsets, **focus placed on a real control** (enter: another HUD button / EXIT; exit: the sort control; switch: ◀ HUB). The control must not act; the keydown target and focus
  placement are printed. If every candidate is inert the focus falls to `body` (noted; `--strict-focus` turns that into a FAIL).
- I2: first click 0/10/25/50 ms after the `*-post` stamp (enter/exit/switch) must hit the destination target (pointerdown target label checked, then the effect: `sort=asc` / `entering-pre` / `exiting-pre`).
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
| `E6.*` | one Esc closes only: detail sheet (+ a second Esc leaves), confirm dialog, popover, combobox, lightbox, palette | lightbox seeds a photo (scratch proof required) |
| `E7.focus/title/skip-link/print` | focus on `#main` after every page change (not on first load), `document.title` for 7 routes + edit, skip link, print layout (OS chrome hidden, `<main>` rect and PDF page count equal to web mode) | print PDF count needs headless |
| `GATE` | device gate at 1000×700, 1280×500, 1023×768 (shown) / 1024×600, 1280×720 (hidden); no hub/HUD/outlet/canvas while gated; button → web persisted; cold gated load enters without transition | |
| `PERSIST` | `pld.mode` in localStorage, reload, new tab (same profile), `?mode=` override + URL cleanup (other query kept), X0 `sessionStorage` key removal, no cross-tab sync, throwing storage | |
| `EXIT` | EXIT TO WEB from hub (→ `/dashboard`) and palette `exit` at a station (keeps path); theme per `pld.theme` (standard & cyber), focus `#main`, `pld.mode=web` | |
| `SIDEBAR` | `[data-os="enter-os"]` rendered only ≥1024 (0 elements at 1023/900/375), click → hub without reload, focus on the selected HUD button | |
| `WEBGL` | second Chrome with `--disable-webgl --disable-3d-apis`: toast 「顯示卡不支援，已改用網頁模式」, `pld.mode=web`, cyber for this load only, route kept (hub → `/dashboard`) | SKIP if the flags are not honoured |
| `E1` | **MANUAL** (see below) + export guard report + export click only if the guard passes and a 匯出 Excel control exists in the OS shell | |

Not automatable / left to the independent verifier by hand: **E1** (new record with photo upload, edit, delete/restore/permanent delete, report printing, settings save – compare with web mode; photo capture and print dialogs are unreliable over CDP),
**E4** final judgement (the script reports print rects, PDF page counts and screenshot hashes as proxies), **S5** moiré at 100/125/150 % Windows scaling, **P1/P6** on the real GPU (`os-perf.mjs --headed`), audio/UX feel (§9.7), real touch behaviour, screen-reader announcements of the live region
(the script only checks DOM text), design-review judgement of the shots.

## os-shots.mjs — design review material (§9.6)

```
node scripts/verify/os-shots.mjs --url http://localhost:3114/ --out verify-out/os-shots [--only hub,station,palette,gate,strips] [--headed] [--osdebug nobloom] [--strip-width 1600]
```

Saves `hub-1920x1080.png` (+ selection moved to CH-05), `station-{records,dashboard}-{1280,1920}.png`, `palette-open-hub.png`, `palette-error-station.png`, `device-gate-1000x700.png`, `device-gate-1280x500.png`
and frame strips `strips/{enter,exit,short-hash,short-palette}.png` (CDP screencast frames matched to planned offsets measured from the phase stamp; labels show the real frame offset and phase; individual frames in `frames/`; `index.html` lists everything).
Strips are for design judgement, not pixel-exact; software GL yields fewer distinct frames, use `--headed` on the GPU machine for smooth ones.

## os-bundle.mjs — A5 + P4

```
node scripts/verify/os-bundle.mjs [--dist web/dist] [--baseline <bytes>] [--baseline-file f] [--write-baseline] [--json out.json]
```

- Parses `index.html` entry `<script type=module>` + `modulepreload` links; follows static `import…from"./x.js"`, `import"./x.js"`,
  `export…from"./x.js"` (not `import()`, not `__vitePreload` arrays).
- A5 FAIL if any chunk in that static graph has a name matching `three|fiber|OsShell|features/os` or contains three markers
  (`__THREE__`, `WebGLRenderer`, `WebGLRenderTarget`, `@react-three`, `BufferGeometry`, `WebGLProgram`).
- "OS lazy" chunks = lazy chunks (not in the static graph) that match those name/marker rules, plus their lazy static deps.
- P4: entry static-graph JS gzip(-9) minus baseline must be <= 2048 B (baseline from `--baseline` or `bundle-baseline.json`
  `{ "entryGzipBytes": N }`; missing => skipped with a notice); OS lazy JS gzip total <= 300 KiB. Reports entry CSS gzip too.
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
