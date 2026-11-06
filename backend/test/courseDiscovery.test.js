process.env.DB_HOST = "127.0.0.1";
process.env.DB_NAME = "test";
process.env.DB_USER = "test";
process.env.DB_PASSWORD = "test";

const { afterEach, test } = require("node:test");
const assert = require("node:assert/strict");
const { Op } = require("sequelize");
const Course = require("../src/models/Course");
const Enrollment = require("../src/models/Enrollment");
const User = require("../src/models/User");
const courseController = require("../src/controllers/courseController");
const enrollmentController = require("../src/controllers/enrollmentController");

const originals = {
    courseFindAll: Course.findAll,
    courseFindByPk: Course.findByPk,
    enrollmentFindOne: Enrollment.findOne,
    enrollmentCreate: Enrollment.create,
    userFindByPk: User.findByPk
};

afterEach(() => {
    Course.findAll = originals.courseFindAll;
    Course.findByPk = originals.courseFindByPk;
    Enrollment.findOne = originals.enrollmentFindOne;
    Enrollment.create = originals.enrollmentCreate;
    User.findByPk = originals.userFindByPk;
});

const responseFor = () => ({
    statusCode: 200,
    body: null,
    status(code) {
        this.statusCode = code;
        return this;
    },
    json(body) {
        this.body = body;
        return this;
    }
});

test("course discovery is scoped to the student's school and department or school-wide courses", async () => {
    let query;
    User.findByPk = async () => ({ schoolId: 3, departmentId: 8 });
    Course.findAll = async (options) => {
        query = options;
        return [{ toJSON: () => ({ id: 21, title: "Available course" }) }];
    };
    const response = responseFor();

    await courseController.getCourses({ user: { id: 12, role: "student" } }, response);

    assert.equal(response.statusCode, 200);
    assert.equal(query.where.schoolId, 3);
    assert.deepEqual(query.where[Op.or], [{ departmentId: null }, { departmentId: 8 }]);
    assert.equal(response.body[0].id, 21);
});

test("course discovery requires a complete academic profile", async () => {
    User.findByPk = async () => ({ schoolId: null, departmentId: null });
    Course.findAll = async () => assert.fail("Courses must not be listed without an academic profile");
    const response = responseFor();

    await courseController.getCourses({ user: { id: 12, role: "student" } }, response);

    assert.equal(response.statusCode, 409);
});

test("students can join an eligible school-wide course from discovery", async () => {
    User.findByPk = async () => ({
        fullName: "Student Example",
        email: "student@example.edu",
        matNumber: "STU-1",
        schoolId: 3,
        departmentId: 8
    });
    Course.findByPk = async () => ({
        id: 21,
        schoolId: 3,
        departmentId: null,
        status: "active",
        enrollmentEnabled: true
    });
    Enrollment.findOne = async () => null;
    let created;
    Enrollment.create = async (values) => { created = values; };
    const response = responseFor();

    await enrollmentController.joinById({
        user: { id: 12, role: "student" },
        params: { courseId: "21" }
    }, response);

    assert.equal(response.statusCode, 201);
    assert.deepEqual(created, { studentId: 12, courseId: 21, permissions: [] });
});

test("students cannot join a course assigned to another department", async () => {
    User.findByPk = async () => ({
        fullName: "Student Example",
        email: "student@example.edu",
        matNumber: "STU-1",
        schoolId: 3,
        departmentId: 8
    });
    Course.findByPk = async () => ({
        id: 21,
        schoolId: 3,
        departmentId: 9,
        status: "active",
        enrollmentEnabled: true
    });
    Enrollment.create = async () => assert.fail("An ineligible student must not be enrolled");
    const response = responseFor();

    await enrollmentController.joinById({
        user: { id: 12, role: "student" },
        params: { courseId: "21" }
    }, response);

    assert.equal(response.statusCode, 403);
});
