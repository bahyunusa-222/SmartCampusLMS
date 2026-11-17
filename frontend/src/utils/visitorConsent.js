export const TERMS_VERSION = "2026-11-11";
export const COOKIE_POLICY_VERSION = "1";
export const VISITOR_CONSENT_KEY = "smartcampus:visitor-consent";

export const readVisitorConsent = () => {
    try {
        const consent = JSON.parse(localStorage.getItem(VISITOR_CONSENT_KEY) || "null");
        if (consent?.termsVersion !== TERMS_VERSION ||
            consent?.cookiePolicyVersion !== COOKIE_POLICY_VERSION ||
            !["essential", "all"].includes(consent?.cookies)) {
            return null;
        }
        return consent;
    } catch {
        return null;
    }
};

export const saveVisitorConsent = (cookies) => {
    if (!["essential", "all"].includes(cookies)) {
        throw new TypeError("Choose whether to use optional cookies.");
    }
    const consent = {
        termsVersion: TERMS_VERSION,
        cookiePolicyVersion: COOKIE_POLICY_VERSION,
        cookies,
        acceptedAt: new Date().toISOString()
    };
    localStorage.setItem(VISITOR_CONSENT_KEY, JSON.stringify(consent));
    return consent;
};
