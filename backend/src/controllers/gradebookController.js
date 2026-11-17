const { Op } = require("sequelize");
const Course = require("../models/Course");
const Enrollment = require("../models/Enrollment");
const User = require("../models/User");
const Assignment = require("../models/Assignment");
const Submission = require("../models/Submission");
const Quiz = require("../models/Quiz");
const QuizResult = require("../models/QuizResult");
const QuizAssessment = require("../models/QuizAssessment");
const QuizAttempt = require("../models/QuizAttempt");
const Lesson = require("../models/Lesson");
const getCourseAccess = require("../utils/courseAccess");

const managerCourse = async (courseId, user, res) => {
    const access = await getCourseAccess(courseId, user);
    if (access.status) {
        res.status(access.status).json({ message: access.message });
        return null;
    }
    if (!access.isManager) {
        res.status(403).json({ message: "Only course managers can access this report" });
        return null;
    }
    return access.course;
};

exports.getGradebook = async (req, res) => {
    const course = await managerCourse(req.params.courseId, req.user, res);
    if (!course) return;
    const paginationRequested = req.query.limit !== undefined || req.query.offset !== undefined;
    const limit = req.query.limit === undefined ? 50 : Number(req.query.limit);
    const offset = req.query.offset === undefined ? 0 : Number(req.query.offset);
    if (paginationRequested && (!Number.isSafeInteger(limit) || limit < 1 || limit > 100 ||
        !Number.isSafeInteger(offset) || offset < 0)) {
        return res.status(400).json({ message: "Gradebook pagination requires limit 1-100 and a non-negative offset." });
    }

    const enrollmentQuery = {
        where: { courseId: course.id },
        include: [{ model: User, as: "student", attributes: ["id", "fullName", "email", "matNumber"] }],
        order: [["createdAt", "ASC"]]
    };
    const enrollmentResult = paginationRequested
        ? await Enrollment.findAndCountAll({ ...enrollmentQuery, limit, offset })
        : { rows: await Enrollment.findAll(enrollmentQuery), count: null };
    const enrollments = enrollmentResult.rows;
    const studentIds = enrollments.map((item) => item.student?.id).filter(Boolean);
    const assignments = await Assignment.findAll({
        where: { courseId: course.id },
        attributes: ["id", "title", "dueDate", "workType"],
        order: [["dueDate", "ASC"]]
    });
    const assignmentIds = assignments.map((assignment) => assignment.id);
    const studentScope = studentIds.length ? { [Op.in]: studentIds } : { [Op.in]: [-1] };
    const assignmentScope = assignmentIds.length ? { [Op.in]: assignmentIds } : { [Op.in]: [-1] };
    const [submissions, questions, results, assessmentAttempts, assessments] = await Promise.all([
        Submission.findAll({
            where: { studentId: studentScope, assignmentId: assignmentScope }
        }),
        Quiz.findAll({ where: { courseId: course.id }, attributes: ["id", "question"] }),
        studentIds.length ? QuizResult.findAll({
            where: { studentId: studentScope },
            include: [
                { model: Quiz, as: "quiz", where: { courseId: course.id }, attributes: ["id", "question"] },
                { model: User, as: "student", attributes: ["id", "fullName", "matNumber"] }
            ],
            order: [["createdAt", "DESC"]]
        }) : [],
        studentIds.length ? QuizAttempt.findAll({
            where: { studentId: studentScope, submittedAt: { [Op.ne]: null } },
            include: [
                { model: QuizAssessment, as: "assessment", where: { courseId: course.id }, attributes: ["id", "title"] },
                { model: User, as: "student", attributes: ["id", "fullName", "matNumber"] }
            ],
            order: [["submittedAt", "DESC"]]
        }) : [],
        QuizAssessment.findAll({
            where: { courseId: course.id },
            attributes: ["id", "title", "timeLimitMinutes"],
            order: [["createdAt", "ASC"]]
        })
    ]);
    const submissionByStudentAndAssignment = new Map(
        submissions.map((submission) => [`${submission.studentId}:${submission.assignmentId}`, submission])
    );
    const resultsByStudent = new Map();
    for (const result of results) {
        const studentResults = resultsByStudent.get(result.studentId) || [];
        studentResults.push(result);
        resultsByStudent.set(result.studentId, studentResults);
    }
    const attemptsByStudent = new Map();
    for (const attempt of assessmentAttempts) {
        const studentAttempts = attemptsByStudent.get(attempt.studentId) || [];
        studentAttempts.push(attempt);
        attemptsByStudent.set(attempt.studentId, studentAttempts);
    }
    const students = enrollments.filter((item) => item.student).map((item) => {
        const student = item.student.toJSON();
        return {
            ...student,
            enrolledAt: item.createdAt,
            assignments: assignments.map((assignment) => ({
                assignmentId: assignment.id,
                title: assignment.title,
                workType: assignment.workType,
                submission: submissionByStudentAndAssignment.get(`${student.id}:${assignment.id}`) || null
            })),
            quizResults: (resultsByStudent.get(student.id) || []).map((result) => result.toJSON()),
            assessmentAttempts: (attemptsByStudent.get(student.id) || []).map((attempt) => attempt.toJSON())
        };
    });
    const response = {
        course: { id: course.id, title: course.title },
        assignmentColumns: assignments.map(({ id, title, dueDate, workType }) => ({ id, title, dueDate, workType })),
        legacyQuizQuestions: questions.map(({ id, question }) => ({ id, question })),
        assessmentColumns: assessments,
        students
    };
    if (paginationRequested) {
        response.pagination = {
            limit,
            offset,
            total: enrollmentResult.count,
            hasMore: offset + enrollments.length < enrollmentResult.count
        };
    }
    return res.json(response);
};

exports.getAnalytics = async (req, res) => {
    const course = await managerCourse(req.params.courseId, req.user, res);
    if (!course) return;
    const [enrolledStudents, lessonCount, assignmentCount, submissionCount, gradedCount, quizQuestionCount, assessmentCount] =
        await Promise.all([
            Enrollment.count({ where: { courseId: course.id } }),
            Lesson.count({ where: { courseId: course.id } }),
            Assignment.count({ where: { courseId: course.id } }),
            Submission.count({ include: [{ model: Assignment, as: "assignment", where: { courseId: course.id } }] }),
            Submission.count({
                where: { grade: { [Op.ne]: "Pending" } },
                include: [{ model: Assignment, as: "assignment", where: { courseId: course.id } }]
            }),
            Quiz.count({ where: { courseId: course.id } }),
            QuizAssessment.count({ where: { courseId: course.id } })
        ]);
    res.json({
        courseId: course.id,
        enrolledStudents,
        lessonCount,
        assignmentCount,
        submissionCount,
        gradedSubmissionCount: gradedCount,
        quizQuestionCount,
        assessmentCount
    });
};
