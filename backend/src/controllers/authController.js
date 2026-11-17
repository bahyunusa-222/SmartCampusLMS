const { Op } = require("sequelize");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const { sequelize } = require("../config/db");
const User = require("../models/User");
const ChatProfile = require("../models/ChatProfile");
const ChatPresence = require("../models/ChatPresence");
const EmailVerificationToken = require("../models/EmailVerificationToken");
const Course = require("../models/Course");
const School = require("../models/School");
const Department = require("../models/Department");
const sanitizeUser = require("../utils/sanitizeUser");
const { isValidJwtSecret } = require("../utils/authConfiguration");
const { hashPassword, verifyPassword, needsRehash } = require("../utils/passwordSecurity");
const { sendAppEmail } = require("../utils/emailService");
const recordSecurityEvent = require("../utils/recordSecurityEvent");
const { cookieName, sessionCookieOptions, clearSessionCookie } = require("../utils/sessionCookie");
const {
    normalizeEmail,
    normalizeName,
    normalizePhone,
    normalizeStudentId,
    validatePassword
} = require("../utils/authValidation");

require("../config/env");

const passwordRecoveryMessage = "If an eligible account exists, recovery instructions will be sent.";
const verificationMessage = "If an unverified account exists for that address, verification instructions will be sent.";

const createEmailVerification = async (user, transaction) => {
    const token = crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    await EmailVerificationToken.upsert({
        userId: user.id,
        tokenHash,
        expiresAt: new Date(Date.now() + 30 * 60 * 1000)
    }, { transaction });
    const configuredOrigin = (process.env.CLIENT_URL || "").split(",")[0].trim();
    const origin = configuredOrigin || "http://localhost:5173";
    const url = new URL("/verify-email", origin);
    if (process.env.NODE_ENV === "production" && url.protocol !== "https:") {
        throw new Error("Email verification requires an HTTPS frontend origin.");
    }
    url.hash = new URLSearchParams({ token }).toString();
    return { url: url.href };
};

const getAcademicPlacement = async (schoolId, departmentId) => {
    const parsedSchoolId = Number(schoolId);
    const parsedDepartmentId = Number(departmentId);
    if (!Number.isSafeInteger(parsedSchoolId) || parsedSchoolId <= 0 ||
        !Number.isSafeInteger(parsedDepartmentId) || parsedDepartmentId <= 0) {
        return { error: "Choose your school and department.", status: 400 };
    }

    const school = await School.findByPk(parsedSchoolId);
    if (!school) return { error: "Choose a valid school.", status: 400 };
    const department = await Department.findOne({
        where: { id: parsedDepartmentId, schoolId: parsedSchoolId }
    });
    if (!department) return { error: "Choose a department in your selected school.", status: 400 };
    return { schoolId: school.id, departmentId: department.id };
};

exports.getAuthConfig = (req, res) => {
    res.set("Cache-Control", "no-store");
    return res.json({ googleClientId: process.env.GOOGLE_CLIENT_ID || null });
};

exports.verifyEmail = async (req, res) => {
    const token = req.body.token;
    if (typeof token !== "string" || !/^[a-f0-9]{64}$/.test(token)) {
        return res.status(400).json({ message: "This verification link is invalid or has expired." });
    }
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    try {
        const verifiedUserId = await sequelize.transaction(async (transaction) => {
            const record = await EmailVerificationToken.findOne({
                where: { tokenHash, expiresAt: { [Op.gt]: new Date() } },
                transaction,
                lock: transaction.LOCK.UPDATE
            });
            if (!record) return null;
            const user = await User.findByPk(record.userId, { transaction, lock: transaction.LOCK.UPDATE });
            if (!user || user.emailVerified) {
                await record.destroy({ transaction });
                return null;
            }
            await user.update({ emailVerified: true }, { transaction });
            await record.destroy({ transaction });
            return user.id;
        });
        if (!verifiedUserId) {
            return res.status(400).json({ message: "This verification link is invalid or has expired." });
        }
        await recordSecurityEvent({ userId: verifiedUserId, eventType: "email_verified", req });
        return res.json({ message: "Email verified. You can now sign in." });
    } catch (error) {
        console.error("Email verification failed:", error.message);
        return res.status(500).json({ message: "Unable to verify your email right now." });
    }
};

exports.resendEmailVerification = async (req, res) => {
    const email = normalizeEmail(req.body.email);
    if (!email) return res.status(400).json({ message: "Enter a valid email address." });
    res.set("Cache-Control", "no-store");
    try {
        const user = await User.findOne({ where: { email, emailVerified: false } });
        if (user?.passwordLoginEnabled) {
            const verification = await createEmailVerification(user);
            await sendAppEmail({
                to: user.email,
                subject: "Verify your SmartCampus email",
                text: `Hello ${user.fullName},\n\nVerify your email address by opening this link:\n${verification.url}\n\nThis link expires in 30 minutes. If you did not create this account, you can ignore this message.`
            });
            await recordSecurityEvent({ userId: user.id, eventType: "email_verification_resent", req });
        }
        return res.status(202).json({ message: verificationMessage });
    } catch (error) {
        console.error("Email verification request failed:", error.message);
        return res.status(202).json({ message: verificationMessage });
    }
};

const getResetDeliveryConfig = () => {
    if (process.env.NODE_ENV === "development") {
        return { development: true };
    }

    const deliveryUrl = process.env.PASSWORD_RESET_DELIVERY_URL;
    const deliverySecret = process.env.PASSWORD_RESET_DELIVERY_SECRET;
    const resetPageUrl = process.env.PASSWORD_RESET_PAGE_URL;
    if (!deliveryUrl || !deliverySecret || deliverySecret.length < 32 || !resetPageUrl) {
        return null;
    }

    try {
        const delivery = new URL(deliveryUrl);
        const resetPage = new URL(resetPageUrl);
        if (!["http:", "https:"].includes(delivery.protocol) ||
            !["http:", "https:"].includes(resetPage.protocol) ||
            delivery.username || delivery.password || resetPage.username || resetPage.password ||
            (process.env.NODE_ENV !== "development" &&
                (delivery.protocol !== "https:" || resetPage.protocol !== "https:"))) {
            return null;
        }
        return { deliveryUrl: delivery.href, deliverySecret, resetPageUrl: resetPage.href };
    } catch {
        return null;
    }
};

const deliverPasswordReset = async (delivery, email, token) => {
    let resetUrl = null;
    if (token) {
        const resetPageUrl = delivery.resetPageUrl ||
            process.env.PASSWORD_RESET_PAGE_URL ||
            `${(process.env.CLIENT_URL || "http://localhost:5173").split(",")[0].trim()}/login`;
        const url = new URL(resetPageUrl);
        url.hash = new URLSearchParams({ resetToken: token }).toString();
        resetUrl = url.href;
    }

    if (delivery.development) {
        if (token) {
            await sendAppEmail({
                to: email,
                subject: "Reset your SmartCampus password",
                text: `Use this link to reset your password:\n${resetUrl}\n\nThe link expires in 30 minutes. If you did not request a reset, you can ignore this message.`
            });
        }
        return;
    }

    const response = await fetch(delivery.deliveryUrl, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "X-Reset-Delivery-Secret": delivery.deliverySecret
        },
        body: JSON.stringify({
            type: "password_reset",
            email,
            resetUrl,
            expiresInMinutes: 30
        }),
        redirect: "error",
        signal: AbortSignal.timeout(10000)
    });
    if (!response.ok) {
        throw new Error("Password reset delivery endpoint rejected the request");
    }
};

const issueSession = (user, req, res, statusCode = 200) => {
    if (!isValidJwtSecret(process.env.JWT_SECRET)) {
        console.error("JWT_SECRET is not configured");
        return res.status(500).json({ message: "Authentication is not configured" });
    }

    res.set("Cache-Control", "no-store");
    const token = jwt.sign(
        { id: user.id, role: user.role, tokenVersion: user.tokenVersion ?? 0 },
        process.env.JWT_SECRET,
        { expiresIn: "6h" }
    );
    res.cookie(cookieName, token, sessionCookieOptions());

    const response = {
        message: "Login successful",
        user: sanitizeUser(user)
    };
    const requestHeader = (name) => typeof req.get === "function"
        ? req.get(name)
        : req.headers?.[name.toLowerCase()];
    if (!requestHeader("origin") || requestHeader("x-smartcampus-client") === "mobile") {
        response.token = token;
    }
    return res.status(statusCode).json(response);
};

const verifyGoogleCredential = async (credential) => {
    if (typeof credential !== "string" || !credential || credential.length > 10000) {
        return { error: "A valid Google credential is required", status: 400 };
    }
    if (!process.env.GOOGLE_CLIENT_ID) {
        console.error("GOOGLE_CLIENT_ID is not configured");
        return { error: "Google sign-in is not configured", status: 503 };
    }

    let response;
    for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
            response = await fetch(
                `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`,
                { signal: AbortSignal.timeout(10000) }
            );
            break;
        } catch (error) {
            const transientNetworkError = error.name === "TimeoutError" ||
                error.name === "AbortError" || error instanceof TypeError;
            if (!transientNetworkError) throw error;
            if (attempt === 1) {
                console.error("Google credential verification could not reach Google:", error.name);
                return {
                    error: "Google sign-in verification timed out. Check the backend's internet connection and try again.",
                    status: 503
                };
            }
        }
    }

    if (!response.ok) {
        return { error: "Google sign-in could not verify your account", status: 401 };
    }

    const claims = await response.json();
    const expiresAt = Number(claims.exp);
    if (claims.aud !== process.env.GOOGLE_CLIENT_ID ||
        !["accounts.google.com", "https://accounts.google.com"].includes(claims.iss) ||
        !(claims.email_verified === true || claims.email_verified === "true") ||
        !Number.isFinite(expiresAt) || expiresAt * 1000 <= Date.now()) {
        return { error: "Use an active, verified Google account", status: 401 };
    }

    if (typeof claims.sub !== "string" || !claims.sub) {
        return { error: "Google did not provide a valid account identifier", status: 401 };
    }

    const email = normalizeEmail(claims.email);
    if (!email) {
        return { error: "Google did not provide a valid email address", status: 401 };
    }

    const fullName = normalizeName(claims.name);
    if (!fullName) {
        return { error: "Your Google account must include your full name", status: 400 };
    }

    return { email, fullName, googleId: claims.sub };
};

exports.register = async (req, res) => {
    try {
        const { fullName, email, password, confirmPassword, role, matNumber, phone, schoolId, departmentId } = req.body;
        const normalizedName = normalizeName(fullName);
        const normalizedEmail = normalizeEmail(email);
        if (!normalizedName || !normalizedEmail || !validatePassword(password) ||
            !["student", "lecturer"].includes(role)) {
            return res.status(400).json({
                message: "Enter a valid name, email, password (12-128 characters), and account type."
            });
        }
        if (password !== confirmPassword) {
            return res.status(400).json({ message: "The passwords do not match." });
        }

        let normalizedMatNumber = null;
        let normalizedPhone = null;
        if (role === "student") {
            normalizedMatNumber = normalizeStudentId(matNumber);
            const phoneProvided = phone !== undefined && phone !== null && phone !== "";
            normalizedPhone = phoneProvided ? normalizePhone(phone) : null;
            if (!normalizedMatNumber || (phoneProvided && !normalizedPhone)) {
                return res.status(400).json({
                    message: "Enter a valid student ID number and, if provided, a valid phone number."
                });
            }
        }

        const placement = await getAcademicPlacement(schoolId, departmentId);
        if (placement.error) return res.status(placement.status).json({ message: placement.error });

        const existingUser = await User.findOne({ where: { email: normalizedEmail } });
        if (existingUser) {
            return res.status(409).json({ message: "An account with this email already exists" });
        }

        const hashedPassword = await hashPassword(password);
        let verification;
        const user = await sequelize.transaction(async (transaction) => {
            const createdUser = await User.create({
                fullName: normalizedName,
                email: normalizedEmail,
                password: hashedPassword,
                passwordLoginEnabled: true,
                emailVerified: false,
                role,
                schoolId: placement.schoolId,
                departmentId: placement.departmentId,
                matNumber: role === "student" ? normalizedMatNumber : null,
                phone: role === "student" ? normalizedPhone : null
            }, { transaction });
            verification = await createEmailVerification(createdUser, transaction);
            return createdUser;
        });

        try {
            await sendAppEmail({
                to: user.email,
                subject: "Verify your SmartCampus email",
                text: `Hello ${user.fullName},\n\nVerify your email address by opening this link:\n${verification.url}\n\nThis link expires in 30 minutes. If you did not create this account, you can ignore this message.`
            });
        } catch (error) {
            console.error("Email verification delivery failed:", error.message);
            await recordSecurityEvent({ userId: user.id, eventType: "email_verification_delivery_failed", req });
            res.set("Cache-Control", "no-store");
            return res.status(202).json({
                message: "Your account was created. You can sign in now; email verification is optional.",
                verificationRequired: false
            });
        }
        await recordSecurityEvent({ userId: user.id, eventType: "account_registered", req });
        res.set("Cache-Control", "no-store");
        return res.status(201).json({
            message: "Account created. You can sign in now; email verification is optional.",
            verificationRequired: false
        });
    } catch (error) {
        if (error.name === "SequelizeUniqueConstraintError") {
            return res.status(409).json({ message: "An account with this email already exists" });
        }
        console.error("Registration failed:", error.name);
        return res.status(500).json({ message: "Registration failed" });
    }
};

exports.googleRegister = async (req, res) => {
    try {
        const { credential, role, fullName, matNumber, phone, schoolId, departmentId } = req.body;
        if (!["student", "lecturer"].includes(role)) {
            return res.status(400).json({ message: "Choose a valid account type" });
        }

        const googleAccount = await verifyGoogleCredential(credential);
        if (googleAccount.error) {
            return res.status(googleAccount.status).json({ message: googleAccount.error });
        }

        const existingUser = await User.findOne({ where: { email: googleAccount.email } });
        if (existingUser) {
            if (existingUser.googleId && existingUser.googleId !== googleAccount.googleId) {
                return res.status(401).json({ message: "This Google account could not be verified for the existing profile." });
            }
            if (!existingUser.googleId) {
                existingUser.googleId = googleAccount.googleId;
            }
            existingUser.emailVerified = true;
            await existingUser.save();
            return issueSession(existingUser, req, res);
        }

        const normalizedName = role === "student" ? normalizeName(fullName) : googleAccount.fullName;
        const hasStudentId = role !== "student" || Boolean(normalizeStudentId(matNumber));
        if (!normalizedName || !schoolId || !departmentId || !hasStudentId) {
            return res.status(428).json({
                message: "Add your school and department details to finish creating your account.",
                profileRequired: true,
                profile: { email: googleAccount.email, fullName: googleAccount.fullName }
            });
        }

        const placement = await getAcademicPlacement(schoolId, departmentId);
        if (placement.error) {
            return res.status(428).json({
                message: placement.error,
                profileRequired: true,
                profile: { email: googleAccount.email, fullName: googleAccount.fullName }
            });
        }
        let normalizedMatNumber = null;
        let normalizedPhone = null;
        if (role === "student") {
            normalizedMatNumber = normalizeStudentId(matNumber);
            const phoneProvided = phone !== undefined && phone !== null && phone !== "";
            normalizedPhone = phoneProvided ? normalizePhone(phone) : null;
            if (!normalizedMatNumber || (phoneProvided && !normalizedPhone)) {
                return res.status(400).json({
                    message: "Enter a valid student ID number and, if provided, a valid phone number."
                });
            }
        }

        const hashedPassword = await hashPassword(crypto.randomBytes(32).toString("hex"));
        const user = await User.create({
            fullName: normalizedName,
            email: googleAccount.email,
            googleId: googleAccount.googleId,
            passwordLoginEnabled: false,
            emailVerified: true,
            password: hashedPassword,
            role,
            schoolId: placement.schoolId,
            departmentId: placement.departmentId,
            matNumber: role === "student" ? normalizedMatNumber : null,
            phone: role === "student" ? normalizedPhone : null
        });

        return issueSession(user, req, res, 201);
    } catch (error) {
        if (error.name === "SequelizeUniqueConstraintError") {
            return res.status(409).json({ message: "An account with this email already exists" });
        }
        console.error("Registration failed:", error.name);
        return res.status(500).json({ message: "Registration failed" });
    }
};

exports.googleLogin = async (req, res) => {
    try {
        const { credential, role } = req.body;
        if (role !== undefined && !["student", "lecturer"].includes(role)) {
            return res.status(400).json({ message: "Choose a valid account type" });
        }

        const googleAccount = await verifyGoogleCredential(credential);
        if (googleAccount.error) {
            return res.status(googleAccount.status).json({ message: googleAccount.error });
        }

        const user = await User.findOne({
            where: {
                [Op.or]: [
                    { googleId: googleAccount.googleId },
                    { email: googleAccount.email }
                ]
            }
        });
        if (!user || (role && user.role !== role) ||
            (user.googleId && user.googleId !== googleAccount.googleId)) {
            return res.status(401).json({ message: "No account was found for this Google email" });
        }

        if (!user.googleId) user.googleId = googleAccount.googleId;
        if (!user.emailVerified) user.emailVerified = true;
        await user.save();

        return issueSession(user, req, res);
    } catch (error) {
        console.error("Google login failed:", error.name);
        return res.status(500).json({ message: "Google login failed" });
    }
};

exports.login = async (req, res) => {
    try {
        const { email, password, role } = req.body;
        const normalizedEmail = normalizeEmail(email);
        if (!normalizedEmail || typeof password !== "string" || !password ||
            Buffer.byteLength(password, "utf8") > 1024) {
            return res.status(400).json({ message: "Enter a valid email and password" });
        }
        if (role !== undefined && !["student", "lecturer"].includes(role)) {
            return res.status(400).json({ message: "Choose a valid account type" });
        }

        const user = await User.unscoped().findOne({ where: { email: normalizedEmail } });

        if (!user || (role && user.role !== role)) {
            await recordSecurityEvent({
                userId: user?.id || null,
                eventType: "login_failed",
                req,
                metadata: { reason: "invalid_credentials" }
            });
            return res.status(401).json({ message: "Invalid email or password" });
        }
        if (!user.passwordLoginEnabled) {
            await recordSecurityEvent({ userId: user.id, eventType: "login_failed", req });
            return res.status(401).json({ message: "Invalid email or password" });
        }

        const isMatch = await verifyPassword(password, user.password);

        if (!isMatch) {
            await recordSecurityEvent({
                userId: user.id,
                eventType: "login_failed",
                req,
                metadata: { reason: "invalid_credentials" }
            });
            return res.status(401).json({ message: "Invalid email or password" });
        }

        if (needsRehash(user.password)) {
            user.password = await hashPassword(password);
            await user.save();
        }
        await recordSecurityEvent({ userId: user.id, eventType: "login_succeeded", req });
        return issueSession(user, req, res);

    } catch (error) {
        console.error("Login failed:", error.name);
        return res.status(500).json({ message: "Login failed" });
    }
};

exports.requestPasswordReset = async (req, res) => {
    const email = normalizeEmail(req.body.email);
    if (!email) {
        return res.status(400).json({ message: "Enter a valid email address" });
    }

    const delivery = getResetDeliveryConfig();
    if (!delivery) {
        return res.status(503).json({ message: "Password recovery is temporarily unavailable." });
    }

    res.set("Cache-Control", "no-store");
    const token = crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    let user;
    try {
        user = await User.findOne({ where: { email } });
        if (user?.passwordLoginEnabled && user.emailVerified !== false) {
            user.passwordResetTokenHash = tokenHash;
            user.passwordResetExpiresAt = new Date(Date.now() + 30 * 60 * 1000);
            await user.save();
        }

        if (user?.passwordLoginEnabled && user.emailVerified !== false) {
            await deliverPasswordReset(delivery, email, token);
        }
        await recordSecurityEvent({
            userId: user?.passwordLoginEnabled ? user.id : null,
            eventType: "password_reset_requested",
            req
        });
        return res.status(202).json({
            message: passwordRecoveryMessage
        });
    } catch {
        if (user?.passwordLoginEnabled) {
            try {
                await User.update({
                    passwordResetTokenHash: null,
                    passwordResetExpiresAt: null
                }, {
                    where: { id: user.id, passwordResetTokenHash: tokenHash }
                });
            } catch {
                console.error("Failed to invalidate an undelivered password reset token");
            }
        }
        console.error("Password reset request could not be completed");
        return res.status(202).json({ message: passwordRecoveryMessage });
    }
};

exports.resetPassword = async (req, res) => {
    try {
        res.set("Cache-Control", "no-store");
        const { token, newPassword, confirmPassword } = req.body;
        if (typeof token !== "string" || !/^[a-f0-9]{64}$/.test(token) ||
            !validatePassword(newPassword)) {
            return res.status(400).json({ message: "A valid reset token and new password are required." });
        }
        if (newPassword !== confirmPassword) {
            return res.status(400).json({ message: "The new passwords do not match." });
        }

        const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
        const user = await User.findOne({
            where: {
                passwordResetTokenHash: tokenHash,
                passwordResetExpiresAt: { [Op.gt]: new Date() }
            }
        });
        if (!user?.passwordLoginEnabled) {
            return res.status(400).json({ message: "This reset link is invalid or has expired." });
        }

        const password = await hashPassword(newPassword);
        const [updated] = await User.update({
            password,
            passwordResetTokenHash: null,
            passwordResetExpiresAt: null,
            tokenVersion: User.sequelize.literal("tokenVersion + 1")
        }, {
            validate: false,
            where: {
                id: user.id,
                passwordResetTokenHash: tokenHash,
                passwordResetExpiresAt: { [Op.gt]: new Date() }
            }
        });
        if (!updated) {
            return res.status(400).json({ message: "This reset link is invalid or has expired." });
        }

        await recordSecurityEvent({ userId: user.id, eventType: "password_reset_completed", req });
        return res.json({ message: "Password reset successfully. Please log in again." });
    } catch (error) {
        console.error("Password reset failed:", error.name);
        return res.status(500).json({ message: "Unable to reset password right now." });
    }
};

exports.logout = async (req, res) => {
    try {
        const user = await User.findByPk(req.user.id);
        if (!user) {
            return res.status(401).json({ message: "User no longer exists" });
        }
        await user.increment("tokenVersion");
        const chatProfile = await ChatProfile.findOne({
            where: { userId: user.id },
            attributes: ["id"]
        });
        if (chatProfile) {
            await ChatPresence.destroy({ where: { profileId: chatProfile.id } });
        }
        clearSessionCookie(res);
        return res.json({ message: "Logged out successfully" });
    } catch (error) {
        console.error("Logout failed:", error.name);
        return res.status(500).json({ message: "Unable to log out right now." });
    }
};

exports.updateProfile = async (req, res) => {
    try {
        const { fullName, email, phone, matNumber, schoolId, departmentId, currentPassword } = req.body;
        const normalizedName = normalizeName(fullName);
        const normalizedEmail = normalizeEmail(email);
        if (!normalizedName || !normalizedEmail) {
            return res.status(400).json({ message: "Name and email are required" });
        }

        const existingUser = await User.findOne({
            where: {
                email: normalizedEmail,
                id: { [Op.ne]: req.user.id }
            }
        });
        if (existingUser) {
            return res.status(409).json({ message: "An account with this email already exists" });
        }

        const user = await User.findByPk(req.user.id);
        if (!user) {
            return res.status(404).json({ message: "User not found" });
        }
        if (user.googleId && normalizedEmail !== user.email) {
            return res.status(400).json({
                message: "The email address on a Google account cannot be changed here."
            });
        }
        const emailChanged = normalizedEmail !== user.email;
        if (emailChanged) {
            if (!user.passwordLoginEnabled || typeof currentPassword !== "string" ||
                Buffer.byteLength(currentPassword, "utf8") > 1024) {
                return res.status(400).json({ message: "Enter your current password to change your email address." });
            }
            const credentialUser = await User.unscoped().findByPk(req.user.id);
            if (!credentialUser || !await verifyPassword(currentPassword, credentialUser.password)) {
                return res.status(400).json({ message: "Current password is incorrect." });
            }
        }

        let placement;
        if (schoolId !== undefined || departmentId !== undefined) {
            placement = await getAcademicPlacement(schoolId, departmentId);
            if (placement.error) return res.status(placement.status).json({ message: placement.error });
        }

        user.fullName = normalizedName;
        if (normalizedEmail !== user.email) {
            user.passwordResetTokenHash = null;
            user.passwordResetExpiresAt = null;
        }
        user.email = normalizedEmail;
        if (emailChanged) user.emailVerified = false;
        if (placement) {
            user.schoolId = placement.schoolId;
            user.departmentId = placement.departmentId;
        }
        if (user.role === "student") {
            const normalizedMatNumber = normalizeStudentId(matNumber);
            const phoneProvided = phone !== undefined && phone !== null && phone !== "";
            const normalizedPhone = phoneProvided ? normalizePhone(phone) : null;
            if (!normalizedMatNumber || (phoneProvided && !normalizedPhone)) {
                return res.status(400).json({
                    message: "Enter a valid student ID number and, if provided, a valid phone number."
                });
            }
            user.matNumber = normalizedMatNumber;
            user.phone = normalizedPhone;
        }
        let verification;
        await sequelize.transaction(async (transaction) => {
            await user.save({ transaction });
            if (emailChanged) verification = await createEmailVerification(user, transaction);
            if (placement && user.role === "lecturer") {
                await Course.update(
                    { schoolId: placement.schoolId },
                    { where: { lecturerId: user.id, schoolId: null, departmentId: null }, transaction }
                );
            }
        });

        let message = "Profile updated successfully";
        if (emailChanged) {
            try {
                await sendAppEmail({
                    to: user.email,
                    subject: "Verify your new SmartCampus email",
                    text: `Hello ${user.fullName},\n\nVerify your new email address by opening this link:\n${verification.url}\n\nThis link expires in 30 minutes.`
                });
                message = "Profile updated. Verify your new email address before your next sign-in.";
            } catch (error) {
                console.error("Email-change verification delivery failed:", error.name);
                message = "Profile updated, but verification email delivery failed. Request a verification email before signing in again.";
            }
            await recordSecurityEvent({ userId: user.id, eventType: "email_change_requested", req });
        }

        return res.json({
            message,
            user: sanitizeUser(user)
        });
    } catch (error) {
        if (error.name === "SequelizeUniqueConstraintError") {
            return res.status(409).json({ message: "An account with this email already exists" });
        }
        console.error("Failed to update profile:", error.name);
        return res.status(500).json({ message: "Failed to update profile" });
    }
};

exports.updatePassword = async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;
        if (typeof currentPassword !== "string" || !currentPassword ||
            typeof newPassword !== "string" || !newPassword) {
            return res.status(400).json({ message: "Current and new passwords are required" });
        }

        if (Buffer.byteLength(currentPassword, "utf8") > 1024) {
            return res.status(400).json({ message: "Current password is invalid" });
        }
        if (!validatePassword(newPassword)) {
            return res.status(400).json({ message: "Use a password of 12-128 characters that is not on the common-password blocklist." });
        }

        const user = await User.unscoped().findByPk(req.user.id);
        if (!user) {
            return res.status(404).json({ message: "User not found" });
        }
        if (!user.passwordLoginEnabled) {
            return res.status(400).json({
                message: "This account uses Google sign-in and does not have a password to change."
            });
        }

        const matches = await verifyPassword(currentPassword, user.password);
        if (!matches) {
            return res.status(400).json({ message: "Current password is incorrect" });
        }

        user.password = await hashPassword(newPassword);
        user.tokenVersion = (user.tokenVersion ?? 0) + 1;
        user.passwordResetTokenHash = null;
        user.passwordResetExpiresAt = null;
        await user.save();
        await recordSecurityEvent({ userId: user.id, eventType: "password_changed", req });
        return res.json({ message: "Password updated successfully. Please log in again." });
    } catch (error) {
        console.error("Failed to update password:", error.message);
        return res.status(500).json({ message: "Failed to update password" });
    }
};
