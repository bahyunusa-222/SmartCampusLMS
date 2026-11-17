const { Op } = require("sequelize");
const jwt = require("jsonwebtoken");
const { sequelize } = require("../config/db");
const ChatProfile = require("../models/ChatProfile");
const ChatPresence = require("../models/ChatPresence");
const ChatProfilePermission = require("../models/ChatProfilePermission");
const ChatMessage = require("../models/ChatMessage");
const ChatMessageReaction = require("../models/ChatMessageReaction");
const ChatMessageMedia = require("../models/ChatMessageMedia");
const Enrollment = require("../models/Enrollment");
const Course = require("../models/Course");
const User = require("../models/User");
const ChatReadState = require("../models/ChatReadState");
const ChatSavedMessage = require("../models/ChatSavedMessage");
const ChatHiddenMessage = require("../models/ChatHiddenMessage");
const chatRealtime = require("../utils/chatRealtime");
const objectStorage = require("../utils/objectStorage");
const { attachFileReference, findFileReference, removeFileReference } = require("../utils/fileReferences");
const { objectKeyFor } = require("../utils/storedUpload");

const messageTypes = new Set(["text", "emoji", "gif", "sticker", "voice", "image", "file", "contact"]);
const profileFields = ["id", "username", "fullName", "avatarUrl", "about"];
const contactVisibilityFields = ["phoneVisibility", "emailVisibility", "matNumberVisibility"];
const contactVisibilityOptions = new Set(["everyone", "course", "private_contacts"]);
const allowedAudioTypes = new Set(["audio/webm", "audio/mp4", "audio/ogg", "audio/mpeg", "audio/wav"]);
const allowedImageTypes = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const reactionEmojis = new Set(["👍", "❤️", "😂", "😮", "😢", "🙏"]);
const developerEmail = "bahy1878@gmail.com";
const developerBio = "The brain behind SmartCampus LMS. Chat with me about the platform, feedback, or collaboration.";
const presenceExpiryMs = 30_000;

const normalizeChatUsername = (value) => {
    if (typeof value !== "string") return null;
    const username = value.trim();
    if (!username || username.length > 20 || /[\u0000-\u001f\u007f]/.test(username)) return null;
    return username;
};

const usernameOwner = (username) => ChatProfile.findOne({
    where: sequelize.where(sequelize.fn("LOWER", sequelize.col("username")), username.toLowerCase()),
    attributes: ["userId"]
});

const summarizeReactions = (reactions = [], profileId) => {
    const summaries = new Map();
    reactions.forEach((reaction) => {
        const summary = summaries.get(reaction.emoji) || {
            emoji: reaction.emoji,
            count: 0,
            reactedByMe: false
        };
        summary.count += 1;
        if (reaction.profileId === profileId) summary.reactedByMe = true;
        summaries.set(reaction.emoji, summary);
    });
    return [...summaries.values()];
};

const serializeMessage = async (message, profileId) => {
    const data = typeof message.toJSON === "function" ? message.toJSON() : { ...message };
    data.reactions = summarizeReactions(data.reactions, profileId);
    if (data.sender) data.sender = await safeProfile(data.sender);
    if (data.receiver) data.receiver = await safeProfile(data.receiver);
    if (data.type === "contact") {
        try {
            const contact = JSON.parse(data.content);
            const key = objectKeyFor(contact.avatarUrl);
            if (key) contact.avatarUrl = await objectStorage.signedDownloadUrl(key, "profile-image", "inline");
            data.content = JSON.stringify(contact);
        } catch (error) {
            if (error instanceof SyntaxError) return data;
            throw error;
        }
    }
    return data;
};

const hiddenMessageIds = async (profileId) => (
    (await ChatHiddenMessage.findAll({ where: { profileId }, attributes: ["messageId"] }))
        .map((item) => item.messageId)
);

const profileFor = (userId) => ChatProfile.findOne({
    where: { userId },
    attributes: [...profileFields, "userId", ...contactVisibilityFields]
});

const ensureDeveloperProfile = async (user) => {
    let profile = await profileFor(user.id);
    if (profile) {
        if (!profile.about?.trim()) {
            profile.about = developerBio;
            await profile.save();
        }
        return profile;
    }
    let username = "smartcampusdev";
    const owner = await usernameOwner(username);
    if (owner && Number(owner.userId) !== Number(user.id)) username = `scdev${user.id}`;
    [profile] = await ChatProfile.findOrCreate({
        where: { userId: user.id },
        defaults: {
            userId: user.id,
            username,
            fullName: "SmartCampus Developer",
            avatarUrl: null,
            about: developerBio
        }
    });
    return profile;
};

const enrolledCourseIds = async (userId) => (
    (await Enrollment.findAll({ where: { studentId: userId }, attributes: ["courseId"] }))
        .map((enrollment) => enrollment.courseId)
);

const hasSharedCourse = async (firstUserId, secondUserId) => {
    const firstIds = await enrolledCourseIds(firstUserId);
    if (!firstIds.length) return false;
    return Boolean(await Enrollment.findOne({
        where: { studentId: secondUserId, courseId: { [Op.in]: firstIds } },
        attributes: ["id"]
    }));
};

const hasPrivateChatContact = async (firstProfileId, secondProfileId) => Boolean(await ChatMessage.findOne({
    where: {
        courseId: null,
        [Op.or]: [
            { senderProfileId: firstProfileId, receiverProfileId: secondProfileId },
            { senderProfileId: secondProfileId, receiverProfileId: firstProfileId }
        ]
    },
    attributes: ["id"]
}));

const hasPrivateContactApproval = async (profileId, viewerProfileId) => Boolean(
    await ChatProfilePermission.findOne({
        where: { profileId, viewerProfileId, canViewContactDetails: true },
        attributes: ["id"]
    })
);

const safeProfile = async (profile, { signAvatar = true } = {}) => {
    if (!profile) return null;
    let avatarUrl = profile.avatarUrl;
    const key = objectKeyFor(avatarUrl);
    if (signAvatar && key) {
        avatarUrl = await objectStorage.signedDownloadUrl(key, "profile-image", "inline");
    }
    return {
        id: profile.id,
        username: profile.username,
        fullName: profile.fullName,
        avatarUrl,
        about: profile.about
    };
};

const profileMissing = (res) => res.status(409).json({
    message: "Create your chat username before using chat.",
    profileRequired: true
});

const getCourseAccess = async (courseId, profile) => {
    const enrollment = await Enrollment.findOne({
        where: { courseId, studentId: profile.userId },
        attributes: ["id"]
    });
    if (!enrollment) return null;
    const course = await Course.findByPk(courseId, { attributes: ["id", "title"] });
    if (!course) return null;
    return course;
};

const canAccessMessage = async (message, profile) => {
    if (message.courseId !== null) {
        return Boolean(await getCourseAccess(message.courseId, profile));
    }
    if (!message.receiverProfileId) return false;
    if (message.senderProfileId !== profile.id && message.receiverProfileId !== profile.id) return false;
    return true;
};

exports.getMe = async (req, res, next) => {
    try {
        const user = await User.findByPk(req.user.id, { attributes: ["id", "fullName", "email"] });
        if (!user) return res.status(404).json({ message: "Account not found" });
        const isDeveloper = user.email?.trim().toLowerCase() === developerEmail;
        const profile = isDeveloper
            ? await ensureDeveloperProfile(user)
            : await profileFor(req.user.id);
        const developerUser = isDeveloper
            ? user
            : await User.findOne({
                where: { email: developerEmail },
                attributes: ["id", "fullName", "email"]
            });
        const developerProfile = developerUser
            ? (Number(developerUser.id) === Number(req.user.id)
                ? profile
                : await ensureDeveloperProfile(developerUser))
            : null;
        if (!profile) {
            return res.json({
                profile: null,
                suggestedFullName: user.fullName,
                developerProfile: await safeProfile(developerProfile),
                courses: [],
                privateChats: [],
                onlineProfileIds: []
            });
        }

        const [ids, hiddenIds] = await Promise.all([
            enrolledCourseIds(req.user.id),
            hiddenMessageIds(profile.id)
        ]);
        const courses = ids.length ? await Course.findAll({
            where: { id: { [Op.in]: ids } },
            attributes: ["id", "title"],
            order: [["title", "ASC"]]
        }) : [];
        const courseChats = await Promise.all(courses.map(async (course) => {
            const [studentCount, latestMessage, readState] = await Promise.all([
                Enrollment.count({ where: { courseId: course.id } }),
                ChatMessage.findOne({
                    where: {
                        courseId: course.id,
                        receiverProfileId: null,
                        ...(hiddenIds.length ? { id: { [Op.notIn]: hiddenIds } } : {})
                    },
                    include: [{ model: ChatProfile, as: "sender", attributes: ["username"] }],
                    order: [["createdAt", "DESC"]]
                }),
                ChatReadState.findOne({ where: { profileId: profile.id, courseId: course.id } })
            ]);
            const unreadCount = await ChatMessage.count({
                where: {
                    courseId: course.id,
                    receiverProfileId: null,
                    senderProfileId: { [Op.ne]: profile.id },
                    ...(hiddenIds.length ? { id: { [Op.notIn]: hiddenIds } } : {}),
                    ...(readState ? { createdAt: { [Op.gt]: readState.lastReadAt } } : {})
                }
            });
            return {
                id: course.id,
                title: course.title,
                studentCount,
                unreadCount,
                latestMessage: latestMessage ? {
                    content: latestMessage.content,
                    type: latestMessage.type,
                    createdAt: latestMessage.createdAt,
                    senderUsername: latestMessage.sender?.username || "student"
                } : null
            };
        }));

        const privateMessages = await ChatMessage.findAll({
            where: {
                courseId: null,
                ...(hiddenIds.length ? { id: { [Op.notIn]: hiddenIds } } : {}),
                [Op.or]: [
                    { senderProfileId: profile.id },
                    { receiverProfileId: profile.id }
                ]
            },
            include: [
                { model: ChatProfile, as: "sender", attributes: profileFields },
                { model: ChatProfile, as: "receiver", attributes: profileFields }
            ],
            order: [["createdAt", "DESC"]],
            limit: 500
        });
        const privateChats = [];
        const seen = new Set();
        for (const message of privateMessages) {
            const other = message.senderProfileId === profile.id ? message.receiver : message.sender;
            if (!other || seen.has(other.id)) continue;
            seen.add(other.id);
            privateChats.push({
                profile: await safeProfile(other),
                latestMessage: {
                    content: message.content,
                    type: message.type,
                    createdAt: message.createdAt,
                    isRead: message.isRead,
                    isOwn: message.senderProfileId === profile.id
                },
                unreadCount: 0
            });
        }
        if (privateChats.length) {
            const unreadCounts = await ChatMessage.findAll({
                attributes: [
                    "senderProfileId",
                    [sequelize.fn("COUNT", sequelize.col("id")), "unreadCount"]
                ],
                where: {
                    courseId: null,
                    senderProfileId: { [Op.in]: privateChats.map((chat) => chat.profile.id) },
                    receiverProfileId: profile.id,
                    isRead: false
                },
                group: ["senderProfileId"],
                raw: true
            });
            const unreadCountByProfile = new Map(unreadCounts.map((entry) => [
                entry.senderProfileId,
                Number(entry.unreadCount)
            ]));
            for (const chat of privateChats) {
                chat.unreadCount = unreadCountByProfile.get(chat.profile.id) || 0;
            }
        }
        const trackedProfileIds = [...new Set([
            ...privateChats.map((chat) => chat.profile.id),
            ...(developerProfile && developerProfile.id !== profile.id ? [developerProfile.id] : [])
        ])];
        const onlineProfileIds = trackedProfileIds.length
            ? (await ChatPresence.findAll({
                where: {
                    profileId: { [Op.in]: trackedProfileIds },
                    lastSeenAt: { [Op.gte]: new Date(Date.now() - presenceExpiryMs) }
                },
                attributes: ["profileId"],
                raw: true
            })).map((entry) => entry.profileId)
            : [];
        return res.json({
            profile: await safeProfile(profile),
            developerProfile: await safeProfile(developerProfile),
            courses: courseChats,
            privateChats,
            onlineProfileIds
        });
    } catch (error) {
        return next(error);
    }
};

exports.saveProfile = async (req, res, next) => {
    try {
        const username = normalizeChatUsername(req.body.username);
        let avatarUrl = req.body.avatarUrl == null || req.body.avatarUrl === "" ? null : req.body.avatarUrl;
        let uploadedAvatar;
        const about = typeof req.body.about === "string" ? req.body.about.trim() : "";
        if (!username) {
            return res.status(400).json({
                message: "Username must contain 1–20 characters and cannot include control characters."
            });
        }
        if (about.length > 200) {
            return res.status(400).json({ message: "About must be 200 characters or fewer." });
        }
        if (avatarUrl !== null) {
            const isHttpsUrl = typeof avatarUrl === "string" && avatarUrl.length <= 2048 &&
                /^https:\/\/[^\s]+$/i.test(avatarUrl);
            const isImageData = typeof avatarUrl === "string" &&
                /^data:image\/(?:jpeg|png|webp);base64,[a-z0-9+/]+=*$/i.test(avatarUrl) &&
                Buffer.from(avatarUrl.slice(avatarUrl.indexOf(",") + 1), "base64").length <= objectStorage.maxProfileImageSize;
            if (!isHttpsUrl && !isImageData) {
                return res.status(400).json({
                    message: `Choose a JPG, PNG, or WebP profile picture up to ${objectStorage.maxProfileImageSize / 1024 / 1024} MB.`
                });
            }
            if (isImageData && !objectStorage.isConfigured()) {
                return res.status(503).json({ message: "Profile image storage is temporarily unavailable." });
            }
            if (isImageData) {
                const match = avatarUrl.match(/^data:(image\/(?:jpeg|png|webp));base64,([a-z0-9+/]+=*)$/i);
                const buffer = Buffer.from(match[2], "base64");
                if (!objectStorage.isImageBuffer(buffer, match[1].toLowerCase())) {
                    return res.status(400).json({ message: "The profile image contents do not match its file type." });
                }
                const extension = match[1].toLowerCase() === "image/jpeg" ? ".jpg"
                    : match[1].toLowerCase() === "image/png" ? ".png" : ".webp";
                uploadedAvatar = await objectStorage.storeBuffer({
                    buffer,
                    fileName: `profile${extension}`,
                    contentType: match[1].toLowerCase(),
                    userId: req.user.id
                });
                avatarUrl = uploadedAvatar.fileUrl;
            }
        }

        const user = await User.findByPk(req.user.id, { attributes: ["id", "fullName"] });
        if (!user) return res.status(404).json({ message: "Account not found" });
        const existingUsername = await usernameOwner(username);
        if (existingUsername && Number(existingUsername.userId) !== Number(req.user.id)) {
            return res.status(409).json({ message: "That chat username is already taken." });
        }
        const [profile, created] = await ChatProfile.findOrCreate({
            where: { userId: req.user.id },
            defaults: {
                userId: req.user.id,
                username,
                fullName: user.fullName,
                avatarUrl,
                about
            }
        });
        const previousReference = created
            ? null
            : await findFileReference({ resourceType: "chat-profile", resourceId: profile.id });
        await sequelize.transaction(async (transaction) => {
            if (!created) {
                profile.username = username;
                profile.fullName = user.fullName;
                profile.avatarUrl = avatarUrl;
                profile.about = about;
                await profile.save({ transaction });
            }
            if (previousReference && previousReference.fileId !== uploadedAvatar?.storedFileId) {
                await removeFileReference({
                    fileId: previousReference.fileId,
                    resourceType: "chat-profile",
                    resourceId: profile.id,
                    transaction
                });
            }
            if (uploadedAvatar?.storedFileId) {
                await attachFileReference({
                    fileId: uploadedAvatar.storedFileId,
                    resourceType: "chat-profile",
                    resourceId: profile.id,
                    ownerId: req.user.id,
                    transaction
                });
            }
        });
        return res.status(created ? 201 : 200).json({ profile: await safeProfile(profile) });
    } catch (error) {
        if (error.name === "SequelizeUniqueConstraintError") {
            return res.status(409).json({ message: "That chat username is already taken." });
        }
        return next(error);
    }
};

exports.checkUsernameAvailability = async (req, res, next) => {
    try {
        const username = normalizeChatUsername(req.query.username);
        if (!username) {
            return res.status(400).json({
                message: "Username must contain 1–20 characters and cannot include control characters."
            });
        }
        const owner = await usernameOwner(username);
        return res.json({
            available: !owner || Number(owner.userId) === Number(req.user.id)
        });
    } catch (error) {
        return next(error);
    }
};

exports.updateProfileVisibility = async (req, res, next) => {
    try {
        const profile = await profileFor(req.user.id);
        if (!profile) return profileMissing(res);
        const body = req.body || {};
        const updates = Object.fromEntries(contactVisibilityFields
            .filter((field) => Object.prototype.hasOwnProperty.call(body, field))
            .map((field) => [field, body[field]]));
        if (!Object.keys(updates).length || Object.values(updates).some((value) =>
            typeof value !== "string" || !contactVisibilityOptions.has(value)
        )) {
            return res.status(400).json({
                message: "Choose whether each private credential is visible to everyone or private chat contacts only."
            });
        }
        Object.assign(profile, updates);
        await profile.save();
        return res.json({
            visibility: Object.fromEntries(contactVisibilityFields.map((field) => [field, profile[field]]))
        });
    } catch (error) {
        return next(error);
    }
};

exports.searchProfiles = async (req, res, next) => {
    try {
        const profile = await profileFor(req.user.id);
        if (!profile) return profileMissing(res);
        const username = normalizeChatUsername(String(req.query.username || "").trim().replace(/^@/, ""));
        const courseId = req.query.courseId == null ? null : Number(req.query.courseId);
        if (!username) {
            return res.json(courseId ? { profiles: [] } : { profile: null });
        }
        if (courseId !== null) {
            if (!Number.isSafeInteger(courseId) || !(await getCourseAccess(courseId, profile))) {
                return res.status(403).json({ message: "You must be enrolled in this course to search its members." });
            }
            const members = await Enrollment.findAll({
                where: { courseId, studentId: { [Op.ne]: req.user.id } },
                attributes: ["studentId"]
            });
            const matches = members.length ? await ChatProfile.findAll({
                where: {
                    userId: { [Op.in]: members.map((member) => member.studentId) },
                    username: { [Op.iLike]: `${username.replace(/[\\%_]/g, "\\$&")}%` }
                },
                attributes: profileFields,
                limit: 5,
                order: [["username", "ASC"]]
            }) : [];
            return res.json({ profiles: await Promise.all(matches.map((match) => safeProfile(match))) });
        }
        const match = await ChatProfile.findOne({
            where: sequelize.where(sequelize.fn("LOWER", sequelize.col("username")), username.toLowerCase()),
            attributes: [...profileFields, "userId"]
        });
        if (!match || match.id === profile.id) {
            return res.json({ profile: null });
        }
        return res.json({ profile: await safeProfile(match) });
    } catch (error) {
        return next(error);
    }
};

exports.listCoursemates = async (req, res, next) => {
    try {
        const ownProfile = await profileFor(req.user.id);
        if (!ownProfile) return profileMissing(res);
        let courseIds = await enrolledCourseIds(req.user.id);
        if (!courseIds.length) {
            return res.json({ profiles: [] });
        }
        if (req.query.courseId != null) {
            const courseId = Number(req.query.courseId);
            if (!Number.isSafeInteger(courseId) || !courseIds.some((id) => Number(id) === courseId)) {
                return res.status(403).json({ message: "You must be enrolled in this course to list its coursemates." });
            }
            courseIds = [courseId];
        }
        if (req.query.withProfileId) {
            if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(req.query.withProfileId)) {
                return res.status(400).json({ message: "Invalid chat participant." });
            }
            const recipient = await ChatProfile.findByPk(req.query.withProfileId, {
                attributes: ["id", "userId"]
            });
            if (!recipient || recipient.id === ownProfile.id) {
                return res.status(404).json({ message: "No eligible student found for that chat." });
            }
            const recipientCourseIds = await enrolledCourseIds(recipient.userId);
            courseIds = courseIds.filter((courseId) =>
                recipientCourseIds.some((recipientCourseId) => Number(recipientCourseId) === Number(courseId))
            );
        }
        if (!courseIds.length) {
            return res.json({ profiles: [] });
        }
        const enrollments = await Enrollment.findAll({
            where: {
                courseId: { [Op.in]: courseIds },
                studentId: { [Op.ne]: req.user.id }
            },
            attributes: ["studentId"]
        });
        const userIds = [...new Set(enrollments.map((enrollment) => enrollment.studentId))];
        const profiles = userIds.length ? await ChatProfile.findAll({
            where: { userId: { [Op.in]: userIds } },
            attributes: profileFields,
            order: [["username", "ASC"]]
        }) : [];
        return res.json({ profiles: await Promise.all(profiles.map((profile) => safeProfile(profile))) });
    } catch (error) {
        return next(error);
    }
};

exports.getProfileSettings = async (req, res, next) => {
    try {
        const profile = await profileFor(req.user.id);
        if (!profile) return profileMissing(res);
        const user = await User.findByPk(req.user.id, { attributes: ["phone", "email", "matNumber"] });
        return res.json({
            phoneNumber: user?.phone || "",
            email: user?.email || "",
            matNumber: user?.matNumber || "",
            visibility: Object.fromEntries(contactVisibilityFields.map((field) => [field, profile[field]]))
        });
    } catch (error) {
        return next(error);
    }
};

exports.getPrivateContactApproval = async (req, res, next) => {
    try {
        const profile = await profileFor(req.user.id);
        if (!profile) return profileMissing(res);
        const contact = await ChatProfile.findByPk(req.params.profileId, { attributes: ["id"] });
        if (!contact || contact.id === profile.id ||
            !(await hasPrivateChatContact(profile.id, contact.id))) {
            return res.status(404).json({ message: "Private chat contact not found." });
        }
        return res.json({
            approved: await hasPrivateContactApproval(profile.id, contact.id)
        });
    } catch (error) {
        return next(error);
    }
};

exports.updatePrivateContactApproval = async (req, res, next) => {
    try {
        const profile = await profileFor(req.user.id);
        if (!profile) return profileMissing(res);
        const { approved } = req.body;
        if (typeof approved !== "boolean") {
            return res.status(400).json({ message: "Choose whether this contact can view your private details." });
        }
        const contact = await ChatProfile.findByPk(req.params.profileId, { attributes: ["id"] });
        if (!contact || contact.id === profile.id ||
            !(await hasPrivateChatContact(profile.id, contact.id))) {
            return res.status(404).json({ message: "Private chat contact not found." });
        }
        await ChatProfilePermission.upsert({
            profileId: profile.id,
            viewerProfileId: contact.id,
            canViewContactDetails: approved
        });
        return res.json({ approved });
    } catch (error) {
        return next(error);
    }
};

exports.getSharedProfile = async (req, res, next) => {
    try {
        const viewer = await profileFor(req.user.id);
        if (!viewer) return profileMissing(res);
        const target = await ChatProfile.findByPk(req.params.profileId, {
            attributes: [...profileFields, "userId", ...contactVisibilityFields]
        });
        if (!target || target.id === viewer.id) {
            return res.status(404).json({ message: "Chat profile not found." });
        }
        const sharedProfile = await safeProfile(target);
        const visibilityScopes = contactVisibilityFields.map((field) => target[field]);
        const [isCourseMate, hasPrivateConversation, hasContactApproval] = await Promise.all([
            visibilityScopes.includes("course")
                ? hasSharedCourse(req.user.id, target.userId)
                : false,
            visibilityScopes.includes("private_contacts")
                ? hasPrivateChatContact(viewer.id, target.id)
                : false,
            visibilityScopes.includes("private_contacts")
                ? hasPrivateContactApproval(target.id, viewer.id)
                : false
        ]);
        const userAttributes = [];
        const canView = (visibility) => visibility === "everyone"
            || (visibility === "course" && isCourseMate)
            || (visibility === "private_contacts" && hasPrivateConversation && hasContactApproval);
        if (canView(target.phoneVisibility)) userAttributes.push("phone");
        if (canView(target.emailVisibility)) userAttributes.push("email");
        if (canView(target.matNumberVisibility)) userAttributes.push("matNumber");
        if (userAttributes.length) {
            const user = await User.findByPk(target.userId, { attributes: userAttributes });
            for (const field of userAttributes) {
                sharedProfile[field === "matNumber" ? "matNumber" : field] = user?.[field] || null;
            }
        }
        return res.json({ profile: sharedProfile });
    } catch (error) {
        return next(error);
    }
};

exports.heartbeatPresence = async (req, res, next) => {
    try {
        const profile = await profileFor(req.user.id);
        if (!profile) return profileMissing(res);
        await ChatPresence.upsert({
            profileId: profile.id,
            lastSeenAt: new Date()
        });
        return res.status(204).end();
    } catch (error) {
        return next(error);
    }
};

exports.getPresence = async (req, res, next) => {
    try {
        const profileId = req.params.profileId;
        if (!/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(profileId)) {
            return res.status(400).json({ message: "Invalid chat profile." });
        }
        const viewer = await profileFor(req.user.id);
        if (!viewer) return profileMissing(res);
        const target = await ChatProfile.findByPk(profileId, { attributes: ["id", "userId"] });
        if (!target || target.id === viewer.id ||
            (!(await hasSharedCourse(req.user.id, target.userId)) &&
                !(await hasPrivateChatContact(viewer.id, target.id)))) {
            return res.status(404).json({ message: "Chat profile not found." });
        }
        const presence = await ChatPresence.findByPk(target.id, { attributes: ["lastSeenAt"] });
        const lastSeenAt = presence ? new Date(presence.lastSeenAt).getTime() : 0;
        return res.set("Cache-Control", "no-store").json({
            profileId: target.id,
            online: lastSeenAt > 0 && Date.now() - lastSeenAt <= presenceExpiryMs
        });
    } catch (error) {
        return next(error);
    }
};

exports.listCourseMessages = async (req, res, next) => {
    try {
        const profile = await profileFor(req.user.id);
        if (!profile) return profileMissing(res);
        const courseId = Number(req.params.courseId);
        if (!Number.isSafeInteger(courseId) || courseId < 1) {
            return res.status(400).json({ message: "Invalid course" });
        }
        const course = await getCourseAccess(courseId, profile);
        if (!course) return res.status(403).json({ message: "You must be enrolled in this course to open its group chat." });
        const [hiddenIds, readState] = await Promise.all([
            hiddenMessageIds(profile.id),
            ChatReadState.findOne({ where: { profileId: profile.id, courseId } })
        ]);
        const messages = await ChatMessage.findAll({
            where: {
                courseId,
                receiverProfileId: null,
                ...(hiddenIds.length ? { id: { [Op.notIn]: hiddenIds } } : {})
            },
            include: [
                { model: ChatProfile, as: "sender", attributes: profileFields },
                { model: ChatMessage, as: "reply", attributes: ["id", "content", "type"] },
                { model: ChatMessageReaction, as: "reactions", attributes: ["profileId", "emoji"] }
            ],
            order: [["createdAt", "DESC"]],
            limit: 100
        });
        const unreadSince = readState?.lastReadAt ? new Date(readState.lastReadAt).getTime() : 0;
        const messagesWithUnreadFlags = await Promise.all(messages.map(async (message) => ({
            ...await serializeMessage(message, profile.id),
            isNew: message.senderProfileId !== profile.id &&
                new Date(message.createdAt).getTime() > unreadSince
        })));
        await ChatReadState.upsert({
            profileId: profile.id,
            courseId,
            lastReadAt: new Date()
        });
        return res.json(messagesWithUnreadFlags.reverse());
    } catch (error) {
        return next(error);
    }
};

exports.listPrivateMessages = async (req, res, next) => {
    try {
        const profile = await profileFor(req.user.id);
        if (!profile) return profileMissing(res);
        const other = await ChatProfile.findByPk(req.params.profileId, {
            attributes: [...profileFields, "userId"]
        });
        if (!other || other.id === profile.id) {
            return res.status(404).json({ message: "No eligible student found for that chat." });
        }
        const hiddenIds = await hiddenMessageIds(profile.id);
        const messages = await ChatMessage.findAll({
            where: {
                courseId: null,
                ...(hiddenIds.length ? { id: { [Op.notIn]: hiddenIds } } : {}),
                [Op.or]: [
                    { senderProfileId: profile.id, receiverProfileId: other.id },
                    { senderProfileId: other.id, receiverProfileId: profile.id }
                ]
            },
            include: [
                { model: ChatProfile, as: "sender", attributes: profileFields },
                { model: ChatMessage, as: "reply", attributes: ["id", "content", "type"] },
                { model: ChatMessageReaction, as: "reactions", attributes: ["profileId", "emoji"] }
            ],
            order: [["createdAt", "DESC"]],
            limit: 100
        });
        const incomingMessages = messages.filter((message) => message.senderProfileId === other.id);
        const deliveredAt = new Date();
        const undeliveredIds = incomingMessages
            .filter((message) => !message.deliveredAt)
            .map((message) => message.id);
        if (undeliveredIds.length) {
            await ChatMessage.update({ deliveredAt }, {
                where: { id: { [Op.in]: undeliveredIds } }
            });
            chatRealtime.publishProfiles([other.id], "delivered", {
                profileId: profile.id,
                messageIds: undeliveredIds
            });
        }
        const [updatedCount] = await ChatMessage.update({ isRead: true }, {
            where: { senderProfileId: other.id, receiverProfileId: profile.id, isRead: false }
        });
        if (updatedCount > 0) {
            chatRealtime.publishProfiles([other.id], "read", {
                profileId: profile.id,
                conversationProfileId: other.id
            });
        }
        const incomingIds = new Set(incomingMessages.map((message) => message.id));
        return res.json(await Promise.all(messages.reverse().map(async (message) => {
            const data = await serializeMessage(message, profile.id);
            if (incomingIds.has(message.id)) {
                data.deliveredAt = message.deliveredAt || deliveredAt;
                data.isRead = true;
            }
            return data;
        })));
    } catch (error) {
        return next(error);
    }
};

exports.sendMessage = async (req, res, next) => {
    let uploadedStorageKey;
    const cleanupStagedUpload = async () => {
        if (!uploadedStorageKey) return;
        try {
            await objectStorage.remove(uploadedStorageKey);
            uploadedStorageKey = null;
        } catch (error) {
            console.error("Failed to remove rejected chat attachment:", error.message);
        }
    };
    const reject = async (status, message) => {
        await cleanupStagedUpload();
        return res.status(status).json({ message });
    };
    try {
        let uploadedStoredFileId = null;
        let uploadedFileUrl = null;
        if (!req.file && req.body.fileStorageKey) {
            if (!objectStorage.validateStorageKey(req.body.fileStorageKey, req.user.id)) {
                return res.status(400).json({ message: "The uploaded attachment is invalid." });
            }
            uploadedStorageKey = req.body.fileStorageKey;
            const uploaded = await objectStorage.resolveChatUpload(req.body, req.user.id);
            req.file = uploaded.file;
            uploadedStoredFileId = uploaded.storedFileId;
            uploadedFileUrl = uploaded.fileUrl;
            uploadedStorageKey = objectKeyFor(uploaded.fileUrl) || uploadedStorageKey;
        }
        const profile = await profileFor(req.user.id);
        if (!profile) {
            await cleanupStagedUpload();
            return profileMissing(res);
        }
        const courseId = req.body.courseId == null ? null : Number(req.body.courseId);
        const receiverProfileId = req.body.receiverProfileId || null;
        let content = typeof req.body.content === "string" ? req.body.content.trim() : "";
        const type = messageTypes.has(req.body.type) ? req.body.type : "text";
        let replyTo = req.body.replyTo || null;
        const clientMessageId = typeof req.body.clientMessageId === "string" ? req.body.clientMessageId : null;
        if (clientMessageId && !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(clientMessageId)) {
            return reject(400, "The message request ID is invalid.");
        }
        if (clientMessageId) {
            const existingMessage = await ChatMessage.findOne({
                where: { senderProfileId: profile.id, clientMessageId },
                include: [
                    { model: ChatProfile, as: "sender", attributes: profileFields },
                    { model: ChatMessage, as: "reply", attributes: ["id", "content", "type"] },
                    { model: ChatMessageReaction, as: "reactions", attributes: ["profileId", "emoji"] }
                ]
            });
            if (existingMessage) {
                await cleanupStagedUpload();
                return res.status(200).json(await serializeMessage(existingMessage, profile.id));
            }
        }
        const mediaGroupId = typeof req.body.mediaGroupId === "string" ? req.body.mediaGroupId : null;
        if (mediaGroupId && (type !== "image" ||
            !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(mediaGroupId))) {
            return reject(400, "The image group is invalid.");
        }
        if (type !== "voice" && type !== "image" && type !== "file" && (!content || content.length > 4000)) {
            return reject(400, "Message must contain 1–4000 characters.");
        }
        if (["voice", "image", "file"].includes(type) && !req.file) {
            return reject(400, "Choose a file before sending.");
        }
        if (type === "contact" && (!content || content.length > 4000)) {
            return reject(400, "Choose a coursemate contact before sending.");
        }
        if ((courseId === null) === (receiverProfileId === null)) {
            return reject(400, "Choose one course chat or one private recipient.");
        }
        if (type === "gif" || type === "sticker") {
            let url;
            try { url = new URL(content); } catch { return reject(400, "Media must be a valid HTTPS URL."); }
            const allowedMediaHost = ["tenor.com", "giphy.com"].some((domain) => (
                url.hostname === domain || url.hostname.endsWith(`.${domain}`)
            ));
            if (url.protocol !== "https:" || !allowedMediaHost) {
                return reject(400, "Only Tenor or Giphy media links are allowed.");
            }
        }
        if (type === "voice" && (!allowedAudioTypes.has(req.file.mimetype) ||
            !objectStorage.isAudioBuffer(req.file.buffer, req.file.mimetype) || req.file.size > 5 * 1024 * 1024)) {
            return reject(400, "Voice notes must be supported audio files up to 5 MB.");
        }
        if (type === "image" && (!allowedImageTypes.has(req.file.mimetype) ||
            !objectStorage.isImageBuffer(req.file.buffer, req.file.mimetype) || req.file.size > 5 * 1024 * 1024)) {
            return reject(400, "Images must be JPG, PNG, WebP, or GIF files up to 5 MB.");
        }
        if (type === "file" && req.file.size > 5 * 1024 * 1024) {
            return reject(400, "Files must be 5 MB or smaller.");
        }
        if (type === "file" && objectStorage.isDangerousChatFile(req.file.originalname, req.file.buffer)) {
            return reject(400, "Unsupported chat attachment format.");
        }
        if (type === "file" && /\.pdf$/i.test(req.file.originalname) &&
            !req.file.buffer.subarray(0, 5).equals(Buffer.from("%PDF-"))) {
            return reject(400, "The PDF contents do not match the selected file type.");
        }
        if (["image", "file"].includes(type) && req.file) {
            content = req.file.originalname
                .split(/[\\/]/)
                .pop()
                .replace(/[\u0000-\u001f\u007f]/g, "")
                .slice(0, 255) || (type === "image" ? "Image" : "File");
        }

        let validMentionUserIds = [];
        if (courseId !== null) {
            if (!Number.isSafeInteger(courseId) || !(await getCourseAccess(courseId, profile))) {
                return reject(403, "You must be enrolled in this course to send a group message.");
            }
            const mentionNames = [...new Set(
                (content.match(/@([a-z0-9_]{3,20})/gi) || [])
                    .map((mention) => mention.slice(1).toLowerCase())
            )];
            if (mentionNames.length) {
                const members = await Enrollment.findAll({
                    where: { courseId, studentId: { [Op.ne]: req.user.id } },
                    attributes: ["studentId"]
                });
                validMentionUserIds = members.map((member) => member.studentId);
                const profiles = validMentionUserIds.length ? await ChatProfile.findAll({
                    where: { userId: { [Op.in]: validMentionUserIds }, username: { [Op.in]: mentionNames } },
                    attributes: ["id", "username"]
                }) : [];
                validMentionUserIds = profiles;
            }
        } else {
            const recipient = await ChatProfile.findByPk(receiverProfileId, { attributes: ["id", "userId"] });
            if (!recipient || recipient.id === profile.id) {
                return reject(403, "Choose another SmartCampus student for a private chat.");
            }
        }

        if (type === "contact") {
            let contactId;
            try {
                contactId = JSON.parse(content).profileId;
            } catch {
                return reject(400, "Choose a valid coursemate contact.");
            }
            const contact = await ChatProfile.findByPk(contactId, {
                attributes: [...profileFields, "userId"]
            });
            if (!contact || contact.id === profile.id ||
                !(await hasSharedCourse(req.user.id, contact.userId))) {
                return reject(403, "You can only share contacts of coursemates.");
            }
            let contactVisibleToConversation;
            if (courseId !== null) {
                contactVisibleToConversation = Boolean(await Enrollment.findOne({
                    where: { courseId, studentId: contact.userId },
                    attributes: ["id"]
                }));
            } else {
                const recipient = await ChatProfile.findByPk(receiverProfileId, { attributes: ["userId"] });
                contactVisibleToConversation = Boolean(
                    recipient && await hasSharedCourse(recipient.userId, contact.userId)
                );
            }
            if (!contactVisibleToConversation) {
                return reject(403, "That contact is not a coursemate of everyone in this conversation.");
            }
            req.contactCard = await safeProfile(contact, { signAvatar: false });
        }

        if (replyTo) {
            const reply = await ChatMessage.findOne({
                where: courseId !== null
                    ? {
                        courseId,
                        receiverProfileId: null,
                        [Op.or]: [
                            { id: replyTo },
                            { senderProfileId: profile.id, clientMessageId: replyTo }
                        ]
                    }
                    : {
                        courseId: null,
                        [Op.and]: [
                            { [Op.or]: [
                                { senderProfileId: profile.id, receiverProfileId },
                                { senderProfileId: receiverProfileId, receiverProfileId: profile.id }
                            ] },
                            { [Op.or]: [
                                { id: replyTo },
                                { senderProfileId: profile.id, clientMessageId: replyTo }
                            ] }
                        ]
                    },
                attributes: ["id"]
            });
            if (!reply) return reject(400, "The message you are replying to is unavailable.");
            replyTo = reply.id;
        }

        const validMentionNames = validMentionUserIds.map((member) => member.username);
        const mentions = (content.match(/@([a-z0-9_]{3,20})/gi) || [])
            .map((mention) => mention.slice(1).toLowerCase())
            .filter((username) => validMentionNames.includes(username));
        if (["voice", "image", "file"].includes(type) && req.file && !uploadedStoredFileId) {
            if (!objectStorage.isConfigured()) {
                if (process.env.VERCEL) {
                    return reject(503, "File storage is temporarily unavailable.");
                }
            } else {
                const stored = await objectStorage.storeChatBuffer({
                    buffer: req.file.buffer,
                    fileName: req.file.originalname,
                    contentType: req.file.mimetype,
                    userId: req.user.id,
                    mediaType: type
                });
                uploadedStoredFileId = stored.storedFileId;
                uploadedFileUrl = stored.fileUrl;
                uploadedStorageKey = objectKeyFor(stored.fileUrl);
                req.file = {
                    ...req.file,
                    buffer: stored.buffer,
                    originalname: stored.fileName,
                    mimetype: stored.mimeType,
                    size: stored.fileSize
                };
            }
        }
        const message = await sequelize.transaction(async (transaction) => {
            const created = await ChatMessage.create({
                courseId,
                senderProfileId: profile.id,
                receiverProfileId,
                content: type === "contact" ? JSON.stringify(req.contactCard) : content,
                mediaGroupId,
                clientMessageId,
                type,
                mentions,
                replyTo
            }, { transaction });
            if (["voice", "image", "file"].includes(type)) {
                await ChatMessageMedia.create({
                    messageId: created.id,
                    contentType: req.file.mimetype,
                    data: uploadedStoredFileId ? null : req.file.buffer,
                    fileUrl: uploadedFileUrl
                }, { transaction });
                if (uploadedStoredFileId) {
                    await attachFileReference({
                        fileId: uploadedStoredFileId,
                        resourceType: "chat-message",
                        resourceId: created.id,
                        ownerId: req.user.id,
                        transaction
                    });
                }
            }
            return created;
        });
        if (uploadedStorageKey) {
            try {
                await objectStorage.remove(uploadedStorageKey);
                uploadedStorageKey = null;
            } catch (error) {
                console.error("Failed to remove chat attachment staging object:", error.message);
            }
        }
        const result = await ChatMessage.findByPk(message.id, {
            include: [
                { model: ChatProfile, as: "sender", attributes: profileFields },
                { model: ChatMessage, as: "reply", attributes: ["id", "content", "type"] },
                { model: ChatMessageReaction, as: "reactions", attributes: ["profileId", "emoji"] }
            ]
        });
        const serialized = await serializeMessage(result, profile.id);
        if (courseId !== null) {
            chatRealtime.publishCourse(courseId, "message", serialized);
            chatRealtime.publishProfiles(
                validMentionUserIds
                    .filter((mentioned) => mentions.includes(mentioned.username))
                    .map((mentioned) => mentioned.id),
                "mention",
                { message: serialized }
            );
        } else {
            chatRealtime.publishProfiles([profile.id, receiverProfileId], "message", serialized);
        }
        return res.status(201).json(serialized);
    } catch (error) {
        if (uploadedStorageKey) {
            try {
                await objectStorage.remove(uploadedStorageKey);
            } catch (cleanupError) {
                console.error("Failed to remove rejected chat attachment:", cleanupError.message);
            }
        }
        return next(error);
    }
};

exports.toggleReaction = async (req, res, next) => {
    try {
        const profile = await profileFor(req.user.id);
        if (!profile) return profileMissing(res);
        const emoji = typeof req.body.emoji === "string" ? req.body.emoji : "";
        if (!reactionEmojis.has(emoji)) {
            return res.status(400).json({ message: "Choose one of the available reaction emojis." });
        }
        const message = await ChatMessage.findByPk(req.params.id, {
            attributes: ["id", "courseId", "senderProfileId", "receiverProfileId"]
        });
        if (!message) return res.status(404).json({ message: "Message not found." });
        if (!(await canAccessMessage(message, profile))) {
            return res.status(403).json({ message: "You do not have access to this message." });
        }

        const existing = await ChatMessageReaction.findOne({
            where: { messageId: message.id, profileId: profile.id, emoji }
        });
        if (existing) await existing.destroy();
        else await ChatMessageReaction.create({ messageId: message.id, profileId: profile.id, emoji });

        const reactions = await ChatMessageReaction.findAll({
            where: { messageId: message.id },
            attributes: ["profileId", "emoji"]
        });
        const summary = summarizeReactions(reactions.map((reaction) => reaction.toJSON()), profile.id);
        const event = { messageId: message.id };
        if (message.courseId !== null) chatRealtime.publishCourse(message.courseId, "reaction", event);
        else chatRealtime.publishProfiles(
            [message.senderProfileId, message.receiverProfileId],
            "reaction",
            event
        );
        return res.json({ ...event, reactions: summary });
    } catch (error) {
        return next(error);
    }
};

exports.markRead = async (req, res, next) => {
    try {
        const profile = await profileFor(req.user.id);
        if (!profile) return profileMissing(res);
        const message = await ChatMessage.findOne({
            where: {
                id: req.params.id,
                receiverProfileId: profile.id,
                courseId: null
            }
        });
        if (!message) return res.status(404).json({ message: "Private message not found." });
        if (!message.isRead) {
            const wasUndelivered = !message.deliveredAt;
            const deliveredAt = message.deliveredAt || new Date();
            message.isRead = true;
            message.deliveredAt = deliveredAt;
            await message.save();
            if (wasUndelivered) {
                chatRealtime.publishProfiles([message.senderProfileId], "delivered", {
                    profileId: profile.id,
                    messageIds: [message.id]
                });
            }
            chatRealtime.publishProfiles([message.senderProfileId], "read", {
                profileId: profile.id,
                conversationProfileId: profile.id
            });
        }
        return res.json({ message: "Message marked as read." });
    } catch (error) {
        return next(error);
    }
};

exports.streamEvents = async (req, res, next) => {
    try {
        const profile = await profileFor(req.user.id);
        if (!profile) {
            res.status(409).json({ message: "Create your chat username before using chat.", profileRequired: true });
            return;
        }
        const courseIds = await enrolledCourseIds(req.user.id);
        res.status(200);
        res.set({
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache, no-transform",
            Connection: "keep-alive",
            "X-Accel-Buffering": "no"
        });
        res.flushHeaders();
        const unsubscribe = chatRealtime.subscribe({
            userId: req.user.id,
            profileId: profile.id,
            courseIds,
            response: res
        });
        const heartbeat = setInterval(() => {
            if (!res.writableEnded) res.write(": keep-alive\n\n");
        }, 20000);
        const membershipRefresh = setInterval(async () => {
            try {
                chatRealtime.updateUserCourses(req.user.id, await enrolledCourseIds(req.user.id));
            } catch (error) {
                console.error("Chat stream membership refresh failed:", error.message);
                res.end();
            }
        }, 5000);
        res.on("close", () => {
            clearInterval(heartbeat);
            clearInterval(membershipRefresh);
            unsubscribe();
        });
    } catch (error) {
        return next(error);
    }
};

exports.getRealtimeToken = async (req, res, next) => {
    try {
        const profile = await profileFor(req.user.id);
        if (!profile) return profileMissing(res);
        if (!process.env.SUPABASE_JWT_SECRET) {
            return res.status(503).json({
                message: "Supabase Realtime is not configured. The secure server event stream remains available."
            });
        }
        const token = jwt.sign({
            sub: profile.id,
            role: "authenticated",
            aud: "authenticated",
            app_metadata: { provider: "smartcampus", providers: ["smartcampus"] },
            user_metadata: { username: profile.username }
        }, process.env.SUPABASE_JWT_SECRET, {
            algorithm: "HS256",
            expiresIn: "10m"
        });
        return res.json({ token, expiresIn: 600 });
    } catch (error) {
        return next(error);
    }
};

exports.sendTyping = async (req, res, next) => {
    try {
        const profile = await profileFor(req.user.id);
        if (!profile) return profileMissing(res);
        const isTyping = req.body.isTyping === true;
        if (req.body.courseId != null) {
            const courseId = Number(req.body.courseId);
            if (!Number.isSafeInteger(courseId) || !(await getCourseAccess(courseId, profile))) {
                return res.status(403).json({ message: "You must be enrolled in this course to send typing status." });
            }
            chatRealtime.publishCourse(courseId, "typing", {
                profileId: profile.id,
                username: profile.username,
                courseId,
                isTyping
            }, req.user.id);
        } else {
            const recipient = await ChatProfile.findByPk(req.body.receiverProfileId, {
                attributes: ["id"]
            });
            if (!recipient || recipient.id === profile.id) {
                return res.status(403).json({ message: "Choose another SmartCampus student for a private chat." });
            }
            chatRealtime.publishProfiles([recipient.id], "typing", {
                profileId: profile.id,
                username: profile.username,
                conversationProfileId: profile.id,
                isTyping
            });
        }
        return res.status(204).end();
    } catch (error) {
        return next(error);
    }
};

exports.searchMedia = async (req, res, next) => {
    try {
        const profile = await profileFor(req.user.id);
        if (!profile) return profileMissing(res);
        const query = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 80) : "";
        const type = req.query.type === "sticker" ? "sticker" : "gif";
        if (query.length < 2) return res.status(400).json({ message: "Enter at least two characters to search." });
        const provider = process.env.GIPHY_API_KEY ? "giphy" : process.env.TENOR_API_KEY ? "tenor" : null;
        if (!provider) {
            return res.status(503).json({ message: "GIF search is not configured. Set GIPHY_API_KEY on the backend." });
        }
        const endpoint = provider === "giphy"
            ? new URL(`https://api.giphy.com/v1/${type === "sticker" ? "stickers" : "gifs"}/search`)
            : new URL("https://tenor.googleapis.com/v2/search");
        endpoint.search = provider === "giphy"
            ? new URLSearchParams({
                api_key: process.env.GIPHY_API_KEY,
                q: query,
                limit: "12",
                rating: "g"
            })
            : new URLSearchParams({
                q: query,
                key: process.env.TENOR_API_KEY,
                client_key: "smartcampus",
                limit: "12",
                ...(type === "sticker" ? { searchfilter: "sticker" } : {}),
                media_filter: type === "sticker"
                    ? "webp_transparent,tinywebp_transparent"
                    : "gif,tinygif"
            });
        const response = await fetch(endpoint, { signal: AbortSignal.timeout(8000) });
        if (!response.ok) {
            console.error(`${provider} search failed with status`, response.status);
            return res.status(502).json({ message: "GIF search is temporarily unavailable." });
        }
        const data = await response.json();
        const results = provider === "giphy"
            ? (data.data || []).map((item) => {
                const images = item.images || {};
                const media = images.original || images.downsized_medium || images.fixed_height;
                const preview = images.fixed_width_small || images.fixed_height_small || media;
                return media?.url ? { id: item.id, url: media.url, previewUrl: preview?.url || media.url } : null;
            }).filter(Boolean)
            : (data.results || []).map((item) => {
                const formats = item.media_formats || {};
                const media = type === "sticker"
                    ? (formats.webp_transparent || formats.gif_transparent)
                    : (formats.gif || formats.tinygif);
                const preview = type === "sticker"
                    ? (formats.tinywebp_transparent || formats.tinygif_transparent || media)
                    : (formats.tinygif || media);
                return media?.url ? { id: item.id, url: media.url, previewUrl: preview?.url || media.url } : null;
            }).filter(Boolean);
        return res.json({ results });
    } catch (error) {
        if (error.name === "TimeoutError" || error.name === "AbortError") {
            return res.status(504).json({ message: "GIF search timed out. Please try again." });
        }
        return next(error);
    }
};

exports.getMessageMedia = async (req, res, next) => {
    try {
        const profile = await profileFor(req.user.id);
        if (!profile) return profileMissing(res);
        const message = await ChatMessage.findByPk(req.params.id, {
            attributes: ["id", "courseId", "senderProfileId", "receiverProfileId", "type", "content"]
        });
        if (!message || !["voice", "image", "file"].includes(message.type)) {
            return res.status(404).json({ message: "Message attachment not found." });
        }
        if (!(await canAccessMessage(message, profile))) {
            return res.status(403).json({ message: "You do not have access to this attachment." });
        }
        const media = await ChatMessageMedia.findOne({
            where: { messageId: message.id },
            attributes: ["contentType", "data", "fileUrl"]
        });
        if (!media) return res.status(404).json({ message: "Message attachment not found." });
        const data = media.fileUrl
            ? await objectStorage.download(objectKeyFor(media.fileUrl), 5 * 1024 * 1024)
            : media.data;
        if (!data) return res.status(404).json({ message: "Message attachment not found." });
        const isPdf = message.type === "file" && /\.pdf$/i.test(message.content || "");
        const contentType = isPdf ? "application/pdf" : media.contentType;
        const disposition = message.type === "file" && !isPdf ? "attachment" : "inline";
        const fileName = String(message.content || "attachment")
            .replace(/[\u0000-\u001f\u007f"\\]/g, "_")
            .slice(0, 255);
        res.set({
            "Content-Type": contentType,
            "Content-Length": String(data.length),
            "Content-Disposition": `${disposition}; filename*=UTF-8''${encodeURIComponent(fileName)}`,
            "Cache-Control": "private, no-store",
            "X-Content-Type-Options": "nosniff"
        });
        return res.status(200).send(data);
    } catch (error) {
        return next(error);
    }
};

exports.toggleSaved = async (req, res, next) => {
    try {
        const profile = await profileFor(req.user.id);
        if (!profile) return profileMissing(res);
        const message = await ChatMessage.findByPk(req.params.id, {
            attributes: ["id", "courseId", "senderProfileId", "receiverProfileId"]
        });
        if (!message) return res.status(404).json({ message: "Message not found." });
        if (!(await canAccessMessage(message, profile))) {
            return res.status(403).json({ message: "You do not have access to this message." });
        }
        const [, created] = await ChatSavedMessage.findOrCreate({
            where: { profileId: profile.id, messageId: message.id },
            defaults: { profileId: profile.id, messageId: message.id }
        });
        return res.status(created ? 201 : 200).json({ saved: true });
    } catch (error) {
        return next(error);
    }
};

exports.removeSaved = async (req, res, next) => {
    try {
        const profile = await profileFor(req.user.id);
        if (!profile) return profileMissing(res);
        await ChatSavedMessage.destroy({ where: { profileId: profile.id, messageId: req.params.id } });
        return res.status(204).end();
    } catch (error) {
        return next(error);
    }
};

exports.listSaved = async (req, res, next) => {
    try {
        const profile = await profileFor(req.user.id);
        if (!profile) return profileMissing(res);
        const saved = await ChatSavedMessage.findAll({
            where: { profileId: profile.id },
            include: [{
                model: ChatMessage,
                as: "message",
                include: [
                    { model: ChatProfile, as: "sender", attributes: profileFields },
                    { model: ChatProfile, as: "receiver", attributes: profileFields }
                ]
            }],
            order: [["createdAt", "DESC"]],
            limit: 200
        });
        const accessible = [];
        for (const item of saved) {
            if (item.message && await canAccessMessage(item.message, profile)) {
                accessible.push(item.message);
            }
        }
        return res.json(accessible);
    } catch (error) {
        return next(error);
    }
};

exports.hideMessage = async (req, res, next) => {
    try {
        const profile = await profileFor(req.user.id);
        if (!profile) return profileMissing(res);
        const message = await ChatMessage.findByPk(req.params.id, {
            attributes: ["id", "courseId", "senderProfileId", "receiverProfileId"]
        });
        if (!message) return res.status(404).json({ message: "Message not found." });
        if (!(await canAccessMessage(message, profile))) {
            return res.status(403).json({ message: "You do not have access to this message." });
        }
        await ChatHiddenMessage.findOrCreate({
            where: { profileId: profile.id, messageId: message.id },
            defaults: { profileId: profile.id, messageId: message.id }
        });
        await ChatSavedMessage.destroy({ where: { profileId: profile.id, messageId: message.id } });
        return res.status(204).end();
    } catch (error) {
        return next(error);
    }
};
