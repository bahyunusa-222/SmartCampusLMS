require("../src/config/env");

const { sequelize, connectDB } = require("../src/config/db");
require("../src/models/associations");
const initializeDatabase = require("../src/utils/initializeDatabase");
const { migrateLegacyFiles } = require("../src/utils/migrateLegacyFiles");
const objectStorage = require("../src/utils/objectStorage");

const hasExecuteFlag = process.argv.includes("--execute");
const limitArg = process.argv.find((arg) => arg.startsWith("--limit="));
const limit = limitArg ? Number(limitArg.slice("--limit=".length)) : 0;

const run = async () => {
    if (hasExecuteFlag) {
        await initializeDatabase();
        await objectStorage.checkHealth();
    } else {
        await connectDB();
    }
    const result = await migrateLegacyFiles({ dryRun: !hasExecuteFlag, limit });
    console.log(JSON.stringify(result, null, 2));
    if (result.failed) process.exitCode = 1;
};

run()
    .catch((error) => {
        console.error("Legacy file migration failed:", error.message);
        process.exitCode = 1;
    })
    .finally(() => sequelize.close());
