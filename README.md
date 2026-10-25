# the-vps-gateway

The gateway of the-vps: the BFF (backend for frontend) of the dashboard. The
browser talks only to this service, at `/api` on the same host. It does the
login with Keycloak (`/api/auth/*`, a sealed session cookie), checks the role
and the schema of each request, and sends commands to the services inside the
cluster. It was named the-vps-authentication until 2026-10-25.

Fastify and TypeScript. Node 24 runs the `.ts` files directly; `tsc` only
checks the types.

## Work on it

    npm ci
    npm run check   # type check
    npm test        # node:test
    npm start       # http://localhost:8080/api/health

## Endpoints

| Method | Path                 | Who            | Answer                                                     |
| ------ | -------------------- | -------------- | ---------------------------------------------------------- |
| GET    | `/api/health`        | everyone       | `{"status":"ok","release":"<commit>"}`                      |
| GET    | `/api/auth/login`    | everyone       | Redirect to Keycloak (PKCE). `?returnTo=/path` after login |
| GET    | `/api/auth/callback` | Keycloak       | Sets the session cookie, then redirects to `returnTo`      |
| POST   | `/api/auth/logout`   | signed in      | Clears the cookie; `{"redirect": "<Keycloak logout URL>"}` |
| GET    | `/api/me`            | signed in      | `{"sub","name","roles"}`, or 401                           |
| GET    | `/api/students`      | role `admin`   | The list from the admissions service; 401 or 403 for others |
| POST   | `/api/students`      | role `admin`   | Body: `RegisterStudentCommandPayloadV1`, header `Idempotency-Key: <uuid>` (the `commandId`). 400 with `fields` when invalid, else the answer of admissions (201, or 200 for a repeated key), 502 when it does not answer |
| GET    | `/api/academic-years` | role `admin`  | Years with their sections, from admissions                 |
| POST   | `/api/academic-years` | role `admin`  | `OpenAcademicYearCommandPayloadV1`, the same rules as `POST /api/students` |
| POST   | `/api/class-sections` | role `admin`  | `CreateClassSectionCommandPayloadV1`, the same rules       |
| POST   | `/api/enrollments`    | role `admin`  | `EnrollStudentCommandPayloadV1`, the same rules            |

## Session

The session is an AES-256-GCM sealed cookie `__Host-vps_session`
(HttpOnly, Secure, SameSite=Lax, 8 hours). It holds the user id, the name,
the realm roles and the ID token for the logout. The browser never gets an
access token. A `POST` (or any request that is not `GET`, `HEAD` or `OPTIONS`)
must have `Origin` equal to `APP_URL`.

## Settings

| Variable             | Example                                     |
| -------------------- | ------------------------------------------- |
| `APP_URL`            | `https://dev.app.vision.ac.pk`              |
| `OIDC_ISSUER`        | `https://auth.vision.ac.pk/realms/the-vps`  |
| `OIDC_CLIENT_ID`     | `the-vps-bff`                               |
| `OIDC_CLIENT_SECRET` | secret                                      |
| `SESSION_KEY`        | secret, 32 bytes in base64                  |
| `ADMISSIONS_URL`     | `http://the-vps-admissions`                 |

## Release

A merge to `main` builds `ghcr.io/famashines/the-vps-gateway:sha-<commit>`
and releases it to dev through a pull request in `famashines/gitops`. Each pull
request runs the type check, the tests and an image build.
