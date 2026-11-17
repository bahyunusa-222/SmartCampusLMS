const { test } = require("node:test");
const assert = require("node:assert/strict");
const Assignment = require("../src/models/Assignment");
const Announcement = require("../src/models/Announcement");
const Course = require("../src/models/Course");
const Enrollment = require("../src/models/Enrollment");
const Lesson = require("../src/models/Lesson");
const Module = require("../src/models/Module");
const { search, searchPattern } = require("../src/controllers/searchController");

const withSearchModels = async (stubs, run) => {
    const models = { Assignment, Announcement, Course, Enrollment, Lesson, Module };
    const originals = Object.fromEntries(Object.keys(models).map((name) => [
        name,
        models[name].findAll
    ]));
    for (const [name, findAll] of Object.entries(stubs)) models[name].findAll = findAll;
    try {
        await run();
    } finally {
        for (const [name, findAll] of Object.entries(originals)) models[name].findAll = findAll;
    }
};

const makeResponse = () => ({
    statusCode: 200,
    status(code) {
        this.statusCode = code;
        return this;
    },
    json(body) {
        this.body = body;
        return this;
    }
});

test("global search escapes SQL LIKE wildcards in user input", () => {
    assert.equal(searchPattern("a%b_c\\d"), "%a\\%b\\_c\\\\d%");
});

test("global search accepts one-character queries and limits content to enrolled courses", async () => {
    const calls = {};
    const response = makeResponse();
    await withSearchModels({
        Enrollment: async (options) => {
            calls.enrollments = options;
            return [{ courseId: 7 }];
        },
        Course: async (options) => {
            calls.courses = [...(calls.courses || []), options];
            return options.where.lecturerId
                ? []
                : Object.getOwnPropertySymbols(options.where).length
                    ? []
                    : [{ id: 7, title: "ICT Foundations" }];
        },
        Assignment: async (options) => { calls.assignments = options; return []; },
        Lesson: async (options) => { calls.materials = options; return []; },
        Announcement: async (options) => { calls.announcements = options; return []; },
        Module: async (options) => { calls.modules = options; return []; }
    }, async () => {
        await search({
            user: { id: 12, role: "student" },
            query: { q: "i" }
        }, response, (error) => { throw error; });
    });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.body, { results: [] });
    assert.deepEqual(calls.enrollments.where, { studentId: 12 });
    assert.equal(calls.assignments.where.courseId[Object.getOwnPropertySymbols(calls.assignments.where.courseId)[0]][0], 7);
    assert.equal(calls.assignments.limit, 5);
    assert.equal(calls.courses.length, 2);
});

test("global search returns only the current lecturer's matching course resources", async () => {
    const response = makeResponse();
    await withSearchModels({
        Course: async (options) => {
            if (options.where.lecturerId === 4) return [{ id: 3 }];
            if (options.attributes.includes("academicCode")) {
                return [{ id: 3, title: "Network Systems", academicCode: "ICT301", category: "ICT" }];
            }
            return [{ id: 3, title: "Network Systems" }];
        },
        Assignment: async (options) => {
            assert.equal(options.where.courseId[Object.getOwnPropertySymbols(options.where.courseId)[0]][0], 3);
            return [{
                id: 5,
                title: "Network topology",
                description: "Draw a network",
                courseId: 3
            }];
        },
        Enrollment: async () => { throw new Error("Lecturer search should not query student enrollments."); },
        Lesson: async () => [],
        Announcement: async () => [],
        Module: async () => []
    }, async () => {
        await search({
            user: { id: 4, role: "lecturer" },
            query: { q: "network" }
        }, response, (error) => { throw error; });
    });

    assert.deepEqual(response.body.results.map(({ type, title, detail, url }) => ({ type, title, detail, url })), [
        {
            type: "Course",
            title: "Network Systems",
            detail: "ICT301 · ICT",
            url: "/courses/3?section=materials"
        },
        {
            type: "Assignment",
            title: "Network topology",
            detail: "Network Systems",
            url: "/assignments?courseId=3"
        }
    ]);
});
