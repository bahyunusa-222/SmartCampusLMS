process.env.DB_DIALECT = "postgres";
process.env.DB_HOST = "127.0.0.1";
process.env.DB_NAME = "test";
process.env.DB_USER = "test";
process.env.DB_PASSWORD = "test";

const { after, test } = require("node:test");
const assert = require("node:assert/strict");
const { sequelize } = require("../src/config/db");

const migrationPath = require.resolve("../src/utils/runMigrations");
const fileStorageMigrationPath = require.resolve("../src/utils/runFileStorageMigration");
const chatSecurityPath = require.resolve("../src/utils/chatSecurity");
const migrationLockPath = require.resolve("../src/utils/withDatabaseMigrationLock");
const initializerPath = require.resolve("../src/utils/initializeDatabase");
const migrations = require(migrationPath);
const fileStorageMigration = require(fileStorageMigrationPath);
const chatSecurity = require(chatSecurityPath);
const originalAuthenticate = sequelize.authenticate;
const originalSync = sequelize.sync;
const originalMigrations = migrations;
const originalChatSecurity = chatSecurity;
const originalMigrationLock = require(migrationLockPath);

const initializationCalls = [];
sequelize.authenticate = async () => initializationCalls.push("connect");
sequelize.sync = async () => initializationCalls.push("sync");
const mockedMigrations = async () => initializationCalls.push("migrations");
mockedMigrations.ensureIdentityIndexes = async () => initializationCalls.push("identity indexes");
require.cache[migrationPath].exports = mockedMigrations;
require.cache[fileStorageMigrationPath].exports = async () => initializationCalls.push("file storage migration");
require.cache[chatSecurityPath].exports = async () => initializationCalls.push("chat security");
require.cache[migrationLockPath].exports = async (operation) => {
    initializationCalls.push("migration lock");
    return operation();
};
const initializeDatabase = require(initializerPath);

after(() => {
    sequelize.authenticate = originalAuthenticate;
    sequelize.sync = originalSync;
    require.cache[migrationPath].exports = originalMigrations;
    require.cache[fileStorageMigrationPath].exports = fileStorageMigration;
    require.cache[chatSecurityPath].exports = originalChatSecurity;
    require.cache[migrationLockPath].exports = originalMigrationLock;
    delete require.cache[initializerPath];
});

test("serverless database initialization applies storage migrations after schema sync", async () => {
    await Promise.all([initializeDatabase(), initializeDatabase()]);

    assert.deepEqual(initializationCalls, [
        "connect",
        "migration lock",
        "migrations",
        "sync",
        "file storage migration",
        "identity indexes",
        "chat security"
    ]);
});
