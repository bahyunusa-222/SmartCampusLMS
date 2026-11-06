FROM node:26-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src
COPY scripts ./scripts
COPY certs/prod-ca-2021.crt /etc/ssl/certs/prod-ca-2021.crt

ENV NODE_ENV=production
ENV PORT=80
ENV DB_SSL_CA_FILE=/etc/ssl/certs/prod-ca-2021.crt
EXPOSE 80

CMD ["node", "src/server.js"]
