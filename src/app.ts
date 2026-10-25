import Fastify, { type FastifyServerOptions } from "fastify";

export function buildApp(options: FastifyServerOptions = {}) {
  const app = Fastify(options);
  const release = process.env.RELEASE ?? "local";

  app.get("/api/health", { logLevel: "warn" }, async () => ({ status: "ok", release }));

  return app;
}
