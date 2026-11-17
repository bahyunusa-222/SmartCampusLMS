const User = require("./User");
const Course = require("./Course");
const Enrollment = require("./Enrollment");
const Lesson = require("./Lesson");
const LessonNote = require("./LessonNote");
const Quiz = require("./Quiz");
const QuizResult = require("./QuizResult");
const Assignment = require("./Assignment");
const AssignmentRead = require("./AssignmentRead");
const SubmissionRead = require("./SubmissionRead");
const Submission = require("./Submission");
const Module = require("./Module");
const LessonProgress = require("./LessonProgress");
const QuizAssessment = require("./QuizAssessment");
const QuizAttempt = require("./QuizAttempt");
const QuizAttemptAnswer = require("./QuizAttemptAnswer");
const Announcement = require("./Announcement");
const AnnouncementReaction = require("./AnnouncementReaction");
const AnnouncementView = require("./AnnouncementView");
const AnnouncementComment = require("./AnnouncementComment");
const AnnouncementCommentReaction = require("./AnnouncementCommentReaction");
const Message = require("./Message");
const Notification = require("./Notification");
const NotificationDevice = require("./NotificationDevice");
const NotificationDelivery = require("./NotificationDelivery");
const CalendarEvent = require("./CalendarEvent");
const Department = require("./Department");
const School = require("./School");
const Certificate = require("./Certificate");
const Feedback = require("./Feedback");
const DeadlineReminder = require("./DeadlineReminder");
const ChatProfile = require("./ChatProfile");
const ChatPresence = require("./ChatPresence");
const ChatMessage = require("./ChatMessage");
const ChatMessageReaction = require("./ChatMessageReaction");
const ChatMessageMedia = require("./ChatMessageMedia");
const ChatReadState = require("./ChatReadState");
const ChatSavedMessage = require("./ChatSavedMessage");
const ChatHiddenMessage = require("./ChatHiddenMessage");
const ChatProfilePermission = require("./ChatProfilePermission");
const StoredFile = require("./StoredFile");
const FileReference = require("./FileReference");
const EmailVerificationToken = require("./EmailVerificationToken");
const SecurityEvent = require("./SecurityEvent");
const PrivacyRequest = require("./PrivacyRequest");
const PrivacyConsent = require("./PrivacyConsent");

User.hasMany(Feedback, { foreignKey: "userId", as: "feedback" });
Feedback.belongsTo(User, { foreignKey: "userId", as: "user" });

User.hasMany(Enrollment, { foreignKey: "studentId", as: "enrollments" });
Enrollment.belongsTo(User, { foreignKey: "studentId", as: "student" });

Course.hasMany(Enrollment, { foreignKey: "courseId", as: "enrollments" });
Enrollment.belongsTo(Course, { foreignKey: "courseId", as: "course" });

Course.belongsTo(User, { foreignKey: "lecturerId", as: "lecturer" });
User.hasMany(Course, { foreignKey: "lecturerId", as: "courses" });

Course.hasMany(Lesson, { foreignKey: "courseId", as: "lessons" });
Lesson.belongsTo(Course, { foreignKey: "courseId", as: "course" });
User.hasMany(Lesson, { foreignKey: "uploadedById", as: "uploadedLessons" });
Lesson.belongsTo(User, { foreignKey: "uploadedById", as: "uploader" });
Lesson.hasMany(LessonNote, { foreignKey: "lessonId", as: "privateNotes", onDelete: "CASCADE" });
LessonNote.belongsTo(Lesson, { foreignKey: "lessonId", as: "lesson" });
User.hasMany(LessonNote, { foreignKey: "userId", as: "lessonNotes", onDelete: "CASCADE" });
LessonNote.belongsTo(User, { foreignKey: "userId", as: "user" });
Course.hasMany(Module, { foreignKey: "courseId", as: "modules" });
Module.belongsTo(Course, { foreignKey: "courseId", as: "course" });
Module.hasMany(Lesson, { foreignKey: "moduleId", as: "lessons" });
Lesson.belongsTo(Module, { foreignKey: "moduleId", as: "module" });
User.hasMany(LessonProgress, { foreignKey: "studentId", as: "lessonProgress" });
LessonProgress.belongsTo(User, { foreignKey: "studentId", as: "student" });
Lesson.hasMany(LessonProgress, { foreignKey: "lessonId", as: "progress" });
LessonProgress.belongsTo(Lesson, { foreignKey: "lessonId", as: "lesson" });

Course.hasMany(Quiz, { foreignKey: "courseId", as: "quizzes" });
Quiz.belongsTo(Course, { foreignKey: "courseId", as: "course" });
Course.hasMany(QuizAssessment, { foreignKey: "courseId", as: "assessments" });
QuizAssessment.belongsTo(Course, { foreignKey: "courseId", as: "course" });
QuizAssessment.hasMany(Quiz, { foreignKey: "assessmentId", as: "questions" });
Quiz.belongsTo(QuizAssessment, { foreignKey: "assessmentId", as: "assessment" });
QuizAssessment.hasMany(QuizAttempt, { foreignKey: "assessmentId", as: "attempts" });
QuizAttempt.belongsTo(QuizAssessment, { foreignKey: "assessmentId", as: "assessment" });
QuizAttempt.hasMany(QuizAttemptAnswer, { foreignKey: "attemptId", as: "responses" });
QuizAttemptAnswer.belongsTo(QuizAttempt, { foreignKey: "attemptId", as: "attempt" });
Quiz.hasMany(QuizAttemptAnswer, { foreignKey: "questionId", as: "attemptAnswers" });
QuizAttemptAnswer.belongsTo(Quiz, { foreignKey: "questionId", as: "question" });
User.hasMany(QuizAttempt, { foreignKey: "studentId", as: "quizAttempts" });
QuizAttempt.belongsTo(User, { foreignKey: "studentId", as: "student" });

Course.hasMany(Assignment, { foreignKey: "courseId", as: "assignments" });
Assignment.belongsTo(Course, { foreignKey: "courseId", as: "course" });
Assignment.hasMany(AssignmentRead, { foreignKey: "assignmentId", as: "reads" });
AssignmentRead.belongsTo(Assignment, { foreignKey: "assignmentId", as: "assignment" });
User.hasMany(AssignmentRead, { foreignKey: "studentId", as: "assignmentReads" });
AssignmentRead.belongsTo(User, { foreignKey: "studentId", as: "student" });

User.hasMany(Submission, { foreignKey: "studentId", as: "submissions" });
Submission.belongsTo(User, { foreignKey: "studentId", as: "student" });

Assignment.hasMany(Submission, { foreignKey: "assignmentId", as: "submissions" });
Submission.belongsTo(Assignment, { foreignKey: "assignmentId", as: "assignment" });
Submission.hasMany(SubmissionRead, { foreignKey: "submissionId", as: "lecturerViews" });
SubmissionRead.belongsTo(Submission, { foreignKey: "submissionId", as: "submission" });

User.hasMany(QuizResult, { foreignKey: "studentId", as: "quizResults" });
QuizResult.belongsTo(User, { foreignKey: "studentId", as: "student" });

Quiz.hasMany(QuizResult, { foreignKey: "quizId", as: "results" });
QuizResult.belongsTo(Quiz, { foreignKey: "quizId", as: "quiz" });

Course.belongsTo(Department, { foreignKey: "departmentId", as: "department" });
Department.hasMany(Course, { foreignKey: "departmentId", as: "courses" });
School.hasMany(Department, { foreignKey: "schoolId", as: "departments" });
Department.belongsTo(School, { foreignKey: "schoolId", as: "school" });
User.belongsTo(School, { foreignKey: "schoolId", as: "school" });
User.belongsTo(Department, { foreignKey: "departmentId", as: "department" });
Course.belongsTo(School, { foreignKey: "schoolId", as: "school" });
Course.hasMany(Announcement, { foreignKey: "courseId", as: "announcements" });
Announcement.belongsTo(Course, { foreignKey: "courseId", as: "course" });
Announcement.belongsTo(User, { foreignKey: "createdById", as: "author" });
Announcement.hasMany(AnnouncementReaction, { foreignKey: "announcementId", as: "reactions" });
AnnouncementReaction.belongsTo(Announcement, { foreignKey: "announcementId", as: "announcement" });
Announcement.hasMany(AnnouncementView, { foreignKey: "announcementId", as: "views" });
AnnouncementView.belongsTo(Announcement, { foreignKey: "announcementId", as: "announcement" });
Announcement.hasMany(AnnouncementComment, { foreignKey: "announcementId", as: "comments" });
AnnouncementComment.belongsTo(Announcement, { foreignKey: "announcementId", as: "announcement" });
AnnouncementComment.belongsTo(User, { foreignKey: "authorId", as: "author" });
AnnouncementComment.hasMany(AnnouncementComment, { foreignKey: "parentCommentId", as: "replies" });
AnnouncementComment.belongsTo(AnnouncementComment, { foreignKey: "parentCommentId", as: "parent" });
AnnouncementComment.hasMany(AnnouncementCommentReaction, { foreignKey: "commentId", as: "reactions" });
AnnouncementCommentReaction.belongsTo(AnnouncementComment, { foreignKey: "commentId", as: "comment" });
AnnouncementCommentReaction.belongsTo(User, { foreignKey: "userId", as: "user" });
User.hasMany(AnnouncementReaction, { foreignKey: "userId", as: "announcementReactions" });
AnnouncementReaction.belongsTo(User, { foreignKey: "userId", as: "user" });
User.hasMany(AnnouncementView, { foreignKey: "userId", as: "announcementViews" });
AnnouncementView.belongsTo(User, { foreignKey: "userId", as: "user" });
User.hasMany(AnnouncementComment, { foreignKey: "authorId", as: "announcementComments" });
User.hasMany(AnnouncementCommentReaction, { foreignKey: "userId", as: "announcementCommentReactions" });
Course.hasMany(Message, { foreignKey: "courseId", as: "messages" });
Message.belongsTo(Course, { foreignKey: "courseId", as: "course" });
Message.belongsTo(User, { foreignKey: "senderId", as: "sender" });
Message.belongsTo(User, { foreignKey: "recipientId", as: "recipient" });
User.hasMany(Notification, { foreignKey: "userId", as: "notifications" });
Notification.belongsTo(User, { foreignKey: "userId", as: "user" });
Notification.hasMany(NotificationDelivery, { foreignKey: "notificationId", as: "deliveries", onDelete: "CASCADE" });
NotificationDelivery.belongsTo(Notification, { foreignKey: "notificationId", as: "notification" });
NotificationDevice.hasMany(NotificationDelivery, { foreignKey: "deviceId", as: "deliveries", onDelete: "SET NULL" });
NotificationDelivery.belongsTo(NotificationDevice, { foreignKey: "deviceId", as: "device", onDelete: "SET NULL" });
User.hasMany(NotificationDevice, { foreignKey: "userId", as: "notificationDevices", onDelete: "CASCADE" });
NotificationDevice.belongsTo(User, { foreignKey: "userId", as: "user" });
Course.hasMany(CalendarEvent, { foreignKey: "courseId", as: "calendarEvents" });
CalendarEvent.belongsTo(Course, { foreignKey: "courseId", as: "course" });
CalendarEvent.belongsTo(User, { foreignKey: "createdById", as: "creator" });
User.hasMany(Certificate, { foreignKey: "studentId", as: "certificates" });
Certificate.belongsTo(User, { foreignKey: "studentId", as: "student" });
Course.hasMany(Certificate, { foreignKey: "courseId", as: "certificates" });
Certificate.belongsTo(Course, { foreignKey: "courseId", as: "course" });
ChatProfile.hasMany(ChatMessage, { foreignKey: "senderProfileId", as: "sentMessages" });
ChatMessage.belongsTo(ChatProfile, { foreignKey: "senderProfileId", as: "sender" });
ChatProfile.hasMany(ChatMessage, { foreignKey: "receiverProfileId", as: "receivedMessages" });
ChatMessage.belongsTo(ChatProfile, { foreignKey: "receiverProfileId", as: "receiver" });
ChatMessage.belongsTo(ChatMessage, { foreignKey: "replyTo", as: "reply" });
ChatMessage.hasMany(ChatMessageReaction, { foreignKey: "messageId", as: "reactions", onDelete: "CASCADE" });
ChatMessageReaction.belongsTo(ChatMessage, { foreignKey: "messageId", as: "message" });
ChatProfile.hasMany(ChatMessageReaction, { foreignKey: "profileId", as: "chatMessageReactions", onDelete: "CASCADE" });
ChatMessageReaction.belongsTo(ChatProfile, { foreignKey: "profileId", as: "profile" });
ChatMessage.hasOne(ChatMessageMedia, { foreignKey: "messageId", as: "media" });
ChatMessageMedia.belongsTo(ChatMessage, { foreignKey: "messageId", as: "message" });
ChatProfile.hasMany(ChatSavedMessage, { foreignKey: "profileId", as: "savedChatMessages" });
ChatSavedMessage.belongsTo(ChatProfile, { foreignKey: "profileId", as: "profile" });
ChatMessage.hasMany(ChatSavedMessage, { foreignKey: "messageId", as: "savedBy" });
ChatSavedMessage.belongsTo(ChatMessage, { foreignKey: "messageId", as: "message" });
ChatProfile.hasMany(ChatHiddenMessage, { foreignKey: "profileId", as: "hiddenChatMessages" });
ChatHiddenMessage.belongsTo(ChatProfile, { foreignKey: "profileId", as: "profile" });
ChatMessage.hasMany(ChatHiddenMessage, { foreignKey: "messageId", as: "hiddenBy" });
ChatHiddenMessage.belongsTo(ChatMessage, { foreignKey: "messageId", as: "message" });
ChatProfile.hasMany(ChatProfilePermission, { foreignKey: "profileId", as: "profilePermissions" });
ChatProfilePermission.belongsTo(ChatProfile, { foreignKey: "profileId", as: "profile" });
ChatProfile.hasMany(ChatProfilePermission, { foreignKey: "viewerProfileId", as: "viewPermissions" });
ChatProfilePermission.belongsTo(ChatProfile, { foreignKey: "viewerProfileId", as: "viewer" });
ChatProfile.hasOne(ChatPresence, { foreignKey: "profileId", as: "presence", onDelete: "CASCADE" });
ChatPresence.belongsTo(ChatProfile, { foreignKey: "profileId", as: "profile", onDelete: "CASCADE" });

StoredFile.hasMany(FileReference, { foreignKey: "fileId", as: "references", onDelete: "RESTRICT" });
FileReference.belongsTo(StoredFile, { foreignKey: "fileId", as: "file" });
User.hasMany(StoredFile, { foreignKey: "ownerId", as: "storedFiles", onDelete: "RESTRICT" });
StoredFile.belongsTo(User, { foreignKey: "ownerId", as: "owner" });
User.hasMany(FileReference, { foreignKey: "ownerId", as: "fileReferences", onDelete: "RESTRICT" });
FileReference.belongsTo(User, { foreignKey: "ownerId", as: "owner" });
User.hasMany(EmailVerificationToken, { foreignKey: "userId", as: "emailVerificationTokens", onDelete: "CASCADE" });
EmailVerificationToken.belongsTo(User, { foreignKey: "userId", as: "user" });
User.hasMany(PrivacyRequest, { foreignKey: "userId", as: "privacyRequests", onDelete: "RESTRICT" });
PrivacyRequest.belongsTo(User, { foreignKey: "userId", as: "user" });
User.hasMany(PrivacyConsent, { foreignKey: "userId", as: "privacyConsents", onDelete: "CASCADE" });
PrivacyConsent.belongsTo(User, { foreignKey: "userId", as: "user" });

module.exports = {
    User,
    Course,
    Enrollment,
    Lesson,
    LessonNote,
    Quiz,
    QuizResult,
    Assignment,
    AssignmentRead,
    SubmissionRead,
    Submission,
    Module,
    LessonProgress,
    QuizAssessment,
    QuizAttempt,
    QuizAttemptAnswer,
    Announcement,
    AnnouncementReaction,
    AnnouncementView,
    AnnouncementComment,
    AnnouncementCommentReaction,
    Message,
    Notification,
    NotificationDevice,
    NotificationDelivery,
    CalendarEvent,
    Department,
    School,
    Certificate,
    Feedback,
    DeadlineReminder,
    ChatProfile,
    ChatPresence,
    ChatMessage,
    ChatMessageReaction,
    ChatMessageMedia,
    ChatReadState,
    ChatSavedMessage,
    ChatHiddenMessage,
    ChatProfilePermission,
    StoredFile,
    FileReference,
    EmailVerificationToken,
    SecurityEvent,
    PrivacyRequest,
    PrivacyConsent
};
