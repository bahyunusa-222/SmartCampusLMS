const { sequelize, connectDB } = require("../config/db");
require("../models/associations");
const runMigrations = require("./runMigrations");
const runFileStorageMigration = require("./runFileStorageMigration");
const runChatSecurity = require("./chatSecurity");
const withDatabaseMigrationLock = require("./withDatabaseMigrationLock");
const runNotificationDeliveryMigration = require("./runNotificationDeliveryMigration");

let databaseInitialization;

module.exports = () => {
    if (!databaseInitialization) {
        databaseInitialization = (async () => {
            await connectDB();
            await withDatabaseMigrationLock(async () => {
                await runMigrations();
                await sequelize.sync();
                await runFileStorageMigration();
                await runNotificationDeliveryMigration();
                if (runMigrations.ensureIdentityIndexes) {
                    await runMigrations.ensureIdentityIndexes();
                }
                await runChatSecurity();
            });
            console.log("Database synced");
        })().catch((error) => {
            databaseInitialization = undefined;
            throw error;
        });
    }

    return databaseInitialization;
};
