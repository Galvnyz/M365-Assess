import { loadConfig } from "./config.js";
import { createApp } from "./app.js";
import { buildServer } from "./server.js";

export { loadConfig, type BffConfig } from "./config.js";
export { buildServer, OPENAPI_ROUTE, type BuildServerOptions, type Route, type RouteHandler } from "./server.js";
export { AppError, ErrorCodes, toErrorBody, type ErrorBody, type ErrorDetail } from "./errors.js";
export {
  DEFAULT_PAGE_LIMIT,
  MAX_PAGE_LIMIT,
  clampLimit,
  decodeCursor,
  encodeCursor,
  paginate,
  parsePagination,
  type CursorPage,
  type Pagination,
} from "./pagination.js";

export { createApp, type App } from "./app.js";

const config = loadConfig();
const app = createApp(config);
const server = buildServer({ routes: app.routes, authenticators: app.authenticators });

if (config.devIdentityRole) {
  console.warn(
    `WARNING: M365_BFF_DEV_IDENTITY is set; every request is treated as a local ${config.devIdentityRole}. ` +
      "Use for local development only.",
  );
} else if (app.authenticators.length === 0) {
  console.warn("No identity provider is configured; protected routes will answer 401.");
}

server.on("close", () => app.close());
server.listen(config.port, config.host, () => {
  console.log(`M365-Assess BFF listening on http://${config.host}:${config.port}`);
});
