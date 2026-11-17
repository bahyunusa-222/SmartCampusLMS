const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const { randomUUID } = require("node:crypto");
require("./config/env");

const authRoutes = require("./Routes/authRoutes");
const privacyRoutes = require("./Routes/privacyRoutes");
const enrollmentRoutes = require("./Routes/enrollmentRoutes");
const lessonRoutes = require("./Routes/lessonRoutes");
const quizRoutes = require("./Routes/quizRoutes");
const assignmentRoutes = require("./Routes/assignmentRoutes");
const courseRoutes = require("./Routes/courseRoutes");
const downloadRoutes = require("./Routes/downloadRoutes");
const auditRoutes = require("./Routes/auditRoutes");
const dashboardRoutes = require("./Routes/dashboardRoutes");
const aiRoutes = require("./Routes/aiRoutes");
const lmsRoutes = require("./Routes/lmsRoutes");
const feedbackRoutes = require("./Routes/feedbackRoutes");
const chatRoutes = require("./Routes/chatRoutes");
const reportRoutes = require("./Routes/reportRoutes");
const uploadRoutes = require("./Routes/uploadRoutes");
const internalRoutes = require("./Routes/internalRoutes");
const searchRoutes = require("./Routes/searchRoutes");
const { sequelize } = require("./config/db");
const objectStorage = require("./utils/objectStorage");
const logger = require("./utils/logger");
const requestLogger = require("./middlewares/requestLogger");
const PostgresRateLimitStore = require("./utils/PostgresRateLimitStore");
require("./models/RateLimitBucket");

const app = express();

app.set("trust proxy", 1);

const allowedOrigins = [
    "http://localhost:5173",
    process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "",
    ...(process.env.CLIENT_URL || "").split(",")
]
    .map((origin) => origin.trim())
    .filter(Boolean);

app.use(helmet());
app.use(requestLogger);
app.use(cors({
    origin(origin, callback) {
        if (!origin || allowedOrigins.includes(origin)) {
            callback(null, true);
            return;
        }

        callback(null, false);
    },
    credentials: true,
    exposedHeaders: ["Content-Disposition"]
}));
app.use(express.json({ limit: "4mb" }));
app.use((req, res, next) => {
    if (req.body === undefined) {
        req.body = {};
    } else if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
        return res.status(400).json({ message: "Request body must be a JSON object" });
    }
    next();
});
app.use(rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 100,
    standardHeaders: true,
    legacyHeaders: false,
    store: new PostgresRateLimitStore(),
    skip: (req) => ["GET", "HEAD", "OPTIONS"].includes(req.method) ||
        req.path === "/api/chat/typing" ||
        req.path === "/api/chat/presence/heartbeat",
    message: { message: "Too many write requests. Please wait before trying again." }
}));

app.get(["/health/live", "/api/health/live"], (req, res) => {
    res.json({ status: "ok" });
});

app.get(["/health/ready", "/api/health/ready", "/health", "/api/health"], async (req, res) => {
    const checks = { database: "connected", storage: "connected" };
    try {
        await sequelize.authenticate();
    } catch (error) {
        checks.database = "unavailable";
        logger.error("readiness_check_failed", {
            requestId: req.requestId,
            dependency: "database",
            error: error.message
        });
    }
    try {
        await objectStorage.checkHealth();
    } catch (error) {
        checks.storage = "unavailable";
        logger.error("readiness_check_failed", {
            requestId: req.requestId,
            dependency: "storage",
            error: error.message
        });
    }
    const status = Object.values(checks).every((check) => check === "connected") ? 200 : 503;
    res.set("Cache-Control", "no-store").status(status).json({
        status: status === 200 ? "ok" : "unavailable",
        checks
    });
});

app.get("/", (req, res) => {
    res.json({
        message: "SmartCampus API is running successfully"
    });
});

app.use("/api/internal", internalRoutes);
app.use("/api/search", searchRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/privacy", privacyRoutes);
app.use("/api/courses", courseRoutes);
app.use("/api/downloads", downloadRoutes);
app.use("/api/audit", auditRoutes);
app.use("/api/enrollments", enrollmentRoutes);
app.use("/api/lessons", lessonRoutes);
app.use("/api/quizzes", quizRoutes);
app.use("/api/assignments", assignmentRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/ai", aiRoutes);
app.use("/api/feedback", feedbackRoutes);
app.use("/api/chat", chatRoutes);
app.use("/api/uploads", uploadRoutes);
app.use("/api/reports", reportRoutes);
app.use("/api", lmsRoutes);

app.use((req, res) => {
    res.status(404).json({ message: "Route not found", requestId: req.requestId });
});

app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);

    if (err.message === "Invalid file type") {
        return res.status(400).json({ message: err.message });
    }

    if (err.code === "LIMIT_FILE_SIZE") {
        return res.status(400).json({
            message: process.env.VERCEL
                ? "File too large (max 4MB on Vercel)"
                : "File too large (max 20MB)"
        });
    }

    if (err.type === "entity.too.large") {
        return res.status(413).json({ message: "Request body is too large" });
    }

    if (err instanceof SyntaxError && err.status === 400 && "body" in err) {
        return res.status(400).json({ message: "Invalid JSON body" });
    }

    const requestId = req.requestId || randomUUID();
    logger.error("request_failed", {
        requestId,
        method: req.method,
        path: req.path,
        error: err.message,
        ...(process.env.NODE_ENV === "development" ? { stack: err.stack } : {})
    });
    res.status(500).json({ message: "Internal server error", requestId });
});

module.exports = app;
