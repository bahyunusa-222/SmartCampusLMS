import { useCallback, useEffect, useRef, useState } from "react";

const INSTALL_REMINDER_INTERVAL = 10 * 60 * 1000;
const INSTALLED_KEY = "smartcampus:pwa-installed";

const isInstalled = () =>
    window.matchMedia("(display-mode: standalone)").matches ||
    window.navigator.standalone === true ||
    localStorage.getItem(INSTALLED_KEY) === "true";

const installationInstructions = () => {
    const userAgent = navigator.userAgent || "";
    if (/iPhone|iPad|iPod/i.test(userAgent)) {
        return "On iPhone or iPad: open this page in Safari, tap Share, then choose Add to Home Screen.";
    }
    if (/Android/i.test(userAgent)) {
        return "On Android: open the browser menu (⋮) and choose Install app or Add to Home screen.";
    }
    return "Choose the install icon in your browser’s address bar, or open the browser menu and select Install SmartCampus.";
};

const InstallAppPrompt = () => {
    const [visible, setVisible] = useState(false);
    const [installAvailable, setInstallAvailable] = useState(false);
    const [installError, setInstallError] = useState("");
    const deferredPrompt = useRef(null);
    const reminderTimer = useRef(null);

    const scheduleReminder = useCallback(() => {
        window.clearTimeout(reminderTimer.current);
        if (!isInstalled()) {
            reminderTimer.current = window.setTimeout(() => setVisible(true), INSTALL_REMINDER_INTERVAL);
        }
    }, []);

    useEffect(() => {
        if (isInstalled()) return undefined;
        const onBeforeInstallPrompt = (event) => {
            event.preventDefault();
            deferredPrompt.current = event;
            setInstallAvailable(true);
        };
        const onAppInstalled = () => {
            localStorage.setItem(INSTALLED_KEY, "true");
            window.clearTimeout(reminderTimer.current);
            deferredPrompt.current = null;
            setInstallAvailable(false);
            setVisible(false);
        };
        scheduleReminder();
        window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
        window.addEventListener("appinstalled", onAppInstalled);
        return () => {
            window.clearTimeout(reminderTimer.current);
            window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
            window.removeEventListener("appinstalled", onAppInstalled);
        };
    }, [scheduleReminder]);

    const dismiss = () => {
        setVisible(false);
        scheduleReminder();
    };

    const install = async () => {
        if (!deferredPrompt.current) {
            dismiss();
            return;
        }
        let failed = false;
        try {
            await deferredPrompt.current.prompt();
            const choice = await deferredPrompt.current.userChoice;
            if (choice?.outcome === "accepted") localStorage.setItem(INSTALLED_KEY, "true");
            else scheduleReminder();
        } catch {
            failed = true;
            setInstallError("Installation could not start. Use the browser menu instructions below.");
        } finally {
            deferredPrompt.current = null;
            setInstallAvailable(false);
            if (!failed) setVisible(false);
        }
    };

    if (!visible || isInstalled()) return null;

    return (
        <aside className="install-app-prompt" role="dialog" aria-labelledby="install-app-title">
            <button type="button" className="install-app-close" onClick={dismiss} aria-label="Dismiss install reminder">
                ×
            </button>
            <strong id="install-app-title">Install SmartCampus for a better experience</strong>
            <p>{installationInstructions()}</p>
            {installError && <p role="status">{installError}</p>}
            <div>
                <button type="button" className="install-app-action" onClick={install}>
                    {installAvailable ? "Install app" : "Got it"}
                </button>
                <button type="button" className="install-app-later" onClick={dismiss}>Not now</button>
            </div>
        </aside>
    );
};

export default InstallAppPrompt;
