const { sequelize } = require("../config/db");

const migrationLockId = 731_904_113;
const lockHeartbeatInterval = 15_000;

const withDatabaseMigrationLock = async (operation) => {
    if (typeof operation !== "function") {
        throw new TypeError("A database migration operation is required.");
    }

    if (sequelize.options.pool.max < 2) {
        throw new Error("DB_POOL_MAX must be at least 2 to serialize startup migrations safely.");
    }

    const connection = await sequelize.connectionManager.getConnection({
        type: "WRITE",
        useMaster: true
    });
    let lockAcquired = false;
    let heartbeatTimer;
    let heartbeatInProgress;
    let heartbeatError;
    const heartbeat = () => {
        if (heartbeatInProgress) return heartbeatInProgress;
        if (heartbeatError) return Promise.resolve();
        heartbeatInProgress = connection.query("SELECT 1")
            .catch((error) => {
                heartbeatError = error;
            })
            .finally(() => {
                heartbeatInProgress = null;
            });
        return heartbeatInProgress;
    };
    const stopHeartbeat = async () => {
        if (heartbeatTimer) {
            clearInterval(heartbeatTimer);
            heartbeatTimer = undefined;
        }
        if (heartbeatInProgress) await heartbeatInProgress;
    };
    try {
        await connection.query("SELECT pg_advisory_lock($1)", [migrationLockId]);
        lockAcquired = true;
        heartbeatTimer = setInterval(heartbeat, lockHeartbeatInterval);
        heartbeatTimer.unref?.();
        const result = await operation();
        await stopHeartbeat();
        if (heartbeatError) {
            throw new Error(`Lost the PostgreSQL migration lock connection: ${heartbeatError.message}`, {
                cause: heartbeatError
            });
        }
        return result;
    } finally {
        await stopHeartbeat();
        try {
            if (lockAcquired) {
                await connection.query("SELECT pg_advisory_unlock($1)", [migrationLockId]);
            }
        } finally {
            await sequelize.connectionManager.releaseConnection(connection);
        }
    }
};

module.exports = withDatabaseMigrationLock;
