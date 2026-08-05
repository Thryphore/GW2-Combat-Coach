# GW2 Combat Coach

Paste a dps.report or GW2 Wingman link, get coaching on how you actually played. GW2 Combat Coach reads the Elite
Insights data behind an arcdps log and points out dropped auto-attack chains, casts you cancelled for nothing, combo
fields you never followed up on, boons you were missing, and cooldowns you sat on. Virtuoso gets a dedicated module
on top of that; every specialization still gets the general checks, with GW2 skill data shipped for all nine base
professions. Each run also auto-picks a MetaBattle **raid** build for comparison.

The whole thing is a static site with no backend, so it runs for free on GitHub Pages and nothing you paste is sent
anywhere except the public APIs listed below.

## How it works

```
dps.report permalink ──► getJson (full EI JSON) ─────────┐
                                                          ▼
GW2 Wingman permalink ──► getJson (HTML-report JSON) ──► adapt ──► normalize() ──► checks
                                                          ▲
GW2 API snapshot / MetaBattle / optional 2nd log ─────────┘
```

Every external service is reachable from the browser:

| Source | Used for | Notes |
| --- | --- | --- |
| [dps.report](https://dps.report/api) | The log itself, via `getJson` | Wildcard CORS; full Elite Insights JSON |
| [GW2 Wingman](https://gw2wingman.nevermindcreations.de/api) | The log itself, via `/api/getJson/{id}` | Wildcard CORS; HTML-report schema, adapted in-browser |
| [GW2 API](https://api.guildwars2.com/v2) | Skills, chains, combo fields, recharges, traits | `skills_by_palette` needs the `2019-12-19` schema version |
| [MetaBattle](https://metabattle.com) | Auto-chosen raid reference builds, via the MediaWiki API | Only `Category:Raid builds`; open-world / PvP pages are ignored |

## Checks

General, for any profession:

- **Auto-attack chains** — walks the `next_chain` graph from the GW2 API and reports chains that restarted before
  their final step, ignoring restarts caused by weapon swaps or a natural chain timeout.
- **Cancelled casts** — separates casts aborted before firing (wasted time) from cancels after the skill fired
  (saved time).
- **Downtime** — stretches where nothing was being cast while you were alive and in combat.
- **Boon uptime** — supports are graded on Alacrity, Quickness, Fury and Might; pure DPS only sees Fury and Might.
- **Combo fields and finishers** — pairs the fields you created with the finishers you fired.
- **Cooldown usage** — actual cast spacing against base recharge, adjusted for your Alacrity uptime.
- **Build comparison** — the build observed in your log against an automatically chosen MetaBattle raid build.
- **Reference log comparison** — when a second log is pasted, the Downtime and Cooldown findings show your numbers
  next to the reference (and say whether the gap looks normal for the fight). The reference check also covers DPS,
  cast rates, aborted casts, auto-chain completion, boons and damage modifiers.

Virtuoso specific:

- **Blade economy** — Bladesongs fired below five Blades, and time spent capped at five generating nothing.
- **Phantasms and Clarity** — Signet of the Ether used while phantasms were recharging, and Clarity windows that
  expired unspent.

Findings that rest on an assumption say so on the card. Combo detection has no positional data, cooldown math does
not model every trait that resets a skill, and traits are inferred rather than read directly.

## What a log can and cannot tell you

arcdps records what happened, not what you had equipped. Traits are reconstructed from the damage modifiers and
personal buffs Elite Insights attributes to them, so a trait that never triggered looks the same as a trait that was
never slotted. Utility skills you never pressed are invisible. Gear and runes are not in the log at all.

## Running it

```bash
npm install
npm run dev        # local dev server
npm test           # analysis engine tests
npm run build      # typecheck + production build
```

Refresh the bundled GW2 API data (also runs weekly in CI):

```bash
npm run fetch-gw2-data            # all nine professions
node scripts/fetch-gw2-data.mjs Mesmer   # refresh a single profession
```

Turn a real log into a test fixture:

```bash
node scripts/trim-log.mjs https://dps.report/abcd-20260804-120000_boss
```

## Deploying to GitHub Pages

Push to `main`. The workflow in `.github/workflows/deploy.yml` runs the tests, builds, and publishes to Pages.

Before the first deploy, enable Pages once: **Settings → Pages → Build and deployment → Source → GitHub Actions**.
Until that is set, `configure-pages` fails with `HttpError: Not Found`.

`vite.config.ts` derives the base path from `GITHUB_REPOSITORY`, so the site works at
`https://<user>.github.io/<repo>/` without configuration. For a custom domain, set `VITE_BASE=/`.

## Adding another profession

1. `node scripts/fetch-gw2-data.mjs <Profession>` writes `src/data/gw2/<profession>.json`.
2. Register the snapshot in `SNAPSHOT_LOADERS` in [src/api/gw2.ts](src/api/gw2.ts).
3. Add checks under `src/analysis/checks/<spec>/` and register them in `PROFESSION_CHECKS` in
   [src/analysis/engine.ts](src/analysis/engine.ts).

The generic checks are already data-driven, so a new profession gets chains, combos, cooldowns and boons for free.

## Known limitations

- **Wingman aftercast-cancel saved time is approximate per cast.** Wingman serves Elite Insights' HTML-report schema,
  which encodes cast status but not the exact `SavedDuration` for reduced (aftercast-cancelled) casts. Interrupted
  casts still get exact wasted ms; reduced casts are marked positive so coaching still classifies them, while fight
  totals come from gameplay stats.
- Reference builds come only from MetaBattle's raid category. Snow Crows has no public API. If the automatic pick is
  wrong, the results panel lists a few other raid pages for that specialization so you can switch.

## Credits

Log parsing by [Elite Insights](https://github.com/baaron4/GW2-Elite-Insights-Parser), hosting by
[dps.report](https://dps.report) and [GW2 Wingman](https://gw2wingman.nevermindcreations.de). Build data from
[MetaBattle](https://metabattle.com), licensed CC BY-NC-SA 3.0. Guild Wars 2 and all associated content are property
of ArenaNet and NCSOFT. This is an unofficial fan project.
