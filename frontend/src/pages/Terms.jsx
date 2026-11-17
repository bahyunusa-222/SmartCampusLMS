import { Link } from "react-router-dom";

const Terms = () => (
    <main className="terms-page">
        <article className="terms-card">
            <Link to="/login" className="terms-back-link">Back to sign in</Link>
            <p className="visitor-consent-eyebrow">Effective November 11, 2026</p>
            <h1>SmartCampus LMS Terms and Conditions</h1>
            <p>
                These terms apply when you access SmartCampus LMS (“SmartCampus”), an educational platform
                for course materials, assignments, assessments, and campus communication. By continuing to
                sign in, you agree to these terms and any applicable rules of your institution.
            </p>

            <h2>1. Your account</h2>
            <p>
                Give accurate registration information, keep your password and sign-in devices secure, and
                tell the appropriate institution administrator if you suspect unauthorized access. You are
                responsible for activity performed through your account. Do not impersonate another person
                or register using an email address you do not control.
            </p>

            <h2>2. Appropriate use and academic work</h2>
            <p>
                Use SmartCampus for lawful educational and campus purposes. Do not disrupt the service,
                bypass access controls, harass others, upload malicious material, or share content you are
                not permitted to distribute. Follow your institution’s academic-integrity requirements;
                submitting another person’s work as your own remains your responsibility.
            </p>

            <h2>3. Your content and privacy</h2>
            <p>
                You retain rights you hold in content you submit. You permit SmartCampus and your institution
                to host and process that content as needed to provide learning, assessment, communication,
                security, and support features. Personal information is handled under the applicable privacy
                notice and institutional requirements. Do not post passwords, payment-card details, or
                sensitive personal information in public course areas.
            </p>

            <h2>4. Service availability and enforcement</h2>
            <p>
                Features may change or be temporarily unavailable for maintenance, security, or operational
                reasons. Access may be restricted when necessary to protect users, the institution, or the
                service, or to respond to a suspected breach of these terms or institutional policy.
            </p>

            <h2 id="cookies">5. Cookies and local storage</h2>
            <p>
                Essential browser storage supports secure sign-in and core application preferences. The
                offline feature may use IndexedDB to keep selected learning data available on your device.
                Optional analytics and advertising cookies are not currently used. You may choose essential
                storage only; this choice does not disable storage required for the service to work. A browser
                that blocks essential storage may not keep your session signed in.
            </p>

            <h2>6. Changes and contact</h2>
            <p>
                These terms may be updated when the service or applicable requirements change. Material
                changes will be presented for acceptance before you next sign in. For account, course, or
                policy questions, contact your institution’s SmartCampus administrator.
            </p>
        </article>
    </main>
);

export default Terms;
