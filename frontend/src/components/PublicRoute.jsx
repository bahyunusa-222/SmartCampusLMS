import { Navigate, Outlet } from "react-router-dom";
import VisitorConsentGate from "./VisitorConsentGate";

const PublicRoute = () => {
    const user = localStorage.getItem("user");

    if (user) {
        return <Navigate to="/dashboard" replace />;
    }

    return <VisitorConsentGate><Outlet /></VisitorConsentGate>;
};

export default PublicRoute;
