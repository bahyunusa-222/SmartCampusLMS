const projectId = process.env.EXPO_PUBLIC_EAS_PROJECT_ID || undefined;

module.exports = {
    expo: {
        name: "SmartCampus",
        slug: "smartcampus",
        version: "1.0.0",
        orientation: "portrait",
        scheme: "smartcampus",
        userInterfaceStyle: "automatic",
        ios: {
            bundleIdentifier: "gm.utg.smartcampus",
            supportsTablet: false
        },
        android: {
            package: "gm.utg.smartcampus",
            permissions: ["android.permission.POST_NOTIFICATIONS"]
        },
        plugins: ["expo-notifications", "expo-secure-store"],
        extra: {
            eas: projectId ? { projectId } : {}
        }
    }
};
