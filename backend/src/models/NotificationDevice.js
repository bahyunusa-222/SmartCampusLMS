const { DataTypes } = require("sequelize");
const { sequelize } = require("../config/db");

module.exports = sequelize.define("NotificationDevice", {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    userId: { type: DataTypes.INTEGER, allowNull: false },
    pushToken: {
        type: DataTypes.STRING(255),
        allowNull: false
    },
    platform: { type: DataTypes.STRING(10), allowNull: false },
    lastRegisteredAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW }
}, {
    indexes: [
        { unique: true, fields: ["pushToken"], name: "notification_devices_push_token_unique" },
        { fields: ["userId", "lastRegisteredAt"], name: "notification_devices_user_last_registered" }
    ]
});
