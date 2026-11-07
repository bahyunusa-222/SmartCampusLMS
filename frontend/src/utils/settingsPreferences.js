export const defaultPageOptions = [
    { value: "/dashboard", label: "Dashboard" },
    { value: "/courses", label: "Courses" },
    { value: "/assignments", label: "Assignments" },
    { value: "/calendar", label: "Calendar" }
];

const defaultPagePaths = new Set(defaultPageOptions.map(({ value }) => value));

export const defaultPageStorageKey = (userId) => `smartcampus:default-page:${userId}`;
export const notificationBadgeStorageKey = (userId) => `smartcampus:notification-badge:${userId}`;
export const reducedMotionStorageKey = (userId) => `smartcampus:reduced-motion:${userId}`;
export const gestureStorageKey = (userId) => `smartcampus:gestures:${userId}`;
export const textSizeSteps = [50, 75, 100, 125, 150, 175, 200];
export const gestureOptions = [
    { value: "longPress", label: "Long press" },
    { value: "doubleTap", label: "Double tap" },
    { value: "tripleTap", label: "Triple tap" },
    { value: "swipeLeft", label: "Swipe left" },
    { value: "swipeRight", label: "Swipe right" },
    { value: "swipeUp", label: "Swipe up" },
    { value: "swipeDown", label: "Swipe down" }
];
export const gestureActions = [
    { value: "", label: "Do nothing" },
    { value: "/dashboard", label: "Open dashboard" },
    { value: "/courses", label: "Open courses" },
    { value: "/messages", label: "Open chats" },
    { value: "/assignments", label: "Open assignments" },
    { value: "/calendar", label: "Open calendar" },
    { value: "/settings", label: "Open settings" }
];

export const readDefaultPage = (userId) => {
    if (userId == null) return "/dashboard";
    const page = localStorage.getItem(defaultPageStorageKey(userId));
    return defaultPagePaths.has(page) ? page : "/dashboard";
};

export const readNotificationBadge = (userId) =>
    userId == null || localStorage.getItem(notificationBadgeStorageKey(userId)) !== "false";

export const readReducedMotion = (userId) => {
    if (userId == null) {
        return localStorage.getItem("reducedMotion") === "true" ||
            (localStorage.getItem("reducedMotion") === null &&
                window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true);
    }
    const preference = localStorage.getItem(reducedMotionStorageKey(userId));
    return preference === null
        ? localStorage.getItem("reducedMotion") === "true" ||
            (localStorage.getItem("reducedMotion") === null &&
                window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true)
        : preference === "true";
};

export const readGesturePreferences = (userId) => {
    if (userId == null) return {};
    try {
        const stored = JSON.parse(localStorage.getItem(gestureStorageKey(userId)) || "{}");
        return Object.fromEntries(gestureOptions.map(({ value }) => [
            value,
            gestureActions.some((action) => action.value && action.value === stored[value])
                ? stored[value]
                : ""
        ]));
    } catch {
        return {};
    }
};

export const readTextSize = (userId) => {
    if (userId == null) return 100;
    const stored = Number(localStorage.getItem(`smartcampus:text-size:${userId}`));
    if (!Number.isFinite(stored)) return 100;
    if (textSizeSteps.includes(stored)) return stored;
    const legacyPercent = Number.isInteger(stored) && stored >= 0 && stored <= 20
        ? 100 + stored * 2
        : 100;
    return textSizeSteps.reduce((closest, step) =>
        Math.abs(step - legacyPercent) < Math.abs(closest - legacyPercent) ? step : closest
    , 100);
};
