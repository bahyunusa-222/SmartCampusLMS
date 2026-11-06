const Department = require("../models/Department");
const School = require("../models/School");

exports.listCatalog = async (req, res) => {
    try {
        const [schools, departments] = await Promise.all([
            School.findAll({ attributes: ["id", "name"], order: [["name", "ASC"]] }),
            Department.findAll({
                attributes: ["id", "name", "schoolId"],
                order: [["name", "ASC"]]
            })
        ]);
        const departmentsBySchool = new Map();
        for (const department of departments) {
            const entries = departmentsBySchool.get(department.schoolId) || [];
            entries.push({ id: department.id, name: department.name });
            departmentsBySchool.set(department.schoolId, entries);
        }
        res.set("Cache-Control", "public, max-age=3600");
        return res.json(schools.map((school) => ({
            id: school.id,
            name: school.name,
            departments: departmentsBySchool.get(school.id) || []
        })));
    } catch (error) {
        console.error("Failed to load academic catalog:", error);
        return res.status(500).json({ message: "Failed to load schools and departments." });
    }
};
