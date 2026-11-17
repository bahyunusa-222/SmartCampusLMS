const crypto = require("node:crypto");
const express = require("express");
const sendDeadlineReminders = require("../utils/deadlineReminders");
const { processNotificationOutbox } = require("../utils/processNotificationOutbox");
const logger = require("../utils/logger");

const router = express.Router();

const authorizeCron = (req, res) => {
    const secret = process.env.CRON_SECRET;
    if (!secret || secret.length < 32) {
        logger.error("scheduled_task_not_configured", { task: req.path });
        res.status(503).json({ message: "Scheduled tasks are not configured." });
        return false;
    }

    const provided = req.get("authorization")?.match(/^Bearer (.+)$/i)?.[1] || "";
    const expectedHash = crypto.createHash("sha256").update(secret).digest();
    const providedHash = crypto.createHash("sha256").update(provided).digest();
    if (!provided || !crypto.timingSafeEqual(providedHash, expectedHash)) {
        res.status(401).json({ message: "Unauthorized." });
        return false;
    }
    return true;
};

router.get("/notifications/dispatch", async (req, res, next) => {
    if (!authorizeCron(req, res)) return;
    try {
        return res.json(await processNotificationOutbox());
    } catch (error) {
        logger.error("scheduled_task_failed", {
            requestId: req.requestId,
            task: "notification-outbox",
            error: error.message
        });
        return next(error);
    }
});

router.get("/tasks/deadline-reminders", async (req, res, next) => {
    if (!authorizeCron(req, res)) return;
    try {
        const created = await sendDeadlineReminders();
        return res.json({ created });
    } catch (error) {
        logger.error("scheduled_task_failed", {
            requestId: req.requestId,
            task: "deadline-reminders",
            error: error.message
        });
        return next(error);
    }
});

module.exports = router;
