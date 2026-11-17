const path = require("node:path");
const { Op } = require("sequelize");
const { sequelize } = require("../config/db");
const Assignment = require("../models/Assignment");
const Course = require("../models/Course");
const Lesson = require("../models/Lesson");
const Submission = require("../models/Submission");
const StoredFile = require("../models/StoredFile");
const objectStorage = require("./objectStorage");
const { objectKeyFor } = require("./storedUpload");
const { attachFileReference } = require("./fileReferences");

const pageSize = 25;

const resourceSources = [
    {
        model: Lesson,
        resourceType: "lesson",
        includes: [{ model: Course, as: "course", attributes: ["id", "lecturerId"] }],
        ownerId: (record) => record.uploadedById || record.course?.lecturerId
    },
    {
        model: Assignment,
        resourceType: "assignment",
        includes: [{ model: Course, as: "course", attributes: ["id", "lecturerId"] }],
        ownerId: (record) => record.course?.lecturerId
    },
    {
        model: Submission,
        resourceType: "submission",
        includes: [],
        ownerId: (record) => record.studentId
    }
];

const candidateKey = (fileUrl) => {
    const key = objectKeyFor(fileUrl);
    if (!key || key.startsWith("staging/") || key.startsWith("objects/")) return null;
    return key;
};

const migrateLegacyFiles = async ({ dryRun = true, limit = 0 } = {}) => {
    if (!Number.isSafeInteger(limit) || limit < 0) {
        throw new Error("Migration limit must be a non-negative whole number.");
    }
    if (!dryRun && objectStorage.selectedProvider() !== "r2") {
        throw new Error("Set FILE_STORAGE_PROVIDER=r2 before migrating legacy files.");
    }

    const result = {
        dryRun,
        scanned: 0,
        eligible: 0,
        migrated: 0,
        skipped: 0,
        failed: 0,
        errors: []
    };
    let remaining = limit;

    for (const source of resourceSources) {
        let lastId = 0;
        while (limit === 0 || remaining > 0) {
            const batchLimit = remaining > 0 ? Math.min(pageSize, remaining) : pageSize;
            const records = await source.model.findAll({
                where: {
                    id: { [Op.gt]: lastId },
                    fileUrl: { [Op.like]: "/uploads/%" }
                },
                include: source.includes,
                order: [["id", "ASC"]],
                limit: batchLimit
            });
            if (!records.length) break;

            for (const record of records) {
                lastId = record.id;
                result.scanned += 1;
                const oldUrl = record.fileUrl;
                const key = candidateKey(oldUrl);
                if (!key) {
                    result.skipped += 1;
                    continue;
                }
                result.eligible += 1;
                if (dryRun) continue;

                try {
                    const ownerId = source.ownerId(record);
                    if (!Number.isSafeInteger(Number(ownerId)) || Number(ownerId) < 1) {
                        throw new Error("The resource has no valid file owner.");
                    }
                    if (await StoredFile.findOne({ where: { storageKey: key } })) {
                        result.skipped += 1;
                        continue;
                    }

                    const fileName = record.fileName || path.posix.basename(key);
                    const sourceBuffer = await objectStorage.download(key);
                    const stored = await objectStorage.storeMaterialBuffer({
                        buffer: sourceBuffer,
                        fileName,
                        contentType: record.mimeType || undefined,
                        userId: Number(ownerId)
                    });
                    const newKey = objectKeyFor(stored.fileUrl);
                    const storedFile = newKey
                        ? await StoredFile.findOne({ where: { storageKey: newKey } })
                        : null;
                    if (!storedFile || storedFile.provider !== "r2") {
                        throw new Error("The migrated object was not stored in the configured R2 bucket.");
                    }
                    const copiedBuffer = await objectStorage.download(newKey);
                    if (objectStorage.sha256ForBuffer(copiedBuffer) !== storedFile.sha256) {
                        throw new Error("The R2 object did not pass its stored SHA-256 integrity check.");
                    }

                    await sequelize.transaction(async (transaction) => {
                        const current = await source.model.findByPk(record.id, {
                            transaction,
                            lock: transaction.LOCK.UPDATE
                        });
                        if (!current || current.fileUrl !== oldUrl) {
                            throw new Error("The file reference changed during migration; retry this resource.");
                        }
                        await current.update({ fileUrl: stored.fileUrl }, { transaction });
                        await attachFileReference({
                            fileId: storedFile.id,
                            resourceType: source.resourceType,
                            resourceId: record.id,
                            ownerId: Number(ownerId),
                            transaction
                        });
                    });
                    result.migrated += 1;
                } catch (error) {
                    result.failed += 1;
                    if (result.errors.length < 20) {
                        result.errors.push({
                            resourceType: source.resourceType,
                            resourceId: record.id,
                            message: error.message
                        });
                    }
                }
            }

            if (remaining > 0) remaining -= records.length;
            if (records.length < batchLimit || (limit > 0 && remaining === 0)) break;
        }
        if (limit > 0 && remaining === 0) break;
    }
    return result;
};

module.exports = { migrateLegacyFiles, candidateKey };
