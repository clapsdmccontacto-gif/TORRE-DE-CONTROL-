# Torre de Control Logística · Constructor Center

WMS + TMS de Constructor Center (Bodega Los Ángeles). Arquitectura, esquema y hoja de ruta
en `README.md`. Repositorio **público**: no subir datos de clientes, inventarios reales ni
secretos (la única clave es la de TomTom de la empresa, ver abajo).

## Convenciones

- Backend: monolito modular NestJS 12 (ESM; los imports relativos llevan extensión `.js`).
  Cada módulo en `backend/src/modules/<módulo>/{domain,application,infrastructure,http}`.
- `domain/` es TypeScript puro: sin NestJS, sin base de datos, sin enums ni
  "parameter properties". El frontend compila ese mismo código (alias `@core`, con
  `erasableSyntaxOnly`) para ejecutar las reglas en el navegador.
- `application/` de `routing` y `tracking` son clases sin framework (`RoutePlanner`,
  `TrackingHub`): el backend las registra como providers con `useFactory` y el modo local
  del frontend las instancia igual. Ahí no va NestJS ni APIs exclusivas de Node.
- Regla nueva: función pura en `domain/` con su `*.spec.ts` al lado; endpoint con esquema
  Zod en `http/`; en el frontend, agregar la operación a `TorreApi` (`src/types/api.ts`) e
  implementarla en `src/lib/api.ts` (HTTP) y en `src/lib/local-api.ts` (modo local).
- Servicios de mapas externos (TomTom, Overpass): adaptadores sin framework en
  `routing/infrastructure/` con `fetch` inyectable y tests con respuestas de ejemplo. El
  frontend los llama desde el navegador con la clave guardada en el dispositivo
  (`src/lib/road-routing.ts`), no a través de `TorreApi`; sólo el resultado aplicado al plan
  pasa por la API. La única clave en el repositorio es la de TomTom de la empresa
  (`COMPANY_TOMTOM_KEY` en `routing/infrastructure/tomtom.ts`, clave de navegador incluida
  a pedido del dueño; `VITE_TOMTOM_KEY` la reemplaza al compilar y vacía la quita).
  Ningún otro secreto en el repositorio.
- Sin datos de muestra ni simulación: la app parte vacía y la empresa carga bodega,
  camiones, productos, obras y pedidos (módulo `master-data`, un documento JSON en
  PostgreSQL `app_state` vía `DATABASE_URL`, o en memoria; en modo local, localStorage).
  Los datos de prueba viven sólo en `backend/test/fixtures/` (specs y e2e los cargan por
  la API con `test/seed.ts`); nunca importarlos desde código de la app.
- Identificadores en inglés; valores de negocio (estados, clases) y textos de UI en español (es-CL).
- Base de datos: cambios como migraciones nuevas `database/migrations/00N_*.sql`.
  `default-fleet.ts` son los tipos de vehículo (no camiones de prueba).
- UI: componentes estilo shadcn/ui en `frontend/src/components/ui`; colores sólo vía los
  tokens de `src/index.css` (tema claro y oscuro); los estados good/warning/critical van
  siempre con ícono + texto.

## Comandos (desde la raíz)

- `npm run setup`: instala backend y frontend.
- `npm run check`: typecheck, lint, tests unitarios y e2e, build del frontend. Debe pasar antes de cada commit.
- `npm run dev:web` (interfaz en modo local) · `npm run dev:api` + `npm run dev:web:api` (con backend).
- `npm run build:html`: app completa en `frontend/dist/torre-control.html`.

## Publicación

- App en internet: cada push a `main` publica la interfaz en GitHub Pages (rama `gh-pages`,
  workflow `.github/workflows/ci.yml`): https://clapsdmccontacto-gif.github.io/TORRE-DE-CONTROL-/
- `Dockerfile` (API + interfaz en modo API en un servicio) y `render.yaml` para Render.
- Nube: la app (también la de GitHub Pages) busca el servidor en `CLOUD_URL`
  (`frontend/src/lib/cloud.ts`, igual al nombre del servicio en `render.yaml`) y entra con la
  clave de acceso de la empresa (`cloud/`: se crea en la app, sin mayúsculas, scrypt,
  `x-torre-key` o `?key=` en SSE; se puede volver a crear mientras la nube no tenga datos).
  Si Render da otra dirección, se pega en «Flota y bodega» y viaja en los enlaces (`nube=`).
  `CloudGate` sube los datos locales si la nube está vacía. Sin Basic Auth: una sola clave.
- Variables: `PORT`, `DATABASE_URL` (PostgreSQL de los datos de la empresa y de la clave;
  sin ella, en memoria), `CORS_ORIGINS` (por defecto GitHub Pages), `ACCESS_CONTROL`
  (`off` sólo en los e2e), `STATIC_DIR`; opcional `ACCESS_KEY` (fija la clave de la empresa:
  recuperación si se olvida con datos ya cargados).
- Mapa base: selector en la app (`frontend/src/components/map/basemaps.ts`): TomTom con
  tráfico por defecto (clave de la empresa incluida), Esri sin clave, MapTiler con clave, o
  sin mapa. Proveedor fijo al compilar con
  `VITE_MAP_TILE_URL`, `VITE_MAP_TILE_URL_DARK` y `VITE_MAP_ATTRIBUTION`. No usar
  `tile.openstreetmap.org` ni CARTO sin clave (bloquean o marcan los mosaicos).
