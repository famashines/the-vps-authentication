import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { after, before, test } from "node:test";
import Fastify from "fastify";
import * as oidc from "openid-client";
import { buildApp, LOGIN_COOKIE, SESSION_COOKIE, type Session } from "./app.ts";
import { sealer } from "./seal.ts";

const sessionKey = randomBytes(32).toString("base64");
const appUrl = "https://dev.app.test";
const idp = new oidc.Configuration(
  {
    issuer: "https://idp.test/realms/the-vps",
    authorization_endpoint: "https://idp.test/realms/the-vps/auth",
    token_endpoint: "https://idp.test/realms/the-vps/token",
    end_session_endpoint: "https://idp.test/realms/the-vps/logout",
  },
  "the-vps-bff",
  "secret",
);
const received: Array<Record<string, any>> = [];
const fakeAdmissions = Fastify();
fakeAdmissions.get("/students", async () => [{ studentId: "s1" }]);
fakeAdmissions.get("/academic-years", async () => [{ academicYearId: "y1", name: "2026-27", sections: [] }]);
for (const path of ["open-academic-year", "create-class-section", "enroll-student"]) {
  fakeAdmissions.post(`/commands/${path}`, async (request, reply) => {
    received.push({ path, ...(request.body as Record<string, any>) });
    return reply.code(201).send({ ok: path });
  });
}
fakeAdmissions.post("/commands/register-student", async (request, reply) => {
  received.push(request.body as Record<string, any>);
  return reply.code(201).send({ studentId: "s2", admissionNumber: "2026-0001" });
});
let admissionsUrl = "";
before(async () => {
  admissionsUrl = await fakeAdmissions.listen({ host: "127.0.0.1", port: 0 });
});
after(() => fakeAdmissions.close());

const app = (overrides: { admissionsUrl?: string } = {}) =>
  buildApp({
    appUrl,
    issuer: "https://idp.test/realms/the-vps",
    clientId: "the-vps-bff",
    clientSecret: "secret",
    sessionKey,
    admissionsUrl: overrides.admissionsUrl ?? admissionsUrl,
    oidcConfig: async () => idp,
  });

const sessionCookie = (roles: string[], exp = Math.floor(Date.now() / 1000) + 600) => {
  const session: Session = { sub: "u1", name: "Ayesha Khan", roles, idToken: "id.token.value", exp };
  return { [SESSION_COOKIE]: sealer(sessionKey).seal(session) };
};

test("health is public and shows the release", async () => {
  process.env.RELEASE = "abc1234";
  const response = await app().inject({ url: "/api/health" });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { status: "ok", release: "abc1234" });
});

test("me without a session gives 401", async () => {
  const response = await app().inject({ url: "/api/me" });
  assert.equal(response.statusCode, 401);
});

test("me with a session gives the name and roles, not the token", async () => {
  const response = await app().inject({ url: "/api/me", cookies: sessionCookie(["admin"]) });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { sub: "u1", name: "Ayesha Khan", roles: ["admin"] });
});

test("an expired or changed session is no session", async () => {
  const expired = await app().inject({ url: "/api/me", cookies: sessionCookie(["admin"], 1) });
  assert.equal(expired.statusCode, 401);
  const valid = sessionCookie(["admin"])[SESSION_COOKIE];
  const changed = valid.slice(0, -2) + (valid.endsWith("A") ? "B" : "A") + valid.slice(-1);
  const tampered = await app().inject({ url: "/api/me", cookies: { [SESSION_COOKIE]: changed } });
  assert.equal(tampered.statusCode, 401);
});

test("the admin API: 401 without a session, 403 for a student, 200 for an admin", async () => {
  assert.equal((await app().inject({ url: "/api/students" })).statusCode, 401);
  assert.equal((await app().inject({ url: "/api/students", cookies: sessionCookie(["student"]) })).statusCode, 403);
  const admin = await app().inject({ url: "/api/students", cookies: sessionCookie(["admin"]) });
  assert.equal(admin.statusCode, 200);
  assert.deepEqual(admin.json(), [{ studentId: "s1" }]);
});

test("login redirects to Keycloak with PKCE and sets a short login cookie", async () => {
  const response = await app().inject({ url: "/api/auth/login?returnTo=/students" });
  assert.equal(response.statusCode, 302);
  const location = new URL(response.headers.location as string);
  assert.equal(location.origin + location.pathname, "https://idp.test/realms/the-vps/auth");
  assert.equal(location.searchParams.get("redirect_uri"), `${appUrl}/api/auth/callback`);
  assert.equal(location.searchParams.get("code_challenge_method"), "S256");
  assert.ok(location.searchParams.get("state") && location.searchParams.get("nonce"));
  const login = response.cookies.find((c) => c.name === LOGIN_COOKIE)!;
  assert.equal(login.httpOnly, true);
  assert.equal(login.secure, true);
  assert.equal(login.sameSite, "Lax");
  assert.equal(login.maxAge, 600);
});

test("login keeps only a local returnTo", async () => {
  for (const returnTo of ["https://evil.test/", "//evil.test", "/\\evil.test"]) {
    const response = await app().inject({ url: `/api/auth/login?returnTo=${encodeURIComponent(returnTo)}` });
    const login = sealer(sessionKey).open<{ returnTo: string }>(response.cookies.find((c) => c.name === LOGIN_COOKIE)!.value);
    assert.equal(login?.returnTo, "/");
  }
});

test("a callback without a login cookie fails safely", async () => {
  const response = await app().inject({ url: "/api/auth/callback?code=x&state=y" });
  assert.equal(response.statusCode, 302);
  assert.equal(response.headers.location, "/?signin=failed");
});

test("logout: other origins are refused; our origin clears the session and ends the Keycloak session", async () => {
  const foreign = await app().inject({ method: "POST", url: "/api/auth/logout", headers: { origin: "https://evil.test" }, cookies: sessionCookie(["admin"]) });
  assert.equal(foreign.statusCode, 403);
  const response = await app().inject({ method: "POST", url: "/api/auth/logout", headers: { origin: appUrl }, cookies: sessionCookie(["admin"]) });
  assert.equal(response.statusCode, 200);
  const redirect = new URL(response.json().redirect);
  assert.equal(redirect.origin + redirect.pathname, "https://idp.test/realms/the-vps/logout");
  assert.equal(redirect.searchParams.get("id_token_hint"), "id.token.value");
  assert.equal(redirect.searchParams.get("post_logout_redirect_uri"), `${appUrl}/`);
  const cleared = response.cookies.find((c) => c.name === SESSION_COOKIE)!;
  assert.equal(cleared.value, "");
});

const student = {
  firstName: "Ayesha",
  lastName: "Khan",
  fatherName: "Imran Khan",
  dateOfBirth: "2016-03-14",
  gender: "female",
  guardian: { name: "Imran Khan", relation: "father", phone: "+923001234567" },
};
const key = "6f1c2d3e-4b5a-4c6d-8e7f-9a0b1c2d3e4f";
const register = (body: unknown, headers: Record<string, string> = { "idempotency-key": key }, roles = ["admin"], instance = app()) =>
  instance.inject({ method: "POST", url: "/api/students", headers: { origin: appUrl, ...headers }, cookies: sessionCookie(roles), payload: body as object });

test("register: an admin's valid student goes to admissions as a command envelope", async () => {
  received.length = 0;
  const response = await register(student);
  assert.equal(response.statusCode, 201);
  assert.deepEqual(response.json(), { studentId: "s2", admissionNumber: "2026-0001" });
  const command = received[0];
  assert.equal(command.commandId, key);
  assert.equal(command.commandType, "admissions.RegisterStudent");
  assert.equal(command.version, 1);
  assert.equal(command.issuedBy, "u1");
  assert.deepEqual(command.payload, student);
});

test("register: a student user gets 403 and nothing reaches admissions", async () => {
  received.length = 0;
  assert.equal((await register(student, undefined, ["student"])).statusCode, 403);
  assert.equal(received.length, 0);
});

test("register: wrong fields come back by name, and nothing reaches admissions", async () => {
  received.length = 0;
  const response = await register({ ...student, dateOfBirth: "2016-02-30", guardian: { name: "Imran Khan", relation: "father" }, grade: "3" });
  assert.equal(response.statusCode, 400);
  const fields = response.json().fields.map((f: { field: string }) => f.field).sort();
  assert.deepEqual(fields, ["dateOfBirth", "grade", "guardian.phone"]);
  assert.equal(received.length, 0);
});

test("register: the Idempotency-Key must be a UUID", async () => {
  assert.equal((await register(student, {})).statusCode, 400);
  assert.equal((await register(student, { "idempotency-key": "1" })).statusCode, 400);
});

test("register: a foreign origin is refused", async () => {
  assert.equal((await register(student, { "idempotency-key": key, origin: "https://evil.test" })).statusCode, 403);
});

test("register: admissions down gives 502 with a clear message", async () => {
  const response = await register(student, undefined, ["admin"], app({ admissionsUrl: "http://127.0.0.1:9" }));
  assert.equal(response.statusCode, 502);
  assert.match(response.json().error, /did not answer/);
});

const post = (url: string, body: object, roles = ["admin"]) =>
  app().inject({ method: "POST", url, headers: { origin: appUrl, "idempotency-key": key }, cookies: sessionCookie(roles), payload: body });

test("enrollment routes: each command goes to its admissions path with its type", async () => {
  received.length = 0;
  const year = { name: "2026-27", startsOn: "2026-04-01", endsOn: "2027-03-31" };
  const section = { academicYearId: "5b1f0e2a-3c4d-4e5f-8a6b-7c8d9e0f1a2b", grade: "class-3", section: "A" };
  const enroll = { studentId: "0b8e6f3a-6a2e-4f7e-9a51-2f1d3c4b5a69", classSectionId: "9c8b7a6d-5e4f-4a3b-9c2d-1e0f2a3b4c5d" };
  assert.equal((await post("/api/academic-years", year)).statusCode, 201);
  assert.equal((await post("/api/class-sections", section)).statusCode, 201);
  assert.equal((await post("/api/enrollments", enroll)).statusCode, 201);
  assert.deepEqual(
    received.map((r) => `${r.path} ${r.commandType} ${r.issuedBy}`),
    ["open-academic-year admissions.OpenAcademicYear u1", "create-class-section admissions.CreateClassSection u1", "enroll-student admissions.EnrollStudent u1"],
  );
  assert.deepEqual(received[2].payload, enroll);
});

test("enrollment routes: wrong payloads come back by field, students get 403, the list is proxied", async () => {
  received.length = 0;
  const bad = await post("/api/class-sections", { academicYearId: "x", grade: "class-11", section: "" });
  assert.equal(bad.statusCode, 400);
  assert.deepEqual(bad.json().fields.map((f: { field: string }) => f.field).sort(), ["academicYearId", "grade", "section"]);
  assert.equal((await post("/api/enrollments", { studentId: key, classSectionId: key }, ["student"])).statusCode, 403);
  assert.equal(received.length, 0);
  const years = await app().inject({ url: "/api/academic-years", cookies: sessionCookie(["admin"]) });
  assert.equal(years.statusCode, 200);
  assert.equal(years.json()[0].name, "2026-27");
  assert.equal((await app().inject({ url: "/api/academic-years", cookies: sessionCookie(["teacher"]) })).statusCode, 403);
});
