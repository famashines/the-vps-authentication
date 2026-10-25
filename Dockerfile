FROM node:24.22.1-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY src ./src
ARG RELEASE=local
ENV RELEASE=$RELEASE
USER node
EXPOSE 8080
CMD ["node", "src/server.ts"]
