# Requirements: Client Rank Reporting — Slack GSC Bot

**Defined:** 2026-06-25
**Core Value:** Cada mañana el equipo ve, sin entrar a GSC, cómo se movió cada cliente día contra día directamente en Slack.

## v1 Requirements

Requirements for initial release. Each maps to roadmap phases.

### GSC Integration

- [x] **GSC-01**: El bot se autentica a Google Search Console con una Service Account (credenciales JSON en env como base64) sin intervención manual
- [x] **GSC-02**: El bot lista las propiedades disponibles vía `sites.list`, filtrando las que la Service Account no puede leer (`siteUnverifiedUser`)
- [x] **GSC-03**: El bot consulta Search Analytics y obtiene impresiones, clics, CTR y posición media de una propiedad para un rango de fechas
- [x] **GSC-04**: El bot resuelve el "último día con datos disponibles" consultando una ventana móvil (no usa una fecha fija) para absorber el lag de 2-3 días de GSC

### Reporting

- [x] **RPT-01**: Para cada métrica el bot calcula el % de variación del último día disponible vs el día previo comparable
- [x] **RPT-02**: El reporte muestra la dirección de la variación con indicador visual (flecha/emoji), invirtiendo el criterio para posición media (menor = mejor)
- [x] **RPT-03**: El reporte se publica como un mensaje por cliente en el canal, formateado con Block Kit (impresiones, clics, CTR, posición + sus deltas)
- [x] **RPT-04**: El reporte maneja casos sin datos / propiedad nueva / datos parciales sin romper (mensaje claro en vez de error)

### Slack Commands

- [x] **CMD-01**: `/add <cliente>` agrega una propiedad GSC a la lista de clientes activos del reporte
- [x] **CMD-02**: `/remove <cliente>` quita una propiedad de la lista de clientes activos
- [ ] **CMD-03**: `/list` lista las propiedades disponibles en la cuenta de GSC
- [x] **CMD-04**: Los comandos validan la entrada y responden con mensajes de error claros (propiedad inexistente, ya agregada, etc.)
- [x] **CMD-05**: El endpoint de comandos verifica la firma HMAC de Slack sobre el body crudo antes de procesar

### Persistence

- [x] **PER-01**: La lista de clientes activos persiste en Redis (Upstash) entre invocaciones serverless
- [x] **PER-02**: El bot evita publicar el reporte diario duplicado ante reintentos/reinvocaciones (clave de idempotencia con TTL)

### Scheduling & Infra

- [x] **SCH-01**: Un cron de Vercel dispara el reporte diario y publica a las 9:00 AM en la zona horaria configurada (`REPORT_TZ`), manejando que Vercel Cron corre en UTC
- [x] **SCH-02**: El endpoint del cron está protegido (`CRON_SECRET`) para que no se pueda disparar externamente
- [x] **SCH-03**: La configuración sensible (Service Account, tokens de Slack, canal destino, zona horaria) se maneja por variables de entorno

## v1.1 Requirements (Current Milestone)

**Milestone v1.1: Weekly Per-Client Reports** — definido 2026-07-03.

Reemplaza el modelo día-vs-día y canal-único de v1 por comparación semanal y ruteo por cliente, y agrega las URLs que más suben/bajan en clics.

### GSC Integration

- [x] **GSC-05**: El bot resuelve la ventana "semana a semana" como los últimos 7 días con datos vs los 7 días previos, anclada al último día disponible (absorbe el lag de 2-3 días de GSC)
- [x] **GSC-06**: El bot consulta Search Analytics con dimensión `page` para obtener clics por URL de una propiedad en una ventana de fechas dada

### Reporting

- [x] **RPT-05**: Para cada métrica el bot calcula el % de variación de la semana actual (7 días) vs la semana previa comparable (reemplaza el cálculo día-vs-día de RPT-01 en el reporte semanal)
- [x] **RPT-07**: El reporte por cliente muestra tráfico (impresiones) y clics semana vs semana, más CTR y posición media, cada uno con su delta semanal e indicador de dirección
- [x] **RPT-08**: El reporte lista las top 3 URLs que más subieron en clics semana vs semana para el cliente
- [x] **RPT-09**: El reporte lista las top 3 URLs que más bajaron en clics semana vs semana para el cliente
- [x] **RPT-10**: Los mensajes y números del reporte usan formato legible (miles separados, porcentajes y posición redondeados, URLs recortadas) en Block Kit

### Channel Routing

- [ ] **CH-01**: El bot mantiene en Redis un mapa cliente (propiedad GSC) → canal de Slack destino, persistente entre invocaciones
- [ ] **CH-02**: Un comando de Slack setea o actualiza el canal destino de un cliente dado
- [ ] **CH-03**: El reporte de cada cliente se publica en su canal mapeado; un cliente sin canal asignado se omite con un aviso claro (no rompe la corrida)

### Onboarding

- [ ] **CFG-01**: El roster inicial de clientes queda cargado: deltacloudz.com, felipevergara.co, childrenchic.com, fhcaorlando.com (nicmafia removido); childrenchic.com se renombra a su nuevo dominio cuando Arianna lo confirme

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Slack Commands

- **CMD-06**: Aliases legibles por cliente (mapear nombre corto → URL de propiedad GSC)
- **CMD-07**: Comando `/report` para disparar el reporte on-demand
- **CMD-08**: Allowlist de quién puede usar `/add` y `/remove` + auditoría de cambios

### Reporting

- **RPT-06**: Resumen "top movers" (mayores subidas/bajadas entre clientes, cross-cliente)

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Socket Mode / proceso always-on | Incompatible con serverless efímero; se usa HTTP endpoint |
| Dashboard web / UI propia | El reporte vive en Slack, no se construye front |
| Métricas fuera de GSC (Analytics, Ads, terceros) | Alcance v1 es solo GSC |
| Data warehouse / histórico a largo plazo | Se consulta GSC on-demand v1 |
| Multi-workspace de Slack | Un solo workspace/canal v1 |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| GSC-01 | Phase 1 | Complete |
| GSC-02 | Phase 1 | Complete |
| CMD-03 | Phase 1 | Pending |
| CMD-05 | Phase 1 | Complete |
| PER-01 | Phase 1 | Complete |
| SCH-03 | Phase 1 | Complete |
| CMD-01 | Phase 2 | Complete |
| CMD-02 | Phase 2 | Complete |
| CMD-04 | Phase 2 | Complete |
| GSC-03 | Phase 3 | Complete |
| GSC-04 | Phase 3 | Complete |
| RPT-01 | Phase 3 | Complete |
| RPT-04 | Phase 3 | Complete |
| RPT-02 | Phase 4 | Complete |
| RPT-03 | Phase 4 | Complete |
| PER-02 | Phase 4 | Complete |
| SCH-01 | Phase 4 | Complete |
| SCH-02 | Phase 4 | Complete |
| GSC-05 | Phase 5 | Complete |
| GSC-06 | Phase 5 | Complete |
| RPT-05 | Phase 5 | Complete |
| RPT-07 | Phase 6 | Complete |
| RPT-08 | Phase 6 | Complete |
| RPT-09 | Phase 6 | Complete |
| RPT-10 | Phase 6 | Complete |
| CH-01 | Phase 7 | Pending |
| CH-02 | Phase 7 | Pending |
| CH-03 | Phase 7 | Pending |
| CFG-01 | Phase 7 | Pending |

**Coverage:**

- v1 requirements: 18 enumerated, mapped to Phases 1-4 ✓
- v1.1 requirements: 11 enumerated (GSC-05/06, RPT-05/07/08/09/10, CH-01/02/03, CFG-01)
- v1.1 mapped to phases: 11 ✓ (Phase 5: 3, Phase 6: 4, Phase 7: 4)
- Unmapped: 0 ✓

---
*Requirements defined: 2026-06-25*
*Last updated: 2026-07-03 — v1.1 traceability mapped: Phase 5 (GSC-05/06, RPT-05), Phase 6 (RPT-07/08/09/10), Phase 7 (CH-01/02/03, CFG-01)*
