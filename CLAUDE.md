# Notes for working on Joseki Practice

See README.md for what the site is, its layout and how to run and deploy it. These are the things
that aren't obvious from the code.

## Ground rules

- No build step and no dependencies: plain HTML, CSS and ES modules that run as they are.
- Run `npm test` after changes; it needs no browser.
- **Go easy on Josekipedia.** It's a small volunteer site. Never fetch from it directly in scripts or
  tests: go through the dev server (`npm run dev`, which caches every node on disk) or fake the tree
  (see `test/problems.test.mjs`). In the app, every lookup goes through `getNode` in
  `js/josekipedia.js`; anything that looks up nodes it then throws away (e.g. following a main line
  past where it's used: pass `maxLength` to `mainLine`) eventually costs Josekipedia a fetch.
  Prefetching nodes "in case" trades their load for our speed, so don't.
- API keys live in Windows user environment variables `NEOCITIES_API_KEY` and `CLOUDFLARE_API_TOKEN`;
  read them with `[Environment]::GetEnvironmentVariable('NAME', 'User')` in PowerShell. Never print them.

## Deploying

The owner asks for each deploy. "Push, merge and deploy" means: push the branch, fast-forward `main`
to it (`git push origin HEAD:main`), then `npm run deploy` (and `npm run deploy:proxy` if `proxy/`
changed). Check the live site afterwards when the change could break loading.

The repo lives in Dropbox. If git fails with "unable to write file … Permission denied" when
committing, Dropbox is interfering: pause it, or commit with `git -c core.fsyncMethod=writeout-only`.

## Conventions in the code

- **Adding a problem type:** start at the top of `js/problem-kinds.js`, which lists everything a type
  needs; `test/problem-kinds.test.mjs` checks the pieces outside it are there.
- **Changing a setting's default** for players who already have saved settings: bump
  `SETTINGS_VERSION` in `js/settings.js` and add an upgrade (saved settings hold every setting, so a
  new default alone doesn't reach them). A brand-new setting just needs its default.
- **Async races in app.js:** `generation` is bumped whenever the game moves on; async work notes it
  first and does nothing if it has changed. A few places use their own check instead: `replayMoves`
  (`stopped()`), `openAddMenu` (`addMenuFor`), `followUpCard` (`followUpsKey`),
  `autoAdvanceAfterSolving` (`problem === solved`).
- **Modules each page imports are preloaded** (`<link rel="modulepreload">` in `index.html` and
  `reviews.html`); `test/preload.test.mjs` fails when the lists fall out of step with the imports.
- Problem links (`#problem=…`) are shared and saved: never change a type's link letter, and keep
  `decodeProblem` reading older links.
- Comments say why, in plain words; keep them in step with the code.
