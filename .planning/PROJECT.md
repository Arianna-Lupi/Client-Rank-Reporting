# Client Rank Reporting — Slack GSC Bot

## What This Is

Un bot de Slack que publica diariamente en un canal el reporte de métricas de Google Search Console (impresiones, clics, CTR, posición media) para cada cliente, mostrando el porcentaje de variación respecto al día anterior. Incluye comandos `/add <cliente>`, `/remove <cliente>` y `/list` para gestionar qué clientes (propiedades GSC) entran al reporte. Es una herramienta interna para la agencia (Arianna Lupi) que evita entrar a GSC manualmente cada mañana.

## Core Value

Cada mañana el equipo ve, sin entrar a GSC, cómo se movió cada cliente día contra día directamente en Slack.

## Current Milestone: v1.1 Weekly Per-Client Reports

**Goal:** Reporte semanal por cliente, publicado cada uno a su propio canal interno de Slack, con comparación semana vs semana y las URLs que más suben/bajan en clics.

**Target features:**
- Comparación semana vs semana (7 días vs 7 previos, anclada al último día con datos de GSC) en lugar de día vs día
- Ruteo por cliente: cada cliente reporta a su propio canal de Slack (mapa cliente→canal en Redis, seteado por comando)
- Top 3 URLs que subieron en clics y top 3 que bajaron, por cliente, vía Search Analytics con dimensión `page`
- Métricas del reporte: tráfico (impresiones) WoW + clics WoW + CTR + posición media, todas con su delta semanal
- Mejor formato de mensajes y números (Block Kit más legible)
- Roster inicial: deltacloudz.com, felipevergara.co, childrenchic.com (renombrar a nuevo dominio después), fhcaorlando.com

## Requirements

### Validated

(None yet — ship to validate)

### Active

- [ ] Reporte diario automático a las 9:00 AM (zona horaria configurable por env)
- [ ] Por cada cliente activo, un mensaje en el canal con impresiones, clics, CTR y posición media
- [ ] Cada métrica muestra el % de variación vs el día anterior comparable
- [ ] La comparación usa el último día con datos disponibles en GSC vs el día previo (maneja el lag de 2-3 días)
- [ ] Comando `/add <cliente>` agrega una propiedad GSC al reporte
- [ ] Comando `/remove <cliente>` quita una propiedad del reporte
- [ ] Comando `/list` lista todas las propiedades disponibles en la cuenta de GSC
- [ ] La lista de clientes activos persiste entre invocaciones serverless
- [ ] Autenticación a GSC vía Service Account con acceso a todas las propiedades

### Out of Scope

- Socket Mode / proceso always-on — incompatible con serverless efímero; se usa HTTP endpoint
- Dashboard web / UI propia — el reporte vive en Slack, no se construye front
- Métricas fuera de GSC (Analytics, Ads, rankings de terceros) — alcance es solo GSC v1
- Histórico/almacén de datos a largo plazo — se consulta GSC on-demand, no se hace data warehouse v1
- Multi-workspace de Slack — un solo workspace/canal v1

## Context

- Agencia SEO (Arianna Lupi). Usuario: Juan. Idioma del reporte: español.
- Ya existe acceso a GSC y familiaridad con la API (hay un GSC MCP en uso), pero el bot usa su propia Service Account para correr desatendido.
- GSC Search Analytics API tiene 2-3 días de lag; "día anterior" se interpreta como el último día con datos vs el previo.
- Clientes = propiedades (sites) registradas en la cuenta de GSC.

## Constraints

- **Tech stack**: Node.js + Slack Bolt + `googleapis` — encaja con serverless y el ecosistema Slack/Google.
- **Hosting**: Vercel serverless (funciones + cron) — sin servidor que mantener.
- **Slack**: HTTP endpoint (Request URL) para slash commands; cron serverless para el push diario. No Socket Mode.
- **Persistencia**: Vercel KV / Upstash Redis para la lista de clientes activos (estado entre invocaciones efímeras).
- **GSC auth**: Service Account (JSON) con permiso de lectura sobre todas las propiedades a reportar.
- **Idioma**: reporte en español.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| HTTP endpoint en vez de Socket Mode | Socket Mode requiere conexión persistente, incompatible con serverless | — Pending |
| Service Account para GSC | Corridas diarias desatendidas sin refrescar token OAuth | — Pending |
| Comparar último día disponible vs previo | GSC tiene lag de 2-3 días; fechas fijas darían datos parciales/vacíos | — Pending |
| Vercel KV/Upstash para lista de clientes | Serverless es efímero; necesita estado externo persistente | — Pending |
| Un mensaje por cliente | Claridad por cliente y permite escanear rápido en el canal | — Pending |
| [v1.1] Comparación semana vs semana (7d vs 7d previos) | Arianna pidió reporte semanal; ventana móvil anclada al último día absorbe el lag GSC | — Pending |
| [v1.1] 1 canal por cliente (mapa en Redis) | Cada cliente tiene su canal interno; mapa en Redis evita redeploy al cambiar canal | — Pending |
| [v1.1] "tráfico" = impresiones | Arianna lista tráfico y clics por separado; tráfico es la otra métrica de volumen GSC | — Pending |
| [v1.1] Mantener CTR y posición media | Se suman a las nuevas métricas en vez de reemplazar | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd:complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-07-03 — milestone v1.1 started*
