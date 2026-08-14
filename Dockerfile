# Portable production image — works on Render, Railway, Fly, or any container host.
FROM node:22-slim

# Prisma needs openssl.
RUN apt-get update && apt-get install -y openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install root deps (incl dev, needed to build + run migrations).
# --workspaces=false keeps the landing/chain workspaces out of the server image.
COPY package*.json ./
RUN npm install --include=dev --workspaces=false

# Dashboard deps (separate workspace).
COPY dashboard/package*.json ./dashboard/
RUN npm --prefix dashboard install

# App source + build (prisma client, dashboard SPA, server).
COPY . .
RUN npm run prisma:generate \
    && npm --prefix dashboard run build \
    && npm run build:prod

ENV NODE_ENV=production
EXPOSE 3000

# Apply migrations, then start the server.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/http/server.js"]
