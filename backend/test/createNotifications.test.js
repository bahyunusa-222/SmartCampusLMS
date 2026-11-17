process.env.DB_HOST = "127.0.0.1";
process.env.DB_NAME = "test";
process.env.DB_USER = "test";
process.env.DB_PASSWORD = "test";

const { afterEach, test } = require("node:test");
const assert = require("node:assert/strict");
const { sequelize } = require("../src/config/db");
const Notification = require("../src/models/Notification");
const NotificationDevice = require("../src/models/NotificationDevice");
const NotificationDelivery = require("../src/models/NotificationDelivery");
const createNotifications = require("../src/utils/createNotifications");

const originalBulkCreate = Notification.bulkCreate;
const originalFindAll = Notification.findAll;
const originalDeviceFindAll = NotificationDevice.findAll;
const originalDeliveryBulkCreate = NotificationDelivery.bulkCreate;
const originalTransaction = sequelize.transaction;

afterEach(() => {
    Notification.bulkCreate = originalBulkCreate;
    Notification.findAll = originalFindAll;
    NotificationDevice.findAll = originalDeviceFindAll;
    NotificationDelivery.bulkCreate = originalDeliveryBulkCreate;
    sequelize.transaction = originalTransaction;
});

test("notification and push outbox rows share the caller's transaction", async () => {
    let rows;
    let deliveries;
    const transaction = {};
    Notification.bulkCreate = async (records, options) => {
        rows = records;
        assert.equal(options.transaction, transaction);
        assert.equal(options.ignoreDuplicates, true);
        return records.map((record, index) => ({ id: index + 1, ...record }));
    };
    Notification.findAll = async ({ where, transaction: activeTransaction }) => {
        assert.equal(activeTransaction, transaction);
        assert.equal(where.dedupeKey[Object.getOwnPropertySymbols(where.dedupeKey)[0]].length, 2);
        return rows.map((row, index) => ({ id: index + 1, ...row }));
    };
    NotificationDevice.findAll = async ({ transaction: activeTransaction }) => {
        assert.equal(activeTransaction, transaction);
        return [{ id: 8, userId: 17 }, { id: 9, userId: 18 }];
    };
    NotificationDelivery.bulkCreate = async (records, options) => {
        deliveries = records;
        assert.equal(options.transaction, transaction);
        assert.equal(options.ignoreDuplicates, true);
    };

    await createNotifications({
        userIds: [17, 17, 18],
        type: "announcement",
        title: "Course update",
        body: "A new update is available.",
        resourceType: "announcement",
        resourceId: 31,
        transaction
    });

    assert.equal(rows.length, 2);
    assert.ok(rows.every((row) => /^[a-f0-9]{64}$/.test(row.dedupeKey)));
    assert.deepEqual(deliveries.map(({ notificationId, deviceId }) => ({ notificationId, deviceId })), [
        { notificationId: 1, deviceId: 8 },
        { notificationId: 2, deviceId: 9 }
    ]);
});

test("notification writes without a caller transaction create their own transaction", async () => {
    let transactionCallback;
    Notification.bulkCreate = async (records) => records.map((record, index) => ({ id: index + 10, ...record }));
    Notification.findAll = async () => [];
    NotificationDevice.findAll = async () => [];
    sequelize.transaction = async (callback) => {
        transactionCallback = callback;
        return callback({});
    };

    const result = await createNotifications({
        userIds: [17],
        type: "message",
        title: "New message",
        body: "There is a new message."
    });

    assert.equal(typeof transactionCallback, "function");
    assert.equal(result.length, 1);
});
