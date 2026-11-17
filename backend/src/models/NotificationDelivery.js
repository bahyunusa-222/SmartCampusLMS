const { DataTypes } = require("sequelize");
const { sequelize } = require("../config/db");

module.exports = sequelize.define("NotificationDelivery", {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    notificationId: { type: DataTypes.INTEGER, allowNull: false },
    deviceId: { type: DataTypes.UUID, allowNull: true },
    status: {
        type: DataTypes.STRING(16),
        allowNull: false,
        defaultValue: "pending",
        validate: { isIn: [["pending", "sending", "accepted", "delivered", "failed"]] }
    },
    attempts: { type: DataTypes.SMALLINT, allowNull: false, defaultValue: 0 },
    availableAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    expoTicketId: { type: DataTypes.STRING(255), allowNull: true },
    lastError: { type: DataTypes.STRING(500), allowNull: true },
    sentAt: { type: DataTypes.DATE, allowNull: true },
    receiptCheckedAt: { type: DataTypes.DATE, allowNull: true }
}, {
    indexes: [
        { unique: true, fields: ["notificationId", "deviceId"], name: "notification_delivery_once_per_device" },
        { fields: ["status", "availableAt"] },
        { fields: ["expoTicketId"] }
    ]
});
