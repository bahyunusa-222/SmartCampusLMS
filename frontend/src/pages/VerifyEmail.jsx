import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import API from "../services/api";

const readToken = () => {
    return new URLSearchParams(window.location.hash.slice(1)).get("token") || "";
};

const VerifyEmail = () => {
    const [token] = useState(readToken);
    const [status, setStatus] = useState(() => token
        ? "Verifying your email address…"
        : "This verification link is invalid or has expired.");
    const [verified, setVerified] = useState(false);

    useEffect(() => {
        window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
        if (!token) return undefined;
        let active = true;
        API.post("/auth/email/verify", { token })
            .then((response) => {
                if (active) {
                    setStatus(response.data.message);
                    setVerified(true);
                }
            })
            .catch((error) => {
                if (active) setStatus(error.response?.data?.message || "Unable to verify your email right now.");
            });
        return () => { active = false; };
    }, [token]);

    return (
        <main className="auth-page">
            <section className="form-box" aria-labelledby="verify-email-title">
                <h1 id="verify-email-title">Email verification</h1>
                <p role="status">{status}</p>
                {verified && <Link className="btn" to="/login">Continue to sign in</Link>}
                {!verified && <Link to="/login">Return to sign in</Link>}
            </section>
        </main>
    );
};

export default VerifyEmail;
