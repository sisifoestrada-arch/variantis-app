FROM node:20-bookworm-slim
RUN apt-get update && apt-get install -y openssl ca-certificates && rm -rf /var/lib/apt/lists/*

EXPOSE 3000

WORKDIR /app

ENV NODE_ENV=production

COPY package.json package-lock.json* ./

RUN npm ci --omit=dev && npm cache clean --force
# Remove CLI packages since we don't need them in production by default.
RUN npm remove @shopify/cli

# Ensure no stale prisma migrations are present in the image
RUN rm -rf prisma/migrations

COPY . .

# Defensive: re-remove migrations folder if it sneaks in from COPY
RUN rm -rf prisma/migrations

RUN npx prisma generate
RUN npm run build

CMD ["npm", "run", "docker-start"]
