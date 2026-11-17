const termsVersion = "2026-11-11";

module.exports = (req, res, next) => {
    const origin = typeof req.get === "function" ? req.get("origin") : req.headers?.origin;
    if (!origin || origin === "null" ||
        req.headers?.["x-smartcampus-client"] === "mobile") {
        return next();
    }

    const acceptedVersion = typeof req.get === "function"
        ? req.get("x-smartcampus-terms-version")
        : req.headers?.["x-smartcampus-terms-version"];
    if (acceptedVersion !== termsVersion) {
        return res.status(428).json({
            message: "Review and accept the current Terms and Conditions before signing in or registering.",
            termsVersion
        });
    }
    return next();
};
