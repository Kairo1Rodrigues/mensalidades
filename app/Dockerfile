# Node.js oficial + Ubuntu 24.04 (Tesseract 5.3.4 com português)
FROM node:24-bookworm-slim AS node

FROM ubuntu:24.04
RUN apt-get update \
 && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends tesseract-ocr tesseract-ocr-por poppler-utils ca-certificates \
 && rm -rf /var/lib/apt/lists/*
COPY --from=node /usr/local/bin/node /usr/local/bin/node
WORKDIR /app
COPY package.json ./
COPY src ./src
COPY public ./public
COPY exemplos ./exemplos
RUN mkdir -p /dados && chown ubuntu:ubuntu /dados
ENV NODE_ENV=production DATA_DIR=/dados TZ=America/Sao_Paulo PORT=3000 NODE_NO_WARNINGS=1
USER ubuntu
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD node -e "fetch('http://127.0.0.1:3000/saude').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "src/server.js"]
