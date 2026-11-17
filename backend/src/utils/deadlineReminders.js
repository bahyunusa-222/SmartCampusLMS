const { Op } = require("sequelize");
const Assignment = require("../models/Assignment");
const Enrollment = require("../models/Enrollment");
const DeadlineReminder = require("../models/DeadlineReminder");
const CalendarEvent = require("../models/CalendarEvent");
const Course = require("../models/Course");
const createAutomatedAnnouncement = require("./createAutomatedAnnouncement");
const createNotifications = require("./createNotifications");
const { sequelize } = require("../config/db");

const HOUR = 60 * 60 * 1000;

const sendDeadlineReminders = async (now = new Date()) => {
    const dueWithin24Hours = new Date(now.getTime() + 24 * HOUR);
    const assignments = await Assignment.findAll({
        where: {
            dueDate: { [Op.gt]: now, [Op.lte]: dueWithin24Hours }
        },
        attributes: ["id", "courseId", "title", "description", "dueDate"]
    });
    const courseIds = [...new Set(assignments.map((assignment) => assignment.courseId))];
    const [courses, enrollments] = courseIds.length
        ? await Promise.all([
            Course.findAll({
                where: { id: { [Op.in]: courseIds } },
                attributes: ["id", "lecturerId"]
            }),
            Enrollment.findAll({
                where: { courseId: { [Op.in]: courseIds } },
                attributes: ["courseId", "studentId"],
                order: [["courseId", "ASC"], ["studentId", "ASC"]]
            })
        ])
        : [[], []];
    const courseById = new Map(courses.map((course) => [course.id, course]));
    const studentsByCourse = new Map();
    for (const enrollment of enrollments) {
        const studentIds = studentsByCourse.get(enrollment.courseId) || [];
        studentIds.push(enrollment.studentId);
        studentsByCourse.set(enrollment.courseId, studentIds);
    }
    let createdCount = 0;

    for (const assignment of assignments) {
        const dueDate = new Date(assignment.dueDate);
        const window = dueDate.getTime() <= now.getTime() + HOUR ? "1h" : "24h";
        const course = courseById.get(assignment.courseId);
        if (course) {
            await createAutomatedAnnouncement({
                automaticKey: `assignment-due:${assignment.id}:${dueDate.toISOString()}`,
                courseId: assignment.courseId,
                lecturerId: course.lecturerId,
                title: `Assignment due within 24 hours: ${assignment.title}`,
                body: `${assignment.title} is due ${dueDate.toLocaleString()}.${assignment.description ? ` ${assignment.description}` : ""}`,
                resourceType: "assignment",
                resourceId: assignment.id
            });
        }
        const userIds = studentsByCourse.get(assignment.courseId) || [];
        for (let index = 0; index < userIds.length; index += 500) {
            const batch = userIds.slice(index, index + 500);
            await sequelize.transaction(async (transaction) => {
                const reminders = await DeadlineReminder.bulkCreate(
                    batch.map((userId) => ({ assignmentId: assignment.id, userId, window })),
                    { ignoreDuplicates: true, returning: true, transaction }
                );
                createdCount += reminders.length;
                if (window === "1h" && reminders.length) {
                    await createNotifications({
                        userIds: reminders.map((reminder) => reminder.userId),
                        type: "deadline-reminder",
                        title: "Assignment due within one hour",
                        body: `${assignment.title} is due ${dueDate.toLocaleString()}.`,
                        resourceType: "assignment",
                        resourceId: assignment.id,
                        transaction
                    });
                }
            });
        }
    }
    const changedClasses = await CalendarEvent.findAll({
        where: {
            eventType: "class",
            status: { [Op.in]: ["cancelled", "rescheduled"] },
            startsAt: { [Op.gt]: now, [Op.lte]: dueWithin24Hours }
        },
        include: [{ model: Course, as: "course", attributes: ["id", "title", "lecturerId"] }]
    });
    for (const event of changedClasses) {
        if (!event.course) continue;
        const startsAt = new Date(event.startsAt);
        const changeLabel = event.status === "cancelled" ? "cancelled" : "rescheduled";
        await createAutomatedAnnouncement({
            automaticKey: `class-change:${event.id}:${event.status}:${startsAt.toISOString()}`,
            courseId: event.courseId,
            lecturerId: event.course.lecturerId,
            title: `${changeLabel === "cancelled" ? "Cancelled" : "Rescheduled"}: ${event.title}`,
            body: event.status === "cancelled"
                ? `${event.course.title} class "${event.title}" scheduled for ${startsAt.toLocaleString()} has been cancelled.${event.description || "Please check the course calendar for updates."}`
                : `${event.course.title} class "${event.title}" has been rescheduled to ${startsAt.toLocaleString()}.${event.description || "Please check the course calendar for the updated time."}`,
            resourceType: "calendarEvent",
            resourceId: event.id
        });
        createdCount += 1;
    }
    const noSchoolEvents = await CalendarEvent.findAll({
        where: {
            eventType: "no-school",
            status: "scheduled",
            startsAt: { [Op.gt]: now, [Op.lte]: dueWithin24Hours }
        },
        include: [{ model: Course, as: "course", attributes: ["id", "title", "lecturerId"] }]
    });
    for (const event of noSchoolEvents) {
        if (!event.course) continue;
        const startsAt = new Date(event.startsAt);
        await createAutomatedAnnouncement({
            automaticKey: `no-school:${event.id}:${startsAt.toISOString()}`,
            courseId: event.courseId,
            lecturerId: event.course.lecturerId,
            title: "No school",
            body: `${event.description}\nScheduled for ${startsAt.toLocaleString()}.`,
            resourceType: "calendarEvent",
            resourceId: event.id
        });
        createdCount += 1;
    }
    return createdCount;
};

module.exports = sendDeadlineReminders;
