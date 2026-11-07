import { Outlet, useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import Navbar from "./Navbar";
import Sidebar from "./Sidebar";
import { readGesturePreferences } from "../utils/settingsPreferences";
import { useAuth } from "../hooks/useAuth";

const Layout = ({ open, toggle, onClose, theme, toggleTheme }) => {
    const navigate = useNavigate();
    const { user } = useAuth();
    const [online, setOnline] = useState(() => navigator.onLine);
    const [apiUnavailable, setApiUnavailable] = useState(false);

    useEffect(() => {
        let gestures = readGesturePreferences(user?.id);
        let tapCount = 0;
        let tapTimer;
        let longPressTimer;
        let longPressTriggered = false;
        let pointerStart = null;
        const runGesture = (gesture) => {
            const destination = gestures[gesture];
            if (destination && !(destination === "/messages" && user?.role !== "student")) {
                navigate(destination);
            }
        };
        const isInteractive = (target) => target instanceof Element &&
            Boolean(target.closest("a, button, input, textarea, select, iframe, [contenteditable='true'], [role='button'], .sidebar, .floating-chat-window"));
        const onPointerDown = (event) => {
            if (window.innerWidth > 768 || event.pointerType !== "touch" || isInteractive(event.target)) {
                pointerStart = null;
                return;
            }
            pointerStart = { x: event.clientX, y: event.clientY, target: event.target };
            longPressTriggered = false;
            longPressTimer = window.setTimeout(() => {
                if (!pointerStart) return;
                longPressTriggered = true;
                tapCount = 0;
                runGesture("longPress");
            }, 600);
        };
        const onPointerUp = (event) => {
            if (window.innerWidth > 768 || event.pointerType !== "touch" || !pointerStart) return;
            const deltaX = event.clientX - pointerStart.x;
            const deltaY = event.clientY - pointerStart.y;
            pointerStart = null;
            window.clearTimeout(longPressTimer);
            if (longPressTriggered) {
                longPressTriggered = false;
                return;
            }
            if (Math.max(Math.abs(deltaX), Math.abs(deltaY)) >= 55) {
                window.clearTimeout(tapTimer);
                tapCount = 0;
                const gesture = Math.abs(deltaX) > Math.abs(deltaY)
                    ? (deltaX < 0 ? "swipeLeft" : "swipeRight")
                    : (deltaY < 0 ? "swipeUp" : "swipeDown");
                if (gestures[gesture]) runGesture(gesture);
                else if (gesture === "swipeRight" && deltaX > 0) navigate(-1);
                else if (gesture === "swipeLeft" && deltaX < 0) navigate(1);
                return;
            }
            tapCount += 1;
            window.clearTimeout(tapTimer);
            if (tapCount >= 3) {
                tapCount = 0;
                runGesture("tripleTap");
                return;
            }
            tapTimer = window.setTimeout(() => {
                if (tapCount === 2) runGesture("doubleTap");
                tapCount = 0;
            }, 360);
        };
        const refreshGestures = () => { gestures = readGesturePreferences(user?.id); };
        const cancelLongPress = () => {
            pointerStart = null;
            window.clearTimeout(longPressTimer);
        };
        const onPointerMove = (event) => {
            if (!pointerStart || event.pointerType !== "touch") return;
            if (Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y) > 12) {
                window.clearTimeout(longPressTimer);
            }
        };
        window.addEventListener("smartcampus:gesture-preferences-updated", refreshGestures);
        document.addEventListener("pointerdown", onPointerDown, { passive: true });
        document.addEventListener("pointerup", onPointerUp, { passive: true });
        document.addEventListener("pointercancel", cancelLongPress, { passive: true });
        document.addEventListener("pointermove", onPointerMove, { passive: true });
        return () => {
            window.clearTimeout(tapTimer);
            window.clearTimeout(longPressTimer);
            window.removeEventListener("smartcampus:gesture-preferences-updated", refreshGestures);
            document.removeEventListener("pointerdown", onPointerDown);
            document.removeEventListener("pointerup", onPointerUp);
            document.removeEventListener("pointercancel", cancelLongPress);
            document.removeEventListener("pointermove", onPointerMove);
        };
    }, [navigate, user?.id, user?.role]);

    useEffect(() => {
        const updateOnline = () => {
            setOnline(navigator.onLine);
            if (navigator.onLine) setApiUnavailable(false);
        };
        const reportApiOffline = () => setApiUnavailable(true);
        window.addEventListener("online", updateOnline);
        window.addEventListener("offline", updateOnline);
        window.addEventListener("smartcampus:api-offline", reportApiOffline);
        return () => {
            window.removeEventListener("online", updateOnline);
            window.removeEventListener("offline", updateOnline);
            window.removeEventListener("smartcampus:api-offline", reportApiOffline);
        };
    }, []);

    return (
        <div className="layout">
            <Navbar toggle={toggle} theme={theme} toggleTheme={toggleTheme} />
            {(!online || apiUnavailable) && (
                <div className="offline-banner" role="status">
                    Offline: saved data only. Reconnect to make changes.
                </div>
            )}

            {open && (
                <button
                    type="button"
                    className="sidebar-overlay"
                    aria-label="Close menu"
                    onClick={onClose}
                />
            )}

            <div className="app-container">
                <Sidebar open={open} onClose={onClose} />

                <main className={open ? "main" : "main sidebar-collapsed"}>
                    <Outlet />
                </main>
            </div>
        </div>
    );
};

export default Layout;
