const { DataTypes } = require("sequelize");
const { sequelize } = require("../config/db");

module.exports = sequelize.define("ChatPresence", {
    profileId: { type: DataTypes.UUID, allowNull: false, primaryKey: true },
    lastSeenAt: { type: DataTypes.DATE, allowNull: false }
});
