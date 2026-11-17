const expoPushUrl = "https://exp.host/--/api/v2/push/send";
const batchSize = 100;

const isExpoPushToken = (token) => typeof token === "string" &&
    token.length <= 255 &&
    /^(Expo|Exponent)PushToken\[[A-Za-z0-9_-]{10,}\]$/.test(token);

const routeForNotification = ({ resourceType, resourceId }) => {
    if (!resourceType || !resourceId) return "/notifications";
    const id = encodeURIComponent(resourceId);
    const routes = {
        announcement: `/announcements/${id}`,
        assignment: `/assignments/${id}`,
        submission: `/assignments/${id}`,
        lesson: `/courses/materials/${id}`,
        calendarEvent: "/calendar",
        message: "/messages",
        assessment: "/quizzes"
    };
    return routes[resourceType] || "/notifications";
};

const pushMessageFor = (device, notification) => ({
    to: device.pushToken,
    title: notification.title.slice(0, 120),
    body: notification.body.slice(0, 500),
    sound: "default",
    priority: "high",
    channelId: "default",
    data: {
        notificationId: notification.id,
        resourceType: notification.resourceType || null,
        resourceId: notification.resourceId || null,
        route: routeForNotification(notification)
    }
});

const sendPushBatch = async (messages, fetchImpl = global.fetch) => {
    const response = await fetchImpl(expoPushUrl, {
        method: "POST",
        headers: {
            Accept: "application/json",
            "Accept-Encoding": "gzip, deflate",
            "Content-Type": "application/json"
        },
        body: JSON.stringify(messages),
        signal: AbortSignal.timeout(10_000)
    });
    if (!response.ok) {
        throw new Error(`Expo Push API returned HTTP ${response.status}.`);
    }
    const result = await response.json();
    if (result.errors?.length) {
        throw new Error(`Expo Push API rejected a batch with ${result.errors.length} error(s).`);
    }
    if (!Array.isArray(result.data) || result.data.length !== messages.length) {
        throw new Error("Expo Push API returned an invalid ticket response.");
    }
    return result.data;
};

const sendPushNotifications = async (notifications) => {
    const records = (notifications || []).map((notification) =>
        typeof notification.get === "function" ? notification.get({ plain: true }) : notification
    );
    if (!records.length) return 0;

    const userIds = [...new Set(records.map((record) => record.userId))];
    const NotificationDevice = require("../models/NotificationDevice");
    const devices = await NotificationDevice.findAll({
        where: { userId: userIds },
        attributes: ["id", "userId", "pushToken"]
    });
    if (!devices.length) return 0;

    const recordsByUser = new Map();
    for (const record of records) {
        const userRecords = recordsByUser.get(record.userId) || [];
        userRecords.push(record);
        recordsByUser.set(record.userId, userRecords);
    }
    const messages = devices.flatMap((device) =>
        (recordsByUser.get(device.userId) || []).map((record) => pushMessageFor(device, record))
    );

    let sent = 0;
    for (let offset = 0; offset < messages.length; offset += batchSize) {
        const batch = messages.slice(offset, offset + batchSize);
        const tickets = await sendPushBatch(batch);
        sent += batch.length;
        const invalidTokens = tickets.flatMap((ticket, index) =>
            ticket.status === "error" && ticket.details?.error === "DeviceNotRegistered"
                ? [batch[index]?.to]
                : []
        );
        if (invalidTokens.length) {
            await NotificationDevice.destroy({ where: { pushToken: invalidTokens } });
        }
        const ticketErrors = tickets.filter((ticket) => ticket.status === "error").length;
        if (ticketErrors) {
            console.error(`Expo Push API reported ${ticketErrors} delivery error(s).`);
        }
    }
    return sent;
};

const dispatchPushNotifications = async (notifications) => {
    try {
        await sendPushNotifications(notifications);
    } catch (error) {
        console.error("Could not send device push notifications:", error.message);
    }
};

module.exports = {
    dispatchPushNotifications,
    isExpoPushToken,
    routeForNotification,
    sendPushBatch,
    sendPushNotifications,
    pushMessageFor
};
