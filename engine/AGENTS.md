# AGENTS.md

## Always read ENGINE.md fully

Always read `ENGINE.md` at the start of any task. This is the single source of
truth of the engine, and should always remain the truth.

Any addition, edit or removal of features that affect engine behaviour or
modelling assumptions should always be updated to `ENGINE.md`. Since you can't
make changes without approval, always consult your human.

## Strictly No Unwarranted Edits

You are STRICTLY NOT ALLOWED to make changes without approval in these files.
ALWAYS ASK your human.

- `ENGINE.md`
- `AGENTS.md`

## Philosophy

You are probably used to writing production code. But we are a startup. We move
fast and only build features that will produce a step change in the direction we
want to go.

You do not have to over-engineer solutions and write defensive measures if they
do not make sense in the context of how the code is going to be used.

We do not do premature optimizations here. Figuratively and literally.

Examples:

- If an API is meant for internal use and not user-facing, you don't have to
  defend input, since we are the ones controlling the input.
- Bring up and document caller assumptions instead of writing defensive measures
  for every possible case. We keep the codebase lean and only fix assumptions
  that actually broke.

## One exception to leanness: absence

This engine answers questions where a missing result reads as "no threat". A
pair with no route, an area that will not load, ground with no roads -- these
are reported explicitly, never returned as an empty success. That is not
defensive coding; it is the product.
