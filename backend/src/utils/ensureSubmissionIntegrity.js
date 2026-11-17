const { QueryTypes } = require("sequelize");
const { sequelize } = require("../config/db");

const indexName = "submissions_student_assignment_unique";

const ensureSubmissionIntegrity = async () => {
    const tables = await sequelize.query(
        "SELECT to_regclass('public.\"Submissions\"') AS table_name",
        { type: QueryTypes.SELECT }
    );
    if (!tables[0]?.table_name) return;

    const duplicates = await sequelize.query(`
        SELECT "studentId", "assignmentId", COUNT(*)::integer AS count
        FROM "Submissions"
        GROUP BY "studentId", "assignmentId"
        HAVING COUNT(*) > 1
        LIMIT 5
    `, { type: QueryTypes.SELECT });
    if (duplicates.length) {
        const details = duplicates.map((row) =>
            `studentId=${row.studentId}, assignmentId=${row.assignmentId}, count=${row.count}`
        ).join("; ");
        throw new Error(
            `Cannot enforce one submission per student and assignment: duplicate records exist (${details}). ` +
            "Resolve duplicate submissions through an approved data-retention decision, then restart."
        );
    }

    const indexes = await sequelize.query(`
        SELECT index_catalog.indisvalid
        FROM pg_class AS index_name
        JOIN pg_index AS index_catalog ON index_catalog.indexrelid = index_name.oid
        WHERE index_name.relname = :indexName
          AND index_name.relnamespace = 'public'::regnamespace
    `, {
        replacements: { indexName },
        type: QueryTypes.SELECT
    });
    if (indexes[0]?.indisvalid) return;
    if (indexes.length) {
        await sequelize.query(`DROP INDEX CONCURRENTLY IF EXISTS public."${indexName}"`);
    }
    await sequelize.query(
        `CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "${indexName}" ON "Submissions" ("studentId", "assignmentId")`
    );
};

module.exports = ensureSubmissionIntegrity;
