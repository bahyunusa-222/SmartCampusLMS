const path = require("node:path");
const fs = require("node:fs/promises");
const validateMaterialFile = require("./validateMaterialFile");
const objectStorage = require("./objectStorage");

module.exports = async (file, body, userId) => {
    if (file) {
        const metadata = await validateMaterialFile(file);
        if (objectStorage.isConfigured()) {
            return objectStorage.storeMaterialBuffer({
                buffer: file.buffer || await fs.readFile(file.path),
                fileName: file.originalname,
                contentType: metadata.mimeType,
                userId
            });
        }
        if (process.env.VERCEL) {
            throw new Error("File storage is not configured for this deployment.");
        }
        return {
            fileUrl: `/uploads/${file.filename}`,
            fileName: path.basename(file.originalname),
            mimeType: metadata.mimeType,
            fileSize: metadata.fileSize
        };
    }

    if (!body.fileStorageKey) return null;
    return objectStorage.resolveMaterialUpload(body, userId);
};
