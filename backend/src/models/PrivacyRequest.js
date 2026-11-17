const { DataTypes } = require("sequelize");
const { sequelize } = require("../config/db");

module.exports = sequelize.define("PrivacyRequest", {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    userId: { type: DataTypes.INTEGER, allowNull: false },
    category: {
        type: DataTypes.ENUM("access", "correction", "erasure", "restriction", "portability", "objection"),
        allowNull: false
    },
    details: { type: DataTypes.STRING(2000), allowNull: true },
    status: {
        type: DataTypes.ENUM("received", "under_review", "completed", "declined"),
        allowNull: false,
        defaultValue: "received"
    },
    submittedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    responseDueAt: { type: DataTypes.DATE, allowNull: true },
    completedAt: { type: DataTypes.DATE, allowNull: true }
}, {
    indexes: [{ fields: ["userId", "submittedAt"] }, { fields: ["status", "responseDueAt"] }]
});
