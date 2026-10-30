FROM node:24.22.1-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY src ./src
ARG RELEASE=local
ENV RELEASE=$RELEASE
USER 1000:1000
EXPOSE 8080
CMD ["node", "--import", "./src/telemetry.ts", "src/server.ts"]
