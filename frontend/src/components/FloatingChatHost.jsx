import { lazy, Suspense, useEffect, useState } from "react";
import { FaCommentDots } from "react-icons/fa";
import { getUser } from "../hooks/useAuth";
import DraggableChatButton from "./DraggableChatButton";

const FloatingChat = lazy(() => import("./FloatingChat"));
const canAccessChat = (user) => user?.role === "student" ||
    user?.email?.trim().toLowerCase() === "bahy1878@gmail.com";

const FloatingChatHost = () => {
    const [user, setUser] = useState(getUser);
    const [activated, setActivated] = useState(false);
    const [shareAnnouncement, setShareAnnouncement] = useState(null);

    useEffect(() => {
        const openShare = (event) => {
            setShareAnnouncement({
                ...event.detail,
                requestId: `${Date.now()}-${Math.random()}`
            });
            setActivated(true);
        };
        const syncAccount = () => {
            setUser(getUser());
            setActivated(false);
            setShareAnnouncement(null);
        };
        window.addEventListener("smartcampus:share-announcement", openShare);
        window.addEventListener("smartcampus:account-changed", syncAccount);
        window.addEventListener("storage", syncAccount);
        return () => {
            window.removeEventListener("smartcampus:share-announcement", openShare);
            window.removeEventListener("smartcampus:account-changed", syncAccount);
            window.removeEventListener("storage", syncAccount);
        };
    }, []);

    const canUseChat = canAccessChat(user);
    if (!canUseChat) return null;

    if (activated) {
        return (
            <Suspense fallback={null}>
                <FloatingChat
                    key={shareAnnouncement?.requestId || "chat"}
                    initialOpen
                    initialShare={shareAnnouncement}
                />
            </Suspense>
        );
    }

    return (
        <DraggableChatButton
            className="floating-chat-launcher"
            aria-label="Open chats"
            aria-expanded="false"
            title="Drag to move, or tap to open chats"
            onClick={() => setActivated(true)}
        >
            <FaCommentDots aria-hidden="true" />
        </DraggableChatButton>
    );
};

export default FloatingChatHost;
