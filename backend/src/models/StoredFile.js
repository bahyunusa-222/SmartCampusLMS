const { DataTypes } = require("sequelize");
const { sequelize } = require("../config/db");

module.exports = sequelize.define("StoredFile", {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    sha256: { type: DataTypes.STRING(64), allowNull: false, unique: true },
    provider: { type: DataTypes.STRING(20), allowNull: false },
    bucket: { type: DataTypes.STRING(255), allowNull: false },
    storageKey: { type: DataTypes.STRING(512), allowNull: false, unique: true },
    ownerId: { type: DataTypes.INTEGER, allowNull: false },
    fileName: { type: DataTypes.STRING(255), allowNull: false },
    mimeType: { type: DataTypes.STRING(127), allowNull: false },
    fileSize: { type: DataTypes.BIGINT, allowNull: false },
    status: { type: DataTypes.STRING(20), allowNull: false, defaultValue: "active" },
    unreferencedAt: { type: DataTypes.DATE, allowNull: true }
}, {
    indexes: [
        { fields: ["status", "unreferencedAt"] },
        { fields: ["ownerId", "createdAt"] }
    ]
});
