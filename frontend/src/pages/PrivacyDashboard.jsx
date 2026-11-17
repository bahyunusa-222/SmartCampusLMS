import { useCallback, useEffect, useState } from "react";
import API from "../services/api";

const requestTypes = [
    ["access", "Access my data"],
    ["correction", "Correct my information"],
    ["erasure", "Request account/data erasure"],
    ["restriction", "Restrict processing"],
    ["portability", "Data portability"],
    ["objection", "Object to processing"]
];

const PrivacyDashboard = () => {
    const [requests, setRequests] = useState([]);
    const [consents, setConsents] = useState({});
    const [policyVersion, setPolicyVersion] = useState("1");
    const [category, setCategory] = useState("access");
    const [details, setDetails] = useState("");
    const [status, setStatus] = useState(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    const loadPrivacyData = useCallback(async () => {
        try {
            const [requestResponse, consentResponse] = await Promise.all([
                API.get("/privacy/requests", { skipOfflineCache: true }),
                API.get("/privacy/consents", { skipOfflineCache: true })
            ]);
            setRequests(requestResponse.data.requests || []);
            setConsents(consentResponse.data.consents || {});
            setPolicyVersion(consentResponse.data.policyVersion || "1");
            setStatus(null);
        } catch (error) {
            setStatus({
                type: "error",
                text: error.response?.data?.message || "Unable to load privacy information."
            });
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        Promise.resolve().then(loadPrivacyData);
    }, [loadPrivacyData]);

    const submitRequest = async (event) => {
        event.preventDefault();
        setSaving(true);
        setStatus(null);
        try {
            const response = await API.post("/privacy/requests", { category, details });
            setDetails("");
            setStatus({ type: "success", text: response.data.message });
            await loadPrivacyData();
        } catch (error) {
            setStatus({
                type: "error",
                text: error.response?.data?.message || "Unable to submit your privacy request."
            });
        } finally {
            setSaving(false);
        }
    };

    const updateConsent = async (purpose, granted) => {
        setSaving(true);
        setStatus(null);
        try {
            await API.put("/privacy/consents", { purpose, granted });
            await loadPrivacyData();
            setStatus({ type: "success", text: "Your optional privacy preference was saved." });
        } catch (error) {
            setStatus({
                type: "error",
                text: error.response?.data?.message || "Unable to save that preference."
            });
        } finally {
            setSaving(false);
        }
    };

    const downloadExport = async () => {
        setSaving(true);
        setStatus(null);
        try {
            const response = await API.get("/privacy/export", { responseType: "blob", skipOfflineCache: true });
            const url = URL.createObjectURL(response.data);
            const link = document.createElement("a");
            link.href = url;
            link.download = "smartcampus-personal-data.json";
            document.body.appendChild(link);
            link.click();
            link.remove();
            URL.revokeObjectURL(url);
            setStatus({ type: "success", text: "Your available personal data export has been downloaded." });
        } catch (error) {
            setStatus({
                type: "error",
                text: error.response?.data?.message || "Unable to download your personal data."
            });
        } finally {
            setSaving(false);
        }
    };

    return (
        <section className="settings-section" aria-labelledby="privacy-title">
            <header>
                <h2 id="privacy-title">Privacy and personal data</h2>
                <p>Review optional preferences, download available account data, and submit a request about your information.</p>
            </header>
            {status && <p className={`settings-status ${status.type}`} role="status">{status.text}</p>}

            <section className="settings-card">
                <h3>Download your data</h3>
                <p>The export includes your account profile, enrollments, submissions, lesson progress, quiz attempts, and privacy records. It does not include chat history or uploaded file contents.</p>
                <button className="btn btn-inline" type="button" onClick={downloadExport} disabled={saving || loading}>
                    Download personal data
                </button>
            </section>

            <section className="settings-card">
                <h3>Optional preferences</h3>
                <p>These controls apply only to optional processing; they do not control data needed to operate university learning services. Consent history is recorded, but optional campaign and analytics integrations must check it before use. Policy version: {policyVersion}.</p>
                {[
                    ["product_communications", "Optional product communications"],
                    ["optional_analytics", "Optional usage analytics"]
                ].map(([purpose, label]) => (
                    <label className="settings-toggle-row" key={purpose}>
                        <span>{label}</span>
                        <input
                            type="checkbox"
                            checked={Boolean(consents[purpose]?.granted)}
                            disabled={saving || loading}
                            onChange={(event) => updateConsent(purpose, event.target.checked)}
                        />
                    </label>
                ))}
            </section>

            <section className="settings-card">
                <h3>Submit a data request</h3>
                <p>Requests are recorded for institutional review. Submission does not automatically erase academic or legally required records.</p>
                <form className="settings-form" onSubmit={submitRequest}>
                    <label>
                        Request type
                        <select value={category} onChange={(event) => setCategory(event.target.value)} disabled={saving}>
                            {requestTypes.map(([value, label]) => <option value={value} key={value}>{label}</option>)}
                        </select>
                    </label>
                    <label>
                        Details <span className="register-optional">(do not include passwords or authentication codes)</span>
                        <textarea value={details} onChange={(event) => setDetails(event.target.value)} rows={4} maxLength={2000} disabled={saving} />
                    </label>
                    <button className="btn btn-inline" type="submit" disabled={saving || loading}>
                        Submit request
                    </button>
                </form>
            </section>

            <section className="settings-card">
                <h3>Your requests</h3>
                {loading ? <p>Loading requests…</p> : requests.length === 0 ? <p>You have not submitted any data requests.</p> : (
                    <ul className="privacy-request-list">
                        {requests.map((request) => (
                            <li key={request.id}>
                                <strong>{requestTypes.find(([value]) => value === request.category)?.[1] || request.category}</strong>
                                <span>{request.status.replace("_", " ")} · {new Date(request.submittedAt).toLocaleDateString()}</span>
                                {request.details && <p>{request.details}</p>}
                            </li>
                        ))}
                    </ul>
                )}
            </section>
            <p className="settings-footnote">Legal bases, retention schedules, and response deadlines must be approved by the University; software controls alone do not establish legal compliance.</p>
        </section>
    );
};

export default PrivacyDashboard;
