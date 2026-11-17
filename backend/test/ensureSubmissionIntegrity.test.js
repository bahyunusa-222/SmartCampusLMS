process.env.DB_HOST = "127.0.0.1";
process.env.DB_NAME = "test";
process.env.DB_USER = "test";
process.env.DB_PASSWORD = "test";

const { afterEach, test } = require("node:test");
const assert = require("node:assert/strict");
const { sequelize } = require("../src/config/db");
const ensureSubmissionIntegrity = require("../src/utils/ensureSubmissionIntegrity");

const originalQuery = sequelize.query;

afterEach(() => {
    sequelize.query = originalQuery;
});

test("submission integrity adds a unique index when no duplicate records exist", async () => {
    const queries = [];
    sequelize.query = async (sql, options = {}) => {
        queries.push(sql);
        if (options.type) {
            if (sql.includes("to_regclass")) return [{ table_name: "Submissions" }];
            return [];
        }
        return [];
    };

    await ensureSubmissionIntegrity();

    assert.match(queries.at(-1), /CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS/);
    assert.match(queries.at(-1), /"studentId", "assignmentId"/);
});

test("submission integrity stops without deleting data when legacy duplicates exist", async () => {
    let createIndexCalled = false;
    sequelize.query = async (sql, options = {}) => {
        if (options.type) {
            if (sql.includes("to_regclass")) return [{ table_name: "Submissions" }];
            return [{ studentId: 7, assignmentId: 12, count: 2 }];
        }
        createIndexCalled = true;
        return [];
    };

    await assert.rejects(ensureSubmissionIntegrity(), /Resolve duplicate submissions/);
    assert.equal(createIndexCalled, false);
});
