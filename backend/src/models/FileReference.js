const { DataTypes } = require("sequelize");
const { sequelize } = require("../config/db");

module.exports = sequelize.define("FileReference", {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    fileId: { type: DataTypes.UUID, allowNull: false },
    resourceType: { type: DataTypes.STRING(40), allowNull: false },
    resourceId: { type: DataTypes.STRING(64), allowNull: false },
    ownerId: { type: DataTypes.INTEGER, allowNull: false }
}, {
    indexes: [
        { unique: true, fields: ["fileId", "resourceType", "resourceId"] },
        { fields: ["resourceType", "resourceId"] },
        { fields: ["ownerId", "createdAt"] }
    ]
});
