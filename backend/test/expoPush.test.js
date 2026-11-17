const { afterEach, test } = require("node:test");
const assert = require("node:assert/strict");
const {
    isExpoPushToken,
    routeForNotification,
    sendPushBatch,
    sendPushNotifications
} = require("../src/utils/expoPush");
const NotificationDevice = require("../src/models/NotificationDevice");

const originalFindAll = NotificationDevice.findAll;
const originalDestroy = NotificationDevice.destroy;
const originalFetch = global.fetch;

afterEach(() => {
    NotificationDevice.findAll = originalFindAll;
    NotificationDevice.destroy = originalDestroy;
    global.fetch = originalFetch;
});

test("Expo push tokens must use a supported Expo token format", () => {
    assert.equal(isExpoPushToken("ExponentPushToken[abcdefghijklmnopqrstuv]"), true);
    assert.equal(isExpoPushToken("ExpoPushToken[abcdefghijklmnopqrstuv]"), true);
    assert.equal(isExpoPushToken("ExpoPushToken[short]"), false);
    assert.equal(isExpoPushToken("ExponentPushToken[not a token]"), false);
    assert.equal(isExpoPushToken("https://example.com"), false);
});

test("push notification routes use resource-specific app locations", () => {
    assert.equal(routeForNotification({ resourceType: "assignment", resourceId: 25 }), "/assignments/25");
    assert.equal(routeForNotification({ resourceType: "calendarEvent", resourceId: 11 }), "/calendar");
    assert.equal(routeForNotification({ resourceType: "unknown", resourceId: 11 }), "/notifications");
    assert.equal(routeForNotification({ resourceType: "assignment", resourceId: null }), "/notifications");
});

test("Expo Push API responses are checked for HTTP and payload errors", async () => {
    const sent = await sendPushBatch([{ to: "ExponentPushToken[abcdefghijklmnopqrstuv]" }], async (url, options) => {
        assert.equal(url, "https://exp.host/--/api/v2/push/send");
        assert.equal(options.method, "POST");
        assert.match(options.headers["Content-Type"], /application\/json/);
        return { ok: true, json: async () => ({ data: [{ status: "ok" }] }) };
    });
    assert.deepEqual(sent, [{ status: "ok" }]);

    await assert.rejects(
        sendPushBatch([], async () => ({ ok: false, status: 503 })),
        /HTTP 503/
    );
    await assert.rejects(
        sendPushBatch([], async () => ({ ok: true, json: async () => ({ errors: [{}] }) })),
        /rejected a batch/
    );
    await assert.rejects(
        sendPushBatch([{ to: "ExponentPushToken[abcdefghijklmnopqrstuv]" }],
            async () => ({ ok: true, json: async () => ({ data: [] }) })),
        /invalid ticket response/
    );
});

test("push notifications go only to opted-in devices and invalid Expo tokens are removed", async () => {
    const sentMessages = [];
    let removedTokens;
    NotificationDevice.findAll = async ({ where }) => {
        assert.deepEqual(where.userId, [12, 13, 14]);
        return [
            { id: "device-1", userId: 12, pushToken: "ExpoPushToken[abcdefghijklmnopqrstuv]" },
            { id: "device-2", userId: 13, pushToken: "ExponentPushToken[abcdefghijklmnopqrstuv]" }
        ];
    };
    NotificationDevice.destroy = async ({ where }) => {
        removedTokens = where.pushToken;
    };
    global.fetch = async (url, options) => {
        assert.equal(url, "https://exp.host/--/api/v2/push/send");
        sentMessages.push(...JSON.parse(options.body));
        return {
            ok: true,
            json: async () => ({
                data: [
                    { status: "ok", id: "ticket-1" },
                    { status: "error", details: { error: "DeviceNotRegistered" } }
                ]
            })
        };
    };

    await sendPushNotifications([
        {
            id: 21,
            userId: 12,
            title: "Course announcement",
            body: "A new announcement is available.",
            resourceType: "announcement",
            resourceId: 31
        },
        {
            id: 22,
            userId: 13,
            title: "Assignment reminder",
            body: "Your assignment is due soon.",
            resourceType: "assignment",
            resourceId: 44
        },
        {
            id: 23,
            userId: 14,
            title: "No opted-in device",
            body: "This must not be sent."
        }
    ]);

    assert.equal(sentMessages.length, 2);
    assert.equal(sentMessages[0].to, "ExpoPushToken[abcdefghijklmnopqrstuv]");
    assert.equal(sentMessages[0].data.route, "/announcements/31");
    assert.equal(sentMessages[1].to, "ExponentPushToken[abcdefghijklmnopqrstuv]");
    assert.deepEqual(removedTokens, ["ExponentPushToken[abcdefghijklmnopqrstuv]"]);
});
