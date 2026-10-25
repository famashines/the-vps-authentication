import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";
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
const app = () =>
  buildApp({ appUrl, issuer: "https://idp.test/realms/the-vps", clientId: "the-vps-bff", clientSecret: "secret", sessionKey, oidcConfig: async () => idp });

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
  assert.deepEqual(admin.json(), []);
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
