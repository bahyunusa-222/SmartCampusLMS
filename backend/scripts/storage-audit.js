require("../src/config/env");

const { sequelize, connectDB } = require("../src/config/db");
require("../src/models/associations");
const objectStorage = require("../src/utils/objectStorage");

const run = async () => {
    await connectDB();
    const report = await objectStorage.auditStoredObjects();
    console.log(JSON.stringify(report, null, 2));
};

run()
    .catch((error) => {
        console.error("Storage audit failed:", error.message);
        process.exitCode = 1;
    })
    .finally(() => sequelize.close());
