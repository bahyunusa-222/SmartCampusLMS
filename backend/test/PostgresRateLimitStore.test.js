process.env.DB_HOST = "127.0.0.1";
process.env.DB_NAME = "test";
process.env.DB_USER = "test";
process.env.DB_PASSWORD = "test";
process.env.JWT_SECRET = "test-rate-limit-secret";

const { afterEach, test } = require("node:test");
const assert = require("node:assert/strict");
const { sequelize } = require("../src/config/db");
const PostgresRateLimitStore = require("../src/utils/PostgresRateLimitStore");

const originalQuery = sequelize.query;

afterEach(() => {
    sequelize.query = originalQuery;
});

test("rate limit keys are hashed before persistence and return a reset time", async () => {
    let query;
    sequelize.query = async (sql, options) => {
        query = { sql, options };
        return [{ count: 4, resetAt: new Date("2026-11-07T23:59:00Z") }];
    };
    const store = new PostgresRateLimitStore();
    store.init({ windowMs: 60_000 });

    const result = await store.increment("192.0.2.1:student@example.edu");

    assert.equal(result.totalHits, 4);
    assert.equal(result.resetTime.toISOString(), "2026-11-07T23:59:00.000Z");
    assert.match(query.options.replacements.key, /^[a-f0-9]{64}$/);
    assert.doesNotMatch(JSON.stringify(query.options.replacements), /student@example\.edu|192\.0\.2\.1/);
    assert.match(query.sql, /ON CONFLICT/);
});
