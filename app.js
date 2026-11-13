/**
 * Basic server 
 */
process.env.NODE_ENV = process.env.NODE_ENV || 'development';

const express = require('express');
const config = require('./config/environment/config');
const mongoose = require('mongoose');
const allRoutes = require('./routes.js');
const expressConfig = require('./config/express');

const seedDb = require('./helpers/seed-db');

const swaggerSpec = require('./config/swagger').spec();
const swaggerUI = require('swagger-ui-express');
const swaggerOptions = {
    customeSiteTitle: 'PetClinic REST API'
};

const meteringMiddleware = require('./middleware/meteringMiddleware');
const { startMeteringScheduler } = require('./metering/meteringScheduler');

//console.log(swaggerSpec);
const PORT = config.port;
//mongoose.set('useCreateIndex', true);

// Create connection to MongoDB database
mongoose.Promise = global.Promise;
mongoose.connect(config.db.URI, config.mongo.options);
mongoose.connection.on('error', function(err) {
    console.error(`MongoDB connection error: ${err}`);
    process.exit(1);
});
console.log(`Connected to MongoDB ${config.db.URI}`);

// Dump configuration for start up check convenience
seedDb();

const app = express();
expressConfig(app);

// Count every inbound HTTP request exactly once (SAP Unified Metering:
// HS_PET_CLINIC_MONTLY_USER_COUNT). Registered before allRoutes so the counter
// is traversed by every request handled by the Express pipeline, including
// requests that never reach a mounted router (e.g. 404s).
app.use(meteringMiddleware);

// Register all routes from local routes.js file
allRoutes(app);

app.use('/docs', swaggerUI.serve, swaggerUI.setup(swaggerSpec) );
app.get('/docs.json', (req, res) => {  
    res.setHeader('Content-Type', 'application/json');  
    res.status(200).json(swaggerSpec);  
});

app.get('/', function(req, res) {
    res.send('Hello World!!');
});

app.listen(PORT, function() {
    console.log(`Server is listening on port ${PORT} in ${app.get('env')} mode`);
});
app.emit('APP_STARTED');

// Start the hourly SAP Unified Metering flush after the HTTP server is up.
startMeteringScheduler();

module.exports = app;
