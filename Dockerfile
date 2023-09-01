FROM node:18 AS builder

WORKDIR /build

RUN apt update && apt install -y git && \
    git clone https://github.com/BlobbyBob/tt-notifications.git . && \
    rm -rf .git

WORKDIR /build/frontend

RUN npm i && npm run build

WORKDIR /build

RUN rm -r public && cp -r frontend/dist/ public && rm -r frontend

RUN npm i

FROM node:18

WORKDIR /app

COPY --from=builder /build /app

CMD ["npm", "run", "deploy", "--trace-warnings"]
