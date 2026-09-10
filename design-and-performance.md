# Application Design and Performance

Principles for how this application is structured and how it performs.

Rules are prefixed so they can be referenced directly in conversation: "that violates SRV-2", "check NET-7 before setting that header".

## Scope

**This file covers design and performance only.** The following areas are governed by sibling files loaded alongside this one:

| Area | File | Prefixes |
|---|---|---|
| Security | `security.md` | SEC |
| Money and numbers | `money-and-time.md` | MON |
| Dates and time | `money-and-time.md` | TIM |
| Data, privacy, database | `data-and-database.md` | DAT |
| Process and verification | `process.md` | PRO |

**A rule here never overrides a rule in one of those files.** If following a performance rule would require weakening security, correctness, or data handling, stop — see GEN-1.

---

## Ground rules

**GEN-1. Never trade correctness or security for speed.** Caching an authorization result, skipping validation on a hot path, or widening a query to avoid a round trip is a defect, not an optimization. If a security or correctness requirement is genuinely the bottleneck, say so and let me decide.

**GEN-2. Measure before optimizing.** Do not restructure code, add a cache, or add memoization on the assumption that something is slow. Show me the query plan, the timing, or the bundle size first.

**GEN-3. Say when a rule here would be broken before breaking it.** A stated exception with a reason is fine. A silent one is not.

**GEN-4. Before writing code, tell me in plain words what you are going to build** — the pieces, how they fit, what existing behavior changes. Wait for my go-ahead. Then build one piece at a time and explain each in plain language.

---

## 1. Architecture and code structure

**ARC-1. Separate concerns by layer.** Route handlers accept and validate input and return a response. Business logic lives in a service. Data access lives in a repository or query module. A route handler containing a query and a computation is three responsibilities in one place — split it.

**ARC-2. Keep coupling low.** A module depends on an interface or a declared contract, not on the internals of another module. If renaming a field in one service breaks three others, the coupling is wrong.

**ARC-3. Keep cohesion high.** Everything in a module serves the same purpose. A `utils.py` or `helpers.ts` that accumulates unrelated functions is a symptom, not a pattern.

**ARC-4. Respect size limits.** A function longer than roughly 60 lines, a class/service module longer than roughly 350, or a component longer than roughly 250 needs a stated reason. If you are approaching one, say so before writing it rather than after.
*Set for this project on 2026-08-12: 60 / 350 / 250 — set slightly above the stock 50/300/200 because several existing route and page files in this codebase are legitimately larger (multi-stage approval routing, wide admin tables) without being a design problem; the numbers should catch genuine sprawl, not flag known-reasonable code.*

**ARC-5. A function does one thing.** If you need the word "and" to describe what it does, it is two functions.

**ARC-6. Extract a shared abstraction on the third occurrence, not the first.** Two similar blocks are a coincidence; three are a pattern. Premature abstraction costs more than duplication.

**ARC-7. Business rules live in one place.** Tax computation, eligibility, aging buckets, allocation logic — defined once and called from everywhere. Never reimplemented per endpoint, and never duplicated between frontend and backend. If the frontend needs the same rule for display, it calls the API or shares a single generated definition.

**ARC-8. Compute a value once per request and pass it.** Do not recompute the same derived figure in three places in one call path.

**ARC-9. Inject dependencies rather than constructing them inside the thing that uses them.** A service that instantiates its own database connection cannot be tested without one.

**ARC-10. Scale by adding modules, not by growing existing ones.** A new domain gets its own service and its own routes. Do not append to a growing `main.py` or a shared controller.

**ARC-11. Do not build for a requirement that does not exist.** No abstraction layer, event bus, plugin system, or generic framework for a hypothetical future need. Build what is in front of you and leave the seams clean. Flexibility that is never used is complexity that is always paid for.

**ARC-12. Naming is part of the design.** A name that needs a comment to explain it is the wrong name. Say what a thing is, not what pattern it implements.

---

## 2. Server-side data loading

**SRV-1. Load only what the current request needs.** Select named columns, not `SELECT *`. A list endpoint returns list fields; a detail endpoint returns detail fields.

**SRV-2. No N+1 queries.** When loading a collection with related records, load the relations in one query — a join, an eager-load option, or a single batched fetch keyed by ID. If you write a loop containing a query, stop and restructure it.

**SRV-3. Every list endpoint is paginated** with a default page size and a hard maximum. No unbounded result sets. Total counts are optional and separately requested — a `COUNT(*)` over a large filtered set is often more expensive than the page itself.

**SRV-4. Filter, sort, and aggregate in the database,** not in application code after loading everything. Never load a table and filter it in Python or JavaScript.

**SRV-5. Index every column used for filtering or sorting** by an endpoint, or state why the endpoint does not need one. Name the index alongside the query when you add it.

**SRV-6. On authentication, load only identity, roles, and permissions.** Not the full profile, not related records, not preferences — those load when a screen needs them.

**SRV-7. Module-specific data loads when the module is used,** not at login or app start. Startup should not query tables the user may never open.

**SRV-8. Aggregations over large tables use a database-level aggregate,** a materialized view, or a precomputed table. Never a full row scan into memory.

**SRV-9. Reports and bulk operations stream or chunk.** Never build an unbounded list in memory before returning it.

**SRV-10. Run `EXPLAIN` on any query in a hot path before it ships.** Paste the plan if I ask. Do not guess at whether an index is used.

**SRV-11. A cache needs a stated expiry and a stated invalidation trigger.** Without both it is a future stale-data bug. Never cache user-scoped data in a shared cache without the user in the key.

**SRV-12. Wrap related writes in one transaction.** An operation that writes three rows either writes all three or none.

---

## 3. Client-side performance

**CLI-1. Route-level code splitting is the default.** Each major module is its own lazy-loaded chunk.

**CLI-2. Lazy-load heavy dependencies at the point of use** — chart libraries, PDF viewers, spreadsheet exporters, rich text editors. Never in the initial bundle.

**CLI-3. Do not load a module, a permission-gated screen, or its data until the user navigates to it.**

**CLI-4. Lists and tables are paginated or virtualized.** Any table that can exceed roughly 100 rows is virtualized — render the visible window, not the whole set.
*Set for this project on 2026-08-12: 100 rows (stock default kept as-is). Known current gap: the Expense Line Items admin table already renders ~198 rows unvirtualized — not fixed by this note alone, tracked as an open item.*

**CLI-5. Avoid unnecessary re-renders.** Stable keys on lists, state scoped to where it is used, memoization where a measurement shows it matters. Do not scatter `memo` and `useMemo` preemptively — profile first, then apply.

**CLI-6. Never do heavy computation during render.** Derive in a memo, in an effect, or on the server.

**CLI-7. Cache infrequently changing reference data client-side** — lookup tables, dropdown options, navigation metadata, permission maps. State a refresh trigger for each.

**CLI-8. Never cache user-specific or sensitive data in a way that survives logout.** Clear cached data on sign-out.

**CLI-9. Debounce search inputs and filter changes. Throttle scroll and resize handlers.** Cancel in-flight requests when their input changes.

**CLI-10. Images and generated documents load lazily with explicit dimensions reserved,** so layout does not shift.

**CLI-11. State the initial bundle size budget** and report when a change pushes past it.
*Set for this project on 2026-08-12, from a measured production build (`npm run build` in `frontend/`): current output is 374.50 kB raw / 111.12 kB gzip JS + 20.67 kB / 4.47 kB gzip CSS ≈ 115.6 kB gzip total, in one unsplit chunk (no route-level code splitting yet — CLI-1 is not currently met). Budget set at 150 kB gzip total, giving headroom over the measured baseline. Route-level code splitting (CLI-1) would let the true "initial" bundle drop well below this ceiling; tracked as an open item, not done as part of this note.*

---

## 4. HTTP and network

**NET-1. Fetch once per logical need.** Deduplicate concurrent identical requests rather than firing the same call from three components.

**NET-2. Avoid request waterfalls.** Independent requests fire in parallel. A request that depends on another's result is a design smell worth one round of thought before accepting it.

**NET-3. Return only the fields the client uses.** A list response does not carry every column of every row.

**NET-4. Prefer one endpoint that returns what a screen needs** over five the screen must stitch together — without turning it into a generic query endpoint that leaks the schema.

**NET-5. Enable compression for text responses.**

**NET-6. Set `Cache-Control` deliberately on every response.** Nothing relies on default browser behavior.

**NET-7. Vite's content-hashed assets get long-lived immutable caching.** The hash changes when the content does, so staleness is not possible. `index.html` is the exception — it must not be cached long, or the browser keeps requesting old hashes and users get a stale app after every deploy.

**NET-8. API responses carrying personal or financial data are `Cache-Control: no-store`.** Never cache an authenticated response in a shared or intermediary cache.

**NET-9. Use `ETag` and conditional requests for reference data that changes rarely** — lookup tables, rate schedules, navigation metadata. A `304` costs almost nothing.

**NET-10. Provide batch endpoints for operations a client would otherwise loop over.** A form submitting 50 line items makes one request, not 50.

**NET-11. Set a timeout on every client request,** show a loading state, and handle failure visibly. Never leave a spinner with no terminal state.

**NET-12. Polling has a stated interval and a stated stop condition.** Never poll an endpoint that could be event-driven without telling me why.

---

## Before first use

Three rules contain placeholders. Replace them with real numbers, or they will be treated as decorative:

- **ARC-4** — function, class, and component size limits
- **CLI-4** — the row count at which a table must be virtualized
- **CLI-11** — the initial bundle size budget

## What "following this file" does and does not produce

Worked example. Task: *add an endpoint that returns customer accounts.*

Following this file, the result should have named columns rather than `SELECT *` (SRV-1), no N+1 on related records (SRV-2), pagination with a hard maximum (SRV-3), filtering done in the database (SRV-4), an index behind every filter column (SRV-5), and a response carrying only the fields the client uses (NET-3).

The same result would still be wrong if it returns accounts the requesting user is not entitled to see (SEC-19), exposes internal columns (SEC-28), or returns balances as floating-point numbers (MON-1, MON-4). **Those are governed by the sibling files, not by this one.** A design rule satisfied is not a task finished.

## Conflicts

If two rules conflict, or a rule blocks the task, stop and ask. Do not pick the interpretation that lets you proceed.
