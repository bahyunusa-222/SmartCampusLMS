const { sequelize } = require("../config/db");
const { DataTypes } = require("sequelize");

const migrationName = "20261107_01_centralized_file_storage";

module.exports = async () => {
    const queryInterface = sequelize.getQueryInterface();
    const tables = await queryInterface.showAllTables();
    const hasTable = tables.some((table) =>
        (typeof table === "string" ? table : table.tableName).toLowerCase() === "chatmessagemedia"
    );
    if (!hasTable) return;

    const migrationTable = tables.find((table) =>
        (typeof table === "string" ? table : table.tableName).toLowerCase() === "schemamigrations"
    );
    if (migrationTable) {
        const [rows] = await sequelize.query(
            'SELECT "name" FROM "SchemaMigrations" WHERE "name" = :migrationName',
            { replacements: { migrationName } }
        );
        if (rows.length) return;
    }

    const columns = await queryInterface.describeTable("ChatMessageMedia");
    if (columns.data && !columns.data.allowNull) {
        await queryInterface.changeColumn("ChatMessageMedia", "data", {
            type: DataTypes.BLOB,
            allowNull: true
        });
    }
    if (!columns.fileUrl) {
        await queryInterface.addColumn("ChatMessageMedia", "fileUrl", {
            type: DataTypes.STRING(2048),
            allowNull: true
        });
    }
    if (migrationTable) {
        await queryInterface.bulkInsert("SchemaMigrations", [{
            name: migrationName,
            appliedAt: new Date()
        }]);
    }
};
