import { useRef, useState } from "react";

const STORAGE_KEY = "smartcampus:chat-launcher-position";

const readPosition = () => {
    try {
        const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
        return Number.isFinite(value?.left) && Number.isFinite(value?.top) ? value : null;
    } catch {
        return null;
    }
};

const DraggableChatButton = ({ className, children, ...buttonProps }) => {
    const [position, setPosition] = useState(readPosition);
    const pointer = useRef(null);
    const suppressClick = useRef(false);

    const onPointerDown = (event) => {
        if (event.button !== undefined && event.button !== 0) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        pointer.current = {
            id: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            left: bounds.left,
            top: bounds.top,
            moved: false
        };
        event.currentTarget.setPointerCapture(event.pointerId);
    };

    const onPointerMove = (event) => {
        const start = pointer.current;
        if (!start || start.id !== event.pointerId) return;
        const deltaX = event.clientX - start.startX;
        const deltaY = event.clientY - start.startY;
        if (Math.hypot(deltaX, deltaY) > 5) start.moved = true;
        if (!start.moved) return;
        const button = event.currentTarget;
        const nextPosition = {
            left: Math.max(0, Math.min(window.innerWidth - button.offsetWidth, start.left + deltaX)),
            top: Math.max(0, Math.min(window.innerHeight - button.offsetHeight, start.top + deltaY))
        };
        setPosition(nextPosition);
        suppressClick.current = true;
    };

    const onPointerUp = (event) => {
        const start = pointer.current;
        if (!start || start.id !== event.pointerId) return;
        pointer.current = null;
        if (start.moved) {
            const bounds = event.currentTarget.getBoundingClientRect();
            const nextPosition = { left: bounds.left, top: bounds.top };
            setPosition(nextPosition);
            try {
                localStorage.setItem(STORAGE_KEY, JSON.stringify(nextPosition));
            } catch {
                // The button remains movable for this session when storage is unavailable.
            }
            window.setTimeout(() => { suppressClick.current = false; }, 250);
        }
    };

    return (
        <button
            {...buttonProps}
            type="button"
            className={className}
            style={position ? { left: position.left, top: position.top, right: "auto", bottom: "auto" } : undefined}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onClick={(event) => {
                if (suppressClick.current) {
                    suppressClick.current = false;
                    event.preventDefault();
                    return;
                }
                buttonProps.onClick?.(event);
            }}
        >
            {children}
        </button>
    );
};

export default DraggableChatButton;
