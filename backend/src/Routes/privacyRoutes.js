const express = require("express");
const authMiddleware = require("../middlewares/authMiddleware");
const privacyController = require("../controllers/privacyController");

const router = express.Router();

router.use(authMiddleware);
router.get("/requests", privacyController.listRequests);
router.post("/requests", privacyController.createRequest);
router.get("/consents", privacyController.getConsents);
router.put("/consents", privacyController.setConsent);
router.get("/export", privacyController.exportPersonalData);

module.exports = router;
