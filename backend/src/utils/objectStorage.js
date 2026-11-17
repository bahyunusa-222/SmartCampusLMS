const path = require("node:path");
const crypto = require("node:crypto");
const { createClient } = require("@supabase/supabase-js");
const {
    S3Client,
    PutObjectCommand,
    GetObjectCommand,
    HeadObjectCommand,
    DeleteObjectCommand,
    HeadBucketCommand,
    ListObjectsV2Command,
    DeleteObjectsCommand
} = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const { Op } = require("sequelize");
const { sequelize } = require("../config/db");
const validateMaterialFile = require("./validateMaterialFile");

const supabaseBucket = process.env.SUPABASE_STORAGE_BUCKET || "smartcampus-files";
const configuredLimit = (name, defaultValue) => {
    const parsed = Number(process.env[name]);
    return (Number.isSafeInteger(parsed) && parsed > 0 ? parsed : defaultValue) * 1024 * 1024;
};
const isAudioBuffer = (buffer, contentType) => {
    if (contentType === "audio/webm") return buffer.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
    if (contentType === "audio/mp4") return buffer.toString("ascii", 4, 8) === "ftyp";
    if (contentType === "audio/ogg") return buffer.toString("ascii", 0, 4) === "OggS";
    if (contentType === "audio/mpeg") return buffer.toString("ascii", 0, 3) === "ID3" ||
        (buffer.length > 1 && buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0);
    if (contentType === "audio/wav") return buffer.toString("ascii", 0, 4) === "RIFF" &&
        buffer.toString("ascii", 8, 12) === "WAVE";
    return false;
};
const maxMaterialSize = configuredLimit("FILE_MAX_MATERIAL_MB", 20);
const maxChatMediaSize = configuredLimit("FILE_MAX_CHAT_MB", 5);
const maxProfileImageSize = configuredLimit("FILE_MAX_PROFILE_MB", 2);
const maxProfileImageDimension = 1024;
const maxChatImageDimension = 2048;
const safeFileName = (fileName) => path.posix.basename(String(fileName).replace(/\\/g, "/"))
    .replace(/[\u0000-\u001f\u007f]/g, "_");
const unsafeChatExtensions = new Set([
    ".apk", ".appx", ".bat", ".bash", ".cgi", ".cmd", ".com", ".cpl", ".deb",
    ".dll", ".exe", ".htm", ".html", ".jar", ".js", ".mjs", ".cjs", ".msi",
    ".php", ".pl", ".ps1", ".py", ".rb", ".rpm", ".scr", ".sh", ".svg", ".vbe", ".vbs"
]);
const materialTypes = new Map([
    [".pdf", "application/pdf"],
    [".doc", "application/msword"],
    [".docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
    [".ppt", "application/vnd.ms-powerpoint"],
    [".pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation"],
    [".xls", "application/vnd.ms-excel"],
    [".xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
    [".txt", "text/plain"],
    [".csv", "text/csv"],
    [".png", "image/png"],
    [".jpg", "image/jpeg"],
    [".jpeg", "image/jpeg"],
    [".gif", "image/gif"],
    [".webp", "image/webp"],
    [".zip", "application/zip"]
]);
let supabaseClient;
let s3Client;

const r2Configured = () => Boolean(
    process.env.R2_ACCOUNT_ID &&
    process.env.R2_ACCESS_KEY_ID &&
    process.env.R2_SECRET_ACCESS_KEY &&
    process.env.R2_BUCKET_NAME
);
const selectedProvider = () => {
    const configured = process.env.FILE_STORAGE_PROVIDER ||
        (r2Configured() ? "r2" : "supabase");
    if (!["r2", "supabase"].includes(configured)) {
        throw new Error("FILE_STORAGE_PROVIDER must be r2 or supabase.");
    }
    if (configured === "r2" && !r2Configured()) {
        throw new Error("R2 storage is selected but its backend credentials are incomplete.");
    }
    return configured;
};
const getSupabaseClient = () => {
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
        throw new Error("Supabase Storage is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
    }
    if (!supabaseClient) {
        supabaseClient = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
            auth: { autoRefreshToken: false, persistSession: false }
        });
    }
    return supabaseClient;
};
const getS3Client = () => {
    if (!r2Configured()) throw new Error("Cloudflare R2 is not configured on the backend.");
    if (!s3Client) {
        s3Client = new S3Client({
            region: "auto",
            endpoint: process.env.R2_ENDPOINT ||
                `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
            credentials: {
                accessKeyId: process.env.R2_ACCESS_KEY_ID,
                secretAccessKey: process.env.R2_SECRET_ACCESS_KEY
            }
        });
    }
    return s3Client;
};
const isConfigured = () => selectedProvider() === "r2"
    ? r2Configured()
    : Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
const checkHealth = async () => {
    const provider = selectedProvider();
    if (provider === "r2") {
        await getS3Client().send(new HeadBucketCommand({ Bucket: bucketForProvider(provider) }));
        return;
    }
    const { error } = await getSupabaseClient().storage.from(supabaseBucket).list("", { limit: 1 });
    if (error) throw new Error(`Supabase Storage health check failed: ${error.message}`);
};
const validateStorageKey = (key, userId) => Number.isSafeInteger(Number(userId)) &&
    Number(userId) > 0 &&
    typeof key === "string" &&
    key.length <= 512 &&
    (
        new RegExp(`^${userId}/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\\.[a-z0-9]{1,10}$`, "i").test(key) ||
        new RegExp(`^staging/${userId}/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\\.[a-z0-9]{1,10}$`, "i").test(key)
    );
const contentKeyForHash = (hash) => `objects/${hash.slice(0, 2)}/${hash}`;
const sha256ForBuffer = (buffer) => crypto.createHash("sha256").update(buffer).digest("hex");
const bucketForProvider = (provider) => provider === "r2"
    ? process.env.R2_BUCKET_NAME
    : supabaseBucket;

const signUpload = async ({ userId, fileName, fileSize, purpose, mediaType }) => {
    if (!Number.isSafeInteger(Number(userId)) || Number(userId) < 1) {
        throw new Error("A valid file owner is required.");
    }
    if (typeof fileName !== "string" || fileName.length > 255 || /[\u0000-\u001f\u007f]/.test(fileName)) {
        throw new Error("Choose a valid file name.");
    }
    const extension = path.extname(fileName).toLowerCase();
    const storageExtension = extension || (purpose === "chat-media" && mediaType === "file" ? ".bin" : "");
    let contentType;
    let maxSize = maxMaterialSize;

    if (purpose === "profile-image") {
        maxSize = maxProfileImageSize;
        const profileTypes = new Map([[".jpg", "image/jpeg"], [".jpeg", "image/jpeg"],
            [".png", "image/png"], [".webp", "image/webp"]]);
        contentType = profileTypes.get(extension);
        if (!contentType) throw new Error("Unsupported profile image format.");
    } else if (purpose === "chat-media") {
        maxSize = maxChatMediaSize;
        if (mediaType === "voice" && mediaTypeFromName(fileName, mediaType)) {
            contentType = mediaTypeFromName(fileName, mediaType);
        } else if (mediaType === "image" && mediaTypeFromName(fileName, mediaType)) {
            contentType = mediaTypeFromName(fileName, mediaType);
        } else if (mediaType === "file") {
            contentType = materialTypes.get(extension);
            if (!contentType || unsafeChatExtensions.has(extension)) {
                throw new Error("Unsupported chat attachment format.");
            }
        } else {
            throw new Error("Unsupported chat attachment format.");
        }
    } else {
        contentType = materialTypes.get(extension);
        if (!contentType) throw new Error("Unsupported file type.");
        if (purpose === "question-import" && ![".pdf", ".docx", ".pptx", ".txt", ".xlsx", ".csv"].includes(extension)) {
            throw new Error("Unsupported quiz document format.");
        }
    }

    if (!Number.isSafeInteger(fileSize) || fileSize < 1 || fileSize > maxSize) {
        throw new Error(`Files must be ${maxSize / 1024 / 1024} MB or smaller.`);
    }

    const provider = selectedProvider();
    const key = `staging/${userId}/${crypto.randomUUID()}${storageExtension}`;
    if (provider === "r2") {
        const command = new PutObjectCommand({
            Bucket: bucketForProvider(provider),
            Key: key,
            ContentType: contentType,
            ContentLength: fileSize
        });
        const uploadUrl = await getSignedUrl(getS3Client(), command, { expiresIn: 60 });
        return { provider, key, uploadUrl, method: "PUT", headers: { "Content-Type": contentType }, contentType };
    }
    const { data, error } = await getSupabaseClient().storage.from(supabaseBucket)
        .createSignedUploadUrl(key, { upsert: false });
    if (error) throw new Error(`Unable to prepare file upload: ${error.message}`);
    return { provider, bucket: supabaseBucket, key, token: data.token, contentType };
};

const mediaTypeFromName = (fileName, mediaType) => {
    const extension = path.extname(fileName).toLowerCase();
    if (mediaType === "file") return materialTypes.get(extension);
    const types = mediaType === "voice"
        ? new Map([[".webm", "audio/webm"], [".m4a", "audio/mp4"], [".mp4", "audio/mp4"],
            [".ogg", "audio/ogg"], [".mp3", "audio/mpeg"], [".wav", "audio/wav"]])
        : new Map([[".jpg", "image/jpeg"], [".jpeg", "image/jpeg"], [".png", "image/png"],
            [".webp", "image/webp"], [".gif", "image/gif"]]);
    return types.get(extension);
};
const isDangerousChatFile = (fileName, buffer) => unsafeChatExtensions.has(path.extname(fileName).toLowerCase()) ||
    (buffer?.length >= 2 && buffer[0] === 0x4d && buffer[1] === 0x5a) ||
    (buffer?.length >= 4 && buffer.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46])));

const getStoredFileByKey = async (key) => {
    const StoredFile = require("../models/StoredFile");
    return StoredFile.findOne({ where: { storageKey: key } });
};
const providerForKey = async (key) => {
    if (key.startsWith("staging/")) return selectedProvider();
    const storedFile = await getStoredFileByKey(key);
    return storedFile?.provider || "supabase";
};
const objectExists = async (key, provider, bucket = bucketForProvider(provider)) => {
    if (provider === "r2") {
        try {
            await getS3Client().send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
            return true;
        } catch (error) {
            if (error.name === "NotFound" || error.$metadata?.httpStatusCode === 404) return false;
            throw error;
        }
    }
    const { data, error } = await getSupabaseClient().storage.from(bucket).list(
        path.posix.dirname(key) === "." ? "" : path.posix.dirname(key),
        { search: path.posix.basename(key), limit: 1 }
    );
    if (error) throw new Error(`Unable to check stored file: ${error.message}`);
    return (data || []).some((entry) => entry.name === path.posix.basename(key));
};
const uploadBytes = async ({ key, buffer, contentType, provider, bucket }) => {
    if (provider === "r2") {
        await getS3Client().send(new PutObjectCommand({
            Bucket: bucket,
            Key: key,
            Body: buffer,
            ContentType: contentType
        }));
        return;
    }
    const { error } = await getSupabaseClient().storage.from(bucket).upload(key, buffer, {
        contentType,
        upsert: true
    });
    if (error) throw new Error(`Unable to store uploaded file: ${error.message}`);
};
const optimizeImage = async (buffer, contentType, maxDimension) => {
    if (contentType === "image/gif") return buffer;
    const sharp = require("sharp");
    const image = sharp(buffer, { limitInputPixels: 40_000_000, failOn: "error" });
    const metadata = await image.metadata();
    if (!metadata.width || !metadata.height) throw new Error("The uploaded image is invalid.");
    if (metadata.width <= maxDimension && metadata.height <= maxDimension) return buffer;
    const resized = image.resize(maxDimension, maxDimension, {
        fit: "inside",
        withoutEnlargement: true
    });
    if (contentType === "image/jpeg") return resized.jpeg({ quality: 84, mozjpeg: true }).toBuffer();
    if (contentType === "image/png") return resized.png({ compressionLevel: 8 }).toBuffer();
    if (contentType === "image/webp") return resized.webp({ quality: 82 }).toBuffer();
    return buffer;
};
const downloadFromProvider = async ({ key, provider, bucket }) => {
    if (provider === "r2") {
        const response = await getS3Client().send(new GetObjectCommand({ Bucket: bucket, Key: key }));
        return Buffer.from(await response.Body.transformToByteArray());
    }
    const { data, error } = await getSupabaseClient().storage.from(bucket).download(key);
    if (error) throw new Error(`Unable to read stored file: ${error.message}`);
    return Buffer.from(await data.arrayBuffer());
};
const removeObject = async ({ key, provider, bucket }) => {
    if (provider === "r2") {
        await getS3Client().send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
        return;
    }
    const { error } = await getSupabaseClient().storage.from(bucket).remove([key]);
    if (error) throw new Error(`Unable to remove stored file: ${error.message}`);
};

const persistFile = async ({ buffer, fileName, contentType, userId }) => {
    const sha256 = sha256ForBuffer(buffer);
    const StoredFile = require("../models/StoredFile");
    const FileReference = require("../models/FileReference");
    let file;
    for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
            file = await sequelize.transaction(async (transaction) => {
                let storedFile = await StoredFile.findOne({
                    where: { sha256 },
                    transaction,
                    lock: transaction.LOCK.UPDATE
                });
                if (!storedFile) {
                    const provider = selectedProvider();
                    storedFile = await StoredFile.create({
                        sha256,
                        provider,
                        bucket: bucketForProvider(provider),
                        storageKey: contentKeyForHash(sha256),
                        ownerId: userId,
                        fileName: safeFileName(fileName),
                        mimeType: contentType,
                        fileSize: buffer.length,
                        status: "pending_delete",
                        unreferencedAt: new Date()
                    }, { transaction });
                }
                const hasReferences = await FileReference.count({
                    where: { fileId: storedFile.id },
                    transaction
                });
                await storedFile.update(hasReferences
                    ? { status: "active", unreferencedAt: null }
                    : { status: "pending_delete", unreferencedAt: new Date() }, { transaction });
                return storedFile;
            });
            break;
        } catch (error) {
            if ((error.name !== "SequelizeUniqueConstraintError" && error.original?.code !== "23505") ||
                attempt === 1) throw error;
        }
    }
    if (!file) throw new Error("Unable to record the uploaded file.");

    if (!(await objectExists(file.storageKey, file.provider, file.bucket))) {
        await uploadBytes({
            key: file.storageKey,
            buffer,
            contentType: file.mimeType,
            provider: file.provider,
            bucket: file.bucket
        });
    }
    return file;
};

const cleanupUnreferencedFiles = async ({ graceDays = 30, limit = 100 } = {}) => {
    if (!Number.isSafeInteger(graceDays) || graceDays < 1 ||
        !Number.isSafeInteger(limit) || limit < 1 || limit > 1000) {
        throw new Error("File cleanup requires a positive grace period and a limit between 1 and 1,000.");
    }
    const StoredFile = require("../models/StoredFile");
    const FileReference = require("../models/FileReference");
    const cutoff = new Date(Date.now() - graceDays * 24 * 60 * 60 * 1000);
    const candidates = await StoredFile.findAll({
        where: { status: "pending_delete", unreferencedAt: { [Op.lte]: cutoff } },
        order: [["unreferencedAt", "ASC"]],
        limit,
        attributes: ["id"]
    });
    let deleted = 0;
    for (const candidate of candidates) {
        await sequelize.transaction(async (transaction) => {
            const file = await StoredFile.findByPk(candidate.id, {
                transaction,
                lock: transaction.LOCK.UPDATE
            });
            if (!file || file.status !== "pending_delete" || !file.unreferencedAt ||
                new Date(file.unreferencedAt) > cutoff) return;
            if (await FileReference.count({ where: { fileId: file.id }, transaction })) {
                await file.update({ status: "active", unreferencedAt: null }, { transaction });
                return;
            }
            if (await objectExists(file.storageKey, file.provider, file.bucket)) {
                await removeObject({ key: file.storageKey, provider: file.provider, bucket: file.bucket });
            }
            await file.destroy({ transaction });
            deleted += 1;
        });
    }
    return deleted;
};

const finalizeStagedFile = async ({
    key,
    userId,
    fileName,
    fileSize,
    contentType,
    maxSize,
    stagedBuffer,
    imageMaxDimension = maxChatImageDimension
}) => {
    const provider = await providerForKey(key);
    const bucket = bucketForProvider(provider);
    const exists = await objectExists(key, provider, bucket);
    if (!exists) throw new Error("The uploaded file could not be found.");
    if (provider === "r2") {
        const result = await getS3Client().send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
        if (!result.ContentLength || result.ContentLength > maxSize) {
            throw new Error(`Files must be ${maxSize / 1024 / 1024} MB or smaller.`);
        }
        if (fileSize !== undefined && Number(fileSize) !== result.ContentLength) {
            throw new Error("The uploaded file size did not match the selected file.");
        }
    }
    let buffer = stagedBuffer || await downloadFromProvider({ key, provider, bucket });
    if (!buffer.length || buffer.length > maxSize) {
        throw new Error(`Files must be ${maxSize / 1024 / 1024} MB or smaller.`);
    }
    if (fileSize !== undefined && Number(fileSize) !== buffer.length) {
        throw new Error("The uploaded file size did not match the selected file.");
    }
    if (contentType.startsWith("image/")) {
        if (!isImageBuffer(buffer, contentType)) {
            throw new Error("The uploaded image contents do not match its file type.");
        }
        buffer = await optimizeImage(buffer, contentType, imageMaxDimension);
    }
    const storedFile = await persistFile({ buffer, fileName, contentType, userId });
    if (key !== storedFile.storageKey) await removeObject({ key, provider, bucket });
    return {
        fileUrl: `/uploads/${storedFile.storageKey}`,
        fileName: safeFileName(fileName),
        mimeType: storedFile.mimeType,
        fileSize: buffer.length,
        storedFileId: storedFile.id,
        buffer
    };
};

const download = async (key, maxSize = maxMaterialSize) => {
    const provider = await providerForKey(key);
    const storedFile = await getStoredFileByKey(key);
    const bucket = storedFile?.bucket || bucketForProvider(provider);
    if (provider === "r2") {
        const metadata = await getS3Client().send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
        if (!metadata.ContentLength || metadata.ContentLength > maxSize) {
            throw new Error("Stored file is empty or exceeds the configured file limit.");
        }
    }
    const buffer = await downloadFromProvider({ key, provider, bucket });
    if (!buffer.length || buffer.length > maxSize) {
        throw new Error("Stored file is empty or exceeds the configured file limit.");
    }
    return buffer;
};

const resolveMaterialUpload = async (body, userId) => {
    const key = body.fileStorageKey;
    if (!validateStorageKey(key, userId)) {
        throw new Error("The uploaded file is invalid or does not belong to your account.");
    }
    try {
        const fileName = typeof body.fileName === "string" ? safeFileName(body.fileName) : "";
        if (!fileName || fileName.length > 255) throw new Error("Choose a valid file name.");
        const provider = await providerForKey(key);
        const bucket = bucketForProvider(provider);
        const staged = await downloadFromProvider({ key, provider, bucket });
        if (staged.length > maxMaterialSize ||
            (body.fileSize !== undefined && Number(body.fileSize) !== staged.length)) {
            throw new Error("The uploaded file size did not match the selected file or exceeded the limit.");
        }
        const metadata = await validateMaterialFile({
            buffer: staged,
            originalname: fileName,
            size: staged.length
        });
        if (body.purpose === "question-import") {
            return {
                fileName,
                mimeType: metadata.mimeType,
                fileSize: metadata.fileSize,
                buffer: staged
            };
        }
        return await finalizeStagedFile({
            key,
            userId,
            fileName,
            fileSize: staged.length,
            contentType: metadata.mimeType,
            maxSize: maxMaterialSize,
            stagedBuffer: staged
        });
    } catch (error) {
        try {
            await remove(key);
        } catch (cleanupError) {
            console.error("Failed to remove invalid uploaded file:", cleanupError.message);
        }
        throw error;
    }
};

const resolveChatUpload = async (body, userId) => {
    const key = body.fileStorageKey;
    if (!validateStorageKey(key, userId)) {
        throw new Error("The uploaded attachment is invalid or does not belong to your account.");
    }
    const fileName = typeof body.fileName === "string" ? safeFileName(body.fileName) : "";
    if (!fileName || fileName.length > 255) throw new Error("Choose a valid attachment name.");
    if (body.mediaType === "file" && isDangerousChatFile(fileName)) {
        throw new Error("Unsupported chat attachment format.");
    }
    const type = mediaTypeFromName(fileName, body.mediaType) || "application/octet-stream";
    let stagedBuffer;
    if (body.mediaType === "file" || body.mediaType === "voice") {
        const provider = await providerForKey(key);
        stagedBuffer = await downloadFromProvider({
            key,
            provider,
            bucket: bucketForProvider(provider)
        });
        if (!stagedBuffer.length || stagedBuffer.length > maxChatMediaSize ||
            (body.fileSize !== undefined && Number(body.fileSize) !== stagedBuffer.length)) {
            await remove(key);
            throw new Error("The uploaded file size did not match the selected file or exceeded the limit.");
        }
        if (body.mediaType === "voice" && !isAudioBuffer(stagedBuffer, type)) {
            await remove(key);
            throw new Error("The uploaded audio contents do not match its file type.");
        }
        if (body.mediaType === "file") {
            try {
                await validateMaterialFile({
                    buffer: stagedBuffer,
                    originalname: fileName,
                    size: stagedBuffer.length
                });
            } catch (error) {
                await remove(key);
                throw error;
            }
        }
    }
    const uploaded = await finalizeStagedFile({
        key,
        userId,
        fileName,
        fileSize: body.fileSize,
        contentType: type,
        maxSize: maxChatMediaSize,
        ...(stagedBuffer ? { stagedBuffer } : {})
    });
    return {
        key,
        file: { buffer: uploaded.buffer, originalname: fileName, mimetype: type, size: uploaded.fileSize },
        fileUrl: uploaded.fileUrl,
        storedFileId: uploaded.storedFileId
    };
};

const isImageBuffer = (buffer, contentType) => {
    if (contentType === "image/jpeg") return buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
    if (contentType === "image/png") return buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    if (contentType === "image/gif") return /^GIF8[79]a/.test(buffer.subarray(0, 6).toString("ascii"));
    if (contentType === "image/webp") return buffer.toString("ascii", 0, 4) === "RIFF" &&
        buffer.toString("ascii", 8, 12) === "WEBP";
    return false;
};

const signedDownloadUrl = async (key, fileName, disposition = "attachment") => {
    const provider = await providerForKey(key);
    const storedFile = await getStoredFileByKey(key);
    const bucket = storedFile?.bucket || bucketForProvider(provider);
    const safeName = safeFileName(fileName || "download").replace(/"/g, "_");
    if (provider === "r2") {
        const command = new GetObjectCommand({
            Bucket: bucket,
            Key: key,
            ResponseContentDisposition: `${disposition}; filename="${safeName}"`,
            ...(disposition === "inline" ? { ResponseCacheControl: "private, max-age=60" } : {})
        });
        return getSignedUrl(getS3Client(), command, { expiresIn: 60 });
    }
    const { data, error } = await getSupabaseClient().storage.from(bucket)
        .createSignedUrl(key, 60, { download: disposition === "inline" ? false : safeName });
    if (error) throw new Error(`Unable to create a file download link: ${error.message}`);
    return data.signedUrl;
};

const remove = async (key) => {
    const storedFile = await getStoredFileByKey(key);
    if (storedFile) {
        const FileReference = require("../models/FileReference");
        const referenceCount = await FileReference.count({ where: { fileId: storedFile.id } });
        if (referenceCount === 0) {
            await storedFile.update({ status: "pending_delete", unreferencedAt: new Date() });
        }
        return;
    }
    if (!key.startsWith("staging/")) return;
    const provider = selectedProvider();
    await removeObject({ key, provider, bucket: bucketForProvider(provider) });
};

const listAllFiles = async () => {
    const provider = selectedProvider();
    if (provider === "r2") {
        const keys = [];
        let continuationToken;
        do {
            const result = await getS3Client().send(new ListObjectsV2Command({
                Bucket: bucketForProvider(provider),
                ContinuationToken: continuationToken
            }));
            keys.push(...(result.Contents || []).map((object) => object.Key).filter(Boolean));
            continuationToken = result.IsTruncated ? result.NextContinuationToken : undefined;
        } while (continuationToken);
        return keys;
    }
    const bucket = getSupabaseClient().storage.from(supabaseBucket);
    const keys = [];
    const visit = async (prefix = "") => {
        let offset = 0;
        const pageSize = 100;
        while (true) {
            const { data, error } = await bucket.list(prefix, {
                limit: pageSize,
                offset,
                sortBy: { column: "name", order: "asc" }
            });
            if (error) throw new Error(`Unable to enumerate stored files: ${error.message}`);
            for (const entry of data || []) {
                const key = prefix ? `${prefix}/${entry.name}` : entry.name;
                if (entry.id == null && entry.metadata == null) await visit(key);
                else keys.push(key);
            }
            if (!data || data.length < pageSize) break;
            offset += data.length;
        }
    };
    await visit();
    return keys;
};

const visitStoredObjects = async (visitor, pageSize = 500) => {
    const provider = selectedProvider();
    if (provider === "r2") {
        let continuationToken;
        let totalObjectCount = 0;
        do {
            const result = await getS3Client().send(new ListObjectsV2Command({
                Bucket: bucketForProvider(provider),
                MaxKeys: pageSize,
                ContinuationToken: continuationToken
            }));
            const keys = (result.Contents || []).map((object) => object.Key).filter(Boolean);
            totalObjectCount += keys.length;
            await visitor(keys);
            continuationToken = result.IsTruncated ? result.NextContinuationToken : undefined;
        } while (continuationToken);
        return totalObjectCount;
    }

    const bucket = getSupabaseClient().storage.from(supabaseBucket);
    let totalObjectCount = 0;
    const visit = async (prefix = "") => {
        let offset = 0;
        while (true) {
            const { data, error } = await bucket.list(prefix, {
                limit: pageSize,
                offset,
                sortBy: { column: "name", order: "asc" }
            });
            if (error) throw new Error(`Unable to enumerate stored files: ${error.message}`);
            const files = [];
            for (const entry of data || []) {
                const key = prefix ? `${prefix}/${entry.name}` : entry.name;
                if (entry.id == null && entry.metadata == null) await visit(key);
                else files.push(key);
            }
            if (files.length) {
                totalObjectCount += files.length;
                await visitor(files);
            }
            if (!data || data.length < pageSize) break;
            offset += data.length;
        }
    };
    await visit();
    return totalObjectCount;
};

const removeAllFiles = async (keys) => {
    const provider = selectedProvider();
    if (provider === "r2") {
        for (let index = 0; index < keys.length; index += 1000) {
            const result = await getS3Client().send(new DeleteObjectsCommand({
                Bucket: bucketForProvider(provider),
                Delete: { Objects: keys.slice(index, index + 1000).map((Key) => ({ Key })) }
            }));
            if (result.Errors?.length) {
                throw new Error(`Unable to remove ${result.Errors.length} stored R2 object(s).`);
            }
        }
        return;
    }
    const bucket = getSupabaseClient().storage.from(supabaseBucket);
    for (let index = 0; index < keys.length; index += 100) {
        const { error } = await bucket.remove(keys.slice(index, index + 100));
        if (error) throw new Error(`Unable to remove stored files: ${error.message}`);
    }
};

const auditStoredObjects = async ({ sampleLimit = 100, pageSize = 500 } = {}) => {
    if (!Number.isSafeInteger(sampleLimit) || sampleLimit < 1 || sampleLimit > 1000 ||
        !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 1000) {
        throw new Error("Storage audit limits must be between 1 and 1,000.");
    }
    const provider = selectedProvider();
    const StoredFile = require("../models/StoredFile");
    const FileReference = require("../models/FileReference");
    const knownKeys = new Set();
    let untrackedCanonicalObjectCount = 0;
    let lastId = 0;
    while (true) {
        const rows = await StoredFile.findAll({
            where: {
                provider,
                bucket: bucketForProvider(provider),
                id: { [Op.gt]: lastId }
            },
            attributes: ["id", "storageKey"],
            order: [["id", "ASC"]],
            limit: pageSize,
        });
        if (rows.length) lastId = rows[rows.length - 1].id;
        for (const row of rows) knownKeys.add(row.storageKey);
        if (rows.length < pageSize) break;
    }

    const canonicalKeySet = new Set();
    const untrackedKeys = [];
    let canonicalObjectCount = 0;
    let stagingObjectCount = 0;
    let legacyObjectCount = 0;
    const objectCount = await visitStoredObjects(async (keys) => {
        for (const key of keys) {
            if (/^objects\/[0-9a-f]{2}\/[0-9a-f]{64}$/i.test(key)) {
                canonicalObjectCount += 1;
                canonicalKeySet.add(key);
                if (!knownKeys.has(key)) {
                    untrackedCanonicalObjectCount += 1;
                    if (untrackedKeys.length < sampleLimit) untrackedKeys.push(key);
                }
            } else if (key.startsWith("staging/")) {
                stagingObjectCount += 1;
            } else {
                legacyObjectCount += 1;
            }
        }
    }, pageSize);
    let missingCanonicalObjectCount = 0;
    const missingKeys = [];
    for (const key of knownKeys) {
        if (!canonicalKeySet.has(key)) {
            missingCanonicalObjectCount += 1;
            if (missingKeys.length < sampleLimit) missingKeys.push(key);
        }
    }
    const referencedFileCount = await FileReference.count({
        distinct: true,
        col: "fileId",
        include: [{
            model: StoredFile,
            as: "file",
            where: { provider, bucket: bucketForProvider(provider) },
            required: true
        }]
    });
    return {
        provider,
        bucket: bucketForProvider(provider),
        totalObjectCount: objectCount,
        canonicalObjectCount,
        metadataRecordCount: knownKeys.size,
        untrackedCanonicalObjectCount,
        missingCanonicalObjectCount,
        stagingObjectCount,
        legacyObjectCount,
        unreferencedMetadataCount: Math.max(0, knownKeys.size - referencedFileCount),
        samples: {
            untrackedCanonicalObjects: untrackedKeys.slice(0, sampleLimit),
            missingCanonicalObjects: missingKeys.slice(0, sampleLimit)
        }
    };
};

const storeBuffer = async ({ buffer, fileName, contentType, userId }) => {
    if (!Buffer.isBuffer(buffer) || buffer.length < 1 || buffer.length > maxProfileImageSize) {
        throw new Error(`Files must be ${maxProfileImageSize / 1024 / 1024} MB or smaller.`);
    }
    if (!isImageBuffer(buffer, contentType)) {
        throw new Error("The uploaded image contents do not match its file type.");
    }
    const optimizedBuffer = await optimizeImage(buffer, contentType, maxProfileImageDimension);
    const storedFile = await persistFile({ buffer: optimizedBuffer, fileName, contentType, userId });
    return {
        fileUrl: `/uploads/${storedFile.storageKey}`,
        fileName: safeFileName(fileName),
        mimeType: storedFile.mimeType,
        fileSize: optimizedBuffer.length,
        storedFileId: storedFile.id
    };
};

const storeMaterialBuffer = async ({ buffer, fileName, contentType, userId }) => {
    if (!Buffer.isBuffer(buffer) || buffer.length < 1 || buffer.length > maxMaterialSize) {
        throw new Error(`Files must be ${maxMaterialSize / 1024 / 1024} MB or smaller.`);
    }
    const metadata = await validateMaterialFile({
        buffer,
        originalname: fileName,
        size: buffer.length
    });
    if (contentType && contentType !== metadata.mimeType) {
        throw new Error("The uploaded file MIME type does not match its contents.");
    }
    let optimizedBuffer = buffer;
    if (metadata.mimeType.startsWith("image/")) {
        if (!isImageBuffer(buffer, metadata.mimeType)) {
            throw new Error("The uploaded image contents do not match its file type.");
        }
        optimizedBuffer = await optimizeImage(buffer, metadata.mimeType, maxChatImageDimension);
    }
    const storedFile = await persistFile({
        buffer: optimizedBuffer,
        fileName,
        contentType: metadata.mimeType,
        userId
    });
    return {
        fileUrl: `/uploads/${storedFile.storageKey}`,
        fileName: safeFileName(fileName),
        mimeType: storedFile.mimeType,
        fileSize: optimizedBuffer.length,
        storedFileId: storedFile.id
    };
};

const storeChatBuffer = async ({ buffer, fileName, contentType, userId, mediaType }) => {
    if (!Buffer.isBuffer(buffer) || buffer.length < 1 || buffer.length > maxChatMediaSize) {
        throw new Error(`Files must be ${maxChatMediaSize / 1024 / 1024} MB or smaller.`);
    }
    const safeName = safeFileName(fileName);
    if (mediaType === "image") {
        if (!isImageBuffer(buffer, contentType)) {
            throw new Error("The uploaded image contents do not match its file type.");
        }
    } else if (mediaType === "voice") {
        if (!isAudioBuffer(buffer, contentType)) {
            throw new Error("The uploaded audio contents do not match its file type.");
        }
    } else if (mediaType === "file") {
        if (isDangerousChatFile(safeName, buffer)) {
            throw new Error("Unsupported chat attachment format.");
        }
        const metadata = await validateMaterialFile({
            buffer,
            originalname: safeName,
            size: buffer.length
        });
        if (contentType !== "application/octet-stream" && contentType !== metadata.mimeType) {
            throw new Error("The uploaded file MIME type does not match its contents.");
        }
        contentType = metadata.mimeType;
    } else {
        throw new Error("Unsupported chat attachment format.");
    }
    const optimizedBuffer = mediaType === "image" && contentType !== "image/gif"
        ? await optimizeImage(buffer, contentType, maxChatImageDimension)
        : buffer;
    const storedFile = await persistFile({
        buffer: optimizedBuffer,
        fileName: safeName,
        contentType,
        userId
    });
    return {
        fileUrl: `/uploads/${storedFile.storageKey}`,
        fileName: safeName,
        mimeType: storedFile.mimeType,
        fileSize: optimizedBuffer.length,
        storedFileId: storedFile.id,
        buffer: optimizedBuffer
    };
};

module.exports = {
    bucketName: supabaseBucket,
    isConfigured,
    checkHealth,
    signUpload,
    validateStorageKey,
    resolveMaterialUpload,
    resolveChatUpload,
    download,
    signedDownloadUrl,
    remove,
    listAllFiles,
    visitStoredObjects,
    removeAllFiles,
    auditStoredObjects,
    selectedProvider,
    storeBuffer,
    storeMaterialBuffer,
    storeChatBuffer,
    cleanupUnreferencedFiles,
    isImageBuffer,
    isAudioBuffer,
    isDangerousChatFile,
    mediaTypeFromName,
    optimizeImage,
    maxProfileImageSize,
    sha256ForBuffer,
    contentKeyForHash
};
