// =====================
// REQUEST ROUTES
// =====================
const express = require('express');
const router = express.Router();
const { verifyToken, verifyAdmin } = require('../middleware/auth');
const { submitRequest, getRequests, markAsSeen } = require('../controllers/requestController');

// POST /api/requests — submit a request (any logged-in user)
router.post('/', verifyToken, submitRequest);

// GET /api/requests — view all requests (admin only)
router.get('/', verifyToken, verifyAdmin, getRequests);

// PATCH /api/requests/:id/seen — mark as seen (admin only)
router.patch('/:id/seen', verifyToken, verifyAdmin, markAsSeen);

module.exports = router;