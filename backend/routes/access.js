const express = require('express');
const router = express.Router();
const { verifyToken, verifyAdmin } = require('../middleware/auth');
const {
  submitAccessRequest,
  getAccessRequests,
  approveAccessRequest,
  rejectAccessRequest
} = require('../controllers/accessController');

// POST /api/access/request — public, no token needed
router.post('/request', submitAccessRequest);

// GET /api/access/requests — admin only
router.get('/requests', verifyToken, verifyAdmin, getAccessRequests);

// POST /api/access/approve/:id — admin only
router.post('/approve/:id', verifyToken, verifyAdmin, approveAccessRequest);

// POST /api/access/reject/:id — admin only
router.post('/reject/:id', verifyToken, verifyAdmin, rejectAccessRequest);

module.exports = router;