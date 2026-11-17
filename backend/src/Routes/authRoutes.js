const express = require("express");
const { rateLimit, ipKeyGenerator } = require("express-rate-limit");
const crypto = require("node:crypto");
const router = express.Router();

const authController = require("../controllers/authController");
const academicController = require("../controllers/academicController");
const authMiddleware = require("../middlewares/authMiddleware");
const requireTermsConsent = require("../middlewares/requireTermsConsent");
const PostgresRateLimitStore = require("../utils/PostgresRateLimitStore");
require("../models/RateLimitBucket");
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    store: new PostgresRateLimitStore(),
    standardHeaders: true,
    legacyHeaders: false,
    skip: () => process.env.NODE_ENV !== "production",
    message: { message: "Too many authentication attempts. Try again later." }
});
const loginAccountLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 8,
    store: new PostgresRateLimitStore(),
    keyGenerator: (req) => {
        const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
        return crypto.createHash("sha256")
            .update(`${ipKeyGenerator(req.ip)}:${email.slice(0, 254) || "unknown-account"}`)
            .digest("hex");
    },
    standardHeaders: true,
    legacyHeaders: false,
    skip: () => process.env.NODE_ENV !== "production",
    message: { message: "Too many sign-in attempts for this account and network. Try again later." }
});

/*
  AUTH ROUTES
*/
router.get("/config", authController.getAuthConfig);
router.get("/academic-catalog", academicController.listCatalog);
router.post("/register", requireTermsConsent, authLimiter, authController.register);
router.post("/email/verify", authLimiter, authController.verifyEmail);
router.post("/email/verification/resend", authLimiter, authController.resendEmailVerification);
router.post("/login", requireTermsConsent, authLimiter, loginAccountLimiter, authController.login);
router.post("/password/forgot", authLimiter, authController.requestPasswordReset);
router.post("/password/reset", authLimiter, authController.resetPassword);
router.post("/logout", authMiddleware, authController.logout);
router.post("/google/register", requireTermsConsent, authLimiter, authController.googleRegister);
router.post("/google/login", requireTermsConsent, authLimiter, loginAccountLimiter, authController.googleLogin);
router.patch("/profile", authMiddleware, authController.updateProfile);
router.patch("/password", authMiddleware, authController.updatePassword);

module.exports = router;