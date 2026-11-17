const SecurityEvent = require("../models/SecurityEvent");

const recordSecurityEvent = async ({ userId = null, eventType, req, metadata = null }) => {
    try {
        await SecurityEvent.create({
            userId,
            eventType,
            requestId: req?.requestId || null,
            metadata
        });
    } catch (error) {
        console.error("Could not persist security event:", error.message);
    }
};

module.exports = recordSecurityEvent;
