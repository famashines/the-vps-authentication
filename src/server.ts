import { buildApp } from "./app.ts";

const app = buildApp({ logger: true });

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, async () => {
    app.log.info({ signal }, "shutting down");
    await app.close();
    process.exit(0);
  });
}

await app.listen({ host: "0.0.0.0", port: Number(process.env.PORT ?? 8080) });
