const NotificationDevice = require("../models/NotificationDevice");
const { isExpoPushToken } = require("../utils/expoPush");

const invalidRequest = (res) => res.status(400).json({
    message: "A valid Expo push token and device platform are required."
});

exports.registerDevice = async (req, res, next) => {
    const { pushToken, platform } = req.body;
    if (!isExpoPushToken(pushToken) || !["android", "ios"].includes(platform)) {
        return invalidRequest(res);
    }

    try {
        const existing = await NotificationDevice.findOne({ where: { pushToken } });
        if (existing && existing.userId !== req.user.id) {
            return res.status(409).json({
                message: "This device token is already associated with another account. Sign out from that account first."
            });
        }
        if (existing) {
            await existing.update({ platform, lastRegisteredAt: new Date() });
        } else {
            const deviceCount = await NotificationDevice.count({ where: { userId: req.user.id } });
            if (deviceCount >= 10) {
                return res.status(429).json({ message: "Remove a registered device before adding another one." });
            }
            await NotificationDevice.create({
                userId: req.user.id,
                pushToken,
                platform,
                lastRegisteredAt: new Date()
            });
        }
        return res.status(200).json({ registered: true });
    } catch (error) {
        if (error.name === "SequelizeUniqueConstraintError") {
            return res.status(409).json({ message: "This device could not be registered. Please try again." });
        }
        return next(error);
    }
};

exports.removeDevice = async (req, res, next) => {
    const { pushToken } = req.body;
    if (!isExpoPushToken(pushToken)) return invalidRequest(res);

    try {
        await NotificationDevice.destroy({
            where: { userId: req.user.id, pushToken }
        });
        return res.status(204).end();
    } catch (error) {
        return next(error);
    }
};
