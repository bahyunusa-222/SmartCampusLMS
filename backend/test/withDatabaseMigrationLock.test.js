process.env.DB_HOST = "127.0.0.1";
process.env.DB_NAME = "test";
process.env.DB_USER = "test";
process.env.DB_PASSWORD = "test";

const { afterEach, test } = require("node:test");
const assert = require("node:assert/strict");
const { sequelize } = require("../src/config/db");
const withDatabaseMigrationLock = require("../src/utils/withDatabaseMigrationLock");

const originalGetConnection = sequelize.connectionManager.getConnection;
const originalReleaseConnection = sequelize.connectionManager.releaseConnection;
const originalPool = sequelize.options.pool;
const originalSetInterval = global.setInterval;
const originalClearInterval = global.clearInterval;

afterEach(() => {
    sequelize.connectionManager.getConnection = originalGetConnection;
    sequelize.connectionManager.releaseConnection = originalReleaseConnection;
    sequelize.options.pool = originalPool;
    global.setInterval = originalSetInterval;
    global.clearInterval = originalClearInterval;
});

test("migration lock holds one connection until the guarded migrations finish", async () => {
    const calls = [];
    const connection = {
        async query(sql) {
            calls.push(sql.trim());
        }
    };
    sequelize.connectionManager.getConnection = async () => connection;
    sequelize.connectionManager.releaseConnection = async (released) => {
        assert.equal(released, connection);
        calls.push("released");
    };

    const result = await withDatabaseMigrationLock(async () => {
        calls.push("operation");
        return "done";
    });

    assert.equal(result, "done");
    assert.match(calls[0], /pg_advisory_lock/);
    assert.equal(calls[1], "operation");
    assert.match(calls[2], /pg_advisory_unlock/);
    assert.equal(calls[3], "released");
});

test("migration lock keeps its connection active and reports heartbeat failures", async () => {
    const calls = [];
    let heartbeat;
    const connection = {
        async query(sql) {
            calls.push(sql.trim());
            if (sql === "SELECT 1") throw new Error("read ECONNRESET");
        }
    };
    sequelize.connectionManager.getConnection = async () => connection;
    sequelize.connectionManager.releaseConnection = async () => calls.push("released");
    global.setInterval = (callback) => {
        heartbeat = callback;
        return { unref() {} };
    };
    global.clearInterval = () => {};

    await assert.rejects(
        withDatabaseMigrationLock(async () => heartbeat()),
        /Lost the PostgreSQL migration lock connection: read ECONNRESET/
    );
    assert.match(calls[0], /pg_advisory_lock/);
    assert.equal(calls[1], "SELECT 1");
    assert.match(calls[2], /pg_advisory_unlock/);
    assert.equal(calls[3], "released");
});

test("migration lock releases the PostgreSQL advisory lock after an operation fails", async () => {
    const calls = [];
    const connection = { async query(sql) { calls.push(sql.trim()); } };
    sequelize.connectionManager.getConnection = async () => connection;
    sequelize.connectionManager.releaseConnection = async () => calls.push("released");

    await assert.rejects(
        withDatabaseMigrationLock(async () => { throw new Error("migration failed"); }),
        /migration failed/
    );
    assert.match(calls[1], /pg_advisory_unlock/);
    assert.equal(calls[2], "released");
});

test("migration lock fails clearly when the pool cannot leave a connection for migrations", async () => {
    sequelize.options.pool = { max: 1 };
    sequelize.connectionManager.getConnection = async () => assert.fail("Must fail before acquiring a connection");

    await assert.rejects(withDatabaseMigrationLock(async () => {}), /DB_POOL_MAX must be at least 2/);
});
