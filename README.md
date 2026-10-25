# the-vps-authentication

The BFF (backend for frontend) of the-vps. The browser talks only to this
service, at `/api` on the same host as the dashboard. Later it does the login
with Keycloak (T7) and sends commands to the other services (T9).

Fastify and TypeScript. Node 24 runs the `.ts` files directly; `tsc` only
checks the types.

## Work on it

    npm ci
    npm run check   # type check
    npm test        # node:test
    npm start       # http://localhost:8080/api/health

## Endpoints

| Method | Path          | Answer                                |
| ------ | ------------- | ------------------------------------- |
| GET    | `/api/health` | `{"status":"ok","release":"<commit>"}` |

## Release

A merge to `main` builds `ghcr.io/famashines/the-vps-authentication:sha-<commit>`
and releases it to dev through a pull request in `famashines/gitops`. Each pull
request runs the type check, the tests and an image build.
