const express = require("express");
const rateLimit = require("express-rate-limit");
const authMiddleware = require("../middlewares/authMiddleware");
const { search } = require("../controllers/searchController");

const router = express.Router();
const searchLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 90,
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: "Too many searches. Please wait a moment and try again." }
});

router.get("/", authMiddleware, searchLimiter, search);

module.exports = router;
