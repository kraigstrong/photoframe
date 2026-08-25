# Review scope for this repository

This is a one-time-use event app: a single deployment, used for a few hundred
guests at one event, then retired. Optimize review feedback accordingly.

## Flag only

- A security or privacy issue (in particular: any path that could upload,
  persist, log, or leak a guest's photo).
- A crash, blank/corrupt output, or unrecoverable UI state during ordinary
  use.
- A likely failure of the core guest flow (take/choose photo → position →
  export → share) on iOS Safari or Android Chrome.
- A race condition that could export or display the wrong guest's photo.
- An accessibility failure that blocks completing a critical action.
- A failing type check, lint, test, or production build.

## Do not flag

- Naming, formatting, or stylistic preferences.
- Suggested refactors, abstractions, or architectural cleanup.
- Missing defensive code, extra tests, or extra docs for non-critical paths.
- Micro-optimizations without device evidence.
- Scope expansion, future flexibility, or "nice to have" features.
- Anything that assumes long-term maintenance, multi-event reuse, or a team
  of future contributors — there won't be any.

A comment outside "Flag only" will get a `No change: non-critical for this
one-time event MVP.` reply and no code change, regardless of severity label.
