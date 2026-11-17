const argon2 = require("argon2");
const bcrypt = require("bcrypt");

const parameters = Object.freeze({
    type: argon2.argon2id,
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1
});

const hashPassword = async (password) => {
    if (typeof password !== "string") throw new TypeError("Password must be a string.");
    return argon2.hash(password, parameters);
};

const verifyPassword = async (password, encodedHash) => {
    if (typeof password !== "string" || typeof encodedHash !== "string") return false;
    if (encodedHash.startsWith("$argon2id$")) {
        try {
            return await argon2.verify(encodedHash, password);
        } catch {
            return false;
        }
    }
    if (/^\$2[aby]\$/.test(encodedHash) && Buffer.byteLength(password, "utf8") <= 72) {
        return bcrypt.compare(password, encodedHash);
    }
    return false;
};

const needsRehash = (encodedHash) => {
    if (typeof encodedHash !== "string" || !encodedHash.startsWith("$argon2id$")) return true;
    try {
        return argon2.needsRehash(encodedHash, parameters);
    } catch {
        return true;
    }
};

module.exports = { hashPassword, verifyPassword, needsRehash, parameters };
