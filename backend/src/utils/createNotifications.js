const crypto = require("node:crypto");
const { Op } = require("sequelize");
const { sequelize } = require("../config/db");
const Enrollment = require("../models/Enrollment");
const Notification = require("../models/Notification");
const NotificationDevice = require("../models/NotificationDevice");
const NotificationDelivery = require("../models/NotificationDelivery");

const makeDedupeKey = ({ userId, type, resourceType, resourceId }) => {
    if (!resourceType || resourceId == null) return null;
    return crypto.createHash("sha256")
        .update(`${userId}:${type}:${resourceType}:${resourceId}`)
        .digest("hex");
};

const createNotifications = async ({
    courseId,
    userIds,
    type,
    title,
    body,
    resourceType,
    resourceId,
    transaction
}) => {
    let recipients = userIds;
    if (!recipients && courseId) {
        const enrollments = await Enrollment.findAll({
            where: { courseId },
            attributes: ["studentId"],
            transaction
        });
        recipients = enrollments.map((enrollment) => enrollment.studentId);
    }

    const uniqueRecipients = [...new Set(recipients || [])];
    if (!uniqueRecipients.length) return [];

    const persist = async (activeTransaction) => {
        const notificationRows = uniqueRecipients.map((userId) => ({
            userId,
            type,
            title,
            body,
            resourceType: resourceType || null,
            resourceId: resourceId || null,
            dedupeKey: makeDedupeKey({ userId, type, resourceType, resourceId })
        }));
        const createdNotifications = await Notification.bulkCreate(notificationRows, {
            transaction: activeTransaction,
            ignoreDuplicates: true,
            returning: true
        });
        const dedupeKeys = notificationRows.map((row) => row.dedupeKey).filter(Boolean);
        const notifications = dedupeKeys.length
            ? await Notification.findAll({
                where: { dedupeKey: { [Op.in]: dedupeKeys } },
                transaction: activeTransaction
            })
            : createdNotifications;
        if (!notifications.length) return [];

        const targetUserIds = [...new Set(notifications.map((notification) => notification.userId))];
        const devices = await NotificationDevice.findAll({
            where: { userId: targetUserIds },
            attributes: ["id", "userId"],
            transaction: activeTransaction
        });
        if (devices.length) {
            const devicesByUser = new Map();
            for (const device of devices) {
                const userDevices = devicesByUser.get(device.userId) || [];
                userDevices.push(device.id);
                devicesByUser.set(device.userId, userDevices);
            }
            const deliveries = notifications.flatMap((notification) =>
                (devicesByUser.get(notification.userId) || []).map((deviceId) => ({
                    notificationId: notification.id,
                    deviceId,
                    status: "pending",
                    attempts: 0,
                    availableAt: new Date()
                }))
            );
            if (deliveries.length) {
                await NotificationDelivery.bulkCreate(deliveries, {
                    transaction: activeTransaction,
                    ignoreDuplicates: true
                });
            }
        }
        return notifications;
    };

    return transaction ? persist(transaction) : sequelize.transaction(persist);
};

module.exports = createNotifications;
