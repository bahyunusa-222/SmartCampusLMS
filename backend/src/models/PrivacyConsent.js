const { DataTypes } = require("sequelize");
const { sequelize } = require("../config/db");

module.exports = sequelize.define("PrivacyConsent", {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    userId: { type: DataTypes.INTEGER, allowNull: false },
    purpose: {
        type: DataTypes.ENUM("product_communications", "optional_analytics"),
        allowNull: false
    },
    granted: { type: DataTypes.BOOLEAN, allowNull: false },
    policyVersion: { type: DataTypes.STRING(32), allowNull: false },
    recordedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW }
}, {
    updatedAt: false,
    indexes: [{ fields: ["userId", "purpose", "recordedAt"] }]
});
