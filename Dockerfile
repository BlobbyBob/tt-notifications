FROM node:22 AS builder

WORKDIR /build

RUN curl -fsSL https://get.pnpm.io/install.sh | sh -

RUN apt update && apt install -y git && \
    git clone https://github.com/BlobbyBob/tt-notifications.git . && \
    rm -rf .git

WORKDIR /build/frontend

RUN pnpm i && pnpm run build-only

WORKDIR /build

RUN rm -r public && cp -r frontend/dist/ public && rm -r frontend

RUN npm i

FROM node:22

WORKDIR /app

COPY --from=builder /build /app

CMD ["npm", "run", "deploy", "--trace-warnings"]
