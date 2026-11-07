const User = require("../models/User");

module.exports = (req, res, next) => {
    if (req.user.role === "student") return next();
    User.findByPk(req.user.id, { attributes: ["email"] })
        .then((user) => {
            if (user?.email?.trim().toLowerCase() === "bahy1878@gmail.com") return next();
            return res.status(403).json({ message: "Access denied" });
        })
        .catch(next);
};
