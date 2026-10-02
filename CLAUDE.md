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
  a pedido del dueño; la reemplazan `VITE_TOMTOM_KEY` al compilar la interfaz y
  `TOMTOM_API_KEY` en el servidor, vacías la quitan). Ningún otro secreto en el repositorio.
- Demostración: el plan de ejemplo se publica por calles (`optimizeWithStreets`) y los
  camiones simulados siguen el trazado por tramos (`tripLegs`); los e2e corren con
  `TOMTOM_API_KEY=''` para no llamar a TomTom.
- Identificadores en inglés; valores de negocio (estados, clases) y textos de UI en español (es-CL).
- Base de datos: cambios como migraciones nuevas `database/migrations/00N_*.sql`. Mantener
  `demo-products.ts`, `default-fleet.ts` y `demo-network.ts` sincronizados con
  `database/seeds/001_demo_data.sql`.
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
- Variables: `PORT`, `TRACKING_DEMO` (`false` = sin camiones simulados), `TOMTOM_API_KEY`
  (opcional: otra clave para el plan de demostración del servidor),
  `BASIC_AUTH_USER` / `BASIC_AUTH_PASSWORD` (clave de acceso a toda la app), `STATIC_DIR`.
- Mapa base: selector en la app (`frontend/src/components/map/basemaps.ts`): TomTom con
  tráfico por defecto (clave de la empresa incluida), Esri sin clave, MapTiler con clave, o
  sin mapa. Proveedor fijo al compilar con
  `VITE_MAP_TILE_URL`, `VITE_MAP_TILE_URL_DARK` y `VITE_MAP_ATTRIBUTION`. No usar
  `tile.openstreetmap.org` ni CARTO sin clave (bloquean o marcan los mosaicos).
