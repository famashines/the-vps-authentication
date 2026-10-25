import cookie from "@fastify/cookie";
import Fastify, { type FastifyReply, type FastifyRequest, type FastifyServerOptions } from "fastify";
import * as oidc from "openid-client";
import { randomUUID } from "node:crypto";
import { sealer } from "./seal.ts";
import * as valid from "./validate.ts";

export type Settings = {
  appUrl: string;
  issuer: string;
  clientId: string;
  clientSecret: string;
  sessionKey: string;
  admissionsUrl: string;
  oidcConfig?: () => Promise<oidc.Configuration>;
};

export type Session = { sub: string; name: string; roles: string[]; idToken: string; exp: number };
type Login = { state: string; nonce: string; verifier: string; returnTo: string; exp: number };

declare module "fastify" {
  interface FastifyRequest {
    session?: Session;
  }
}

export const SESSION_COOKIE = "__Host-vps_session";
export const LOGIN_COOKIE = "__Host-vps_login";
const SESSION_SECONDS = 8 * 60 * 60;
const LOGIN_SECONDS = 10 * 60;
const cookieOptions = { httpOnly: true, secure: true, sameSite: "lax", path: "/" } as const;

const now = () => Math.floor(Date.now() / 1000);
const safeReturnTo = (value: unknown) =>
  typeof value === "string" && value.startsWith("/") && !value.startsWith("//") && !value.startsWith("/\\") ? value : "/";

export function requireRole(role: string) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.session) return reply.code(401).send({ error: "Sign in first." });
    if (!request.session.roles.includes(role)) return reply.code(403).send({ error: "You do not have access to this." });
  };
}

export function buildApp(settings: Settings, options: FastifyServerOptions = {}) {
  const app = Fastify(options);
  const release = process.env.RELEASE ?? "local";
  const box = sealer(settings.sessionKey);
  const redirectUri = `${settings.appUrl}/api/auth/callback`;

  let discovery: Promise<oidc.Configuration> | undefined;
  const oidcConfig =
    settings.oidcConfig ??
    (() => {
      discovery ??= oidc.discovery(new URL(settings.issuer), settings.clientId, settings.clientSecret).catch((error) => {
        discovery = undefined;
        throw error;
      });
      return discovery;
    });

  app.register(cookie);

  app.addHook("onRequest", async (request, reply) => {
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method) && request.headers.origin !== settings.appUrl) {
      return reply.code(403).send({ error: "This request must come from the dashboard." });
    }
    const session = box.open<Session>(request.cookies[SESSION_COOKIE]);
    if (session && session.exp > now()) request.session = session;
  });

  app.get("/api/health", { logLevel: "warn" }, async () => ({ status: "ok", release }));

  app.get("/api/auth/login", async (request, reply) => {
    const config = await oidcConfig();
    const verifier = oidc.randomPKCECodeVerifier();
    const login: Login = {
      state: oidc.randomState(),
      nonce: oidc.randomNonce(),
      verifier,
      returnTo: safeReturnTo((request.query as Record<string, unknown>).returnTo),
      exp: now() + LOGIN_SECONDS,
    };
    reply.setCookie(LOGIN_COOKIE, box.seal(login), { ...cookieOptions, maxAge: LOGIN_SECONDS });
    const url = oidc.buildAuthorizationUrl(config, {
      redirect_uri: redirectUri,
      scope: "openid profile",
      code_challenge: await oidc.calculatePKCECodeChallenge(verifier),
      code_challenge_method: "S256",
      state: login.state,
      nonce: login.nonce,
    });
    return reply.redirect(url.href);
  });

  app.get("/api/auth/callback", async (request, reply) => {
    const login = box.open<Login>(request.cookies[LOGIN_COOKIE]);
    reply.clearCookie(LOGIN_COOKIE, cookieOptions);
    if (!login || login.exp <= now()) return reply.redirect("/?signin=failed");
    try {
      const tokens = await oidc.authorizationCodeGrant(await oidcConfig(), new URL(request.url, settings.appUrl), {
        pkceCodeVerifier: login.verifier,
        expectedState: login.state,
        expectedNonce: login.nonce,
        idTokenExpected: true,
      });
      const claims = tokens.claims()!;
      const session: Session = {
        sub: claims.sub,
        name: String(claims.name ?? claims.preferred_username ?? claims.sub),
        roles: Array.isArray(claims.roles) ? claims.roles.map(String) : [],
        idToken: tokens.id_token!,
        exp: now() + SESSION_SECONDS,
      };
      reply.setCookie(SESSION_COOKIE, box.seal(session), { ...cookieOptions, maxAge: SESSION_SECONDS });
      return reply.redirect(login.returnTo);
    } catch (error) {
      request.log.warn({ err: error }, "sign-in failed");
      return reply.redirect("/?signin=failed");
    }
  });

  app.post("/api/auth/logout", async (request, reply) => {
    const idToken = request.session?.idToken;
    reply.clearCookie(SESSION_COOKIE, cookieOptions);
    if (!idToken) return { redirect: "/" };
    const config = await oidcConfig();
    const url = oidc.buildEndSessionUrl(config, { id_token_hint: idToken, post_logout_redirect_uri: `${settings.appUrl}/` });
    return { redirect: url.href };
  });

  app.get("/api/me", async (request, reply) => {
    if (!request.session) return reply.code(401).send({ error: "Sign in first." });
    const { sub, name, roles } = request.session;
    return { sub, name, roles };
  });

  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  const admissions = async (reply: FastifyReply, path: string, init?: RequestInit) => {
    try {
      const response = await fetch(`${settings.admissionsUrl}${path}`, { ...init, signal: AbortSignal.timeout(10_000) });
      return reply.code(response.status).type("application/json").send(await response.text());
    } catch (error) {
      reply.log.error({ err: error }, "admissions service unreachable");
      return reply.code(502).send({ error: "The admissions service did not answer. Try again in a minute." });
    }
  };

  app.get("/api/students", { preHandler: requireRole("admin") }, async (_request, reply) => admissions(reply, "/students"));

  const command = (method: "POST" | "PUT", path: string, commandType: string, validPayload: typeof valid.validRegisterStudent, target: string) =>
    app.route({ method, url: path, preHandler: requireRole("admin"), handler: async (request, reply) => {
      const commandId = request.headers["idempotency-key"];
      if (typeof commandId !== "string" || !uuid.test(commandId)) {
        return reply.code(400).send({ error: "The Idempotency-Key header must be a UUID." });
      }
      const payload = { ...(request.body as object), ...(request.params as object) };
      if (!validPayload(payload)) {
        return reply.code(400).send({ error: "Check the marked fields.", fields: valid.fieldErrors(validPayload.errors) });
      }
      const envelope = {
        commandId,
        commandType,
        version: 1,
        issuedAt: new Date().toISOString(),
        issuedBy: request.session!.sub,
        correlationId: randomUUID(),
        payload,
      };
      return admissions(reply, target, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(envelope),
      });
    } });

  command("POST", "/api/students", "admissions.RegisterStudent", valid.validRegisterStudent, "/commands/register-student");
  command("POST", "/api/academic-years", "admissions.OpenAcademicYear", valid.validOpenAcademicYear, "/commands/open-academic-year");
  command("POST", "/api/class-sections", "admissions.CreateClassSection", valid.validCreateClassSection, "/commands/create-class-section");
  command("POST", "/api/enrollments", "admissions.EnrollStudent", valid.validEnrollStudent, "/commands/enroll-student");
  command("PUT", "/api/students/:studentId", "admissions.UpdateStudentDetails", valid.validUpdateStudentDetails, "/commands/update-student-details");
  command("PUT", "/api/enrollments/:enrollmentId", "admissions.ChangeStudentSection", valid.validChangeStudentSection, "/commands/change-student-section");
  command("PUT", "/api/class-sections/:classSectionId", "admissions.UpdateClassSection", valid.validUpdateClassSection, "/commands/update-class-section");
  command("PUT", "/api/academic-years/:academicYearId", "admissions.UpdateAcademicYear", valid.validUpdateAcademicYear, "/commands/update-academic-year");

  app.get("/api/academic-years", { preHandler: requireRole("admin") }, async (_request, reply) => admissions(reply, "/academic-years"));

  return app;
}
