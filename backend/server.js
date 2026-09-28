require('dotenv').config();
const db = require('./db');
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();

// Create thumbnails directory if it doesn't exist
const thumbDir = path.join(__dirname, '../uploads/thumbnails');
if (!fs.existsSync(thumbDir)) fs.mkdirSync(thumbDir, { recursive: true });

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));
app.use(express.static(path.join(__dirname, '../frontend')));

const authRoutes = require('./routes/auth');
const videoRoutes = require('./routes/videos');
const requestRoutes = require('./routes/requests');
const accessRoutes = require('./routes/access');
const adminRoutes = require('./routes/admin');
const videoRequestRoutes = require('./routes/videoRequests');

app.use('/api/auth', authRoutes);
app.use('/api/videos', videoRoutes);
app.use('/api/requests', requestRoutes);
app.use('/api/access', accessRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/videorequests', videoRequestRoutes);

app.get('/api/test', (req, res) => {
  res.json({ success: true, message: 'Server is running', timestamp: new Date().toISOString() });
});

app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `Route ${req.method} ${req.url} not found`
  });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, '0.0.0.0' ,() => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
  console.log(`🧪 Test it: http://localhost:${PORT}/api/test`);
});
