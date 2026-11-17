const { Op } = require("sequelize");
const { sequelize } = require("../config/db");
const NotificationDelivery = require("../models/NotificationDelivery");
const NotificationDevice = require("../models/NotificationDevice");
const { pushMessageFor, sendPushBatch } = require("./expoPush");
const logger = require("./logger");

const batchSize = 100;
const maxAttempts = 6;

const retryAt = (attempts) => new Date(
    Date.now() + Math.min(60 * 60 * 1000, 1000 * (2 ** Math.min(attempts, 12)))
);

const claimPendingDeliveries = (now) => sequelize.transaction(async (transaction) => {
    const deliveries = await NotificationDelivery.findAll({
        where: { status: "pending", availableAt: { [Op.lte]: now } },
        include: [
            { association: "notification", required: true },
            { association: "device", required: false }
        ],
        order: [["availableAt", "ASC"], ["id", "ASC"]],
        limit: batchSize,
        transaction,
        lock: transaction.LOCK.UPDATE,
        skipLocked: true
    });
    for (const delivery of deliveries) {
        await delivery.update({
            status: "sending",
            attempts: delivery.attempts + 1
        }, { transaction });
    }
    return deliveries;
});

const updateDelivery = async (delivery, values) => NotificationDelivery.update(values, {
    where: { id: delivery.id, status: "sending" }
});

const claimReceipts = (now) => sequelize.transaction(async (transaction) => {
    const deliveries = await NotificationDelivery.findAll({
        where: {
            status: "accepted",
            expoTicketId: { [Op.ne]: null },
            availableAt: { [Op.lte]: now }
        },
        include: [{ association: "device", required: false }],
        order: [["availableAt", "ASC"], ["id", "ASC"]],
        limit: batchSize,
        transaction,
        lock: transaction.LOCK.UPDATE,
        skipLocked: true
    });
    const nextCheck = new Date(now.getTime() + 5 * 60 * 1000);
    for (const delivery of deliveries) {
        await delivery.update({ availableAt: nextCheck }, { transaction });
    }
    return deliveries;
});

const fetchReceipts = async (ids, fetchImpl = global.fetch) => {
    const response = await fetchImpl("https://exp.host/--/api/v2/push/getReceipts", {
        method: "POST",
        headers: {
            Accept: "application/json",
            "Content-Type": "application/json"
        },
        body: JSON.stringify({ ids }),
        signal: AbortSignal.timeout(10_000)
    });
    if (!response.ok) throw new Error(`Expo Push receipt API returned HTTP ${response.status}.`);
    const result = await response.json();
    if (result.errors?.length || !result.data || typeof result.data !== "object") {
        throw new Error("Expo Push receipt API returned an invalid response.");
    }
    return result.data;
};

const processAcceptedReceipts = async (now) => {
    const deliveries = await claimReceipts(now);
    if (!deliveries.length) return { checked: 0, delivered: 0, failed: 0 };
    const receiptIds = deliveries.map((delivery) => delivery.expoTicketId);
    let receipts;
    try {
        receipts = await fetchReceipts(receiptIds);
    } catch (error) {
        const retryTime = retryAt(2);
        await Promise.all(deliveries.map((delivery) =>
            NotificationDelivery.update({
                availableAt: retryTime,
                lastError: error.message.slice(0, 500)
            }, { where: { id: delivery.id, status: "accepted" } })
        ));
        throw error;
    }

    let delivered = 0;
    let failed = 0;
    for (const delivery of deliveries) {
        const receipt = receipts[delivery.expoTicketId];
        if (!receipt) continue;
        if (receipt.status === "ok") {
            await NotificationDelivery.update({
                status: "delivered",
                receiptCheckedAt: now,
                lastError: null
            }, { where: { id: delivery.id, status: "accepted" } });
            delivered += 1;
            continue;
        }
        const errorCode = receipt.details?.error || "ExpoReceiptError";
        if (errorCode === "DeviceNotRegistered" && delivery.device?.pushToken) {
            await NotificationDevice.destroy({ where: { id: delivery.device.id } });
        }
        await NotificationDelivery.update({
            status: "failed",
            receiptCheckedAt: now,
            lastError: `${errorCode}: ${String(receipt.message || "Push receipt reported a failure").slice(0, 450)}`
        }, { where: { id: delivery.id, status: "accepted" } });
        failed += 1;
    }
    return { checked: deliveries.length, delivered, failed };
};

const processPendingDeliveries = async (now) => {
    const deliveries = await claimPendingDeliveries(now);
    if (!deliveries.length) return { attempted: 0, accepted: 0, failed: 0 };
    const active = deliveries.filter((delivery) => delivery.device?.pushToken);
    const missingDevices = deliveries.filter((delivery) => !delivery.device?.pushToken);
    await Promise.all(missingDevices.map((delivery) => updateDelivery(delivery, {
        status: "failed",
        lastError: "Device token was removed before delivery."
    })));
    if (!active.length) return { attempted: deliveries.length, accepted: 0, failed: missingDevices.length };

    try {
        const tickets = await sendPushBatch(active.map((delivery) =>
            pushMessageFor(delivery.device, delivery.notification)
        ));
        let accepted = 0;
        let failed = missingDevices.length;
        await Promise.all(active.map(async (delivery, index) => {
            const ticket = tickets[index];
            if (ticket.status === "ok" && typeof ticket.id === "string") {
                await updateDelivery(delivery, {
                    status: "accepted",
                    expoTicketId: ticket.id,
                    sentAt: now,
                    availableAt: new Date(now.getTime() + 15 * 60 * 1000),
                    lastError: null
                });
                accepted += 1;
                return;
            }

            const code = ticket.details?.error || "ExpoTicketError";
            if (code === "DeviceNotRegistered") {
                await NotificationDevice.destroy({ where: { id: delivery.device.id } });
            }
            const canRetry = code !== "DeviceNotRegistered" && delivery.attempts < maxAttempts;
            await updateDelivery(delivery, {
                status: canRetry ? "pending" : "failed",
                availableAt: canRetry ? retryAt(delivery.attempts) : now,
                lastError: `${code}: ${String(ticket.message || "Push ticket reported a failure").slice(0, 450)}`
            });
            failed += 1;
        }));
        return { attempted: deliveries.length, accepted, failed };
    } catch (error) {
        await Promise.all(active.map((delivery) => updateDelivery(delivery, {
            status: delivery.attempts < maxAttempts ? "pending" : "failed",
            availableAt: retryAt(delivery.attempts),
            lastError: error.message.slice(0, 500)
        })));
        throw error;
    }
};

const processNotificationOutbox = async (now = new Date()) => {
    const [deliveryResult, receiptResult] = await Promise.all([
        processPendingDeliveries(now),
        processAcceptedReceipts(now)
    ]);
    logger.info("notification_outbox_processed", {
        delivery: deliveryResult,
        receipts: receiptResult
    });
    return { delivery: deliveryResult, receipts: receiptResult };
};

module.exports = {
    processNotificationOutbox,
    fetchReceipts,
    retryAt
};
