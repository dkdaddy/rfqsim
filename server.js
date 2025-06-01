// server.js - Main application file

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');

const PORT = process.env.PORT || 3000;

// --- In-Memory Data Stores ---
let customers = [
    { id: 'CUST01', tier: '1', shortName: 'Demo Bank A', longName: 'Demonstration Bank Alpha Inc.' },
    { id: 'CUST02', tier: '2', shortName: 'Demo Bank B', longName: 'Demonstration Bank Bravo Co.' },
    { id: 'CUST03', tier: '1', shortName: 'Demo Bank C', longName: 'Demonstration Bank Charlie Ltd.' },
];

let instruments = [
    { id: 'INST01', cusip: '912828ABC', maturity: '2030-12-01', currency: 'USD', instrumentType: 'GovBond', description: 'US Treasury Bond 2.5% 2030' },
    { id: 'INST02', cusip: '912828XYZ', maturity: '2028-06-15', currency: 'USD', instrumentType: 'GovBond', description: 'US Treasury Note 1.875% 2028' },
    { id: 'INST03', cusip: 'AAPL123', maturity: 'N/A', currency: 'USD', instrumentType: 'Equity', description: 'Apple Inc. Common Stock' },
    { id: 'INST04', cusip: 'MSFT456', maturity: 'N/A', currency: 'USD', instrumentType: 'Equity', description: 'Microsoft Corp. Common Stock' },
    { id: 'INST05', cusip: 'CORPBD01', maturity: '2035-03-01', currency: 'EUR', instrumentType: 'CorpBond', description: 'Demo Corp Bond A 5Y EUR' },
];

let venues = [
    { venueId: 'V01', name: 'SimuVenue A', connectionType: 'Simulated' },
    { venueId: 'V02', name: 'SimuVenue B', connectionType: 'Simulated' },
];

let rfqs = []; // This will store our RFQ objects

// --- Logger Utility ---
const logger = {
    info: (message, data) => console.log(`[INFO] ${message}`, data || ''),
    error: (message, err) => console.error(`[ERROR] ${message}`, err || ''),
    venue: (message, data) => console.log(`[VENUE_LOG] ${message}`, data || ''),
};

// --- WebSocket Service ---
const wssConnections = new Map(); // Stores client connections and their subscriptions

function setupWebSocketServer(server) {
    const wss = new WebSocket.Server({ server });

    wss.on('connection', (ws) => {
        const clientId = uuidv4();
        logger.info(`WebSocket client connected: ${clientId}`);
        wssConnections.set(clientId, { ws, subscriptions: {} });

        ws.on('message', (message) => {
            try {
                const parsedMessage = JSON.parse(message);
                logger.info(`WebSocket message from ${clientId}:`, parsedMessage);

                if (parsedMessage.action === 'SUBSCRIBE' && parsedMessage.instrumentType) {
                    const clientConn = wssConnections.get(clientId);
                    if (clientConn) {
                        clientConn.subscriptions.instrumentType = parsedMessage.instrumentType;
                        logger.info(`Client ${clientId} subscribed to instrumentType: ${parsedMessage.instrumentType}`);
                        ws.send(JSON.stringify({ type: 'SUBSCRIPTION_ACK', status: 'Subscribed to ' + parsedMessage.instrumentType }));
                    }
                } else {
                     ws.send(JSON.stringify({ type: 'ERROR', message: 'Invalid subscription message. Provide action: "SUBSCRIBE" and "instrumentType".' }));
                }
            } catch (e) {
                logger.error('Failed to parse WebSocket message or handle subscription:', e);
                ws.send(JSON.stringify({ type: 'ERROR', message: 'Invalid message format.' }));
            }
        });

        ws.on('close', () => {
            logger.info(`WebSocket client disconnected: ${clientId}`);
            wssConnections.delete(clientId);
        });

        ws.on('error', (error) => {
            logger.error(`WebSocket error for client ${clientId}:`, error);
            wssConnections.delete(clientId); // Clean up on error
        });

        ws.send(JSON.stringify({ type: 'CONNECTION_ACK', message: 'Connected to RFQ Stream. Please send subscription message.' }));
    });

    logger.info('WebSocket server setup complete.');
    return wss;
}

function broadcastNewRfq(rfq) {
    const fullRfq = getFullRfqDetails(rfq);
    if (!fullRfq) return;

    const message = JSON.stringify({ type: 'NEW_RFQ', data: fullRfq });
    wssConnections.forEach(conn => {
        if (conn.subscriptions.instrumentType && conn.subscriptions.instrumentType === fullRfq.instrument.instrumentType) {
            if (conn.ws.readyState === WebSocket.OPEN) {
                conn.ws.send(message);
            }
        }
    });
}

function broadcastRfqUpdate(rfq) {
    const fullRfq = getFullRfqDetails(rfq);
     if (!fullRfq) return;

    const message = JSON.stringify({ type: 'RFQ_UPDATE', data: fullRfq });
     wssConnections.forEach(conn => {
        // Send update if subscribed to type, or if no specific subscription (send all updates)
        // For this demo, we only filter on instrumentType for new RFQs, but updates might be broader or also filtered.
        // Let's assume for now updates are sent if the original RFQ matched the subscription.
        if (conn.subscriptions.instrumentType && conn.subscriptions.instrumentType === fullRfq.instrument.instrumentType) {
            if (conn.ws.readyState === WebSocket.OPEN) {
                 conn.ws.send(message);
            }
        }
    });
}


// --- RFQ Service Logic ---

// Helper to enrich RFQ with full details
function getFullRfqDetails(rfq) {
    if (!rfq) return null;
    const instrument = instruments.find(i => i.id === rfq.instrumentId);
    const customer = customers.find(c => c.id === rfq.customerId);
    const venue = venues.find(v => v.venueId === rfq.venueId);

    if (!instrument || !customer || !venue) {
        logger.error('Could not find full details for RFQ:', rfq.id);
        return { ...rfq, instrument: {}, customer: {}, venue: {} }; // Return partial to avoid crash
    }

    return {
        ...rfq,
        instrument: { cusip: instrument.cusip, maturity: instrument.maturity, currency: instrument.currency, instrumentType: instrument.instrumentType, description: instrument.description },
        customer: { id: customer.id, shortName: customer.shortName, tier: customer.tier },
        venue: { venueId: venue.venueId, name: venue.name }
    };
}


// --- RFQ Simulator ---
function startSimulator() {
    logger.info('Starting RFQ Simulator...');
    setInterval(() => {
        const randomInstrument = instruments[Math.floor(Math.random() * instruments.length)];
        const randomCustomer = customers[Math.floor(Math.random() * customers.length)];
        const randomVenue = venues[Math.floor(Math.random() * venues.length)];
        const now = new Date();

        const newRfq = {
            id: `RFQ-${uuidv4()}`,
            startTime: now.toISOString(),
            timeToLive: Math.floor(Math.random() * (120 - 30 + 1) + 30), // TTL between 30s and 120s
            instrumentId: randomInstrument.id,
            customerId: randomCustomer.id,
            venueId: randomVenue.venueId,
            size: Math.floor(Math.random() * (5000000 - 100000 + 1) + 100000) * (randomInstrument.instrumentType === 'Equity' ? 0.01 : 1), // Smaller size for equities
            settlementDate: new Date(now.setDate(now.getDate() + 2)).toISOString().split('T')[0], // T+2
            status: 'New',
            respondingTraderId: null,
        };
        if (randomInstrument.instrumentType === 'Equity') newRfq.size = Math.floor(newRfq.size / 1000) * 100;


        rfqs.push(newRfq);
        logger.info('Simulator generated new RFQ:', { id: newRfq.id, instrumentType: randomInstrument.instrumentType });
        broadcastNewRfq(newRfq);

    }, Math.random() * (5000 - 3000) + 3000); // Every 3-5 seconds
}

// --- RFQ Lifecycle Management (TTL Expiry) ---
function startLifecycleManager() {
    logger.info('Starting RFQ Lifecycle Manager...');
    setInterval(() => {
        const now = new Date();
        rfqs.forEach(rfq => {
            if (rfq.status === 'New' || rfq.status === 'On the Wire') {
                const startTime = new Date(rfq.startTime);
                const expiryTime = new Date(startTime.getTime() + rfq.timeToLive * 1000);
                if (now > expiryTime) {
                    rfq.status = 'Lapsed';
                    logger.info(`RFQ ${rfq.id} status changed to Lapsed due to TTL expiry.`);
                    broadcastRfqUpdate(rfq);
                }
            }
        });
    }, 5000); // Check every 5 seconds
}


// --- Express App Setup ---
const app = express();
app.use(express.json()); // Middleware to parse JSON bodies

// REST API Routes
app.get('/rfqs', (req, res) => {
    const { instrumentId, instrumentCusip, instrumentType } = req.query;
    let filteredRfqs = rfqs;

    if (instrumentId) {
        filteredRfqs = filteredRfqs.filter(r => r.instrumentId === instrumentId);
    }
    if (instrumentCusip) {
        // This requires joining with instrument details
        filteredRfqs = filteredRfqs.filter(r => {
            const instrument = instruments.find(i => i.id === r.instrumentId);
            return instrument && instrument.cusip === instrumentCusip;
        });
    }
    if (instrumentType) {
        filteredRfqs = filteredRfqs.filter(r => {
            const instrument = instruments.find(i => i.id === r.instrumentId);
            return instrument && instrument.instrumentType === instrumentType;
        });
    }
    
    res.json(filteredRfqs.map(getFullRfqDetails).filter(r => r !== null));
});

app.get('/rfqs/:rfqId', (req, res) => {
    const rfq = rfqs.find(r => r.id === req.params.rfqId);
    if (rfq) {
        const fullRfq = getFullRfqDetails(rfq);
        if (fullRfq) {
            res.json(fullRfq);
        } else {
            res.status(404).json({ message: 'RFQ details incomplete or not found.' });
        }
    } else {
        res.status(404).json({ message: 'RFQ not found.' });
    }
});

app.post('/rfqs/:rfqId/respond', (req, res) => {
    const rfq = rfqs.find(r => r.id === req.params.rfqId);
    const { traderId, responseType, priceDetails } = req.body;

    if (!rfq) {
        return res.status(404).json({ message: 'RFQ not found.' });
    }
    if (!traderId || !responseType) {
        return res.status(400).json({ message: 'Missing traderId or responseType in request body.' });
    }
    if (rfq.status === 'Lapsed' || rfq.status === 'Passed') {
         return res.status(400).json({ message: `Cannot respond to RFQ in ${rfq.status} state.` });
    }

    rfq.status = 'On the Wire';
    rfq.respondingTraderId = traderId;

    logger.venue(`Trader [${traderId}] responded to RFQ [${rfq.id}] with [${responseType}].`, { priceDetails });
    broadcastRfqUpdate(rfq);

    res.json({
        message: 'RFQ response acknowledged and logged.',
        rfqId: rfq.id,
        newStatus: rfq.status,
        respondingTraderId: rfq.respondingTraderId
    });
});

app.post('/rfqs/:rfqId/pass', (req, res) => {
    const rfq = rfqs.find(r => r.id === req.params.rfqId);
    const { traderId, reason } = req.body;

    if (!rfq) {
        return res.status(404).json({ message: 'RFQ not found.' });
    }
     if (!traderId) {
        return res.status(400).json({ message: 'Missing traderId in request body.' });
    }
    if (rfq.status === 'Lapsed' || rfq.status === 'Passed') {
         return res.status(400).json({ message: `Cannot pass on RFQ in ${rfq.status} state.` });
    }


    rfq.status = 'Passed';
    rfq.respondingTraderId = traderId; // Log who passed

    logger.venue(`Trader [${traderId}] passed on RFQ [${rfq.id}].`, { reason });
    broadcastRfqUpdate(rfq);

    res.json({
        message: 'RFQ pass acknowledged and logged.',
        rfqId: rfq.id,
        newStatus: rfq.status
    });
});

// Simple health check endpoint
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'UP', timestamp: new Date().toISOString() });
});


// --- Server Initialization ---
const server = http.createServer(app);

// Setup WebSocket server
setupWebSocketServer(server);

server.listen(PORT, () => {
    logger.info(`HTTP and WebSocket Server running on port ${PORT}`);
    // Start background processes
    startSimulator();
    startLifecycleManager();
});

// Graceful shutdown (optional but good practice)
process.on('SIGINT', () => {
    logger.info('Shutting down server...');
    server.close(() => {
        logger.info('Server shut down.');
        process.exit(0);
    });
});