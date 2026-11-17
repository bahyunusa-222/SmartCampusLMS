import { Navigate, Outlet } from "react-router-dom";
import VisitorConsentGate from "./VisitorConsentGate";

const ProtectedRoute = () => {
    const user = localStorage.getItem("user");

    if (!user) {
        return <Navigate to="/login" replace />;
    }

    return <VisitorConsentGate><Outlet /></VisitorConsentGate>;
};

export default ProtectedRoute;
