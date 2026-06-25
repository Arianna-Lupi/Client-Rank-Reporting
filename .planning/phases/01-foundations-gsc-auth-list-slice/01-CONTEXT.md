# Phase 1: Foundations + GSC Auth + `/list` Slice - Context

**Gathered:** 2026-06-25
**Status:** Ready for planning

<domain>
## Phase Boundary

Esta fase entrega un endpoint de Slack desplegado que: (1) se autentica a Google Search Console con una Service Account, (2) verifica la firma HMAC de Slack sobre el body crudo, (3) lista las propiedades GSC legibles vía el comando `/list`, y (4) persiste la lista de clientes activos en Redis (Upstash). Es el primer vertical slice — prueba firma de Slack, auth de GSC y persistencia de punta a punta, sin lógica de métricas ni deltas (eso es Fase 3).

</domain>

<decisions>
## Implementation Decisions

### Stack base & runtime
- TypeScript + Node.js runtime en Vercel (no Edge — `googleapis` requiere Node).
- Handler HTTP propio para Slack, síncrono, con verificación HMAC manual. Se descarta `@vercel/slack-bolt` y Socket Mode: el trabajo de `/list` es pequeño y entra en los 3s; el patrón Bolt ack-then-async es frágil en serverless (la instancia se congela al responder y mata el trabajo pendiente).
- `bodyParser` desactivado en la ruta del comando para poder validar la firma sobre los bytes crudos.
- Persistencia con `@upstash/redis` (cliente REST/HTTP; Vercel KV está deprecado desde dic 2024).

### Auth GSC & configuración (env)
- Credencial de la Service Account como JSON completo en base64 en una sola env var (`GSC_SA_KEY_B64`) — elimina la clase de bug del escape de newlines de la private key.
- Scope `https://www.googleapis.com/auth/webmasters.readonly` (solo lectura).
- Canal destino fijo vía env var `SLACK_CHANNEL_ID` (un solo canal v1).
- Env vars en Vercel para prod + `.env.local` para dev, nunca commiteado.

### Comportamiento de `/list`
- Muestra todas las propiedades legibles por la SA, marcando con ✓ cuáles ya están activas en el reporte.
- Filtra/excluye propiedades con `permissionLevel === "siteUnverifiedUser"` (la SA no puede leerlas).
- Respuesta ephemeral (visible solo para quien ejecuta el comando).
- Muestra el `siteUrl` canónico tal cual (`sc-domain:` o URL-prefix) para que `/add` (Fase 2) use exactamente el mismo valor.

### Estructura del proyecto & deploy
- Layout: `api/` para rutas serverless + `lib/` para servicios compartidos (`gsc`, `slack`, `clients`, `config`).
- Estructura en Redis: un SET `clients:active` con los `siteUrl` canónicos.
- Verificación de firma en un módulo reusable `lib/slack/verify.ts` (HMAC `v0:timestamp:rawBody` + ventana de 5 min).
- Tests: unit test del verificador de firma y del filtro de propiedades legibles.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- Greenfield — no hay código previo. Esta fase crea la base que reutilizan las Fases 2-4.

### Established Patterns
- "Thin handlers, shared services": los handlers en `api/` son shells delgados; toda la lógica vive en `lib/` y la comparten el handler de comandos y (luego) el cron.

### Integration Points
- `api/slack/command.ts` (o equivalente) — entrypoint del slash command.
- `lib/gsc.ts` — auth SA + `sites.list`.
- `lib/clients.ts` — CRUD del SET en Redis.
- `lib/slack/verify.ts` — verificación de firma.
- `lib/config.ts` — lectura/validación de env vars.

</code_context>

<specifics>
## Specific Ideas

- El email de la Service Account debe agregarse manualmente como usuario en cada propiedad GSC (la SA es per-property, no domain-wide). Documentar este paso en el README.
- `sites.list` alimenta directamente `/list` y la validación de `/add` en Fase 2.

</specifics>

<deferred>
## Deferred Ideas

- `/add` y `/remove` → Fase 2.
- Lógica de métricas + cálculo de deltas → Fase 3.
- Reporte Block Kit + cron diario + idempotencia → Fase 4.
- Aliases legibles por cliente, allowlist de permisos, `/report` on-demand → v2.

</deferred>
