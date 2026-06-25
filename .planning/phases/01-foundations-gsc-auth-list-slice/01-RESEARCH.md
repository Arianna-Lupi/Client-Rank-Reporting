# Phase 1: Foundations + GSC Auth + `/list` Slice - Research

**Researched:** 2026-06-25
**Domain:** Vercel Node serverless — Slack slash command (raw-body HMAC) + Google Search Console Service Account auth + Upstash Redis
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Stack base & runtime**
- TypeScript + Node.js runtime en Vercel (NO Edge — `googleapis` requiere Node).
- Handler HTTP propio para Slack, síncrono, con verificación HMAC manual. Se descartan `@vercel/slack-bolt` y Socket Mode: el trabajo de `/list` es pequeño y entra en los 3s; el patrón Bolt ack-then-async es frágil en serverless.
- `bodyParser` desactivado en la ruta del comando para validar la firma sobre los bytes crudos.
- Persistencia con `@upstash/redis` (cliente REST/HTTP; Vercel KV deprecado desde dic 2024).

**Auth GSC & configuración (env)**
- Credencial de la Service Account como JSON completo en base64 en una sola env var (`GSC_SA_KEY_B64`).
- Scope `https://www.googleapis.com/auth/webmasters.readonly` (solo lectura).
- Canal destino fijo vía env var `SLACK_CHANNEL_ID` (un solo canal v1).
- Env vars en Vercel para prod + `.env.local` para dev, nunca commiteado.

**Comportamiento de `/list`**
- Muestra todas las propiedades legibles por la SA, marcando con ✓ cuáles ya están activas.
- Filtra/excluye propiedades con `permissionLevel === "siteUnverifiedUser"`.
- Respuesta ephemeral (visible solo para quien ejecuta el comando).
- Muestra el `siteUrl` canónico tal cual (`sc-domain:` o URL-prefix) para que `/add` (Fase 2) use exactamente el mismo valor.

**Estructura del proyecto & deploy**
- Layout: `api/` para rutas serverless + `lib/` para servicios compartidos (`gsc`, `slack`, `clients`, `config`).
- Estructura en Redis: un SET `clients:active` con los `siteUrl` canónicos.
- Verificación de firma en módulo reusable `lib/slack/verify.ts` (HMAC `v0:timestamp:rawBody` + ventana de 5 min).
- Tests: unit test del verificador de firma y del filtro de propiedades legibles.

### Claude's Discretion
- Modelo concreto de handler Vercel (Web-standard `Request`/`Response` vs clásico `VercelRequest`/`VercelResponse`) — ver recomendación en Architecture Patterns.
- Framework de testing unitario (recomendado: Vitest).
- Forma exacta de construir el cliente auth (`GoogleAuth` con `credentials` vs `JWT`).
- Formato del texto de respuesta de `/list` (plain text vs mrkdwn).
- Si seedear `clients:active` manualmente o con un helper para probar el read en Fase 1.

### Deferred Ideas (OUT OF SCOPE)
- `/add` y `/remove` → Fase 2.
- Lógica de métricas + cálculo de deltas → Fase 3.
- Reporte Block Kit + cron diario + idempotencia → Fase 4.
- Aliases legibles por cliente, allowlist de permisos, `/report` on-demand → v2.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| GSC-01 | El bot se autentica a GSC con una Service Account (JSON base64 en env) sin intervención manual | "GSC Service Account auth" + "Base64 SA JSON decode" code examples; `GoogleAuth` con `credentials` |
| GSC-02 | Lista propiedades vía `sites.list`, filtrando `siteUnverifiedUser` | "List + filter GSC sites" example; `searchconsole('v1').sites.list()` → `siteEntry[].permissionLevel` |
| CMD-03 | `/list` lista las propiedades disponibles en la cuenta de GSC | End-to-end command flow; ephemeral JSON reply pattern |
| CMD-05 | El endpoint verifica la firma HMAC de Slack sobre el body crudo antes de procesar | "Raw-body HMAC verification" example; `lib/slack/verify.ts` recipe |
| PER-01 | La lista de clientes activos persiste en Redis (Upstash) entre invocaciones serverless | `@upstash/redis` `Redis.fromEnv()` + `smembers('clients:active')` |
| SCH-03 | Config sensible (SA, tokens Slack, canal, TZ) por variables de entorno | `lib/config.ts` env-parsing pattern + env var inventory |
</phase_requirements>

## Summary

Esta fase es el walking skeleton: prueba los tres seams de integración más riesgosos (firma HMAC de Slack sobre body crudo, auth de Service Account a GSC, y un read en Redis) sobre el camino más corto posible — un comando `/list` que hace una sola llamada a `sites.list` y devuelve una respuesta ephemeral síncrona. Todo el riesgo técnico de Fase 1 vive en cuatro recetas concretas, todas resueltas en este documento: (1) leer el body crudo en una función Vercel Node, (2) reconstruir y comparar el HMAC `v0:timestamp:rawBody` con `timingSafeEqual` + ventana de 5 min, (3) decodificar el JSON de la SA desde base64 y construir el cliente `googleapis`, y (4) inicializar `@upstash/redis` desde env.

La decisión locked clave es **abandonar `@slack/bolt` y `@vercel/slack-bolt`** (que sí recomendaba la investigación a nivel proyecto y que todavía aparece en CLAUDE.md) en favor de un handler propio síncrono. Esto es correcto para Fase 1: `/list` es una sola lectura, entra holgadamente en los 3s de Slack, y elimina la fragilidad del patrón ack-then-async en serverless. La consecuencia práctica: NO se instala ningún SDK de Slack. La verificación de firma se hace con el módulo `crypto` nativo de Node, y la respuesta de `/list` se devuelve directamente en el body HTTP como JSON ephemeral — no se necesita `@slack/web-api` ni `chat.postMessage` en esta fase (eso llega en Fase 4 para el reporte al canal).

Sobre la API de GSC: la duda flagged en la investigación de proyecto (`searchconsole` v1 vs `webmasters` v3) queda resuelta — usar `google.searchconsole({ version: 'v1' })`, que es el namespace actual y envuelve internamente los endpoints REST `webmasters/v3`. El scope `webmasters.readonly` locked es correcto para ambos. `sites.list()` devuelve `data.siteEntry[]` con `{ siteUrl, permissionLevel }`; los valores de `permissionLevel` son `siteOwner | siteFullUser | siteRestrictedUser | siteUnverifiedUser`.

**Primary recommendation:** Handler Vercel Web-standard (`export async function POST(req: Request)`) con `await req.text()` para el body crudo (sin pelear con `bodyParser`), `crypto.timingSafeEqual` para la firma, `google.searchconsole('v1').sites.list()` con `GoogleAuth` desde JSON base64, y `Redis.fromEnv().smembers('clients:active')` para marcar activos. Cero SDKs de Slack.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Recepción del slash command | API / Backend (Vercel function) | — | Slack hace HTTP POST a una Request URL pública; debe correr en runtime Node (no Edge) por `googleapis` |
| Verificación de firma HMAC | API / Backend (`lib/slack/verify.ts`) | — | Seguridad de borde; debe leer bytes crudos antes de cualquier parseo |
| Auth a GSC (Service Account) | API / Backend (`lib/gsc.ts`) | — | Credencial secreta nunca toca el cliente; JWT minted server-side |
| `sites.list` + filtro | API / Backend (`lib/gsc.ts`) | — | Lógica de negocio sobre la respuesta de Google |
| Lectura de clientes activos | Database / Storage (`lib/clients.ts` → Upstash) | — | Único estado persistente entre invocaciones efímeras |
| Parseo/validación de env | API / Backend (`lib/config.ts`) | — | Fail-fast en cold start si falta config |
| Respuesta a Slack | API / Backend (HTTP response body) | — | Reply ephemeral síncrono dentro de los 3s; sin llamada outbound |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `googleapis` | `173.0.0` | Auth Service Account (JWT) + `searchconsole('v1').sites.list` | Cliente oficial de Google; bundlea `google-auth-library`; tipos first-class |
| `@upstash/redis` | `1.38.0` | Read del SET `clients:active` (y CRUD en Fase 2) | Cliente REST/HTTP; sin pool TCP — purpose-built para serverless; reemplazo de Vercel KV |
| `@vercel/node` | `5.8.21` | Runtime/tipos de las funciones serverless | Builder oficial; soporta TS y firma Web-standard `Request`/`Response` |
| Node `crypto` (builtin) | — | HMAC-SHA256 + `timingSafeEqual` para firma de Slack | Nativo; NO hand-roll del compare — usar `timingSafeEqual` |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `google-auth-library` | `10.9.0` (bundled) | JWT minting de la SA | Ya viene dentro de `googleapis` (`google.auth.GoogleAuth`) — NO instalar aparte |
| `vitest` | latest (verificar) `[ASSUMED]` | Unit tests de `verify.ts` y del filtro de propiedades | Tests locked en CONTEXT; ESM/TS-native, rápido. Alternativa: `node:test` builtin |

### NOT Used in This Phase (deliberate)
| Package | Why excluded |
|---------|--------------|
| `@slack/bolt`, `@vercel/slack-bolt` | Decisión locked: handler propio síncrono. Aunque CLAUDE.md/STACK.md los listan, CONTEXT los descarta explícitamente. |
| `@slack/web-api` | `/list` responde en el body HTTP (ephemeral), no postea al canal. `chat.postMessage` recién se necesita en Fase 4. |
| `@vercel/kv` | Deprecado (dic 2024) → Upstash. |
| `date-fns` / `date-fns-tz` | No hay date math en Fase 1 (eso es Fase 3). |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `GoogleAuth({ credentials })` | `new google.auth.JWT({ email, key, scopes })` | Equivalente; `JWT` es más explícito. `GoogleAuth` es el camino canónico actual. |
| Web-standard handler (`Request`) | Clásico `(req: VercelRequest, res: VercelResponse)` + `config.api.bodyParser=false` | El clásico funciona pero el parser de `@vercel/node` puede consumir el body; el Web-standard `req.text()` da el raw sin ambigüedad. Ver Pitfall 2. |
| `vitest` | `node:test` (builtin) | `node:test` evita una dependencia; `vitest` da mejor DX/watch. Discreción. |

**Installation:**
```bash
# Core
npm install googleapis@173 @upstash/redis@1

# Dev
npm install -D typescript @types/node @vercel/node vitest
```

**Version verification:** Verificadas contra el registro npm el 2026-06-25:
- `googleapis@173.0.0` (modificado 2026-05-28; en registro desde 2012) `[VERIFIED: npm registry]`
- `@upstash/redis@1.38.0` (modificado 2026-06-25) `[VERIFIED: npm registry]`
- `@vercel/node@5.8.21` (modificado 2026-06-24) `[VERIFIED: npm registry]`
- `google-auth-library@10.9.0` (bundled en googleapis) `[VERIFIED: npm registry]`

> **Nota TypeScript:** `typescript@latest` es ahora `6.0.3` (2026-06-18) y `@types/node@26.0.1`. TS 6.0 es muy reciente y trae breaking changes. Para Fase 1 recomiendo **pinear a la última 5.x estable** (`typescript@5`) para evitar incompatibilidades con `@vercel/node`, salvo que el planner/usuario confirme TS 6. `[ASSUMED]` — decisión a confirmar.

## Package Legitimacy Audit

> slopcheck NO estaba disponible en el entorno de research (`pip install slopcheck` no instalado, comando ausente). Per protocolo, las dispositions abajo se basan en: namespace oficial conocido, verificación en el registro npm correcto, antigüedad y volumen de descargas. Los tres paquetes core son SDKs oficiales (Google, Upstash, Vercel) citados desde documentación oficial.

| Package | Registry | Age | Downloads (last week) | Source Repo | slopcheck | Disposition |
|---------|----------|-----|------------------------|-------------|-----------|-------------|
| `googleapis` | npm | ~14 yrs (desde 2012-09) | 8,960,947 | github.com/googleapis/google-api-nodejs-client | unavailable | Approved (official Google) |
| `@upstash/redis` | npm | mature | 3,984,055 | github.com/upstash/redis-js | unavailable | Approved (official Upstash) |
| `@vercel/node` | npm | mature | 3,411,179 | github.com/vercel/vercel | unavailable | Approved (official Vercel) |
| `google-auth-library` | npm | mature | (bundled) | github.com/googleapis/google-auth-library-nodejs | unavailable | Approved (official Google, transitive) |
| `vitest` | npm | mature | n/a (verify) | github.com/vitest-dev/vitest | unavailable | Approved (dev-only) `[ASSUMED version]` |

**Packages removed due to slopcheck [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

*Como slopcheck no corrió, el planner DEBE mantener un `checkpoint:human-verify` antes del primer `npm install` para confirmar los nombres exactos de paquete. Riesgo real bajo: los cuatro son SDKs oficiales con millones de descargas semanales y repos verificables, pero el gate es barato y se respeta el protocolo.*

## Architecture Patterns

### System Architecture Diagram

```
Slack user types: /list
        │
        │ HTTP POST (application/x-www-form-urlencoded, signed headers)
        │   headers: x-slack-signature: v0=<hmac>
        │            x-slack-request-timestamp: <unix>
        ▼
┌──────────────────────────────────────────────┐
│  api/slack/command.ts  (Vercel Node function) │
│                                                │
│  1. raw = await req.text()   ← RAW body        │
│  2. lib/slack/verify.ts:                       │
│       - reject if |now - ts| > 300s            │
│       - base = `v0:${ts}:${raw}`               │
│       - hmac = HMAC_SHA256(signingSecret, base)│
│       - timingSafeEqual(`v0=`+hmac, sigHeader) │
│       - fail → 401                              │
│  3. parse: new URLSearchParams(raw)            │
│       → command, text, user_id, response_url   │
│  4. route on command === '/list'               │
└───────┬───────────────────────────────┬────────┘
        │                               │
        ▼                               ▼
┌─────────────────────┐        ┌──────────────────────┐
│ lib/gsc.ts          │        │ lib/clients.ts       │
│ - decode b64 SA JSON│        │ - Redis.fromEnv()    │
│ - GoogleAuth(scopes)│        │ - smembers           │
│ - searchconsole.v1  │        │   ('clients:active') │
│   .sites.list()     │        └─────────┬────────────┘
│ - filter            │                  │
│   siteUnverifiedUser│                  ▼
└─────────┬───────────┘         Upstash Redis (REST)
          │                     SET clients:active
          ▼
   GSC API (sites.list)
          │
          ▼
  merge: mark ✓ sites present in active set
          │
          ▼
  HTTP 200 { response_type:'ephemeral', text } → Slack shows reply (<3s)
```

### Recommended Project Structure
```
.
├── api/
│   └── slack/
│       └── command.ts        # Slack Request URL: verify → route /list → ephemeral reply
├── lib/
│   ├── config.ts             # env parsing/validation (fail-fast)
│   ├── slack/
│   │   └── verify.ts         # HMAC verification (reusable; unit-tested)
│   ├── gsc.ts                # SA auth (b64 decode) + sites.list + filter
│   └── clients.ts            # Redis: smembers('clients:active') (CRUD completo en Fase 2)
├── lib/__tests__/            # o *.test.ts junto al módulo
│   ├── verify.test.ts        # firma válida/ inválida/ replay
│   └── gsc.test.ts           # filtro siteUnverifiedUser
├── vercel.json               # (mínimo en Fase 1; functions config opcional)
├── tsconfig.json
├── package.json
├── .env.local                # NUNCA commiteado
└── .gitignore                # incluye .env.local, .vercel
```

### Pattern 1: Web-standard handler con raw body (RECOMENDADO)
**What:** Usar la firma Web-standard de funciones Vercel para obtener el body crudo sin pelear con el parser.
**When to use:** El endpoint de Slack — siempre necesita el raw body.
```typescript
// api/slack/command.ts
// Source: https://vercel.com/kb/guide/how-do-i-get-the-raw-body-of-a-serverless-function [CITED]
export async function POST(req: Request): Promise<Response> {
  const raw = await req.text();                     // RAW body, sin parsear
  const sig = req.headers.get('x-slack-signature') ?? '';
  const ts  = req.headers.get('x-slack-request-timestamp') ?? '';

  if (!verifySlackSignature(raw, ts, sig)) {
    return new Response('invalid signature', { status: 401 });
  }

  const params = new URLSearchParams(raw);          // x-www-form-urlencoded
  const command = params.get('command');
  if (command === '/list') {
    const text = await buildListReply();
    return Response.json({ response_type: 'ephemeral', text });
  }
  return Response.json({ response_type: 'ephemeral', text: 'Comando no soportado.' });
}
```
> Corre en runtime Node por defecto (NO añadir `export const runtime = 'edge'`). `googleapis` requiere Node. `[CITED: vercel.com/docs/functions]`

### Pattern 1b: Handler clásico (alternativa)
**What:** `(req: VercelRequest, res: VercelResponse)` con `bodyParser` desactivado + lectura manual del stream.
**When to use:** Solo si el equipo prefiere la firma clásica. Tiene más footguns (ver Pitfall 2).
```typescript
// api/slack/command.ts  (alternativa clásica)
import type { VercelRequest, VercelResponse } from '@vercel/node';
export const config = { api: { bodyParser: false } };

async function readRawBody(req: VercelRequest): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}
```

### Pattern 2: Raw-body HMAC verification (`lib/slack/verify.ts`)
**What:** Reconstruir `v0:{timestamp}:{rawBody}`, HMAC-SHA256 con el signing secret, comparar en tiempo constante, rechazar timestamps > 5 min.
**When to use:** Siempre, antes de procesar cualquier comando.
```typescript
// lib/slack/verify.ts
// Source: https://docs.slack.dev/authentication/verifying-requests-from-slack/ [CITED]
import { createHmac, timingSafeEqual } from 'node:crypto';

export function verifySlackSignature(
  rawBody: string,
  timestamp: string,
  signature: string,
  signingSecret = process.env.SLACK_SIGNING_SECRET!,
  now = Date.now(),
): boolean {
  // 1. Replay protection: 5-minute window
  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return false;
  if (Math.abs(now / 1000 - ts) > 60 * 5) return false;

  // 2. Reconstruct base string and HMAC
  const base = `v0:${timestamp}:${rawBody}`;
  const expected = 'v0=' + createHmac('sha256', signingSecret).update(base).digest('hex');

  // 3. Constant-time compare (length-guard first to avoid throw)
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
```
**Headers exactos (Slack):** `x-slack-signature` (valor `v0=<hex>`), `x-slack-request-timestamp` (unix seconds). Ventana de replay: 5 minutos. `[CITED: docs.slack.dev]`

### Pattern 3: GSC Service Account auth desde JSON base64 (`lib/gsc.ts`)
**What:** Decodificar el JSON completo de la SA desde `GSC_SA_KEY_B64`, construir el cliente, llamar `sites.list`, filtrar.
**When to use:** GSC-01 + GSC-02.
```typescript
// lib/gsc.ts
// Source: googleapis searchconsole v1 — github.com/googleapis/google-api-nodejs-client [CITED]
import { google } from 'googleapis';

const SCOPES = ['https://www.googleapis.com/auth/webmasters.readonly'];

function getAuth() {
  const json = JSON.parse(
    Buffer.from(process.env.GSC_SA_KEY_B64!, 'base64').toString('utf8'),
  );
  return new google.auth.GoogleAuth({
    credentials: { client_email: json.client_email, private_key: json.private_key },
    scopes: SCOPES,
  });
}

export interface GscSite { siteUrl: string; permissionLevel: string; }

export async function listReadableSites(): Promise<GscSite[]> {
  const searchconsole = google.searchconsole({ version: 'v1', auth: getAuth() });
  const res = await searchconsole.sites.list();
  const entries = res.data.siteEntry ?? [];
  return entries
    .filter((e) => e.permissionLevel !== 'siteUnverifiedUser')   // GSC-02
    .map((e) => ({ siteUrl: e.siteUrl!, permissionLevel: e.permissionLevel! }));
}
```
> `searchconsole('v1')` es el namespace actual; envuelve internamente los endpoints REST `webmasters/v3` (`/webmasters/v3/sites`). El scope `webmasters.readonly` aplica a ambos. `permissionLevel ∈ { siteOwner, siteFullUser, siteRestrictedUser, siteUnverifiedUser }`. `[CITED: developers.google.com/webmaster-tools/v1/sites/list]`
> **Filtrar `siteUnverifiedUser` decodifica el `siteUrl` canónico tal cual** (`sc-domain:ejemplo.com` o `https://www.ejemplo.com/`) — devolverlo sin normalizar para que `/add` (Fase 2) use el mismo string exacto.

### Pattern 4: Redis read (`lib/clients.ts`)
**What:** Inicializar `@upstash/redis` desde env y leer el SET de activos.
**When to use:** PER-01 — marcar con ✓ qué propiedades ya están activas.
```typescript
// lib/clients.ts
// Source: https://upstash.com/docs/redis/sdks/ts [CITED]
import { Redis } from '@upstash/redis';

const redis = Redis.fromEnv();   // lee UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN

const ACTIVE_KEY = 'clients:active';

export async function getActiveClients(): Promise<Set<string>> {
  const members = await redis.smembers(ACTIVE_KEY);   // string[]
  return new Set(members);
}

// Fase 2 añadirá: redis.sadd(ACTIVE_KEY, siteUrl) / redis.srem(...)
```
> `Redis.fromEnv()` lee `UPSTASH_REDIS_REST_URL` y `UPSTASH_REDIS_REST_TOKEN` automáticamente. `smembers(key)` devuelve `string[]`. `[CITED: upstash.com/docs/redis/sdks/ts/commands/set/smembers]`

### Pattern 5: Construir el reply de `/list`
**What:** Hacer merge de sites legibles (GSC) con el set activo (Redis), marcando ✓.
```typescript
// dentro del handler o lib/gsc.ts
export async function buildListReply(): Promise<string> {
  const [sites, active] = await Promise.all([listReadableSites(), getActiveClients()]);
  if (sites.length === 0) return 'No hay propiedades legibles por la Service Account.';
  const lines = sites.map((s) => `${active.has(s.siteUrl) ? '✓' : '•'} ${s.siteUrl}`);
  return `*Propiedades GSC*\n${lines.join('\n')}`;
}
```

### Anti-Patterns to Avoid
- **Parsear el body antes de verificar la firma:** el HMAC se calcula sobre los bytes crudos; cualquier re-serialización rompe el match. Leer raw primero, parsear después. (Pitfall 2)
- **Hand-roll del compare de firma con `===`:** vulnerable a timing attacks. Usar `crypto.timingSafeEqual` con guard de longitud. (Security V6)
- **`PRIVATE_KEY` con `\n` escapados en env:** clase de bug eliminada por la decisión base64-JSON. NO añadir `GSC_SA_PRIVATE_KEY` aparte. (Pitfall 3)
- **Edge runtime:** `googleapis` no corre en Edge. Mantener Node. (Anti-pattern silencioso)
- **Instalar `@slack/web-api` "por si acaso":** no se usa en Fase 1; el reply va en el body HTTP.
- **Global mutable para la lista de clientes:** no sobrevive cold starts; usar Redis.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Comparación constante de firmas | `expected === received` | `crypto.timingSafeEqual` | Timing attacks; el `===` filtra info por tiempo |
| HMAC-SHA256 | implementación manual | `crypto.createHmac('sha256', …)` | Builtin, auditado |
| JWT minting de la SA | firmar el JWT a mano | `google.auth.GoogleAuth` (bundled en googleapis) | Maneja token exchange, refresh, clock skew |
| Cliente REST de GSC | `fetch` a `/webmasters/v3/...` | `google.searchconsole('v1')` | Tipos, auth integrada, paginación |
| Cliente Redis serverless | pool TCP propio | `@upstash/redis` (REST) | Las conexiones TCP no sobreviven en serverless |
| Parseo de form-urlencoded | split manual de `&`/`=` | `new URLSearchParams(raw)` | Builtin, maneja encoding |

**Key insight:** En esta fase casi todo el código de valor es "pegamento" entre SDKs oficiales. El único código original con riesgo de seguridad es `verify.ts`, y ahí el algoritmo está completamente especificado por Slack — no hay decisiones de diseño, solo seguir la receta con `timingSafeEqual`.

## Common Pitfalls

### Pitfall 1: Firma falla en serverless por body parseado
**What goes wrong:** Verificación devuelve 401 a requests legítimas, o (peor) se "salta" silenciosamente.
**Why it happens:** Slack firma los bytes crudos (`v0:timestamp:rawBody`). Si el runtime parsea el body antes del handler, re-serializar produce un string distinto y el HMAC nunca matchea.
**How to avoid:** Usar `await req.text()` (Web-standard) que entrega el raw sin parseo. En el modelo clásico, `config.api.bodyParser=false` + leer el stream.
**Warning signs:** Todo funciona local pero 401 en prod; verificación "pasa" porque está deshabilitada.

### Pitfall 2: Ambigüedad del `bodyParser` en `@vercel/node`
**What goes wrong:** Con la firma clásica, `req.body` puede venir ya parseado y el raw perdido; `config.api.bodyParser=false` tiene comportamiento reportado como inconsistente entre versiones.
**Why it happens:** `config.api.bodyParser` es semántica heredada de Next.js; su soporte en funciones puras `@vercel/node` ha sido históricamente ambiguo.
**How to avoid:** Preferir el handler **Web-standard** (`Request`/`Response`) con `await req.text()` — no depende de ningún flag de parser. Si se usa el clásico, leer el stream manualmente y NO tocar `req.body`.
**Warning signs:** `raw` llega vacío o como `[object Object]`; firma falla solo en deploy.

### Pitfall 3: Newline escaping de la private key
**What goes wrong:** Auth a GSC falla con `DECODER routines::unsupported` / `Invalid PEM`. Funciona local, rompe en Vercel.
**Why it happens:** La key PEM es multilínea; en env var los `\n` se mangléan entre plataformas.
**How to avoid:** Decisión locked correcta — base64 del JSON completo + `Buffer.from(b64,'base64')` + `JSON.parse`. NO usar `replace(/\\n/g,'\n')`. **Verificar la auth en un deploy preview, no solo en `vercel dev`.**
**Warning signs:** `Invalid PEM`; funciona en `vercel dev` pero 500 en función desplegada.

### Pitfall 4: SA no agregada como usuario en la propiedad → "0 rows"
**What goes wrong:** `sites.list` devuelve menos propiedades de las esperadas, o una aparece como `siteUnverifiedUser`.
**Why it happens:** GSC es per-property; el email de la SA debe agregarse manualmente como usuario en cada propiedad. No hay grant account-wide.
**How to avoid:** Documentar en README el paso de onboarding: agregar `<sa>@<project>.iam.gserviceaccount.com` como usuario (Full/Restricted) en cada propiedad GSC. El filtro `siteUnverifiedUser` ya excluye las no concedidas.
**Warning signs:** `/list` muestra una propiedad esperada con permiso insuficiente o no la muestra.

### Pitfall 5: Slash command excede 3s en cold start
**What goes wrong:** Slack muestra `operation_timeout` y reintenta.
**Why it happens:** Cold start + una llamada `sites.list` puede acercarse a 3s.
**How to avoid:** El trabajo de `/list` es una sola lectura — entra holgado normalmente. Inicializar el cliente GSC a module scope para reuso en warm. Si en práctica se ve lento, Fase 1 puede aceptar el riesgo (es un slice); el patrón `response_url` deferred queda para revisar si aparece. (Nota: la decisión locked es síncrono — correcto para este alcance.)
**Warning signs:** `operation_timeout` correlacionado con cold starts.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `google.webmasters('v3')` | `google.searchconsole('v1')` | namespace vigente | Mismo backend REST; usar v1 |
| Vercel KV (`@vercel/kv`) | `@upstash/redis` | dic 2024 (KV deprecado) | Proyectos nuevos no provisionan KV |
| `config.api.bodyParser=false` (Next pages) | `await req.text()` (Web-standard fn) | funciones Vercel modernas | Raw body sin flags |
| `GSC_SA_PRIVATE_KEY` con `\n` | JSON completo en base64 | decisión del proyecto | Elimina la clase de bug de newlines |

**Deprecated/outdated:**
- `@vercel/kv`: retirado, migrado a Upstash.
- Patrón Bolt ack-then-async en serverless: frágil; descartado para este proyecto.

## Project Constraints (from CLAUDE.md)

- **Idioma del reporte:** español (neutral). Los textos de `/list` y mensajes al usuario en español.
- **Stack declarado en CLAUDE.md** menciona `@slack/bolt` y "Vercel KV / Upstash" — **CONTEXT.md lo overridea**: NO Bolt (handler propio), y Upstash (no KV). El planner debe seguir CONTEXT, no la tabla heredada de CLAUDE.md.
- **GSD workflow:** los cambios de archivos van a través de comandos GSD; no editar fuera del flujo.
- **No Socket Mode:** HTTP endpoint (Request URL) — consistente con CONTEXT.
- **Persistencia:** Upstash Redis para estado entre invocaciones.
- **Convenciones:** aún no establecidas (sección vacía en CLAUDE.md) — el planner puede definir las primeras (estructura `api/`+`lib/`, tests co-localizados).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Pinear TypeScript a 5.x (no 6.0.3) por compatibilidad con `@vercel/node` | Standard Stack | Bajo — si TS6 funciona, solo se pierde nada; si no se pinea, posible breakage de build |
| A2 | `vitest` como framework de tests (versión sin verificar) | Standard Stack | Bajo — `node:test` es fallback sin dependencia |
| A3 | `Redis.fromEnv()` lee exactamente `UPSTASH_REDIS_REST_URL`/`TOKEN` | Pattern 4 | Bajo — bien documentado; alternativa `new Redis({url,token})` explícito |
| A4 | `/list` síncrono entra en 3s incluso con cold start | Pitfall 5 | Medio — si se excede, hay que mover a `response_url` deferred (cambio de patrón) |
| A5 | El handler Web-standard `POST(req: Request)` corre en runtime Node por defecto en funciones `/api` de Vercel | Pattern 1 | Medio — si el proyecto usa otra config de runtime, confirmar que NO es Edge |
| A6 | `searchconsole('v1')` expone `sites.list` con la misma forma de respuesta que `webmasters/v3` | Pattern 3 | Bajo — confirmado contra el source de google-api-nodejs-client |

## Open Questions

1. **¿Cómo se seedea `clients:active` para probar el read en Fase 1?**
   - What we know: `/add` (escritura) es Fase 2; Fase 1 solo lee.
   - What's unclear: si seedear manualmente (Upstash console / un script) o incluir un `sadd` mínimo.
   - Recommendation: seedear 1-2 `siteUrl` reales por la consola de Upstash (o un script dev one-shot) para validar que ✓ aparece. No bloquea el slice.

2. **¿Plan de Vercel (Hobby vs Pro)?**
   - What we know: no afecta Fase 1 (los comandos son HTTP-triggered, funcionan en Hobby). Afecta Fase 4 (cron).
   - Recommendation: diferir la decisión a Fase 4; documentar que `/list` funciona en cualquier plan.

3. **¿`response_type` y formato del reply?**
   - What we know: ephemeral (locked). mrkdwn vs plain text es discreción.
   - Recommendation: `response_type: 'ephemeral'` con `text` en mrkdwn (`*bold*`, `✓`).

## Environment Availability

> Dependencias externas que requieren provisión humana (no son tooling local que pueda probar desde este entorno).

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Cuenta Vercel + CLI (`vercel`) | Deploy/preview, env vars | provisión humana | `54.17.1` (latest) | — |
| Slack App (signing secret + slash command `/list` apuntando a la Request URL) | CMD-03, CMD-05 | provisión humana | — | — |
| Google Cloud project + Search Console API habilitada + SA con JSON key | GSC-01 | provisión humana | — | — |
| SA agregada como usuario en cada propiedad GSC | GSC-02 (datos reales) | provisión humana | — | — |
| Instancia Upstash Redis (REST URL + token) | PER-01 | provisión humana | — | — |
| Node 18+ runtime (Vercel) | todo | sí (Vercel default) | 20.x | — |

**Missing dependencies with no fallback:**
- Slack App, Google Cloud SA y Upstash son prerequisitos de provisión humana — el planner debe incluir tasks de setup/checkpoint (crear la app, habilitar la API, agregar la SA a las propiedades, provisionar Upstash) ANTES de los tasks de código que dependen de ellos. Sin estos, el slice no puede verificarse end-to-end en preview.

**Missing dependencies with fallback:**
- Ninguna — todos los seams requieren los servicios reales para el walking skeleton (ese es el punto del slice).

## Security Domain

> `security_enforcement: true`, ASVS Level 1, `block_on: high`.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | parcial | La autenticidad de la request se prueba con la firma HMAC de Slack (no hay login de usuario). `verify.ts` ES el control de auth del borde. |
| V3 Session Management | no | Sin sesiones; cada request es stateless y auto-firmada. |
| V4 Access Control | parcial | El endpoint solo procesa si la firma valida; sin firma → 401. (Cron secret es Fase 4.) |
| V5 Input Validation | sí | Validar `command`, `text`; parsear con `URLSearchParams`; rechazar comandos no soportados. |
| V6 Cryptography | sí | HMAC-SHA256 + `timingSafeEqual` (NO `===`). NUNCA hand-roll. SA key decodificada en memoria, nunca logueada. |
| V7 Errors & Logging | sí | NO loguear `SLACK_SIGNING_SECRET`, `GSC_SA_KEY_B64`, ni el body crudo. Redact en cualquier log. |
| V14 Config | sí | Secrets solo en env (Vercel + `.env.local`). `.env.local` y `.vercel` en `.gitignore`. Nunca commitear la SA JSON. |

### Known Threat Patterns for Vercel Node + Slack + GSC

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Request de Slack forjada / spoofeada | Spoofing | Verificación HMAC `v0:ts:rawBody` con signing secret; 401 si falla |
| Replay de una request capturada | Tampering/Spoofing | Ventana de 5 min sobre `x-slack-request-timestamp` |
| Tampering del body para inyectar otro comando | Tampering | HMAC sobre bytes crudos (cubre todo el body) |
| Timing attack sobre el compare de firma | Information Disclosure | `crypto.timingSafeEqual` + guard de longitud |
| Fuga de la SA key o signing secret en logs | Information Disclosure | Redact; nunca loguear secrets ni raw body; secrets solo en env |
| Commit accidental de la SA JSON | Information Disclosure | base64 en env var; `.gitignore` de `.env.local`; nunca archivo en repo |
| Endpoint llamado por terceros sin firma | Elevation/DoS | Firma obligatoria antes de cualquier trabajo (GSC/Redis) |

**Security gate (`block_on: high`):** Para Fase 1, el control de seguridad alto es la verificación de firma. Tasks deben incluir un test negativo: body tampered / firma inválida / timestamp viejo → 401. Sin ese test, el gate de seguridad no se cumple.

## Sources

### Primary (HIGH confidence)
- Slack — Verifying requests from Slack (v0 sig, raw body, 5-min window, headers): https://docs.slack.dev/authentication/verifying-requests-from-slack/
- Google Search Console API — Sites: list (`siteEntry`, `permissionLevel`, scopes): https://developers.google.com/webmaster-tools/v1/sites/list
- google-api-nodejs-client — searchconsole v1 / webmasters v3 source (tipos `WmxSite`, `SitesListResponse`): https://github.com/googleapis/google-api-nodejs-client
- Vercel — Getting the raw body of a Serverless Function (`await req.text()`): https://vercel.com/kb/guide/how-do-i-get-the-raw-body-of-a-serverless-function
- Vercel — Node.js runtime for Functions: https://vercel.com/docs/functions/serverless-functions/runtimes/node-js
- Upstash — Redis TS SDK (`Redis.fromEnv`, `sadd`, `smembers`): https://upstash.com/docs/redis/sdks/ts
- npm registry — versiones verificadas el 2026-06-25 (`googleapis@173.0.0`, `@upstash/redis@1.38.0`, `@vercel/node@5.8.21`, `google-auth-library@10.9.0`)

### Secondary (MEDIUM confidence)
- Vercel community/discussions — raw body en funciones serverless (#5213, #4524, #5677): https://github.com/vercel/vercel/discussions/5213
- Project research: STACK.md, ARCHITECTURE.md, PITFALLS.md, SUMMARY.md (verificados contra fuentes oficiales arriba)

### Tertiary (LOW confidence)
- Versión exacta de `vitest` (no verificada en esta sesión — confirmar antes de instalar)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — versiones verificadas contra npm; paquetes oficiales
- Architecture: HIGH — recetas de raw body / HMAC / GSC auth / Redis confirmadas contra docs oficiales
- Pitfalls: HIGH — corroboradas por docs oficiales y la investigación de proyecto
- Security: HIGH — el único control crítico (firma) está completamente especificado por Slack

**Research date:** 2026-06-25
**Valid until:** ~2026-07-25 (stack estable; revalidar versiones si pasa más de un mes)
