const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
require('dotenv').config();
const bodyParser = require('body-parser');
const http = require('http');
const connectDB = require('./config/db');
const routes = require('./routes');
const initSocket = require('./utils/socket');
const { startEscalationCron } = require('./jobs/escalation.cron');
const pushService = require('./services/pushNotification.service');
const { createRolesCodelist } = require('./utils/populateCodelists'); 
const apiLogger = require('./middleware/apiLogger');
const { createStatusCodelist } = require('./utils/populateCodelists');
const { createStoneTypesCodelist } = require('./utils/populateCodelists');

const swaggerUi = require('swagger-ui-express');
const swaggerSpec = require('./config/swagger');

const app = express();
const server = http.createServer(app);

// Trust proxy for accurate IP logging
app.set('trust proxy', true);

const admin = require("firebase-admin");
const serviceAccount = require("./serviceAccountKey.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

// CORS setup
app.use(cors({
  origin: [
    'http://localhost:4200',
    'https://workflow-ui-virid.vercel.app'
  ],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));

app.use(bodyParser.json());
app.use(express.static('public'));

// Swagger UI (open — no auth required)
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

// Health check (open — used by load balancers / k8s probes)
app.get('/health', (req, res) => {
  const dbState = mongoose.connection.readyState; // 1 = connected
  res.status(dbState === 1 ? 200 : 503).json({
    status: dbState === 1 ? 'ok' : 'degraded',
    db: dbState,
    uptime: process.uptime()
  });
});

// API Logger Middleware - Log all API calls
app.use('/api', apiLogger);

// API routes
app.use('/api', routes);

// Initialize DB and Server
const startApp = async () => {
  await connectDB();

  // Clean up any invalid chat documents with null values

  // Start WebSocket server
  initSocket(server);

  // Start the daily SLA-escalation cron
  startEscalationCron();

  // Start HTTP server
  const PORT = process.env.PORT || 5000;
  server.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    // createRolesCodelist(); populate roles codelist
    // createStatusCodelist(); populate status codelist
    // createStoneTypesCodelist(); populate stone types codelist
  });
};

startApp();