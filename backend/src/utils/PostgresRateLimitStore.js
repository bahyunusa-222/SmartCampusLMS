const { QueryTypes } = require("sequelize");
const crypto = require("node:crypto");
const { sequelize } = require("../config/db");
require("../models/RateLimitBucket");

class PostgresRateLimitStore {
    constructor() {
        this.windowMs = 15 * 60 * 1000;
        this.operationsSinceCleanup = 0;
    }

    init(options) {
        this.windowMs = options.windowMs;
    }

    async increment(key) {
        const storageKey = crypto.createHmac(
            "sha256",
            process.env.JWT_SECRET || "smartcampus-development-rate-limit-key"
        ).update(key).digest("hex");
        const [bucket] = await sequelize.query(`
            INSERT INTO "RateLimitBuckets" ("key", "count", "resetAt", "createdAt", "updatedAt")
            VALUES (:key, 1, NOW() + (:windowMs * INTERVAL '1 millisecond'), NOW(), NOW())
            ON CONFLICT ("key") DO UPDATE SET
                "count" = CASE
                    WHEN "RateLimitBuckets"."resetAt" <= NOW() THEN 1
                    ELSE "RateLimitBuckets"."count" + 1
                END,
                "resetAt" = CASE
                    WHEN "RateLimitBuckets"."resetAt" <= NOW()
                        THEN NOW() + (:windowMs * INTERVAL '1 millisecond')
                    ELSE "RateLimitBuckets"."resetAt"
                END,
                "updatedAt" = NOW()
            RETURNING "count", "resetAt"
        `, {
            replacements: { key: storageKey, windowMs: this.windowMs },
            type: QueryTypes.SELECT
        });

        this.operationsSinceCleanup += 1;
        if (this.operationsSinceCleanup >= 1000) {
            this.operationsSinceCleanup = 0;
            void sequelize.query(`
                DELETE FROM "RateLimitBuckets"
                WHERE "key" IN (
                    SELECT "key" FROM "RateLimitBuckets"
                    WHERE "resetAt" < NOW() - INTERVAL '1 day'
                    LIMIT 500
                )
            `).catch((error) => {
                console.error("Rate-limit bucket cleanup failed:", error.message);
            });
        }

        return {
            totalHits: Number(bucket.count),
            resetTime: new Date(bucket.resetAt)
        };
    }

    async decrement(key) {
        const storageKey = crypto.createHmac(
            "sha256",
            process.env.JWT_SECRET || "smartcampus-development-rate-limit-key"
        ).update(key).digest("hex");
        await sequelize.query(
            'UPDATE "RateLimitBuckets" SET "count" = GREATEST("count" - 1, 0), "updatedAt" = NOW() WHERE "key" = :key',
            { replacements: { key: storageKey } }
        );
    }

    async resetKey(key) {
        const storageKey = crypto.createHmac(
            "sha256",
            process.env.JWT_SECRET || "smartcampus-development-rate-limit-key"
        ).update(key).digest("hex");
        await sequelize.query(
            'DELETE FROM "RateLimitBuckets" WHERE "key" = :key',
            { replacements: { key: storageKey } }
        );
    }

    async shutdown() {}
}

module.exports = PostgresRateLimitStore;
