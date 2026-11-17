const { test } = require("node:test");
const assert = require("node:assert/strict");
const bcrypt = require("bcrypt");
const {
    hashPassword,
    verifyPassword,
    needsRehash,
    parameters
} = require("../src/utils/passwordSecurity");
const { validatePassword } = require("../src/utils/authValidation");

test("passwords are stored as unique Argon2id hashes and verify Unicode passphrases", async () => {
    const password = "University passphrase 🔐 café";
    const [first, second] = await Promise.all([
        hashPassword(password),
        hashPassword(password)
    ]);

    assert.match(first, /^\$argon2id\$/);
    assert.notEqual(first, second);
    assert.equal(await verifyPassword(password, first), true);
    assert.equal(await verifyPassword("incorrect passphrase", first), false);
    assert.equal(needsRehash(first), false);
    assert.equal(parameters.memoryCost, 19456);
    assert.equal(parameters.timeCost, 2);
});

test("legacy bcrypt hashes verify but are marked for upgrade", async () => {
    const legacy = await bcrypt.hash("legacy password", 10);

    assert.equal(await verifyPassword("legacy password", legacy), true);
    assert.equal(await verifyPassword("incorrect password", legacy), false);
    assert.equal(await verifyPassword(`${"x".repeat(73)}`, legacy), false);
    assert.equal(needsRehash(legacy), true);
});

test("password policy accepts long passphrases and rejects short or common passwords", () => {
    assert.equal(validatePassword("a long Unicode 🔐 passphrase"), true);
    assert.equal(validatePassword("short"), false);
    assert.equal(validatePassword("password1234"), false);
    assert.equal(validatePassword("x".repeat(129)), false);
});
