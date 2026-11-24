# Frontend del diario. Build en dos etapas (multi-stage):
#   1) "build": Node compila React con Vite -> carpeta dist/ (HTML, JS y CSS estáticos)
#   2) "final": solo Nginx + dist/. La imagen final no lleva Node ni node_modules (~50 MB).

# ---------- Etapa 1: compilar ----------
FROM node:22-alpine AS build
WORKDIR /web
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# ---------- Etapa 2: servir ----------
FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /web/dist /usr/share/nginx/html

EXPOSE 80

# "unhealthy" si Nginx deja de servir la página principal
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1/ > /dev/null || exit 1
