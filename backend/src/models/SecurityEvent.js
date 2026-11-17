const { DataTypes } = require("sequelize");
const { sequelize } = require("../config/db");

module.exports = sequelize.define("SecurityEvent", {
    id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true },
    userId: { type: DataTypes.INTEGER, allowNull: true },
    eventType: { type: DataTypes.STRING(64), allowNull: false },
    requestId: { type: DataTypes.STRING(64), allowNull: true },
    metadata: { type: DataTypes.JSON, allowNull: true }
}, {
    updatedAt: false,
    indexes: [
        { fields: ["userId", "createdAt"] },
        { fields: ["eventType", "createdAt"] }
    ],
    hooks: {
        beforeUpdate: () => { throw new Error("Security event records are append-only."); },
        beforeDestroy: () => { throw new Error("Security event records are append-only."); },
        beforeBulkUpdate: () => { throw new Error("Security event records are append-only."); },
        beforeBulkDestroy: () => { throw new Error("Security event records are append-only."); }
    }
});
