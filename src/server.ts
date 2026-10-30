import { trace } from "@opentelemetry/api";
import { buildApp } from "./app.ts";

const env = (name: string) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
};

const app = buildApp(
  {
    appUrl: env("APP_URL"),
    issuer: env("OIDC_ISSUER"),
    clientId: env("OIDC_CLIENT_ID"),
    clientSecret: env("OIDC_CLIENT_SECRET"),
    sessionKey: env("SESSION_KEY"),
    admissionsUrl: env("ADMISSIONS_URL"),
    feesUrl: env("FEES_URL"),
  },
  {
    logger: {
      mixin: () => {
        const span = trace.getActiveSpan()?.spanContext();
        return span ? { trace_id: span.traceId, span_id: span.spanId } : {};
      },
    },
  },
);

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, async () => {
    app.log.info({ signal }, "shutting down");
    await app.close();
    process.exit(0);
  });
}

await app.listen({ host: "0.0.0.0", port: Number(process.env.PORT ?? 8080) });
