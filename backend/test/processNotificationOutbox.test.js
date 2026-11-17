const { test } = require("node:test");
const assert = require("node:assert/strict");
const { sequelize } = require("../src/config/db");
const NotificationDelivery = require("../src/models/NotificationDelivery");
const NotificationDevice = require("../src/models/NotificationDevice");
const expoPush = require("../src/utils/expoPush");

const withWorker = async ({ pending = [], receipts = [], sendPushBatch, run }) => {
    const originalTransaction = sequelize.transaction;
    const originalFindAll = NotificationDelivery.findAll;
    const originalStaticUpdate = NotificationDelivery.update;
    const originalDeviceDestroy = NotificationDevice.destroy;
    const originalSendBatch = expoPush.sendPushBatch;
    const workerPath = require.resolve("../src/utils/processNotificationOutbox");
    const workerCache = require.cache[workerPath];
    const updates = [];
    const removedDevices = [];

    sequelize.transaction = async (operation) => operation({ LOCK: { UPDATE: "UPDATE" } });
    NotificationDelivery.findAll = async ({ where }) => (
        where.status === "pending" ? pending : receipts
    );
    NotificationDelivery.update = async (values, { where }) => {
        updates.push({ id: where.id, values });
    };
    NotificationDevice.destroy = async ({ where }) => {
        removedDevices.push(where);
    };
    expoPush.sendPushBatch = sendPushBatch;
    delete require.cache[workerPath];

    const deliveryUpdates = new Map();
    for (const delivery of [...pending, ...receipts]) {
        const originalUpdate = delivery.update;
        delivery.update = async (values) => {
            Object.assign(delivery, values);
            deliveryUpdates.set(delivery.id, { ...(deliveryUpdates.get(delivery.id) || {}), ...values });
            if (originalUpdate) await originalUpdate(values);
        };
    }

    try {
        const worker = require("../src/utils/processNotificationOutbox");
        await run({ worker, updates, removedDevices, deliveryUpdates });
    } finally {
        sequelize.transaction = originalTransaction;
        NotificationDelivery.findAll = originalFindAll;
        NotificationDelivery.update = originalStaticUpdate;
        NotificationDevice.destroy = originalDeviceDestroy;
        expoPush.sendPushBatch = originalSendBatch;
        delete require.cache[workerPath];
        if (workerCache) require.cache[workerPath] = workerCache;
    }
};

test("notification outbox retries transient ticket failures and prunes unregistered devices", async () => {
    const now = new Date("2026-03-01T10:00:00Z");
    const transient = {
        id: 1,
        attempts: 0,
        device: { id: 10, pushToken: "ExpoPushToken[abcdefghijklmnop]" },
        notification: { id: 20, title: "Test", body: "Body", resourceType: "assignment", resourceId: 3 },
        async update(values) { Object.assign(this, values); }
    };
    const unregistered = {
        id: 2,
        attempts: 1,
        device: { id: 11, pushToken: "ExpoPushToken[qrstuvwxyzabcdef]" },
        notification: { id: 21, title: "Test", body: "Body", resourceType: "assignment", resourceId: 4 },
        async update(values) { Object.assign(this, values); }
    };

    await withWorker({
        pending: [transient, unregistered],
        sendPushBatch: async () => [
            { status: "error", details: { error: "MessageRateExceeded" }, message: "Retry later" },
            { status: "error", details: { error: "DeviceNotRegistered" }, message: "Token expired" }
        ],
        run: async ({ worker, updates, removedDevices }) => {
            const result = await worker.processNotificationOutbox(now);
            assert.deepEqual(result.delivery, { attempted: 2, accepted: 0, failed: 2 });
            assert.equal(updates[0].values.status, "pending");
            assert.ok(updates[0].values.availableAt > now);
            assert.equal(updates[1].values.status, "failed");
            assert.deepEqual(removedDevices, [{ id: 11 }]);
        }
    });
});

test("notification outbox marks accepted Expo tickets delivered after receipt confirmation", async () => {
    const now = new Date("2026-03-01T10:00:00Z");
    const delivery = {
        id: 3,
        attempts: 1,
        status: "accepted",
        expoTicketId: "ticket-123",
        device: { id: 12, pushToken: "ExpoPushToken[abcdefghijklmnop]" },
        async update(values) { Object.assign(this, values); }
    };
    const originalFetch = global.fetch;
    global.fetch = async () => ({
        ok: true,
        async json() {
            return { data: { "ticket-123": { status: "ok" } } };
        }
    });

    try {
        await withWorker({
            receipts: [delivery],
            sendPushBatch: async () => [],
            run: async ({ worker, updates }) => {
                const result = await worker.processNotificationOutbox(now);
                assert.deepEqual(result.receipts, { checked: 1, delivered: 1, failed: 0 });
                assert.equal(updates.at(-1).values.status, "delivered");
                assert.equal(updates.at(-1).values.receiptCheckedAt, now);
            }
        });
    } finally {
        global.fetch = originalFetch;
    }
});
