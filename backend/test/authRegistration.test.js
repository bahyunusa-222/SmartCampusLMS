process.env.DB_HOST = "127.0.0.1";
process.env.DB_NAME = "test";
process.env.DB_USER = "test";
process.env.DB_PASSWORD = "test";

const { afterEach, beforeEach, test } = require("node:test");
const assert = require("node:assert/strict");
const bcrypt = require("bcrypt");
const argon2 = require("argon2");
const crypto = require("node:crypto");
const { sequelize } = require("../src/config/db");
const User = require("../src/models/User");
const School = require("../src/models/School");
const Department = require("../src/models/Department");
const EmailVerificationToken = require("../src/models/EmailVerificationToken");
const SecurityEvent = require("../src/models/SecurityEvent");
const ChatProfile = require("../src/models/ChatProfile");
const ChatPresence = require("../src/models/ChatPresence");
const emailService = require("../src/utils/emailService");
const originalSendAppEmail = emailService.sendAppEmail;
const originalTransaction = sequelize.transaction;
emailService.sendAppEmail = async () => {};
const authController = require("../src/controllers/authController");

const originalFindOne = User.findOne;
const originalFindByPk = User.findByPk;
const originalUserUpdate = User.update;
const originalCreate = User.create;
const originalUnscoped = User.unscoped;
const originalVerificationUpsert = EmailVerificationToken.upsert;
const originalVerificationFindOne = EmailVerificationToken.findOne;
const originalSecurityEventCreate = SecurityEvent.create;
const originalSchoolFindByPk = School.findByPk;
const originalDepartmentFindOne = Department.findOne;
const originalChatProfileFindOne = ChatProfile.findOne;
const originalChatPresenceDestroy = ChatPresence.destroy;
const originalJwtSecret = process.env.JWT_SECRET;
const originalGoogleClientId = process.env.GOOGLE_CLIENT_ID;
const originalFetch = global.fetch;
process.env.JWT_SECRET = "test-jwt-secret-for-account-registration";

afterEach(() => {
    User.findOne = originalFindOne;
    User.findByPk = originalFindByPk;
    User.update = originalUserUpdate;
    User.create = originalCreate;
    User.unscoped = originalUnscoped;
    EmailVerificationToken.upsert = originalVerificationUpsert;
    EmailVerificationToken.findOne = originalVerificationFindOne;
    SecurityEvent.create = originalSecurityEventCreate;
    emailService.sendAppEmail = originalSendAppEmail;
    sequelize.transaction = originalTransaction;
    School.findByPk = originalSchoolFindByPk;
    Department.findOne = originalDepartmentFindOne;
    ChatProfile.findOne = originalChatProfileFindOne;
    ChatPresence.destroy = originalChatPresenceDestroy;
    global.fetch = originalFetch;
    if (originalJwtSecret === undefined) {
        delete process.env.JWT_SECRET;
    } else {
        process.env.JWT_SECRET = originalJwtSecret;
    }
    if (originalGoogleClientId === undefined) {
        delete process.env.GOOGLE_CLIENT_ID;
    } else {
        process.env.GOOGLE_CLIENT_ID = originalGoogleClientId;
    }
});

beforeEach(() => {
    sequelize.transaction = async (callback) => callback({ LOCK: { UPDATE: "UPDATE" } });
    User.unscoped = () => ({
        findOne: (...args) => User.findOne(...args),
        findByPk: (...args) => User.findByPk(...args)
    });
    EmailVerificationToken.upsert = async () => [];
    SecurityEvent.create = async () => {};
    School.findByPk = async (id) => ({ id: Number(id) });
    Department.findOne = async ({ where }) => ({ id: Number(where.id), schoolId: Number(where.schoolId) });
    ChatProfile.findOne = async () => null;
    ChatPresence.destroy = async () => [0];
});

const createResponse = () => ({
    statusCode: 200,
    headers: {},
    body: null,
    status(code) {
        this.statusCode = code;
        return this;
    },
    set(name, value) {
        this.headers[name] = value;
        return this;
    },
    json(body) {
        this.body = body;
        return this;
    },
    cookie(name, value, options) {
        this.cookies = { ...(this.cookies || {}), [name]: { value, options } };
        return this;
    },
    clearCookie(name, options) {
        this.clearedCookie = { name, options };
        return this;
    }
});

test("public auth config returns only the Google OAuth client ID", () => {
    process.env.GOOGLE_CLIENT_ID = "public-google-client-id";
    const response = createResponse();

    authController.getAuthConfig({}, response);

    assert.equal(response.headers["Cache-Control"], "no-store");
    assert.deepEqual(response.body, { googleClientId: "public-google-client-id" });
});

test("public auth config reports when Google sign-in is not configured", () => {
    delete process.env.GOOGLE_CLIENT_ID;
    const response = createResponse();

    authController.getAuthConfig({}, response);

    assert.deepEqual(response.body, { googleClientId: null });
});

test("logout revokes the user's session", async () => {
    let incrementedField;
    User.findByPk = async (id) => {
        assert.equal(id, 21);
        return {
            increment: async (field) => {
                incrementedField = field;
            }
        };
    };

    const response = createResponse();
    await authController.logout({ user: { id: 21 } }, response);

    assert.equal(incrementedField, "tokenVersion");
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.body, { message: "Logged out successfully" });
});

test("logout reports when the user no longer exists", async () => {
    User.findByPk = async () => null;
    const response = createResponse();

    await authController.logout({ user: { id: 21 } }, response);

    assert.equal(response.statusCode, 401);
    assert.deepEqual(response.body, { message: "User no longer exists" });
});

test("email registration creates a student account that can sign in without email verification", async () => {
    let createdUser;
    User.findOne = async ({ where }) => {
        assert.deepEqual(where, { email: "student@example.edu" });
        return null;
    };
    User.create = async (values) => {
        createdUser = values;
        return {
            id: 21,
            tokenVersion: 0,
            ...values,
            toJSON() {
                return { ...this };
            }
        };
    };

    const response = createResponse();
    await authController.register({
        body: {
            fullName: "Student Example",
            email: "Student@Example.edu",
            password: "student-password",
            confirmPassword: "student-password",
            role: "student",
            matNumber: "STU-2026",
            schoolId: "1",
            departmentId: "11"
        }
    }, response);

    assert.equal(response.statusCode, 201);
    assert.equal(response.headers["Cache-Control"], "no-store");
    assert.equal(createdUser.fullName, "Student Example");
    assert.equal(createdUser.email, "student@example.edu");
    assert.equal(createdUser.role, "student");
    assert.equal(createdUser.schoolId, 1);
    assert.equal(createdUser.departmentId, 11);
    assert.equal(createdUser.matNumber, "STU-2026");
    assert.equal(createdUser.phone, null);
    assert.equal(createdUser.passwordLoginEnabled, true);
    assert.match(createdUser.password, /^\$argon2id\$/);
    assert.equal(await argon2.verify(createdUser.password, "student-password"), true);
    assert.equal(createdUser.emailVerified, false);
    assert.equal(response.body.verificationRequired, false);
    assert.match(response.body.message, /sign in now; email verification is optional/i);
    assert.equal(response.body.token, undefined);
    assert.equal(response.body.user, undefined);
});

test("email registration creates lecturer accounts without student-only details", async () => {
    let createdUser;
    User.findOne = async ({ where }) => {
        assert.deepEqual(where, { email: "lecturer@example.edu" });
        return null;
    };
    User.create = async (values) => {
        createdUser = values;
        return {
            id: 22,
            tokenVersion: 0,
            ...values,
            toJSON() {
                return { ...this };
            }
        };
    };

    const response = createResponse();
    await authController.register({
        body: {
            fullName: "Lecturer Example",
            email: "lecturer@example.edu",
            password: "lecturer-password",
            confirmPassword: "lecturer-password",
            role: "lecturer",
            schoolId: "1",
            departmentId: "11"
        }
    }, response);

    assert.equal(response.statusCode, 201);
    assert.equal(createdUser.role, "lecturer");
    assert.equal(createdUser.matNumber, null);
    assert.equal(createdUser.phone, null);
    assert.equal(createdUser.passwordLoginEnabled, true);
    assert.match(createdUser.password, /^\$argon2id\$/);
    assert.equal(await argon2.verify(createdUser.password, "lecturer-password"), true);
    assert.equal(createdUser.emailVerified, false);
    assert.equal(response.body.verificationRequired, false);
    assert.equal(response.body.token, undefined);
});

test("email registration rejects an email that already exists regardless of input casing", async () => {
    User.findOne = async ({ where }) => {
        assert.deepEqual(where, { email: "lecturer@example.edu" });
        return { id: 22, email: "lecturer@example.edu" };
    };
    User.create = async () => assert.fail("A duplicate email must not create another account");
    const response = createResponse();

    await authController.register({
        body: {
            fullName: "Another Lecturer",
            email: " Lecturer@Example.edu ",
            password: "lecturer-password",
            confirmPassword: "lecturer-password",
            role: "lecturer",
            schoolId: "1",
            departmentId: "11"
        }
    }, response);

    assert.equal(response.statusCode, 409);
    assert.match(response.body.message, /email already exists/i);
});

test("email registration rejects mismatched password confirmation on the backend", async () => {
    User.findOne = async () => assert.fail("Mismatched passwords must be rejected before lookup");
    User.create = async () => assert.fail("Mismatched passwords must not create an account");
    const response = createResponse();

    await authController.register({
        body: {
            fullName: "Student Example",
            email: "student@example.edu",
            password: "student-password",
            confirmPassword: "different-password",
            role: "lecturer"
        }
    }, response);

    assert.equal(response.statusCode, 400);
    assert.match(response.body.message, /passwords do not match/i);
});

test("password reset rejects mismatched password confirmation on the backend", async () => {
    User.findOne = async () => assert.fail("Mismatched passwords must be rejected before lookup");
    const response = createResponse();

    await authController.resetPassword({
        body: {
            token: "a".repeat(64),
            newPassword: "new-password",
            confirmPassword: "different-password"
        }
    }, response);

    assert.equal(response.statusCode, 400);
    assert.match(response.body.message, /passwords do not match/i);
});

test("email verification consumes a stored hash once and marks the account verified", async () => {
    const rawToken = "a".repeat(64);
    const user = {
        id: 33,
        emailVerified: false,
        update: async (values) => { Object.assign(user, values); }
    };
    let tokenRecordDestroyed = false;
    let lookup;
    EmailVerificationToken.findOne = async (options) => {
        lookup = options;
        return { userId: user.id, destroy: async () => { tokenRecordDestroyed = true; } };
    };
    User.findByPk = async () => user;
    SecurityEvent.create = async () => {};
    const response = createResponse();

    await authController.verifyEmail({ body: { token: rawToken } }, response);

    assert.equal(lookup.where.tokenHash, crypto.createHash("sha256").update(rawToken).digest("hex"));
    assert.equal(lookup.where.tokenHash.includes(rawToken), false);
    assert.equal(user.emailVerified, true);
    assert.equal(tokenRecordDestroyed, true);
    assert.equal(response.statusCode, 200);
});

test("password reset stores Argon2id and invalidates the reset token and prior sessions", async () => {
    let updateValues;
    User.findOne = async () => ({ id: 34, passwordLoginEnabled: true });
    User.update = async (values) => {
        updateValues = values;
        return [1];
    };
    SecurityEvent.create = async () => {};
    const response = createResponse();

    await authController.resetPassword({
        body: {
            token: "b".repeat(64),
            newPassword: "A safer long passphrase",
            confirmPassword: "A safer long passphrase"
        }
    }, response);

    assert.match(updateValues.password, /^\$argon2id\$/);
    assert.equal(await argon2.verify(updateValues.password, "A safer long passphrase"), true);
    assert.equal(updateValues.passwordResetTokenHash, null);
    assert.equal(updateValues.passwordResetExpiresAt, null);
    assert.equal(updateValues.tokenVersion.val, "tokenVersion + 1");
    assert.equal(response.statusCode, 200);
});

test("password change verifies the current hash and revokes existing sessions", async () => {
    const user = {
        id: 35,
        passwordLoginEnabled: true,
        password: await bcrypt.hash("current legacy password", 10),
        tokenVersion: 3,
        passwordResetTokenHash: "old-reset-hash",
        passwordResetExpiresAt: new Date(),
        save: async () => {}
    };
    User.findByPk = async () => user;
    SecurityEvent.create = async () => {};
    const response = createResponse();

    await authController.updatePassword({
        user: { id: user.id },
        body: {
            currentPassword: "current legacy password",
            newPassword: "A safer long passphrase"
        }
    }, response);

    assert.match(user.password, /^\$argon2id\$/);
    assert.equal(await argon2.verify(user.password, "A safer long passphrase"), true);
    assert.equal(user.tokenVersion, 4);
    assert.equal(user.passwordResetTokenHash, null);
    assert.equal(user.passwordResetExpiresAt, null);
    assert.equal(response.statusCode, 200);
});

test("email address changes require reauthentication and begin verification", async () => {
    const user = {
        id: 36,
        fullName: "Lecturer Example",
        email: "old@example.edu",
        role: "lecturer",
        passwordLoginEnabled: true,
        emailVerified: true,
        passwordResetTokenHash: "reset",
        passwordResetExpiresAt: new Date(),
        save: async () => {},
        toJSON() { return { ...this }; }
    };
    const credentialUser = {
        password: await bcrypt.hash("current password", 10)
    };
    let verificationValues;
    User.findOne = async () => null;
    User.findByPk = async () => user;
    User.unscoped = () => ({ findByPk: async () => credentialUser });
    EmailVerificationToken.upsert = async (values) => { verificationValues = values; };
    SecurityEvent.create = async () => {};
    const response = createResponse();

    await authController.updateProfile({
        user: { id: user.id },
        body: {
            fullName: user.fullName,
            email: "new@example.edu",
            currentPassword: "current password"
        }
    }, response);

    assert.equal(user.email, "new@example.edu", JSON.stringify(response.body));
    assert.equal(user.emailVerified, false);
    assert.equal(verificationValues.userId, user.id);
    assert.match(verificationValues.tokenHash, /^[a-f0-9]{64}$/);
    assert.match(response.body.message, /verify your new email/i);
    assert.equal(response.body.user.password, undefined);
});

test("password login refuses to issue a session with an insecure JWT secret", async () => {
    process.env.JWT_SECRET = "change_this_to_a_long_random_secret";
    const password = "account-password";
    const user = {
        id: 26,
        tokenVersion: 0,
        email: "student@example.edu",
        role: "student",
        passwordLoginEnabled: true,
        password: await bcrypt.hash(password, 10)
    };
    User.findOne = async () => user;
    user.save = async () => {};
    const response = createResponse();

    await authController.login({
        body: { email: user.email, password }
    }, response);

    assert.equal(response.statusCode, 500);
    assert.equal(response.body.message, "Authentication is not configured");
    assert.equal(response.body.token, undefined);
});

test("Google registration creates lecturer accounts without student-only details", async () => {
    process.env.GOOGLE_CLIENT_ID = "test-google-client-id";
    global.fetch = async () => ({
        ok: true,
        json: async () => ({
            aud: "test-google-client-id",
            iss: "https://accounts.google.com",
            email_verified: true,
            exp: String(Math.floor(Date.now() / 1000) + 3600),
            sub: "google-lecturer-123",
            email: "lecturer@example.edu",
            name: "Lecturer Example"
        })
    });

    let createdUser;
    User.findOne = async ({ where }) => {
        assert.deepEqual(where, { email: "lecturer@example.edu" });
        return null;
    };
    User.create = async (values) => {
        createdUser = values;
        return {
            id: 23,
            tokenVersion: 0,
            ...values,
            toJSON() {
                return { ...this };
            }
        };
    };
    const response = createResponse();

    await authController.googleRegister({
        body: {
            credential: "verified-test-credential",
            role: "lecturer",
            schoolId: "1",
            departmentId: "11"
        }
    }, response);

    assert.equal(response.statusCode, 201);
    assert.equal(createdUser.role, "lecturer");
    assert.equal(createdUser.matNumber, null);
    assert.equal(createdUser.phone, null);
    assert.equal(createdUser.passwordLoginEnabled, false);
    assert.ok(response.body.token);
});

test("Google registration signs in an existing account instead of creating a duplicate", async () => {
    process.env.GOOGLE_CLIENT_ID = "test-google-client-id";
    global.fetch = async () => ({
        ok: true,
        json: async () => ({
            aud: "test-google-client-id",
            iss: "https://accounts.google.com",
            email_verified: true,
            exp: String(Math.floor(Date.now() / 1000) + 3600),
            sub: "google-existing-123",
            email: "existing@example.edu",
            name: "Existing User"
        })
    });
    const existingUser = {
        id: 45,
        tokenVersion: 0,
        fullName: "Existing User",
        email: "existing@example.edu",
        googleId: "google-existing-123",
        emailVerified: false,
        role: "student",
        save: async () => {},
        toJSON() {
            return { ...this };
        }
    };
    User.findOne = async () => existingUser;
    User.create = async () => assert.fail("An existing account must not be duplicated");
    const response = createResponse();

    await authController.googleRegister({
        body: { credential: "verified-test-credential", role: "lecturer" }
    }, response);

    assert.equal(response.statusCode, 200);
    assert.equal(response.body.user.role, "student");
    assert.equal(existingUser.emailVerified, true);
    assert.ok(response.body.token);
});

test("Google registration asks new users for school and department details", async () => {
    process.env.GOOGLE_CLIENT_ID = "test-google-client-id";
    global.fetch = async () => ({
        ok: true,
        json: async () => ({
            aud: "test-google-client-id",
            iss: "https://accounts.google.com",
            email_verified: true,
            exp: String(Math.floor(Date.now() / 1000) + 3600),
            sub: "google-new-123",
            email: "new@example.edu",
            name: "New User"
        })
    });
    User.findOne = async () => null;
    User.create = async () => assert.fail("Incomplete registration must not create an account");
    const response = createResponse();

    await authController.googleRegister({
        body: { credential: "verified-test-credential", role: "lecturer" }
    }, response);

    assert.equal(response.statusCode, 428);
    assert.equal(response.body.profileRequired, true);
});

test("email registration rejects a department that belongs to another school", async () => {
    Department.findOne = async () => null;
    User.findOne = async () => assert.fail("Invalid school placement must be rejected before account lookup");
    User.create = async () => assert.fail("Invalid school placement must not create an account");
    const response = createResponse();

    await authController.register({
        body: {
            fullName: "Lecturer Example",
            email: "lecturer@example.edu",
            password: "lecturer-password",
            confirmPassword: "lecturer-password",
            role: "lecturer",
            schoolId: "1",
            departmentId: "22"
        }
    }, response);

    assert.equal(response.statusCode, 400);
    assert.match(response.body.message, /department in your selected school/i);
});

for (const role of ["student", "lecturer"]) {
    test(`password login accepts a registered ${role} account`, async () => {
        const password = "account-password";
        const user = {
            id: role === "student" ? 24 : 25,
            tokenVersion: 0,
            fullName: `${role} example`,
            email: `${role}@example.edu`,
            role,
            passwordLoginEnabled: true,
            emailVerified: false,
            password: await bcrypt.hash(password, 10),
            save: async () => {},
            toJSON() {
                return { ...this };
            }
        };
        User.findOne = async ({ where }) => {
            assert.deepEqual(where, { email: user.email });
            return user;
        };

        const response = createResponse();
        await authController.login({
            body: { email: user.email, password },
            headers: { origin: "https://smartcampus.example" }
        }, response);

        assert.equal(response.statusCode, 200);
        assert.equal(response.body.user.role, role);
        assert.match(user.password, /^\$argon2id\$/);
        assert.equal(response.body.user.password, undefined);
        assert.equal(response.body.user.passwordResetTokenHash, undefined);
        assert.equal(response.body.token, undefined);
        assert.equal(response.cookies.smartcampus_session.options.httpOnly, true);
        assert.equal(response.cookies.smartcampus_session.options.path, "/api");
    });
}

test("native login returns a bearer token in addition to the session cookie", async () => {
    const password = "account-password";
    const user = {
        id: 27,
        tokenVersion: 0,
        fullName: "Native Student",
        email: "native@example.edu",
        role: "student",
        passwordLoginEnabled: true,
        password: await bcrypt.hash(password, 10),
        save: async () => {},
        toJSON() { return { ...this }; }
    };
    User.findOne = async () => user;
    const response = createResponse();

    await authController.login({
        body: { email: user.email, password },
        headers: { origin: "https://smartcampus.example", "x-smartcampus-client": "mobile" },
        get(name) { return this.headers[name.toLowerCase()]; }
    }, response);

    assert.equal(response.statusCode, 200);
    assert.ok(response.body.token);
});

test("email registration requires a student matriculation number", async () => {
    User.findOne = async () => assert.fail("Invalid student details should be rejected before lookup");
    User.create = async () => assert.fail("Invalid student details must not create an account");

    const response = createResponse();
    await authController.register({
        body: {
            fullName: "Student Example",
            email: "student@example.edu",
            password: "student-password",
            confirmPassword: "student-password",
            role: "student"
        }
    }, response);

    assert.equal(response.statusCode, 400);
    assert.match(response.body.message, /student ID number/i);
});

test("email registration rejects an invalid phone number when one is provided", async () => {
    User.findOne = async () => assert.fail("Invalid phone should be rejected before lookup");
    User.create = async () => assert.fail("Invalid phone must not create an account");

    const response = createResponse();
    await authController.register({
        body: {
            fullName: "Student Example",
            email: "student@example.edu",
            password: "student-password",
            confirmPassword: "student-password",
            role: "student",
            matNumber: "STU-2026",
            phone: "not a phone",
            schoolId: "1",
            departmentId: "11"
        }
    }, response);

    assert.equal(response.statusCode, 400);
    assert.match(response.body.message, /valid phone number/i);
});
