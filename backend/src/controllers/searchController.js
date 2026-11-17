const { Op } = require("sequelize");
const Assignment = require("../models/Assignment");
const Announcement = require("../models/Announcement");
const Course = require("../models/Course");
const Enrollment = require("../models/Enrollment");
const Lesson = require("../models/Lesson");
const Module = require("../models/Module");

const resultLimit = 5;

const searchPattern = (query) => `%${query.replace(/[\\%_]/g, "\\$&")}%`;

const search = async (req, res, next) => {
    try {
        const query = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 80) : "";
        if (!query) return res.json({ results: [] });

        let courseIds;
        if (req.user.role === "lecturer") {
            const courses = await Course.findAll({
                where: { lecturerId: req.user.id },
                attributes: ["id"]
            });
            courseIds = courses.map((course) => course.id);
        } else {
            const enrollments = await Enrollment.findAll({
                where: { studentId: req.user.id },
                attributes: ["courseId"]
            });
            courseIds = [...new Set(enrollments.map((enrollment) => enrollment.courseId))];
        }
        if (!courseIds.length) return res.json({ results: [] });

        const like = searchPattern(query);
        const matches = { [Op.iLike]: like };
        const inAccessibleCourses = { [Op.in]: courseIds };
        const [courses, assignments, materials, announcements, modules] = await Promise.all([
            Course.findAll({
                where: {
                    id: inAccessibleCourses,
                    [Op.or]: [
                        { title: matches },
                        { academicCode: matches },
                        { category: matches }
                    ]
                },
                attributes: ["id", "title", "academicCode", "category"],
                order: [["title", "ASC"]],
                limit: resultLimit
            }),
            Assignment.findAll({
                where: {
                    courseId: inAccessibleCourses,
                    [Op.or]: [{ title: matches }, { description: matches }, { fileName: matches }]
                },
                attributes: ["id", "title", "description", "courseId"],
                order: [["dueDate", "ASC"], ["id", "ASC"]],
                limit: resultLimit
            }),
            Lesson.findAll({
                where: {
                    courseId: inAccessibleCourses,
                    [Op.or]: [{ title: matches }, { description: matches }, { fileName: matches }]
                },
                attributes: ["id", "title", "description", "courseId"],
                order: [["courseId", "ASC"], ["orderIndex", "ASC"], ["id", "ASC"]],
                limit: resultLimit
            }),
            Announcement.findAll({
                where: {
                    courseId: inAccessibleCourses,
                    [Op.or]: [{ title: matches }, { body: matches }]
                },
                attributes: ["id", "title", "body", "courseId"],
                order: [["createdAt", "DESC"], ["id", "DESC"]],
                limit: resultLimit
            }),
            Module.findAll({
                where: {
                    courseId: inAccessibleCourses,
                    [Op.or]: [{ title: matches }, { description: matches }]
                },
                attributes: ["id", "title", "description", "courseId"],
                order: [["courseId", "ASC"], ["orderIndex", "ASC"], ["id", "ASC"]],
                limit: resultLimit
            })
        ]);
        const matchedCourseIds = [...new Set([
            ...courses.map((course) => course.id),
            ...assignments.map((item) => item.courseId),
            ...materials.map((item) => item.courseId),
            ...announcements.map((item) => item.courseId),
            ...modules.map((item) => item.courseId)
        ])];
        const courseTitles = await Course.findAll({
            where: { id: { [Op.in]: matchedCourseIds } },
            attributes: ["id", "title"]
        });
        const titleByCourseId = new Map(courseTitles.map((course) => [course.id, course.title]));

        const results = [
            ...courses.map((course) => ({
                id: `course-${course.id}`,
                type: "Course",
                title: course.title,
                detail: [course.academicCode, course.category].filter(Boolean).join(" · "),
                url: `/courses/${course.id}?section=materials`
            })),
            ...materials.map((item) => ({
                id: `material-${item.id}`,
                type: "Learning material",
                title: item.title,
                detail: titleByCourseId.get(item.courseId) || item.description || "Course material",
                url: `/courses/${item.courseId}?section=materials`
            })),
            ...assignments.map((item) => ({
                id: `assignment-${item.id}`,
                type: "Assignment",
                title: item.title,
                detail: titleByCourseId.get(item.courseId) || item.description,
                url: `/assignments?courseId=${item.courseId}`
            })),
            ...announcements.map((item) => ({
                id: `announcement-${item.id}`,
                type: "Announcement",
                title: item.title,
                detail: titleByCourseId.get(item.courseId) || item.body,
                url: `/announcements?courseId=${item.courseId}`
            })),
            ...modules.map((item) => ({
                id: `module-${item.id}`,
                type: "Course module",
                title: item.title,
                detail: titleByCourseId.get(item.courseId) || item.description || "Course module",
                url: `/courses/${item.courseId}?section=materials`
            }))
        ];
        return res.json({ results });
    } catch (error) {
        return next(error);
    }
};

module.exports = { search, searchPattern };
