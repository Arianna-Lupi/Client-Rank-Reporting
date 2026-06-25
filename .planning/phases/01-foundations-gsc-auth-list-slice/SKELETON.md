# Walking Skeleton — Client Rank Reporting (Slack GSC Bot)

**Phase:** 1
**Generated:** 2026-06-25

## Capability Proven End-to-End

Un usuario escribe `/list` en Slack y recibe una respuesta ephemeral con las propiedades de Google Search Console que la Service Account puede leer (`siteUnverifiedUser` excluidas), marcando con ✓ las que ya están activas en Redis — servido por una función Vercel Node desplegada que primero verifica la firma HMAC de Slack sobre el body crudo.

Este slice ejercita los tres seams de integración más riesgosos del proyecto en el camino más corto: firma HMAC de Slack (raw body) → auth Service Account a GSC → read en Upstash Redis, todo desplegado en un preview de Vercel.

## Architectural Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Lenguaje / runtime | TypeScript (pin `typescript@5.x`) + Node.js runtime en Vercel (NO Edge) | `googleapis` requiere Node; TS 6.x trae breaking changes y es muy reciente (RESEARCH A1) — se pinea 5.x por compatibilidad con `@vercel/node` |
| Handler de Slack | Función Vercel Web-standard `export async function POST(req: Request)` con `await req.text()` para el body crudo, síncrono | Devuelve el raw sin pelear con `bodyParser`; `/list` es una sola lectura, entra holgado en los 3s de Slack. Sin patrón ack-then-async |
| SDK de Slack | NINGUNO — handler propio + `node:crypto` para HMAC | Decisión locked en CONTEXT: se descartan `@slack/bolt`, `@vercel/slack-bolt`, `@slack/web-api` y Socket Mode. El reply va en el body HTTP como JSON ephemeral |
| Auth GSC | Service Account; JSON completo en base64 en `GSC_SA_KEY_B64`; `google.auth.GoogleAuth` con scope `webmasters.readonly` | Elimina la clase de bug del escape de `\n` en la private key (Pitfall 3). SA es per-property: su email se agrega manualmente como usuario en cada propiedad |
| API GSC | `google.searchconsole({ version: 'v1' })` → `sites.list()` → `data.siteEntry[]` | Namespace vigente (envuelve `webmasters/v3`); filtro `permissionLevel !== 'siteUnverifiedUser'` |
| Persistencia | `@upstash/redis` `Redis.fromEnv()`; SET `clients:active` con `siteUrl` canónicos; read vía `smembers` | Cliente REST/HTTP sin pool TCP (sobrevive serverless); Vercel KV deprecado dic 2024 |
| Config | Todo por env vars, fail-fast en cold start vía `lib/config.ts`; `.env.local` (nunca commiteado) + `.env.example` documentando todas | SCH-03; secrets nunca hardcodeados ni logueados |
| Deployment target | Vercel preview deployment | El walking skeleton debe verificarse en un deploy real (no solo `vercel dev`) por Pitfall 3/5 |
| Directory layout | `api/` (rutas serverless, shells delgados) + `lib/` (servicios compartidos: `config.ts`, `slack/verify.ts`, `gsc.ts`, `clients.ts`); tests co-localizados (`*.test.ts`) | Patrón "thin handlers, shared services" — los servicios los reusan Fases 2-4 |
| Test runner | Vitest (`[ASSUMED version]` — confirmar en el gate de install) | ESM/TS-native; tests locked en CONTEXT (verify + filtro) |

## Stack Touched in Phase 1

- [x] Project scaffold — `package.json` (deps pineadas), `tsconfig.json`, `vercel.json`, `.gitignore`, `.env.example`
- [x] Routing — una ruta real: `api/slack/command.ts` (Slack Request URL)
- [x] Database — un read real en Upstash Redis (`smembers('clients:active')`); la escritura (`sadd`/`srem`) es Fase 2. El SET se seedea manualmente por la consola de Upstash para probar el read
- [x] Auth de borde — verificación HMAC de la firma de Slack sobre el body crudo (control de seguridad alto, con test negativo)
- [x] Integración externa real — auth Service Account a GSC + `sites.list`
- [x] Deployment — desplegado en un preview de Vercel con env vars seteadas, `/list` ejecutado desde Slack

## Out of Scope (Deferred to Later Slices)

- `/add` y `/remove` (escritura a Redis: `sadd`/`srem`, validación de input) → Fase 2
- Lógica de métricas: `searchanalytics.query`, resolución del último día con datos, cálculo de deltas → Fase 3
- Reporte Block Kit, `chat.postMessage`, `@slack/web-api`, cron diario, idempotencia (`SET NX`), `CRON_SECRET`, manejo de DST/`REPORT_TZ` → Fase 4
- Aliases legibles por cliente, allowlist de permisos, `/report` on-demand → v2
- `date-fns` / date math (no hay aritmética de fechas en Fase 1)

## Subsequent Slice Plan

Cada fase posterior agrega un vertical slice sobre este esqueleto sin alterar sus decisiones arquitectónicas:

- **Phase 2 — Client Management:** `/add` y `/remove` agregan/quitan el `siteUrl` canónico del SET `clients:active`, validando contra `sites.list`, con confirmaciones/errores ephemeral.
- **Phase 3 — GSC Metrics + Delta:** `searchanalytics.query` + resolución del último día disponible (ventana móvil) + deltas por métrica (posición invertida) con manejo de "sin datos", aislado tras unit tests.
- **Phase 4 — Block Kit Report + Cron:** un mensaje Block Kit por cliente publicado cada mañana por un cron Vercel seguro (`CRON_SECRET`), idempotente (`SET NX`) y tz-correcto (`REPORT_TZ` + DST).
