const { DataTypes } = require("sequelize");
const { sequelize } = require("../config/db");

const migrationName = "20261107_02_notification_delivery_outbox";

module.exports = async () => {
    const queryInterface = sequelize.getQueryInterface();
    const columns = await queryInterface.describeTable("Notifications");
    if (!columns.dedupeKey) {
        await queryInterface.addColumn("Notifications", "dedupeKey", {
            type: DataTypes.STRING(255),
            allowNull: true
        });
    }

    const indexes = await queryInterface.showIndex("Notifications");
    if (!indexes.some((index) => index.name === "notifications_dedupe_key_unique")) {
        await queryInterface.addIndex("Notifications", ["dedupeKey"], {
            unique: true,
            name: "notifications_dedupe_key_unique"
        });
    }

    const tables = await queryInterface.showAllTables();
    const migrationTable = tables.some((table) =>
        (typeof table === "string" ? table : table.tableName).toLowerCase() === "schemamigrations"
    );
    if (!migrationTable) return;

    const [rows] = await sequelize.query(
        'SELECT "name" FROM "SchemaMigrations" WHERE "name" = :migrationName',
        { replacements: { migrationName } }
    );
    if (!rows.length) {
        await queryInterface.bulkInsert("SchemaMigrations", [{
            name: migrationName,
            appliedAt: new Date()
        }]);
    }
};
