const { DataTypes } = require("sequelize");
const { sequelize } = require("../config/db");

module.exports = sequelize.define("RateLimitBucket", {
    key: { type: DataTypes.STRING(512), primaryKey: true },
    count: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    resetAt: { type: DataTypes.DATE, allowNull: false }
}, {
    indexes: [{ fields: ["resetAt"] }]
});
