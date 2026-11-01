# scripts/verify — acceptance tooling (X0 spike)

Zero-dependency Node 22 ESM scripts (Node built-in `WebSocket`/`fetch` + system Chrome over CDP).
Chrome path: `C:/Program Files/Google/Chrome/Application/chrome.exe`, override with `CHROME_PATH`.

## Data safety (read first)

- Never point a server at real data (the `…工作日誌` folder). Only ever use a **fresh copy of `backend/data/example`**.
- Never use ports 3000 / 3001. Convention: 3114 = branch under test, 3115 = baseline (main), 3116 = spare.
- Always `NO_OPEN_BROWSER=1`. Never run `npm start` / `npm run dev` from the main checkout.
- `serve.mjs` enforces all of this (refuses 3000/3001 and any path containing `工作日誌`).

## Starting servers

Build first (`npm run build` in each worktree → `web/dist`), then:

```
node scripts/verify/serve.mjs --root <branch worktree> --port 3114 --scratch <scratch dir>
node scripts/verify/serve.mjs --root <main worktree>   --port 3115 --scratch <scratch dir>
```

Flags: `--root` worktree, `--port`, `--data-from` (default `backend/data/example`, relative to root), `--scratch`
(default `%TEMP%/pld-verify`). It copies the example data to `<scratch>/data-<port>-XXXX`, spawns
`node backend/server.js` with `DATA_DIR`, `PORT`, `NO_OPEN_BROWSER=1`, prints the URL, runs until killed.
Run it in the background. Any state-mutating test (records, sort) only touches the scratch copy.

## Scripts

| script | purpose |
|---|---|
| `cdp.mjs` | CDP driver. `Browser.launch({port, headless=true, userDataDir, args})` (`headless:false` = headed, hardware GPU, no software-GL flags); `newPage`, `goto`, `eval`, `waitFor`, `addInitScript`, `throttleCPU(rate)`, `webglRenderer()`, `key/keyDown/keyUp/pressKey`, `mouseMove/mouseDown/mouseUp/click(x,y)`, `clickEl`, `rectOf`, `screenshot`, `settle`, `close`. |
| `snap.mjs` | `takeSnap(page,{scope})` computed-style snapshot; `diffSnaps(a,b,{ignoreProps,ignoreRect,ignoreWidthRelated,ignoreCustoms})`. `data-fx` attributes are never diffed. The sidebar CYBER toggle is excluded. |
| `c1.mjs` | C1 comparator (two servers, per scenario/width/theme). |
| `os-bundle.mjs` | A5 + P4 bundle checks on `web/dist` (static import graph). |
| `bundle-graph.mjs` | shared static-graph analysis (used by os-bundle and os-perf). |
| `os-handoff.mjs` | I1–I3 (needs the OS implementation). |
| `os-perf.mjs` | P1 fps (headed, real GPU) and P2 rAF attribution (needs the OS implementation). |
| `os-common.mjs` | shared selectors / event-hook / calibration for the OS scripts. |
| `serve.mjs` | safe server launcher. |

## c1.mjs — style / layout / AX comparison

```
node scripts/verify/c1.mjs --base http://localhost:3115/ --new http://localhost:3114/ --theme all --out verify-out/c1
```

- `--base`, `--new` base URLs. `--base-query` / `--new-query` extra query per side, e.g. `--new-query "?mode=os"`
  (query goes **before** the `#`, the scenario route follows). `--theme cyber` appends `theme=cyber` to both sides
  (unless that side's query already sets `theme`).
- `--theme standard-light|standard-dark|cyber|cyber-light|all` (comma list ok). `all` = standard-light, standard-dark, cyber(dark).
  standard-* use `prefers-color-scheme` emulation.
- `--widths 375,900,1280`, `--scenarios dashboard,records,new,calendar,trash,settings,report,detail,lightbox,dialog,more-panel,form-validation` (default: all; `more-panel` only at 375).
- `--scope main` snapshot only that subtree (paths relative to scope root; `:root` custom-property diffs skipped).
  `--ignore-width-related` skips width/height/inline-size/block-size/min-max, perspective-/transform-origin, resolved grid tracks,
  left/right, auto margins and rect x/w (S4(b): OS frame has a different width).
- `--ax` / `--no-ax` AX-tree comparison; default: on only when not scoped.
- `--shots` screenshots to `<out>/shots/`; `--settle <ms>` (post-load wait, 800) and `--settle-after <ms>` (after the act step, 1200); `--verbose` prints sample diffs; `--cdp-port`; `--headed`.
- Output: one line per scenario (`OK`/`DIFF`, counts per kind), full JSON in `<out>/c1-result.json`.
  Exit code 1 if total style/rect/pseudo/text/missing/extra/AX diffs > 0 (animation counts, `data-fx`, new custom properties are informational).
- Scenarios whose act step needs data absent in the example data (`dialog`, `lightbox`) report `actErr` on both sides and compare the un-acted page.
- With `--scope main`, portal content (dialogs, lightbox, more-panel) is outside `main` and not compared.

Examples: baseline self-check `--base :3115 --new :3116` (expect 0); web cyber vs OS mode:
`--base http://localhost:3115/ --base-query "?theme=cyber" --new http://localhost:3114/ --new-query "?mode=os" --theme standard-light --scope main --ignore-width-related`
(routes are `#/records`, i.e. `?mode=os#/records`).

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
- On a dist with no OS code it passes with a "no OS chunks found" warning.

## os-handoff.mjs — I1–I3

```
node scripts/verify/os-handoff.mjs --url http://localhost:3114/ [--throttles 1,4] [--only i1,key,i2,i3] [--reps 3] [--viewport 1440x900] [--osdebug a,b] [--out dir]
```

Page opened as `?mode=os` (hub) or `?mode=os#/records` (station); fresh browser context per iteration; CPU throttle 1× and 4×.
An injected capture listener on `window` stamps every pointer/key event with `performance.now()` and the current `data-os-phase`, so
real offsets (not planned ones) are reported. A click that actually lands outside the `*-pre` window is marked `LATE` and retried
(up to 3 times, offset adjusted); persistent `LATE` is inconclusive, not a failure.
- I1 pointer: ENTER offsets 0..850/50 × {over `/records` sort control, over HUD CH-02}; EXIT offsets 0..250/50 × over HUD CH-02. Asserts phase jump to `station`/`hub`, hash unchanged (no `sort=asc`, no navigation), no `[role=dialog]`, focus not on the underlying sort control; then second click on the real target works (`sort=asc` / `entering-pre`).
- I1 keyboard (`--only key`): Enter and Space, focus-less, at a few offsets; second key on the focused real target works.
- I2: polls for `entering-post` / `exiting-post`, clicks the destination immediately; expects direct hit.
- I3: 16 ms sampler over a full enter+exit; `#os-overlay` computed `pointer-events` always `none` and never returned by `elementFromPoint` on an 8×5 grid.
- Prints a matrix + summary, writes `<out>/result.json`, exit 1 on any FAIL. Headless uses SwiftShader flags (correctness only).

Sort control selector: `main th[aria-sort] button, main button[aria-label*="排序"]` (first visible) — see `RecordList.tsx` / `FilterBar.tsx`.

## os-perf.mjs — P1 / P2

```
node scripts/verify/os-perf.mjs --url http://localhost:3114/ [--only p1,p2] [--dist web/dist] [--osdebug nobloom,nosway,nophosphor | --no-bloom --no-sway --no-phosphor] [--duration 10] [--p2-seconds 3]
```

- P1 launches **headed** Chrome (needs a visible desktop + real GPU), 1920×1080, `?mode=os[&osdebug=…]`. Prints the WebGL renderer;
  SwiftShader/llvmpipe/software ⇒ `INVALID`, exit 2. Hub idle 10 s rAF deltas ⇒ median fps (pass ≥ 55) and p5 fps; repeated at 4× CPU (pass ≥ 30).
- P2 wraps `requestAnimationFrame` (new-document script), loads the station (direct load and via HUD click), waits for phase `station`,
  records stacks for 3 s and counts calls whose stack contains a file of an OS lazy chunk (computed from `--dist`, or `--os-chunks a.js,b.js`). Expect 0;
  other callers (react, entry, radix, sonner…) are listed for information.
- Results in `<out>/result.json`. Exit 1 on failure.
