import assert from "node:assert/strict";
import { test } from "node:test";
import { buildApp } from "./app.ts";

test("GET /api/health answers ok with the release", async () => {
  process.env.RELEASE = "abc1234";
  const app = buildApp();
  const response = await app.inject({ method: "GET", url: "/api/health" });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { status: "ok", release: "abc1234" });
  await app.close();
});

test("an unknown path gives 404", async () => {
  const app = buildApp();
  const response = await app.inject({ method: "GET", url: "/api/nope" });
  assert.equal(response.statusCode, 404);
  await app.close();
});
