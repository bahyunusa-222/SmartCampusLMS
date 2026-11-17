const { randomUUID } = require("node:crypto");
const logger = require("../utils/logger");

module.exports = (req, res, next) => {
    const requestId = randomUUID();
    const startedAt = process.hrtime.bigint();
    req.requestId = requestId;
    res.setHeader("X-Request-Id", requestId);
    res.once("finish", () => {
        const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
        logger.info("http_request", {
            requestId,
            method: req.method,
            path: req.path,
            statusCode: res.statusCode,
            durationMs: Math.round(durationMs * 100) / 100
        });
    });
    next();
};
