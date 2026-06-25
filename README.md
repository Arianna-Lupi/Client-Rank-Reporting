# Client Rank Reporting — Slack GSC Bot

Bot interno de Arianna Lupi que reporta a diario, dentro de Slack, las métricas
de Google Search Console (GSC) de cada cliente y su variación día contra día.
Fase 1 entrega el _walking skeleton_: un endpoint de Slack con firma verificada
que lista las propiedades GSC legibles vía `/list`, con la lista de clientes
activos persistida en Upstash Redis.

## Stack y decisiones

- **Runtime:** funciones serverless de Vercel sobre **Node** (no Edge —
  `googleapis` requiere Node).
- **Slack:** handler HTTP propio y síncrono con verificación HMAC manual sobre
  el body crudo. **No** se usa `@slack/bolt`, `@vercel/slack-bolt` ni Socket
  Mode: `/list` es una sola lectura que entra holgada en los 3 s de Slack, y el
  patrón Bolt _ack-then-async_ es frágil en serverless. La respuesta de `/list`
  viaja en el body HTTP como JSON ephemeral; no se postea al canal (eso llega en
  Fase 4 con el reporte diario).
- **GSC:** autenticación con Service Account. El JSON completo de la credencial
  va base64-encodeado en una sola env var (`GSC_SA_KEY_B64`) para evitar la
  clase de bug de newlines de la private key en PEM.
- **Persistencia:** `@upstash/redis` (cliente REST/HTTP; Vercel KV está
  deprecado). Un SET `clients:active` guarda los `siteUrl` canónicos.

## Estructura

```
api/slack/command.ts   # Request URL de Slack: verify → route /list → reply ephemeral
lib/config.ts          # Lectura/validación fail-fast de env (SCH-03)
lib/slack/verify.ts    # Verificación HMAC del body crudo (testeado)
lib/gsc.ts             # Auth SA (base64) + sites.list + filtro siteUnverifiedUser
lib/clients.ts         # Read del SET clients:active en Redis
```

## Variables de entorno

Todas las claves sensibles se leen del entorno (SCH-03). Copia `.env.example` a
`.env.local` (nunca se commitea) para desarrollo, y configura las mismas en el
dashboard de Vercel para el deploy. Inventario completo con cómo obtener cada
valor: ver [`.env.example`](./.env.example).

| Variable | Para qué |
|----------|----------|
| `SLACK_SIGNING_SECRET` | Verificar la firma HMAC de cada slash command |
| `SLACK_CHANNEL_ID` | Canal destino del reporte diario (Fase 4) |
| `GSC_SA_KEY_B64` | JSON de la Service Account, base64-encodeado |
| `UPSTASH_REDIS_REST_URL` | Endpoint REST de Upstash Redis |
| `UPSTASH_REDIS_REST_TOKEN` | Token REST de Upstash Redis |
| `REPORT_TZ` | Zona horaria del reporte (opcional; default `America/Mexico_City`) |

## Onboarding: conceder la Service Account en cada propiedad GSC

GSC otorga permisos **por propiedad**, no a nivel cuenta. Para que una propiedad
aparezca en `/list`, agrega el correo de la Service Account
(`<nombre>@<proyecto>.iam.gserviceaccount.com`) como **usuario** de esa
propiedad:

1. Entra a [Google Search Console](https://search.google.com/search-console).
2. Elige la propiedad → **Configuración** → **Usuarios y permisos**.
3. **Agregar usuario** → pega el correo de la Service Account → permiso
   **Restringido** o **Completo** (lectura basta para el reporte).
4. Repite por cada propiedad que quieras reportar.

Las propiedades sin conceder llegan como `siteUnverifiedUser` y se filtran
automáticamente; `sites.list` devuelve 0 propiedades hasta que concedas al menos
una.

## Seedear `clients:active` para probar el ✓

`/list` marca con ✓ las propiedades presentes en el SET `clients:active` de
Redis. La escritura (`/add`, `/remove`) llega en Fase 2; por ahora seedea
manualmente desde la **consola de Upstash** para validar el ✓:

```
SADD clients:active <siteUrl-canónico>
```

Usa el `siteUrl` **exacto** que devuelve `/list` (p. ej. `sc-domain:ejemplo.com`
o `https://www.ejemplo.com/`). Puedes seedear 1 o 2 propiedades.

## Deploy a un preview de Vercel

```bash
# 1. Generar un preview deployment
vercel

# 2. Configurar las 6 env vars en el environment del preview
#    (o hazlo desde el dashboard: Project → Settings → Environment Variables)
vercel env add SLACK_SIGNING_SECRET
vercel env add SLACK_CHANNEL_ID
vercel env add GSC_SA_KEY_B64
vercel env add UPSTASH_REDIS_REST_URL
vercel env add UPSTASH_REDIS_REST_TOKEN
vercel env add REPORT_TZ

# 3. Re-deploy para que el preview tome las env vars
vercel
```

Luego, en la Slack App (api.slack.com/apps → tu app → **Slash Commands**),
apunta el comando `/list` a la **Request URL**:

```
<preview-url>/api/slack/command
```

Reinstala la app al workspace si Slack lo pide. Ejecuta `/list` en el canal: la
respuesta ephemeral lista las propiedades legibles, con ✓ en las seedeadas.

## Verificación de seguridad

Una firma inválida debe devolver `401` antes de cualquier trabajo:

```bash
curl -i -X POST <preview-url>/api/slack/command \
  -d 'command=/list' \
  -H 'x-slack-signature: v0=deadbeef' \
  -H 'x-slack-request-timestamp: 1'
# Esperado: HTTP/1.1 401
```

## Desarrollo

```bash
npm install
npm run typecheck   # tsc --noEmit
npm test            # vitest run (verify.ts + filtro de gsc.ts)
```
