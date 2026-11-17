require("../src/config/env");

const { sequelize, connectDB } = require("../src/config/db");
const objectStorage = require("../src/utils/objectStorage");

const run = async () => {
    const graceDays = process.env.FILE_ORPHAN_GRACE_DAYS === undefined
        ? 30
        : Number(process.env.FILE_ORPHAN_GRACE_DAYS);
    if (!Number.isSafeInteger(graceDays) || graceDays < 1) {
        throw new Error("FILE_ORPHAN_GRACE_DAYS must be a positive whole number.");
    }
    await connectDB();
    const deleted = await objectStorage.cleanupUnreferencedFiles({ graceDays });
    console.log(`Removed ${deleted} unreferenced stored file(s) after ${graceDays} days.`);
};

run()
    .catch((error) => {
        console.error("Stored file cleanup failed:", error.message);
        process.exitCode = 1;
    })
    .finally(() => sequelize.close());
