import { useState } from "react";
import { Link } from "react-router-dom";
import {
    readVisitorConsent,
    saveVisitorConsent,
    TERMS_VERSION
} from "../utils/visitorConsent";

const VisitorConsentGate = ({ children }) => {
    const [consent, setConsent] = useState(readVisitorConsent);
    const [termsAccepted, setTermsAccepted] = useState(false);
    const [error, setError] = useState("");

    const chooseCookies = (cookies) => {
        if (!termsAccepted) {
            setError("Please read and accept the Terms and Conditions before continuing.");
            return;
        }
        try {
            setConsent(saveVisitorConsent(cookies));
        } catch {
            setError("Your consent could not be saved in this browser. Enable site storage and try again.");
        }
    };

    if (consent) return children;

    return (
        <div className="visitor-consent-backdrop">
            <section
                className="visitor-consent-dialog"
                role="dialog"
                aria-modal="true"
                aria-labelledby="visitor-consent-title"
            >
                <p className="visitor-consent-eyebrow">Before you continue</p>
                <h1 id="visitor-consent-title">Terms and cookie choices</h1>
                <p>
                    Please review the <Link to="/terms" target="_blank" rel="noreferrer">Terms and Conditions</Link>
                    {" "}and <Link to="/terms#cookies" target="_blank" rel="noreferrer">Cookie Policy</Link>.
                    Essential storage keeps your sign-in secure. Optional analytics or advertising cookies
                    are not currently used.
                </p>
                <label className="visitor-consent-check">
                    <input
                        type="checkbox"
                        checked={termsAccepted}
                        onChange={(event) => {
                            setTermsAccepted(event.target.checked);
                            setError("");
                        }}
                    />
                    <span>I have read and agree to the Terms and Conditions (required).</span>
                </label>
                <div className="visitor-consent-actions">
                    <button
                        type="button"
                        className="visitor-consent-essential"
                        disabled={!termsAccepted}
                        onClick={() => chooseCookies("essential")}
                    >
                        Agree and use essential only
                    </button>
                    <button
                        type="button"
                        className="visitor-consent-all"
                        disabled={!termsAccepted}
                        onClick={() => chooseCookies("all")}
                    >
                        Agree and accept all cookies
                    </button>
                </div>
                {error && <p className="visitor-consent-error" role="alert">{error}</p>}
                <small>Terms version {TERMS_VERSION}. You can change your choice by clearing this site’s stored data.</small>
            </section>
        </div>
    );
};

export default VisitorConsentGate;
