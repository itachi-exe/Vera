# vera-backend

The credentialed server tier. This is the only code in the repo that holds
Cleanverse API keys, and the only code that talks to Cleanverse.

```
vera-backend/
├─ src/
│  ├─ cleanverse.js    the API client: AES-256-CBC bodies, retries, read cache,
│  │                   webhook signature verification
│  └─ rate-limit.js    per-client throttle on the routes that spend quota
└─ test/
   └─ read-cache.mjs   22 checks against a stubbed upstream with a call counter
```

## Why this is a package and not a server

There is no second process here, and that is deliberate. Vera's HTTP surface is
three Next.js route handlers in `vera-frontend/app/api/{cvi,cva,prices}` — they
already run server-side, on the server that serves the app. This package holds
the logic they call.

Splitting it into a standalone service would add a second port, a CORS layer and
a second deploy target, and it would cost the one property that currently makes
credential leakage impossible rather than unlikely: `src/cleanverse.js` opens
with `import "server-only"`, so importing it from a client component is a **build
error**, not a runtime surprise. A separate service replaces that compile-time
guarantee with a network boundary you have to remember to configure.

What the split *does* buy is the thing it is here for: the credentialed code has
its own directory, its own dependency list, and its own test command, so "which
files can see the keys" is answered by a path rather than by reading imports.

## How the frontend reaches it

`vera-frontend/jsconfig.json` maps `@vera/backend/*` to `../vera-backend/src/*`,
and `next.config.mjs` sets `turbopack.root` to the repo root so the build is
allowed to follow that alias one directory up. Without the `root` setting
Turbopack resolves the alias and then refuses to leave the project directory,
which fails the build with `Module not found` naming an alias it just resolved.

```js
import { queryApass, CleanverseError } from "@vera/backend/cleanverse";
import { rateLimit } from "@vera/backend/rate-limit";
```

## Credentials

Read from `process.env` only — `CLEANVERSE_API_ID` and `CLEANVERSE_API_KEY`,
supplied by the root `.env`, which is git-ignored. Nothing here writes them to a
log, a response, or an error message. `credentialsPresent()` reports whether they
are set without revealing their values, which is what the routes use to return an
honest "not configured" instead of a confusing upstream failure.

## Tests

```bash
npm test    # from this directory, or `npm --prefix vera-backend test`
```

The `--conditions=react-server` flag in that script is not optional:
`src/cleanverse.js` is `server-only`, which throws on import without it.

The suite proves two properties that matter more than the cache's speed, both by
counting upstream calls rather than by timing:

- a read that did not complete is never cached
- a failure is never answered from an older success — that would be the
  fail-closed compliance gate opening on error, which is the one thing it must
  not do

Mutation-checked: deleting the `cacheable` predicate makes it fail.
