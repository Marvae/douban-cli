# douban-cli

Unofficial Douban CLI: Node.js 22.13+, TypeScript ESM, Commander. `src/` builds to `dist/`; `src/index.ts` registers commands and shapes the root help.

## Layout

- `src/commands/` — one file per command group: arguments, validation, `--json` output. Never calls `fetch` directly.
  - `collection.ts` — `user`, `me`, `book user`, `book me`; `export.ts` — `stats` and `export` for movies and books; `social.ts` — `review`, `follow`.
  - `resolve.ts` — turns what the user typed (ID, ISBN for books, or a title) into a subject.
- `src/ui/` — terminal presentation shared by commands: tables, status names, terminal links, list layouts, prompts, interactive pagination, spinner, display width.
- `src/api/` — Douban URLs, response validation and parsing; no terminal output.
  - `http/` — the read client: timeouts, retries for idempotent GETs, redirects, challenge/login detection, structured `HttpRequestError`.
  - `common.ts` — shared read helpers and `SessionReadOptions` (optional cookies and a warnings sink).
  - `movie.ts`, `book.ts` (+ `book-parsers.ts`), `search.ts`, `list.ts` — domain reads.
  - `subject.ts` — what movies and books genuinely share: ratings, comments, reviews, mobile collections, recommendations.
  - `collection.ts` — user collections, with or without the session; `account.ts` — the signed-in account's profile.
  - `record.ts` — the account's own record: read the edit form, patch, submit, read back.
  - `mutations.ts` — CSRF (`ck`) handling and POST endpoints; the only place that sends writes.
- `src/auth/` — login and the saved session: `cookies`, `cache` (encrypted), `browser-cookies`, `browser-open`, `session`, `login`; `index.ts` is the public entry.
- `src/storage/` — CLI config, storage paths, private file writes.
- `skills/douban-cli/` — the Agent Skill shipped in the npm package and installed from GitHub.
- `docs/` — user documentation; `README.md` stays a short overview.

## Invariants

- Prefer the public mobile JSON API (`m.douban.com/rexxar`); parse HTML only where it has no equivalent (collections, book charts, weekly chart, coming soon, ISBN, the write form).
- Treat Douban HTML and JSON as untrusted; validate at the API boundary. A page that cannot be parsed, a challenge or HTTP 429 must raise a structured error, never an empty result.
- Keep data that was fetched when a later page or source fails, and report it as partial (warnings on stderr, `partial`/`warnings` in JSON).
- Public reads never read the auth cache implicitly. Commands may pass the cached session explicitly (`getOptionalSessionCookies`) where anonymous access is throttled or incomplete: search, title resolution, collections.
- A write by title runs only as a dry run or after confirmation in a terminal; batch files take IDs (and ISBNs for books), never titles.
- Writes always go through `record.ts`: start from the current form, change only requested fields, never submit `share-shuo`, and verify by reading back. Writes are never retried, except one `ck` refresh.
- `--json` sends results to stdout and structured errors to stderr; non-TTY output never paginates interactively and ends with the next `--page` hint.
- Keep movie- and book-specific code separate until both share the same contract.
- Comments in English; user-facing text may be Chinese.

## Testing

- Unit tests mock `fetch`; they never read browser cookies or touch a real account. Test parsers and risky behavior (write safety, error classification); skip trivial code.
- Live checks against douban.com: reads only, a few requests spaced several seconds apart. Douban flags an IP quickly. Do not run live writes.

Before committing:

```bash
npm run verify
git diff --check
```

When changing packaging or the skill, also run `npm pack --dry-run --ignore-scripts`.

## Documentation

User-visible changes update `docs/` (and `README.md` only for headline features), the relevant `--help` text, and `skills/douban-cli/SKILL.md` when agents need to know.
