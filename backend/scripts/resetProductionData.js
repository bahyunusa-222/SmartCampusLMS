const { sequelize } = require("../src/config/db");
require("../src/models/associations");
const objectStorage = require("../src/utils/objectStorage");

const excludedTables = new Set(["schools", "departments", "schemamigrations", "sequelizemeta"]);
const execute = process.argv.includes("--execute");
const confirmed = process.argv.includes("--confirm-live-reset");

const tableName = (table) => typeof table === "string" ? table : table.tableName;

const countRows = async (tables) => {
    const counts = [];
    for (const table of tables) {
        const [result] = await sequelize.query(
            `SELECT COUNT(*)::bigint AS count FROM ${sequelize.getQueryInterface().queryGenerator.quoteTable(table)}`
        );
        counts.push({ table, count: Number(result[0].count) });
    }
    return counts;
};

const printCounts = (title, counts) => {
    console.log(title);
    for (const { table, count } of counts) console.log(`  ${table}: ${count}`);
};

const reset = async () => {
    if (execute && (!confirmed ||
        process.env.SMARTCAMPUS_RESET_TARGET !== "production" ||
        process.env.SMARTCAMPUS_ALLOW_DESTRUCTIVE_RESET !== "YES")) {
        throw new Error(
            "Live reset requires --confirm-live-reset and SMARTCAMPUS_RESET_TARGET=production plus SMARTCAMPUS_ALLOW_DESTRUCTIVE_RESET=YES."
        );
    }
    if (!objectStorage.isConfigured()) {
        throw new Error("Supabase Storage must be configured so uploaded files can be included in the reset.");
    }

    await sequelize.authenticate();
    const queryInterface = sequelize.getQueryInterface();
    const tables = (await queryInterface.showAllTables())
        .map(tableName)
        .filter((name) => !excludedTables.has(name.toLowerCase()));
    const before = await countRows(tables);
    const fileKeys = await objectStorage.listAllFiles();
    console.log(`Database: ${sequelize.config.database}`);
    console.log(`Storage bucket: ${objectStorage.bucketName}`);
    printCounts(execute ? "Rows scheduled for deletion:" : "Dry run; rows that would be deleted:", before);
    console.log(`Uploaded objects scheduled for deletion: ${fileKeys.length}`);

    if (!execute) {
        console.log("No data was changed. To execute the previously authorized production reset, supply the explicit confirmation flags and environment guards.");
        return;
    }

    if (tables.length) {
        const quotedTables = tables.map((table) => queryInterface.quoteTable(table)).join(", ");
        await sequelize.transaction(async (transaction) => {
            await sequelize.query(`TRUNCATE TABLE ${quotedTables} RESTART IDENTITY CASCADE`, { transaction });
        });
    }
    await objectStorage.removeAllFiles(fileKeys);

    const after = await countRows(tables);
    const remainingTables = after.filter(({ count }) => count > 0);
    const remainingFiles = await objectStorage.listAllFiles();
    if (remainingTables.length || remainingFiles.length) {
        printCounts("Rows remaining after reset:", remainingTables);
        throw new Error(`Reset verification failed; ${remainingFiles.length} stored object(s) remain.`);
    }
    const [schools, departments] = await Promise.all([
        queryInterface.select(null, "Schools", { attributes: ["id"] }),
        queryInterface.select(null, "Departments", { attributes: ["id"] })
    ]);
    console.log(`Verified: ${tables.length} application tables are empty; ${fileKeys.length} uploaded objects were removed.`);
    console.log(`Academic catalog preserved with ${schools.length} school(s) and ${departments.length} department(s).`);
};

reset()
    .catch((error) => {
        console.error(`Production reset failed: ${error.message}`);
        process.exitCode = 1;
    })
    .finally(async () => {
        await sequelize.close();
    });
