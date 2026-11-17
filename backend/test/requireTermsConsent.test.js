const { test } = require("node:test");
const assert = require("node:assert/strict");
const requireTermsConsent = require("../src/middlewares/requireTermsConsent");

const makeResponse = () => ({
    statusCode: 200,
    body: null,
    status(code) {
        this.statusCode = code;
        return this;
    },
    json(body) {
        this.body = body;
        return this;
    }
});

test("browser authentication requires acceptance of the current terms version", () => {
    let nextCalled = false;
    const response = makeResponse();
    requireTermsConsent({
        headers: { origin: "https://smartcampus.example" },
        get(name) {
            return this.headers[name];
        }
    }, response, () => { nextCalled = true; });

    assert.equal(response.statusCode, 428);
    assert.equal(response.body.termsVersion, "2026-11-11");
    assert.equal(nextCalled, false);
});

test("browser authentication accepts the current terms version", () => {
    let nextCalled = false;
    const headers = {
        origin: "https://smartcampus.example",
        "x-smartcampus-terms-version": "2026-11-11"
    };
    const response = makeResponse();
    requireTermsConsent({ headers, get(name) { return headers[name]; } }, response, () => {
        nextCalled = true;
    });

    assert.equal(nextCalled, true);
    assert.equal(response.statusCode, 200);
});

test("non-browser and native authentication are not blocked by the website consent gate", () => {
    for (const headers of [
        {},
        { origin: "null" },
        { origin: "smartcampus://mobile", "x-smartcampus-client": "mobile" }
    ]) {
        let nextCalled = false;
        requireTermsConsent({ headers, get(name) { return headers[name]; } }, makeResponse(), () => {
            nextCalled = true;
        });
        assert.equal(nextCalled, true);
    }
});
