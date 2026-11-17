import React, { useCallback, useEffect, useRef, useState } from "react";
import {
    ActivityIndicator,
    FlatList,
    Platform,
    Pressable,
    SafeAreaView,
    StatusBar,
    StyleSheet,
    Text,
    TextInput,
    View
} from "react-native";
import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import * as SecureStore from "expo-secure-store";

const API_URL = (process.env.EXPO_PUBLIC_API_URL || "").trim().replace(/\/+$/, "");
const SESSION_TOKEN_KEY = "smartcampus.session-token";
const USER_KEY = "smartcampus.session-user";
const PUSH_TOKEN_KEY = "smartcampus.expo-push-token";

const isAllowedApiUrl = () => {
    try {
        const url = new URL(API_URL);
        if (url.protocol === "https:") return true;
        const isDevelopment = typeof __DEV__ !== "undefined" && __DEV__;
        const isLocalHost = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
        const isPrivateIpv4 = /^(10|192\.168)\./.test(url.hostname) ||
            /^172\.(1[6-9]|2\d|3[01])\./.test(url.hostname);
        return isDevelopment && (isLocalHost || isPrivateIpv4);
    } catch {
        return false;
    }
};

Notifications.setNotificationHandler({
    handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: true,
        shouldSetBadge: false
    })
});

const apiRequest = async (path, { token, method = "GET", body } = {}) => {
    if (!API_URL) throw new Error("Set EXPO_PUBLIC_API_URL in mobile/.env before signing in.");
    if (!isAllowedApiUrl()) {
        throw new Error("SmartCampus API must use HTTPS. HTTP is allowed only for a local development server.");
    }
    const headers = { Accept: "application/json", "X-SmartCampus-Client": "mobile" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (token) headers.Authorization = `Bearer ${token}`;
    const response = await fetch(`${API_URL}/api${path}`, {
        method,
        headers,
        ...(body !== undefined ? { body: JSON.stringify(body) } : {})
    });
    if (response.status === 204) return null;
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
        const error = new Error(payload.message || `SmartCampus request failed (${response.status}).`);
        error.status = response.status;
        throw error;
    }
    return payload;
};

const messageFromError = (error) => error?.message || "Something went wrong. Please try again.";

export default function App() {
    const [session, setSession] = useState(null);
    const [restoringSession, setRestoringSession] = useState(true);
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [notifications, setNotifications] = useState([]);
    const [pushEnabled, setPushEnabled] = useState(false);
    const [busy, setBusy] = useState(false);
    const [refreshing, setRefreshing] = useState(false);
    const [error, setError] = useState("");
    const notificationListener = useRef(null);
    const responseListener = useRef(null);

    const loadNotifications = useCallback(async (token, isRefresh = false) => {
        if (isRefresh) setRefreshing(true);
        try {
            const items = await apiRequest("/notifications", { token });
            setNotifications(Array.isArray(items) ? items : []);
            setError("");
        } catch (requestError) {
            if (requestError.status === 401) {
                await SecureStore.deleteItemAsync(SESSION_TOKEN_KEY);
                await SecureStore.deleteItemAsync(USER_KEY);
                setSession(null);
            } else {
                setError(messageFromError(requestError));
            }
        } finally {
            setRefreshing(false);
        }
    }, []);

    useEffect(() => {
        let mounted = true;
        const restoreSession = async () => {
            try {
                const [token, rawUser, savedPushToken] = await Promise.all([
                    SecureStore.getItemAsync(SESSION_TOKEN_KEY),
                    SecureStore.getItemAsync(USER_KEY),
                    SecureStore.getItemAsync(PUSH_TOKEN_KEY)
                ]);
                if (!mounted) return;
                if (token && rawUser) {
                    const restored = { token, user: JSON.parse(rawUser) };
                    setSession(restored);
                    await loadNotifications(token);
                    const permission = await Notifications.getPermissionsAsync();
                    setPushEnabled(permission.granted && Boolean(savedPushToken));
                }
            } catch (restoreError) {
                if (mounted) setError(messageFromError(restoreError));
            } finally {
                if (mounted) setRestoringSession(false);
            }
        };
        restoreSession();
        return () => { mounted = false; };
    }, [loadNotifications]);

    useEffect(() => {
        notificationListener.current = Notifications.addNotificationReceivedListener(() => {
            if (session?.token) loadNotifications(session.token);
        });
        responseListener.current = Notifications.addNotificationResponseReceivedListener(async (response) => {
            const id = response.notification.request.content.data?.notificationId;
            if (session?.token && id) {
                try {
                    await apiRequest(`/notifications/${encodeURIComponent(id)}/read`, {
                        token: session.token,
                        method: "PATCH"
                    });
                    await loadNotifications(session.token);
                } catch (requestError) {
                    setError(messageFromError(requestError));
                }
            }
        });
        return () => {
            notificationListener.current?.remove();
            responseListener.current?.remove();
        };
    }, [loadNotifications, session?.token]);

    const signIn = async () => {
        setBusy(true);
        setError("");
        try {
            const result = await apiRequest("/auth/login", {
                method: "POST",
                body: { email: email.trim(), password }
            });
            const nextSession = { token: result.token, user: result.user };
            await Promise.all([
                SecureStore.setItemAsync(SESSION_TOKEN_KEY, nextSession.token),
                SecureStore.setItemAsync(USER_KEY, JSON.stringify(nextSession.user))
            ]);
            setSession(nextSession);
            setPassword("");
            await loadNotifications(nextSession.token);
        } catch (loginError) {
            setError(messageFromError(loginError));
        } finally {
            setBusy(false);
        }
    };

    const registerForPush = async () => {
        if (!session) return;
        if (!Device.isDevice) {
            setError("Push notifications require a physical Android or iOS device.");
            return;
        }
        setBusy(true);
        setError("");
        try {
            if (Platform.OS === "android") {
                await Notifications.setNotificationChannelAsync("default", {
                    name: "SmartCampus notifications",
                    importance: Notifications.AndroidImportance.HIGH,
                    vibrationPattern: [0, 250, 250, 250]
                });
            }
            let permission = await Notifications.getPermissionsAsync();
            if (!permission.granted) permission = await Notifications.requestPermissionsAsync();
            if (!permission.granted) throw new Error("Allow notifications in your device settings to enable push alerts.");

            const projectId = Constants.easConfig?.projectId || Constants.expoConfig?.extra?.eas?.projectId;
            if (!projectId) throw new Error("Mobile push is not configured yet. Set the EAS project ID in the mobile app build environment.");
            const result = await Notifications.getExpoPushTokenAsync({ projectId });
            const previousToken = await SecureStore.getItemAsync(PUSH_TOKEN_KEY);
            if (previousToken && previousToken !== result.data) {
                await apiRequest("/notifications/devices", {
                    token: session.token,
                    method: "DELETE",
                    body: { pushToken: previousToken }
                });
            }
            await apiRequest("/notifications/devices", {
                token: session.token,
                method: "POST",
                body: { pushToken: result.data, platform: Platform.OS }
            });
            await SecureStore.setItemAsync(PUSH_TOKEN_KEY, result.data);
            setPushEnabled(true);
        } catch (pushError) {
            setError(messageFromError(pushError));
        } finally {
            setBusy(false);
        }
    };

    const disablePush = async () => {
        if (!session) return;
        setBusy(true);
        setError("");
        try {
            const token = await SecureStore.getItemAsync(PUSH_TOKEN_KEY);
            if (token) {
                await apiRequest("/notifications/devices", {
                    token: session.token,
                    method: "DELETE",
                    body: { pushToken: token }
                });
            }
            await SecureStore.deleteItemAsync(PUSH_TOKEN_KEY);
            setPushEnabled(false);
        } catch (pushError) {
            setError(messageFromError(pushError));
        } finally {
            setBusy(false);
        }
    };

    const signOut = async () => {
        if (!session) return;
        setBusy(true);
        setError("");
        try {
            const pushToken = await SecureStore.getItemAsync(PUSH_TOKEN_KEY);
            if (pushToken) {
                await apiRequest("/notifications/devices", {
                    token: session.token,
                    method: "DELETE",
                    body: { pushToken }
                });
                await SecureStore.deleteItemAsync(PUSH_TOKEN_KEY);
            }
            await apiRequest("/auth/logout", { token: session.token, method: "POST", body: {} });
            await Promise.all([
                SecureStore.deleteItemAsync(SESSION_TOKEN_KEY),
                SecureStore.deleteItemAsync(USER_KEY)
            ]);
            setSession(null);
            setNotifications([]);
            setPushEnabled(false);
        } catch (signOutError) {
            setError(`Could not safely sign out. ${messageFromError(signOutError)}`);
        } finally {
            setBusy(false);
        }
    };

    const markRead = async (item) => {
        if (item.readAt || !session) return;
        try {
            await apiRequest(`/notifications/${encodeURIComponent(item.id)}/read`, {
                token: session.token,
                method: "PATCH"
            });
            setNotifications((current) => current.map((notification) =>
                notification.id === item.id ? { ...notification, readAt: new Date().toISOString() } : notification
            ));
        } catch (readError) {
            setError(messageFromError(readError));
        }
    };

    if (restoringSession) {
        return <SafeAreaView style={styles.center}><ActivityIndicator size="large" color="#ba5510" /></SafeAreaView>;
    }

    return (
        <SafeAreaView style={styles.safeArea}>
            <StatusBar barStyle="dark-content" />
            <View style={styles.container}>
                <Text style={styles.brand}>SmartCampus</Text>
                <Text style={styles.heading}>{session ? "Your notifications" : "Sign in"}</Text>
                <Text style={styles.subtitle}>
                    {session ? "Course and campus updates, delivered to your device." : "Use your existing SmartCampus account."}
                </Text>

                {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}

                {!session ? (
                    <View style={styles.form}>
                        <TextInput
                            autoCapitalize="none"
                            autoComplete="email"
                            keyboardType="email-address"
                            onChangeText={setEmail}
                            placeholder="Email address"
                            style={styles.input}
                            value={email}
                        />
                        <TextInput
                            autoCapitalize="none"
                            onChangeText={setPassword}
                            onSubmitEditing={signIn}
                            placeholder="Password"
                            returnKeyType="go"
                            secureTextEntry
                            style={styles.input}
                            value={password}
                        />
                        <ActionButton title="Sign in" onPress={signIn} disabled={busy || !email.trim() || !password} />
                        <Text style={styles.hint}>Create accounts and reset passwords on the SmartCampus website.</Text>
                    </View>
                ) : (
                    <>
                        <View style={styles.accountRow}>
                            <View>
                                <Text style={styles.accountName}>{session.user.fullName}</Text>
                                <Text style={styles.accountEmail}>{session.user.email}</Text>
                            </View>
                            <Pressable accessibilityRole="button" disabled={busy} onPress={signOut}>
                                <Text style={styles.link}>Sign out</Text>
                            </Pressable>
                        </View>
                        <View style={styles.pushCard}>
                            <Text style={styles.pushTitle}>{pushEnabled ? "Push notifications are enabled" : "Enable phone notifications"}</Text>
                            <Text style={styles.hint}>Notifications are sent to this signed-in device, not to your phone number.</Text>
                            <ActionButton
                                title={pushEnabled ? "Disable push notifications" : "Enable push notifications"}
                                onPress={pushEnabled ? disablePush : registerForPush}
                                disabled={busy}
                                secondary={pushEnabled}
                            />
                        </View>
                        <FlatList
                            data={notifications}
                            keyExtractor={(item) => String(item.id)}
                            refreshing={refreshing}
                            onRefresh={() => loadNotifications(session.token, true)}
                            contentContainerStyle={notifications.length ? styles.list : styles.emptyList}
                            ListEmptyComponent={<Text style={styles.empty}>No notifications yet. Pull down to refresh.</Text>}
                            renderItem={({ item }) => (
                                <Pressable
                                    accessibilityRole="button"
                                    onPress={() => markRead(item)}
                                    style={[styles.notification, !item.readAt && styles.unread]}
                                >
                                    <View style={styles.notificationHeader}>
                                        <Text style={styles.notificationTitle}>{item.title}</Text>
                                        {!item.readAt && <View style={styles.unreadDot} />}
                                    </View>
                                    <Text style={styles.notificationBody}>{item.body}</Text>
                                    <Text style={styles.date}>{new Date(item.createdAt).toLocaleString()}</Text>
                                </Pressable>
                            )}
                        />
                    </>
                )}
            </View>
        </SafeAreaView>
    );
}

function ActionButton({ title, onPress, disabled, secondary = false }) {
    return (
        <Pressable
            accessibilityRole="button"
            disabled={disabled}
            onPress={onPress}
            style={[styles.button, secondary && styles.secondaryButton, disabled && styles.disabledButton]}
        >
            {disabled ? <ActivityIndicator color={secondary ? "#ba5510" : "#ffffff"} /> : (
                <Text style={[styles.buttonText, secondary && styles.secondaryButtonText]}>{title}</Text>
            )}
        </Pressable>
    );
}

const styles = StyleSheet.create({
    safeArea: { flex: 1, backgroundColor: "#f5f6f7" },
    center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#f5f6f7" },
    container: { flex: 1, width: "100%", maxWidth: 620, alignSelf: "center", paddingHorizontal: 20, paddingTop: 16 },
    brand: { color: "#ba5510", fontSize: 15, fontWeight: "800", letterSpacing: 1.2, textTransform: "uppercase" },
    heading: { color: "#18212b", fontSize: 28, fontWeight: "800", marginTop: 8 },
    subtitle: { color: "#59636f", fontSize: 15, lineHeight: 22, marginTop: 6, marginBottom: 20 },
    form: { gap: 12, marginTop: 12 },
    input: { backgroundColor: "#ffffff", borderColor: "#d9dee4", borderRadius: 12, borderWidth: 1, color: "#18212b", fontSize: 16, minHeight: 52, paddingHorizontal: 14 },
    button: { alignItems: "center", backgroundColor: "#ba5510", borderRadius: 12, justifyContent: "center", minHeight: 48, paddingHorizontal: 16 },
    buttonText: { color: "#ffffff", fontSize: 15, fontWeight: "700" },
    secondaryButton: { backgroundColor: "#ffffff", borderColor: "#ba5510", borderWidth: 1 },
    secondaryButtonText: { color: "#ba5510" },
    disabledButton: { opacity: 0.65 },
    hint: { color: "#66717d", fontSize: 13, lineHeight: 19, marginVertical: 6 },
    error: { backgroundColor: "#fff0ed", borderRadius: 10, color: "#a52f1d", marginBottom: 12, padding: 12 },
    accountRow: { alignItems: "center", borderBottomColor: "#dfe3e8", borderBottomWidth: 1, flexDirection: "row", justifyContent: "space-between", paddingBottom: 14 },
    accountName: { color: "#18212b", fontSize: 16, fontWeight: "700" },
    accountEmail: { color: "#66717d", fontSize: 13, marginTop: 3 },
    link: { color: "#a9470a", fontWeight: "700", padding: 8 },
    pushCard: { backgroundColor: "#ffffff", borderColor: "#e1e5e9", borderRadius: 14, borderWidth: 1, gap: 7, marginVertical: 14, padding: 14 },
    pushTitle: { color: "#18212b", fontSize: 16, fontWeight: "700" },
    list: { gap: 10, paddingBottom: 24 },
    emptyList: { flexGrow: 1, justifyContent: "center", paddingBottom: 24 },
    empty: { color: "#66717d", lineHeight: 21, textAlign: "center" },
    notification: { backgroundColor: "#ffffff", borderColor: "#e1e5e9", borderRadius: 12, borderWidth: 1, padding: 14 },
    unread: { borderLeftColor: "#ba5510", borderLeftWidth: 4 },
    notificationHeader: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
    notificationTitle: { color: "#18212b", flex: 1, fontSize: 15, fontWeight: "700" },
    notificationBody: { color: "#45515d", fontSize: 14, lineHeight: 20, marginTop: 6 },
    date: { color: "#77818b", fontSize: 12, marginTop: 8 },
    unreadDot: { backgroundColor: "#ba5510", borderRadius: 5, height: 9, marginLeft: 8, width: 9 }
});
