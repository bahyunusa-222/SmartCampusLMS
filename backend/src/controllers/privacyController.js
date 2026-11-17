const User = require("../models/User");
const Enrollment = require("../models/Enrollment");
const Submission = require("../models/Submission");
const LessonProgress = require("../models/LessonProgress");
const QuizAttempt = require("../models/QuizAttempt");
const PrivacyRequest = require("../models/PrivacyRequest");
const PrivacyConsent = require("../models/PrivacyConsent");
const recordSecurityEvent = require("../utils/recordSecurityEvent");

const requestCategories = new Set([
    "access",
    "correction",
    "erasure",
    "restriction",
    "portability",
    "objection"
]);
const optionalPurposes = new Set(["product_communications", "optional_analytics"]);

exports.listRequests = async (req, res) => {
    try {
        const requests = await PrivacyRequest.findAll({
            where: { userId: req.user.id },
            attributes: ["id", "category", "details", "status", "submittedAt", "responseDueAt", "completedAt"],
            order: [["submittedAt", "DESC"]]
        });
        return res.json({ requests });
    } catch (error) {
        console.error("Could not load privacy requests:", error.message);
        return res.status(500).json({ message: "Unable to load your privacy requests." });
    }
};

exports.createRequest = async (req, res) => {
    const { category, details } = req.body;
    if (!requestCategories.has(category) ||
        (details !== undefined && (typeof details !== "string" || details.length > 2000))) {
        return res.status(400).json({ message: "Choose a valid request type and keep details under 2,000 characters." });
    }
    try {
        const request = await PrivacyRequest.create({
            userId: req.user.id,
            category,
            details: details?.trim() || null,
            status: "received",
            responseDueAt: null
        });
        await recordSecurityEvent({
            userId: req.user.id,
            eventType: "privacy_request_created",
            req,
            metadata: { category }
        });
        return res.status(201).json({
            message: "Your request was received. It will be reviewed through the institution's approved process.",
            request: {
                id: request.id,
                category: request.category,
                status: request.status,
                submittedAt: request.submittedAt,
                responseDueAt: request.responseDueAt
            }
        });
    } catch (error) {
        console.error("Could not create privacy request:", error.message);
        return res.status(500).json({ message: "Unable to submit your privacy request." });
    }
};

exports.getConsents = async (req, res) => {
    try {
        const records = await PrivacyConsent.findAll({
            where: { userId: req.user.id },
            attributes: ["purpose", "granted", "policyVersion", "recordedAt"],
            order: [["recordedAt", "ASC"]]
        });
        const current = {};
        for (const record of records) current[record.purpose] = record;
        return res.json({
            policyVersion: process.env.PRIVACY_POLICY_VERSION || "1",
            consents: current
        });
    } catch (error) {
        console.error("Could not load privacy preferences:", error.message);
        return res.status(500).json({ message: "Unable to load your privacy preferences." });
    }
};

exports.setConsent = async (req, res) => {
    const { purpose, granted } = req.body;
    if (!optionalPurposes.has(purpose) || typeof granted !== "boolean") {
        return res.status(400).json({ message: "Choose a supported optional purpose and a consent state." });
    }
    const policyVersion = process.env.PRIVACY_POLICY_VERSION || "1";
    try {
        const latest = await PrivacyConsent.findOne({
            where: { userId: req.user.id, purpose },
            order: [["recordedAt", "DESC"]]
        });
        if (!latest || latest.granted !== granted || latest.policyVersion !== policyVersion) {
            await PrivacyConsent.create({
                userId: req.user.id,
                purpose,
                granted,
                policyVersion
            });
        }
        await recordSecurityEvent({
            userId: req.user.id,
            eventType: granted ? "optional_consent_granted" : "optional_consent_withdrawn",
            req,
            metadata: { purpose, policyVersion }
        });
        return res.json({ purpose, granted, policyVersion });
    } catch (error) {
        console.error("Could not update privacy preference:", error.message);
        return res.status(500).json({ message: "Unable to update your privacy preference." });
    }
};

exports.exportPersonalData = async (req, res) => {
    try {
        const [user, enrollments, submissions, lessonProgress, quizAttempts, privacyRequests, privacyConsents] =
            await Promise.all([
                User.findByPk(req.user.id, {
                    attributes: ["id", "fullName", "email", "emailVerified", "role", "matNumber", "phone", "schoolId", "departmentId", "createdAt", "updatedAt"]
                }),
                Enrollment.findAll({
                    where: { studentId: req.user.id },
                    attributes: ["id", "courseId", "canPostAnnouncements", "announcementRoleName", "permissionRole", "createdAt"]
                }),
                Submission.findAll({
                    where: { studentId: req.user.id },
                    attributes: ["id", "assignmentId", "fileName", "answerText", "grade", "feedback", "createdAt", "updatedAt"]
                }),
                LessonProgress.findAll({
                    where: { studentId: req.user.id },
                    attributes: ["id", "lessonId", "completedAt", "readingPosition", "readingProgress", "lastReadAt", "createdAt", "updatedAt"]
                }),
                QuizAttempt.findAll({
                    where: { studentId: req.user.id },
                    attributes: ["id", "assessmentId", "startedAt", "deadlineAt", "submittedAt", "answers", "score", "totalQuestions", "totalMarks", "theoryPending", "createdAt", "updatedAt"]
                }),
                PrivacyRequest.findAll({
                    where: { userId: req.user.id },
                    attributes: ["id", "category", "details", "status", "submittedAt", "responseDueAt", "completedAt"]
                }),
                PrivacyConsent.findAll({
                    where: { userId: req.user.id },
                    attributes: ["purpose", "granted", "policyVersion", "recordedAt"]
                })
            ]);
        if (!user) return res.status(404).json({ message: "User not found." });
        await recordSecurityEvent({ userId: req.user.id, eventType: "personal_data_exported", req });
        res.set("Cache-Control", "private, no-store");
        res.set("Content-Disposition", "attachment; filename=\"smartcampus-personal-data.json\"");
        return res.json({
            exportedAt: new Date().toISOString(),
            scope: ["account profile", "course enrollments", "assignment submissions", "lesson progress", "quiz attempts", "privacy requests", "optional consent history"],
            note: "This export does not include chat history, uploaded file contents, or all institutional records.",
            data: {
                profile: user,
                enrollments,
                submissions,
                lessonProgress,
                quizAttempts,
                privacyRequests,
                privacyConsents
            }
        });
    } catch (error) {
        console.error("Could not export personal data:", error.message);
        return res.status(500).json({ message: "Unable to export your personal data." });
    }
};
