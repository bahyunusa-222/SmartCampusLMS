const FileReference = require("../models/FileReference");
const StoredFile = require("../models/StoredFile");

const attachFileReference = async ({ fileId, resourceType, resourceId, ownerId, transaction }) => {
    if (!fileId) return;
    const storedFile = await StoredFile.findByPk(fileId, {
        transaction,
        lock: transaction.LOCK.UPDATE
    });
    if (!storedFile) throw new Error("The stored file metadata no longer exists.");
    await FileReference.findOrCreate({
        where: { fileId, resourceType, resourceId: String(resourceId) },
        defaults: { fileId, resourceType, resourceId: String(resourceId), ownerId },
        transaction
    });
    await StoredFile.update(
        { status: "active", unreferencedAt: null },
        { where: { id: fileId }, transaction }
    );
};

const removeFileReference = async ({ fileId, resourceType, resourceId, transaction }) => {
    if (!fileId) return;
    await StoredFile.findByPk(fileId, {
        transaction,
        lock: transaction.LOCK.UPDATE
    });
    await FileReference.destroy({
        where: { fileId, resourceType, resourceId: String(resourceId) },
        transaction
    });
    const referenceCount = await FileReference.count({ where: { fileId }, transaction });
    if (referenceCount === 0) {
        await StoredFile.update(
            { status: "pending_delete", unreferencedAt: new Date() },
            { where: { id: fileId }, transaction }
        );
    }
};

const removeResourceReferences = async ({ resourceType, resourceId, transaction }) => {
    const references = await FileReference.findAll({
        where: { resourceType, resourceId: String(resourceId) },
        attributes: ["fileId"],
        transaction
    });
    if (!references.length) return;
    const fileIds = [...new Set(references.map((reference) => reference.fileId))].sort();
    for (const fileId of fileIds) {
        await StoredFile.findByPk(fileId, {
            transaction,
            lock: transaction.LOCK.UPDATE
        });
    }
    await FileReference.destroy({
        where: { resourceType, resourceId: String(resourceId) },
        transaction
    });
    for (const fileId of fileIds) {
        const remaining = await FileReference.count({ where: { fileId }, transaction });
        if (remaining === 0) {
            await StoredFile.update(
                { status: "pending_delete", unreferencedAt: new Date() },
                { where: { id: fileId }, transaction }
            );
        }
    }
};

const findFileReference = async ({ resourceType, resourceId, transaction }) => (
    FileReference.findOne({
        where: { resourceType, resourceId: String(resourceId) },
        attributes: ["fileId"],
        transaction
    })
);

module.exports = {
    attachFileReference,
    removeFileReference,
    removeResourceReferences,
    findFileReference
};
