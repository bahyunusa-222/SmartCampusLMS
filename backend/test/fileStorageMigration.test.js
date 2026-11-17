process.env.DB_HOST = "127.0.0.1";
process.env.DB_NAME = "test";
process.env.DB_USER = "test";
process.env.DB_PASSWORD = "test";

const { afterEach, test } = require("node:test");
const assert = require("node:assert/strict");
const { sequelize } = require("../src/config/db");
const runFileStorageMigration = require("../src/utils/runFileStorageMigration");

const queryInterface = sequelize.getQueryInterface();
const originalShowAllTables = queryInterface.showAllTables;
const originalDescribeTable = queryInterface.describeTable;
const originalChangeColumn = queryInterface.changeColumn;
const originalAddColumn = queryInterface.addColumn;
const originalBulkInsert = queryInterface.bulkInsert;
const originalQuery = sequelize.query;

afterEach(() => {
    queryInterface.showAllTables = originalShowAllTables;
    queryInterface.describeTable = originalDescribeTable;
    queryInterface.changeColumn = originalChangeColumn;
    queryInterface.addColumn = originalAddColumn;
    queryInterface.bulkInsert = originalBulkInsert;
    sequelize.query = originalQuery;
});

test("file storage migration uses the existing SchemaMigrations table shape", async () => {
    let migrationRecord;
    queryInterface.showAllTables = async () => ["ChatMessageMedia", "SchemaMigrations"];
    queryInterface.describeTable = async () => ({ data: { allowNull: false } });
    queryInterface.changeColumn = async () => {};
    queryInterface.addColumn = async () => {};
    queryInterface.bulkInsert = async (_table, rows) => {
        migrationRecord = rows[0];
    };
    sequelize.query = async () => [[], {}];

    await runFileStorageMigration();

    assert.equal(migrationRecord.name, "20261107_01_centralized_file_storage");
    assert.ok(migrationRecord.appliedAt instanceof Date);
    assert.equal("createdAt" in migrationRecord, false);
    assert.equal("updatedAt" in migrationRecord, false);
});

test("file storage migration leaves already-applied schemas unchanged", async () => {
    let schemaChanged = false;
    queryInterface.showAllTables = async () => ["ChatMessageMedia", "SchemaMigrations"];
    sequelize.query = async () => [[{ name: "20261107_01_centralized_file_storage" }], {}];
    queryInterface.describeTable = async () => {
        schemaChanged = true;
        return {};
    };

    await runFileStorageMigration();

    assert.equal(schemaChanged, false);
});
