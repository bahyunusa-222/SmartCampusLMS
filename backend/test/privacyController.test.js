process.env.DB_HOST = "127.0.0.1";
process.env.DB_NAME = "test";
process.env.DB_USER = "test";
process.env.DB_PASSWORD = "test";

const { afterEach, test } = require("node:test");
const assert = require("node:assert/strict");
const User = require("../src/models/User");
const Enrollment = require("../src/models/Enrollment");
const Submission = require("../src/models/Submission");
const LessonProgress = require("../src/models/LessonProgress");
const QuizAttempt = require("../src/models/QuizAttempt");
const PrivacyRequest = require("../src/models/PrivacyRequest");
const PrivacyConsent = require("../src/models/PrivacyConsent");
const SecurityEvent = require("../src/models/SecurityEvent");
const privacyController = require("../src/controllers/privacyController");

const originals = {
    userFindByPk: User.findByPk,
    enrollmentFindAll: Enrollment.findAll,
    submissionFindAll: Submission.findAll,
    progressFindAll: LessonProgress.findAll,
    quizAttemptFindAll: QuizAttempt.findAll,
    requestFindAll: PrivacyRequest.findAll,
    requestCreate: PrivacyRequest.create,
    consentFindAll: PrivacyConsent.findAll,
    consentFindOne: PrivacyConsent.findOne,
    consentCreate: PrivacyConsent.create,
    securityCreate: SecurityEvent.create
};

afterEach(() => {
    User.findByPk = originals.userFindByPk;
    Enrollment.findAll = originals.enrollmentFindAll;
    Submission.findAll = originals.submissionFindAll;
    LessonProgress.findAll = originals.progressFindAll;
    QuizAttempt.findAll = originals.quizAttemptFindAll;
    PrivacyRequest.findAll = originals.requestFindAll;
    PrivacyRequest.create = originals.requestCreate;
    PrivacyConsent.findAll = originals.consentFindAll;
    PrivacyConsent.findOne = originals.consentFindOne;
    PrivacyConsent.create = originals.consentCreate;
    SecurityEvent.create = originals.securityCreate;
});

const response = () => ({
    statusCode: 200,
    headers: {},
    status(code) { this.statusCode = code; return this; },
    set(name, value) { this.headers[name] = value; return this; },
    json(body) { this.body = body; return this; }
});

test("privacy export is scoped to the signed-in user and omits object URLs and credentials", async () => {
    const userId = 42;
    const seen = {};
    User.findByPk = async (id, options) => {
        seen.user = { id, options };
        return { id, fullName: "Student", email: "student@example.edu" };
    };
    const userScopedList = (name) => async (options) => {
        seen[name] = options;
        return [];
    };
    Enrollment.findAll = userScopedList("enrollments");
    Submission.findAll = userScopedList("submissions");
    LessonProgress.findAll = userScopedList("progress");
    QuizAttempt.findAll = userScopedList("attempts");
    PrivacyRequest.findAll = userScopedList("requests");
    PrivacyConsent.findAll = userScopedList("consents");
    SecurityEvent.create = async () => {};
    const res = response();

    await privacyController.exportPersonalData({ user: { id: userId } }, res);

    assert.equal(res.statusCode, 200);
    for (const key of ["enrollments", "submissions", "progress", "attempts", "requests", "consents"]) {
        assert.deepEqual(seen[key].where, key === "requests" || key === "consents"
            ? { userId }
            : { studentId: userId });
    }
    assert.ok(!seen.user.options.attributes.includes("password"));
    assert.ok(!seen.submissions.attributes.includes("fileUrl"));
    assert.equal(res.headers["Cache-Control"], "private, no-store");
    assert.deepEqual(res.body.data.profile, {
        id: userId,
        fullName: "Student",
        email: "student@example.edu"
    });
});

test("privacy requests are created for the authenticated user with no invented response deadline", async () => {
    let values;
    PrivacyRequest.create = async (input) => {
        values = input;
        return { id: 8, ...input, submittedAt: new Date("2026-01-01T00:00:00.000Z") };
    };
    SecurityEvent.create = async () => {};
    const res = response();

    await privacyController.createRequest({
        user: { id: 42 },
        body: { category: "erasure", details: " Please review my request. " }
    }, res);

    assert.equal(res.statusCode, 201);
    assert.equal(values.userId, 42);
    assert.equal(values.details, "Please review my request.");
    assert.equal(values.responseDueAt, null);
    assert.equal(values.status, "received");
});

test("optional consent updates record a versioned withdrawal", async () => {
    let values;
    PrivacyConsent.findOne = async () => ({ granted: true, policyVersion: "1" });
    PrivacyConsent.create = async (input) => { values = input; };
    SecurityEvent.create = async () => {};
    const res = response();

    await privacyController.setConsent({
        user: { id: 42 },
        body: { purpose: "optional_analytics", granted: false }
    }, res);

    assert.equal(values.userId, 42);
    assert.equal(values.granted, false);
    assert.equal(values.policyVersion, process.env.PRIVACY_POLICY_VERSION || "1");
    assert.equal(res.body.granted, false);
});
