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

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Slack Commands

- **CMD-06**: Aliases legibles por cliente (mapear nombre corto → URL de propiedad GSC)
- **CMD-07**: Comando `/report` para disparar el reporte on-demand
- **CMD-08**: Allowlist de quién puede usar `/add` y `/remove` + auditoría de cambios

### Reporting

- **RPT-05**: Modo de comparación alternativo (ventana 7 días vs 7 previos)
- **RPT-06**: Resumen "top movers" (mayores subidas/bajadas del día entre clientes)

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

**Coverage:**

- v1 requirements: 18 enumerated (note: prior header said "19 total" — the enumerated list contains 18 distinct IDs; corrected here)
- Mapped to phases: 18 ✓
- Unmapped: 0 ✓

---
*Requirements defined: 2026-06-25*
*Last updated: 2026-06-25 after roadmap creation (traceability mapped)*
