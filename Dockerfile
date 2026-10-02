# Imagen única: API NestJS + interfaz (modo API) en el mismo servicio y la misma URL.
# Variables: PORT, DATABASE_URL (PostgreSQL donde se guardan los datos de la empresa; sin
# ella quedan en memoria), BASIC_AUTH_USER / BASIC_AUTH_PASSWORD (clave de acceso a toda la app).
FROM node:22-slim AS build
WORKDIR /app
COPY backend/package.json backend/package-lock.json backend/
COPY frontend/package.json frontend/package-lock.json frontend/
RUN npm ci --prefix backend && npm ci --prefix frontend
COPY backend backend
COPY frontend frontend
RUN npm run build --prefix backend \
  && npm run build --prefix frontend -- --mode api \
  && npm prune --omit=dev --prefix backend

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production PORT=3000 STATIC_DIR=/app/public
COPY --from=build /app/backend/package.json ./
COPY --from=build /app/backend/node_modules ./node_modules
COPY --from=build /app/backend/dist ./dist
COPY --from=build /app/frontend/dist ./public
EXPOSE 3000
USER node
CMD ["node", "dist/main.js"]
