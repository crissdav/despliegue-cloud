# Imagen ligera de Node.js 22 (LTS) sobre Alpine Linux
FROM node:22-alpine

WORKDIR /app

# 1) Instalar dependencias primero (se cachea si package.json no cambia)
COPY package*.json ./
RUN npm install --omit=dev && npm cache clean --force

# 2) Copiar el código
COPY src ./src
COPY views ./views
COPY public ./public

ENV NODE_ENV=production \
    PORT=3000

# Por seguridad, no correr como root
USER node

EXPOSE 3000

# Docker marca el contenedor como "unhealthy" si /health no responde
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/health > /dev/null || exit 1

CMD ["node", "src/server.js"]
