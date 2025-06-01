// server.ts - Main application file

import express, { Request, Response, NextFunction, RequestHandler } from 'express'; // Added RequestHandler
import http from 'http';
import WebSocket from 'ws';
import { v4 as uuidv4 } from 'uuid';

const PORT = process.env.PORT || 3000;

// --- TypeScript Interfaces (based on OpenAPI spec) ---

interface InstrumentDetail {
    id: string; // Added for internal reference
    cusip: string;
    maturity: string; // date
    currency: string;
    instrumentType: string;
    description?: string;
}

interface CustomerDetail {
    id: string;
    tier: string;
    shortName: string;
    longName: string;
}

interface VenueDetail {
    venueId: string;
    name: string;
    connectionType: string;
}

interface RFQ {
    id: string;
    startTime: string; // date-time
    timeToLive: number; // integer, seconds
    instrumentId: string; // Foreign key to InstrumentDetail
    customerId: string;   // Foreign key to CustomerDetail
    venueId: string;      // Foreign key to VenueDetail
    size: number;
    settlementDate: string; // date
    status: 'New' | 'On the Wire' | 'Passed' | 'Lapsed';
    respondingTraderId: string | null;
}

// For API responses, we'll combine RFQ with full details
interface RFQApiResponse extends Omit<RFQ, 'instrumentId' | 'customerId' | 'venueId'> {
    instrument: Omit<InstrumentDetail, 'id'>;
    customer: Omit<CustomerDetail, 'longName'>; // Assuming longName not always needed in brief view
    venue: VenueDetail;
}


interface RfqResponseActionRequest {
    traderId: string;
    responseType: 'STREAM_PRICE' | 'FIXED_PRICE';
    priceDetails?: {
        price: number;
        quantity?: number;
    };
}

interface RfqPassActionRequest {
    traderId: string;
    reason?: string;
}

// --- In-Memory Data Stores ---
let customers: CustomerDetail[] = [
    { id: 'CUST01', tier: '1', shortName: 'Demo Bank A', longName: 'Demonstration Bank Alpha Inc.' },
    { id: 'CUST02', tier: '2', shortName: 'Demo Bank B', longName: 'Demonstration Bank Bravo Co.' },
    { id: 'CUST03', tier: '1', shortName: 'Demo Bank C', longName: 'Demonstration Bank Charlie Ltd.' },
];

let instruments: InstrumentDetail[] = [
    { id: 'INST01', cusip: '912828ABC', maturity: '2030-12-01', currency: 'USD', instrumentType: 'GovBond', description: 'US Treasury Bond 2.5% 2030' },
    { id: 'INST02', cusip: '912828XYZ', maturity: '2028-06-15', currency: 'USD', instrumentType: 'GovBond', description: 'US Treasury Note 1.875% 2028' },
    { id: 'INST03', cusip: 'AAPL123', maturity: 'N/A', currency: 'USD', instrumentType: 'Equity', description: 'Apple Inc. Common Stock' },
    { id: 'INST04', cusip: 'MSFT456', maturity: 'N/A', currency: 'USD', instrumentType: 'Equity', description: 'Microsoft Corp. Common Stock' },
    { id: 'INST05', cusip: 'CORPBD01', maturity: '2035-03-01', currency: 'EUR', instrumentType: 'CorpBond', description: 'Demo Corp Bond A 5Y EUR' },
];

let venues: VenueDetail[] = [
    { venueId: 'V01', name: 'SimuVenue A', connectionType: 'Simulated' },
    { venueId: 'V02', name: 'SimuVenue B', connectionType: 'Simulated' },
];

let rfqs: RFQ[] = []; // This will store our RFQ objects

// --- Logger Utility ---
const logger = {
    info: (message: string, data?: any) => console.log(`[INFO] ${new Date().toISOString()} ${message}`, data || ''),
    error: (message: string, err?: any) => console.error(`[ERROR] ${new Date().toISOString()} ${message}`, err || ''),
    venue: (message: string, data?: any) => console.log(`[VENUE_LOG] ${new Date().toISOString()} ${message}`, data || ''),
};

// --- WebSocket Service ---
interface ClientConnection {
    ws: WebSocket;
    subscriptions: {
        instrumentType?: string;
    };
}
const wssConnections = new Map<string, ClientConnection>();

function setupWebSocketServer(server: http.Server) {
    const wss = new WebSocket.Server({ server });

    wss.on('connection', (ws: WebSocket) => {
        const clientId = uuidv4();
        logger.info(`WebSocket client connected: ${clientId}`);
        wssConnections.set(clientId, { ws, subscriptions: {} });

        ws.on('message', (message: WebSocket.Data) => {
            try {
                const parsedMessage = JSON.parse(message.toString());
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

        ws.on('error', (error: Error) => {
            logger.error(`WebSocket error for client ${clientId}:`, error);
            wssConnections.delete(clientId);
        });
        
        ws.send(JSON.stringify({ type: 'CONNECTION_ACK', message: 'Connected to RFQ Stream. Please send subscription message.' }));
    });

    logger.info('WebSocket server setup complete.');
    return wss;
}

function getFullRfqDetails(rfq: RFQ): RFQApiResponse | null {
    if (!rfq) return null;
    const instrument = instruments.find(i => i.id === rfq.instrumentId);
    const customer = customers.find(c => c.id === rfq.customerId);
    const venue = venues.find(v => v.venueId === rfq.venueId);

    if (!instrument || !customer || !venue) {
        logger.error('Could not find full details for RFQ:', rfq.id);
        return { 
            ...rfq, 
            instrument: { cusip: 'N/A', maturity: 'N/A', currency: 'N/A', instrumentType: 'N/A', description: 'Instrument details missing' }, 
            customer: { id: 'N/A', shortName: 'Customer details missing', tier: 'N/A' }, 
            venue: { venueId: 'N/A', name: 'Venue details missing', connectionType: 'N/A' }
        };
    }
    
    const { id: instrumentObjId, ...instrumentApi } = instrument;
    const { longName, ...customerApi } = customer;

    return {
        id: rfq.id,
        startTime: rfq.startTime,
        timeToLive: rfq.timeToLive,
        size: rfq.size,
        settlementDate: rfq.settlementDate,
        status: rfq.status,
        respondingTraderId: rfq.respondingTraderId,
        instrument: instrumentApi,
        customer: customerApi,
        venue: venue
    };
}


function broadcastNewRfq(rfq: RFQ) {
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

function broadcastRfqUpdate(rfq: RFQ) {
    const fullRfq = getFullRfqDetails(rfq);
    if (!fullRfq) return;
    
    const message = JSON.stringify({ type: 'RFQ_UPDATE', data: fullRfq });
     wssConnections.forEach(conn => {
        if (conn.subscriptions.instrumentType && conn.subscriptions.instrumentType === fullRfq.instrument.instrumentType) {
             if (conn.ws.readyState === WebSocket.OPEN) {
                conn.ws.send(message);
            }
        }
    });
}

// --- RFQ Simulator ---
function startSimulator() {
    logger.info('Starting RFQ Simulator...');
    setInterval(() => {
        const randomInstrument = instruments[Math.floor(Math.random() * instruments.length)];
        const randomCustomer = customers[Math.floor(Math.random() * customers.length)];
        const randomVenue = venues[Math.floor(Math.random() * venues.length)];
        const now = new Date();

        const newRfq: RFQ = {
            id: `RFQ-${uuidv4()}`,
            startTime: now.toISOString(),
            timeToLive: Math.floor(Math.random() * (120 - 30 + 1) + 30), 
            instrumentId: randomInstrument.id,
            customerId: randomCustomer.id,
            venueId: randomVenue.venueId,
            size: Math.floor(Math.random() * (5000000 - 100000 + 1) + 100000) * (randomInstrument.instrumentType === 'Equity' ? 0.01 : 1),
            settlementDate: new Date(new Date().setDate(now.getDate() + 2)).toISOString().split('T')[0],
            status: 'New',
            respondingTraderId: null,
        };
        if (randomInstrument.instrumentType === 'Equity') newRfq.size = Math.floor(newRfq.size / 1000) * 100;

        rfqs.push(newRfq);
        logger.info('Simulator generated new RFQ:', { id: newRfq.id, instrumentType: randomInstrument.instrumentType });
        broadcastNewRfq(newRfq);

    }, Math.random() * 240 + 300); 
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
    }, 5000); 
}

// --- Express App Setup ---
const app = express();
app.use(express.json()); 

// REST API Routes
app.get('/health', (req: Request, res: Response) => {
    res.status(200).json({ status: 'UP', timestamp: new Date().toISOString() });
});

app.get('/rfqs', (req: Request, res: Response) => {
    const { instrumentId, instrumentCusip, instrumentType } = req.query;
    let filteredRfqs: RFQ[] = rfqs;

    if (instrumentId && typeof instrumentId === 'string') {
        filteredRfqs = filteredRfqs.filter(r => r.instrumentId === instrumentId);
    }
    if (instrumentCusip && typeof instrumentCusip === 'string') {
        filteredRfqs = filteredRfqs.filter(r => {
            const instrument = instruments.find(i => i.id === r.instrumentId);
            return instrument && instrument.cusip === instrumentCusip;
        });
    }
    if (instrumentType && typeof instrumentType === 'string') {
        filteredRfqs = filteredRfqs.filter(r => {
            const instrument = instruments.find(i => i.id === r.instrumentId);
            return instrument && instrument.instrumentType === instrumentType;
        });
    }
    
    const responseData = filteredRfqs.map(getFullRfqDetails).filter(r => r !== null) as RFQApiResponse[];
    res.json(responseData);
});

app.get('/rfqs/:rfqId', (req: Request, res: Response) => {
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

// Explicitly typed Request Handlers for POST routes
const respondToRfqHandler: RequestHandler = (req, res, next) => {
    const rfq = rfqs.find(r => r.id === req.params.rfqId);
    // Use type assertion for req.body as RequestHandler's default body type is 'any'
    const { traderId, responseType, priceDetails } = req.body as RfqResponseActionRequest;

    if (!rfq) {
        res.status(404).json({ message: 'RFQ not found.' });
        return; 
    }
    if (!traderId || !responseType) {
        res.status(400).json({ message: 'Missing traderId or responseType in request body.' });
        return;
    }
    if (responseType === 'FIXED_PRICE' && (!priceDetails || typeof priceDetails.price !== 'number')) {
        res.status(400).json({ message: 'Price details (price) required for FIXED_PRICE response type.' });
        return;
    }
    if (rfq.status === 'Lapsed' || rfq.status === 'Passed') {
        res.status(400).json({ message: `Cannot respond to RFQ in ${rfq.status} state.` });
        return;
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
};
app.post('/rfqs/:rfqId/respond', respondToRfqHandler);


const passOnRfqHandler: RequestHandler = (req, res, next) => {
    const rfq = rfqs.find(r => r.id === req.params.rfqId);
    const { traderId, reason } = req.body as RfqPassActionRequest;

    if (!rfq) {
        res.status(404).json({ message: 'RFQ not found.' });
        return;
    }
    if (!traderId) {
        res.status(400).json({ message: 'Missing traderId in request body.' });
        return;
    }
    if (rfq.status === 'Lapsed' || rfq.status === 'Passed') {
        res.status(400).json({ message: `Cannot pass on RFQ in ${rfq.status} state.` });
        return;
    }

    rfq.status = 'Passed';
    rfq.respondingTraderId = traderId; 

    logger.venue(`Trader [${traderId}] passed on RFQ [${rfq.id}].`, { reason });
    broadcastRfqUpdate(rfq);

    res.json({
        message: 'RFQ pass acknowledged and logged.',
        rfqId: rfq.id,
        newStatus: rfq.status
    });
};
app.post('/rfqs/:rfqId/pass', passOnRfqHandler);


// Basic Error Handler
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
    logger.error('Unhandled Express Error:', err.stack);
    res.status(500).json({ message: 'Internal Server Error' });
});


// --- Server Initialization ---
const server = http.createServer(app);

setupWebSocketServer(server);

server.listen(PORT, () => {
    logger.info(`HTTP and WebSocket Server (TypeScript) running on port ${PORT}`);
    startSimulator();
    startLifecycleManager();
});

// Graceful shutdown
process.on('SIGINT', () => {
    logger.info('Shutting down server (SIGINT)...');
    server.close(() => {
        logger.info('Server shut down.');
        process.exit(0);
    });
});
process.on('SIGTERM', () => {
    logger.info('Shutting down server (SIGTERM)...');
    server.close(() => {
        logger.info('Server shut down.');
        process.exit(0);
    });
});
