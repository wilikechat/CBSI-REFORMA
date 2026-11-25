const REGIME_URL = stripSlash(
  process.env.REGIME_URL || "http://regime-regular:8080/api"
);
const SIMPLES_URL = stripSlash(
  process.env.SIMPLES_URL || "http://simples-nacional:8082/api"
);
const DANFSE_URL = stripSlash(
  process.env.DANFSE_URL || "http://danfse:8080/api"
);

const UPSTREAMS = {
  regime: REGIME_URL,
  simples: SIMPLES_URL,
  danfse: DANFSE_URL,
};

function stripSlash(value) {
  return value.replace(/\/+$/, "");
}

export default {
  port: Number(process.env.PORT ?? 3000),
  host: process.env.HOST ?? "0.0.0.0",
  webDist:
    process.env.WEB_DIST ??
    new URL("../../web/public", import.meta.url).pathname,
  requestTimeoutMs: Number(process.env.REQUEST_TIMEOUT_MS ?? 120000),
  bodyLimitBytes: Number(process.env.BODY_LIMIT_BYTES ?? 10485760),
  corsOrigin: process.env.CORS_ORIGIN ?? "*",
  upstreams: UPSTREAMS,
  regimeBase: `${REGIME_URL}/calculadora`,
  simplesBase: `${SIMPLES_URL}/calculadora`,
  danfseBase: DANFSE_URL,
};
