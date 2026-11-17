const { test } = require("node:test");
const assert = require("node:assert/strict");
const objectStorage = require("../src/utils/objectStorage");
const { candidateKey } = require("../src/utils/migrateLegacyFiles");
const sharp = require("sharp");

const userId = 42;
const validKey = "42/7e57d004-2b97-4e7a-9c2d-3c45f30e2b7a.pdf";

test("storage object keys must be generated and scoped to their owner", () => {
    assert.equal(objectStorage.validateStorageKey(validKey, userId), true);
    assert.equal(objectStorage.validateStorageKey(`staging/${validKey}`, userId), true);
    assert.equal(objectStorage.validateStorageKey(validKey, 43), false);
    assert.equal(objectStorage.validateStorageKey("../secret.pdf", userId), false);
});

test("legacy migration only accepts scoped legacy upload keys", () => {
    assert.equal(candidateKey(`/uploads/${validKey}`), validKey);
    assert.equal(candidateKey("/uploads/objects/aa/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"), null);
    assert.equal(candidateKey("/uploads/../../private.pdf"), null);
    assert.equal(candidateKey("https://storage.example/private.pdf"), null);
});

test("deduplication keys use content hashes rather than filenames", () => {
    const first = Buffer.from("same bytes");
    const second = Buffer.from("same bytes");
    const hash = objectStorage.sha256ForBuffer(first);
    assert.equal(objectStorage.sha256ForBuffer(second), hash);
    assert.equal(objectStorage.contentKeyForHash(hash), `objects/${hash.slice(0, 2)}/${hash}`);
});

test("image validation verifies file signatures instead of trusting the MIME type", () => {
    const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]);
    assert.equal(objectStorage.isImageBuffer(png, "image/png"), true);
    assert.equal(objectStorage.isImageBuffer(Buffer.from("not an image"), "image/png"), false);
});

test("large raster images are resized without changing their format", async () => {
    const source = await sharp({
        create: { width: 1200, height: 800, channels: 3, background: "#336699" }
    }).png().toBuffer();
    const optimized = await objectStorage.optimizeImage(source, "image/png", 512);
    const metadata = await sharp(optimized).metadata();
    assert.equal(metadata.format, "png");
    assert.ok(metadata.width <= 512);
    assert.ok(metadata.height <= 512);
});

test("signed material uploads enforce the 20 MB file limit", async () => {
    await assert.rejects(objectStorage.signUpload({
        userId,
        fileName: "lecture.pdf",
        fileSize: 20 * 1024 * 1024 + 1,
        purpose: "lesson"
    }), /20 MB or smaller/);
});

test("signed chat media uploads retain the 5 MB limit", async () => {
    await assert.rejects(objectStorage.signUpload({
        userId,
        fileName: "voice-note.webm",
        fileSize: 5 * 1024 * 1024 + 1,
        purpose: "chat-media",
        mediaType: "voice"
    }), /5 MB or smaller/);
});

test("chat document attachments require a supported extension and verified document MIME type", async () => {
    assert.equal(objectStorage.mediaTypeFromName("notes.pdf", "file"), "application/pdf");
    assert.equal(objectStorage.mediaTypeFromName("program.exe", "file"), undefined);
    await assert.rejects(objectStorage.signUpload({
        userId,
        fileName: "program.exe",
        fileSize: 1024,
        purpose: "chat-media",
        mediaType: "file"
    }), /Unsupported chat attachment format/);
});

test("direct chat image uploads reject forged image MIME types before storage", async () => {
    await assert.rejects(objectStorage.storeChatBuffer({
        buffer: Buffer.from("not an image"),
        fileName: "photo.png",
        contentType: "image/png",
        userId,
        mediaType: "image"
    }), /contents do not match its file type/);
});
