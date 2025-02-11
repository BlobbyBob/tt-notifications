FROM node:22 AS builder

WORKDIR /build

RUN npm install -g pnpm

RUN apt update && apt install -y git && \
    git clone https://github.com/BlobbyBob/tt-notifications.git . && \
    rm -rf .git

WORKDIR /build/frontend

RUN pnpm i && pnpm run build-only

WORKDIR /build

RUN rm -r public && cp -r frontend/dist/ public && rm -r frontend

RUN pnpm i && npx tsc -p tsconfig.json

FROM node:22

WORKDIR /app

COPY --from=builder /build /app

CMD ["node", "dist/index.js"]
