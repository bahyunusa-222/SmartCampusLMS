const cookieName = "smartcampus_session";
const sessionMaxAge = 6 * 60 * 60 * 1000;

const sessionCookieOptions = () => {
    const sameSite = (process.env.SESSION_COOKIE_SAME_SITE || "lax").toLowerCase();
    if (!["lax", "strict", "none"].includes(sameSite)) {
        throw new Error("SESSION_COOKIE_SAME_SITE must be lax, strict, or none.");
    }
    const secure = process.env.NODE_ENV === "production" || sameSite === "none";
    return {
        httpOnly: true,
        secure,
        sameSite,
        path: "/api",
        maxAge: sessionMaxAge
    };
};

const readSessionCookie = (header = "") => {
    for (const part of header.split(";")) {
        const separator = part.indexOf("=");
        if (separator < 0 || part.slice(0, separator).trim() !== cookieName) continue;
        const value = part.slice(separator + 1).trim();
        try {
            return decodeURIComponent(value);
        } catch {
            return null;
        }
    }
    return null;
};

const clearSessionCookie = (res) => {
    const { maxAge, ...options } = sessionCookieOptions();
    res.clearCookie(cookieName, options);
};

module.exports = {
    cookieName,
    sessionCookieOptions,
    readSessionCookie,
    clearSessionCookie
};
