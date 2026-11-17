process.env.DB_HOST = "127.0.0.1";
process.env.DB_NAME = "test";
process.env.DB_USER = "test";
process.env.DB_PASSWORD = "test";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
    cookieName,
    sessionCookieOptions,
    readSessionCookie,
    clearSessionCookie
} = require("../src/utils/sessionCookie");

test("session cookies are HTTP-only and restricted to API paths", () => {
    const options = sessionCookieOptions();
    assert.equal(options.httpOnly, true);
    assert.equal(options.path, "/api");
    assert.equal(options.sameSite, "lax");
    assert.equal(options.maxAge, 6 * 60 * 60 * 1000);
});

test("session cookie parsing handles unrelated cookies and malformed encoding", () => {
    assert.equal(readSessionCookie(`theme=dark; ${cookieName}=safe%20token`), "safe token");
    assert.equal(readSessionCookie(`${cookieName}=%E0%A4%A`), null);
});

test("logout clears the scoped session cookie", () => {
    let clear;
    clearSessionCookie({
        clearCookie(name, options) {
            clear = { name, options };
        }
    });
    assert.equal(clear.name, cookieName);
    assert.equal(clear.options.httpOnly, true);
    assert.equal(clear.options.path, "/api");
});
