const defaultApiBase = ["localhost", "127.0.0.1", "[::1]"].includes(window.location.hostname)
    ? "http://localhost:5000"
    : "";

const API_BASE = (import.meta.env.VITE_API_URL?.trim() || defaultApiBase).replace(/\/+$/, "");

export default API_BASE;
