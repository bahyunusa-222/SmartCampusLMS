process.env.DB_HOST = "127.0.0.1";
process.env.DB_NAME = "test";
process.env.DB_USER = "test";
process.env.DB_PASSWORD = "test";

const { afterEach, test } = require("node:test");
const assert = require("node:assert/strict");
const Department = require("../src/models/Department");
const School = require("../src/models/School");
const academicController = require("../src/controllers/academicController");

const originalSchoolFindAll = School.findAll;
const originalDepartmentFindAll = Department.findAll;

afterEach(() => {
    School.findAll = originalSchoolFindAll;
    Department.findAll = originalDepartmentFindAll;
});

test("academic catalog groups department choices under their school", async () => {
    School.findAll = async () => [{ id: 2, name: "Arts and Sciences" }];
    Department.findAll = async () => [
        { id: 11, name: "B.A English", schoolId: 2 },
        { id: 12, name: "B.A French", schoolId: 2 },
        { id: 13, name: "BSc. Agriculture", schoolId: 1 }
    ];
    let responseBody;
    let cacheControl;
    const response = {
        set(name, value) {
            if (name === "Cache-Control") cacheControl = value;
            return this;
        },
        json(body) {
            responseBody = body;
            return this;
        }
    };

    await academicController.listCatalog({}, response);

    assert.equal(cacheControl, "public, max-age=3600");
    assert.deepEqual(responseBody, [{
        id: 2,
        name: "Arts and Sciences",
        departments: [
            { id: 11, name: "B.A English" },
            { id: 12, name: "B.A French" }
        ]
    }]);
});
