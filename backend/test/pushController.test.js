process.env.DB_HOST = "127.0.0.1";
process.env.DB_NAME = "test";
process.env.DB_USER = "test";
process.env.DB_PASSWORD = "test";

const { afterEach, test } = require("node:test");
const assert = require("node:assert/strict");
const NotificationDevice = require("../src/models/NotificationDevice");
const pushController = require("../src/controllers/pushController");

const originalFindOne = NotificationDevice.findOne;
const originalCount = NotificationDevice.count;
const originalCreate = NotificationDevice.create;
const originalDestroy = NotificationDevice.destroy;

afterEach(() => {
    NotificationDevice.findOne = originalFindOne;
    NotificationDevice.count = originalCount;
    NotificationDevice.create = originalCreate;
    NotificationDevice.destroy = originalDestroy;
});

const response = () => ({
    statusCode: 200,
    body: null,
    status(code) {
        this.statusCode = code;
        return this;
    },
    json(body) {
        this.body = body;
        return this;
    },
    end() {
        this.ended = true;
        return this;
    }
});

test("device registration rejects invalid tokens and platform values on the backend", async () => {
    NotificationDevice.findOne = async () => assert.fail("Invalid device input must be rejected before lookup");
    const invalidTokenResponse = response();
    await pushController.registerDevice({
        body: { pushToken: "https://example.com", platform: "android" },
        user: { id: 12 }
    }, invalidTokenResponse, assert.fail);
    assert.equal(invalidTokenResponse.statusCode, 400);

    const invalidPlatformResponse = response();
    await pushController.registerDevice({
        body: { pushToken: "ExpoPushToken[abcdefghijklmnopqrstuv]", platform: "web" },
        user: { id: 12 }
    }, invalidPlatformResponse, assert.fail);
    assert.equal(invalidPlatformResponse.statusCode, 400);
});

test("device registration associates a token only with the authenticated user", async () => {
    NotificationDevice.findOne = async () => null;
    NotificationDevice.count = async () => 0;
    let values;
    NotificationDevice.create = async (input) => { values = input; };
    const res = response();
    await pushController.registerDevice({
        body: { pushToken: "ExpoPushToken[abcdefghijklmnopqrstuv]", platform: "ios" },
        user: { id: 12 }
    }, res, assert.fail);

    assert.equal(res.statusCode, 200);
    assert.deepEqual({
        userId: values.userId,
        pushToken: values.pushToken,
        platform: values.platform
    }, {
        userId: 12,
        pushToken: "ExpoPushToken[abcdefghijklmnopqrstuv]",
        platform: "ios"
    });

    test("device registration enforces the per-account device limit", async () => {
        NotificationDevice.findOne = async () => null;
        NotificationDevice.count = async () => 10;
        NotificationDevice.create = async () => assert.fail("Accounts at the device limit must not add another device");
        const res = response();
        await pushController.registerDevice({
            body: { pushToken: "ExpoPushToken[abcdefghijklmnopqrstuv]", platform: "android" },
            user: { id: 12 }
        }, res, assert.fail);
        assert.equal(res.statusCode, 429);
    });
});

test("a device token cannot be claimed from another account", async () => {
    const existing = { userId: 99, update: async () => assert.fail("A foreign device must not be updated") };
    NotificationDevice.findOne = async () => existing;
    NotificationDevice.create = async () => assert.fail("A foreign device must not be created");
    const res = response();
    await pushController.registerDevice({
        body: { pushToken: "ExpoPushToken[abcdefghijklmnopqrstuv]", platform: "android" },
        user: { id: 12 }
    }, res, assert.fail);

    assert.equal(res.statusCode, 409);
});

test("device removal is scoped to the authenticated user", async () => {
    let where;
    NotificationDevice.destroy = async (query) => { where = query.where; };
    const res = response();
    await pushController.removeDevice({
        body: { pushToken: "ExpoPushToken[abcdefghijklmnopqrstuv]" },
        user: { id: 12 }
    }, res, assert.fail);

    assert.equal(res.statusCode, 204);
    assert.deepEqual(where, { userId: 12, pushToken: "ExpoPushToken[abcdefghijklmnopqrstuv]" });
});
