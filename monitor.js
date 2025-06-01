const instrumentTypeInput = document.getElementById('instrumentTypeInput');
const subscribeButton = document.getElementById('subscribeButton');
const disconnectButton = document.getElementById('disconnectButton');
const connectionStatusDiv = document.getElementById('connectionStatus');
const rfqTableBody = document.getElementById('rfqTableBody');
const noRfqsMessageRow = document.getElementById('noRfqsMessageRow');
const actionLogDiv = document.getElementById('actionLog');

const respondModal = document.getElementById('respondModal');
const respondModalRfqIdSpan = document.getElementById('respondModalRfqId');
const respondRfqIdHidden = document.getElementById('respondRfqIdHidden');
const traderIdInput = document.getElementById('traderIdInput');
const responseTypeSelect = document.getElementById('responseTypeSelect');
const priceInput = document.getElementById('priceInput');
const quantityInput = document.getElementById('quantityInput');
const cancelRespondButton = document.getElementById('cancelRespondButton');
const submitRespondButton = document.getElementById('submitRespondButton');

const passModal = document.getElementById('passModal');
const passModalRfqIdSpan = document.getElementById('passModalRfqId');
const passRfqIdHidden = document.getElementById('passRfqIdHidden');
const passTraderIdInput = document.getElementById('passTraderIdInput');
const passReasonInput = document.getElementById('passReasonInput');
const cancelPassButton = document.getElementById('cancelPassButton');
const submitPassButton = document.getElementById('submitPassButton');

// RFQ Detail Panel Elements
const rfqDetailContentDiv = document.getElementById('rfqDetailContent');
const noRfqSelectedMessageDiv = document.getElementById('noRfqSelectedMessage');
const detailRfqIdSpan = document.getElementById('detailRfqId');
const detailRfqTimeSpan = document.getElementById('detailRfqTime');
const detailRfqSideSpan = document.getElementById('detailRfqSide');
const detailRfqQtySpan = document.getElementById('detailRfqQty');
const detailRfqInstSpan = document.getElementById('detailRfqInst');
const detailRfqCcySpan = document.getElementById('detailRfqCcy');
const detailRfqMatSpan = document.getElementById('detailRfqMat');
const detailRfqVenueSpan = document.getElementById('detailRfqVenue');
const detailRfqCustSpan = document.getElementById('detailRfqCust');
const detailRfqStatusSpan = document.getElementById('detailRfqStatus');
const detailRfqTraderSpan = document.getElementById('detailRfqTrader');
const detailRfqDv01Span = document.getElementById('detailRfqDv01');
const quickRespondSection = document.getElementById('quickRespondSection');
const detailRespondPriceInput = document.getElementById('detailRespondPriceInput');
const detailRespondSubmitButton = document.getElementById('detailRespondSubmitButton');


let socket = null;
const API_BASE_URL = 'http://localhost:3000';
const rfqDataMap = new Map(); // To store full RFQ data for modals etc.
let currentSelectedRfqId = null;
let currentSortKey = null;
let currentSortDirection = 'asc'; // 'asc' or 'desc'
let activeFilters = {}; // To store { columnKey: filterValue }

function logMessage(message, type = 'info') {
    const p = document.createElement('p');
    const timestamp = new Date().toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    p.innerHTML = `<span class="text-gray-500">${timestamp}</span> <span class="text-gray-400">></span> ${message}`;

    if (type === 'error') p.classList.add('text-red-400');
    else if (type === 'success') p.classList.add('text-green-400');
    else if (type === 'ws_send') p.classList.add('text-sky-500');
    else if (type === 'ws_recv') p.classList.add('text-purple-400');
    else p.classList.add('text-amber-400');

    const initialLog = actionLogDiv.querySelector('p.italic');
    if (initialLog && actionLogDiv.children.length === 1) {
        actionLogDiv.innerHTML = '';
    }
    actionLogDiv.prepend(p); // Add new logs to the top
    if (actionLogDiv.children.length > 100) { // Keep log short
        actionLogDiv.removeChild(actionLogDiv.lastChild);
    }
}

function updateConnectionStatus(status, message = '') {
    connectionStatusDiv.textContent = status.toUpperCase();
    const baseClasses = "text-xs px-2 py-0.5";
    if (status === 'Connected') {
        connectionStatusDiv.className = `${baseClasses} bg-green-700 text-green-200`;
        logMessage(`Connection Established. ${message}`, 'success');
        subscribeButton.disabled = true;
        instrumentTypeInput.disabled = true;
        disconnectButton.disabled = false;
    } else if (status === 'Disconnected' || status === 'Error') {
        connectionStatusDiv.className = `${baseClasses} bg-red-700 text-red-200`;
        logMessage(`WS ${status}. ${message}`, 'error');
        subscribeButton.disabled = false;
        instrumentTypeInput.disabled = false;
        disconnectButton.disabled = true;
    } else { // Connecting
        connectionStatusDiv.className = `${baseClasses} bg-yellow-600 text-yellow-100`;
        logMessage(`WS Connecting...`, 'info');
        subscribeButton.disabled = true;
        instrumentTypeInput.disabled = true;
        disconnectButton.disabled = true;
    }
}

function connectWebSocket(autoSubInstrumentType = null) {
    const instrumentType = autoSubInstrumentType || instrumentTypeInput.value.trim();
    if (!instrumentType) {
        logMessage('ERR: Instrument type required.', 'error');
        if(!autoSubInstrumentType) alert('Please enter an instrument type.');
        return;
    }
    instrumentTypeInput.value = instrumentType;

    if (socket && socket.readyState === WebSocket.OPEN) {
        logMessage('INFO: Already connected. Disconnect to change subscription.', 'info');
        return;
    }

    rfqTableBody.innerHTML = '';
    if (noRfqsMessageRow) rfqTableBody.appendChild(noRfqsMessageRow);
    if (noRfqsMessageRow) noRfqsMessageRow.classList.remove('hidden');


    socket = new WebSocket('ws://localhost:3000/rfq-stream');
    updateConnectionStatus('Connecting');

    socket.onopen = () => {
        updateConnectionStatus('Connected', 'Subscribing...');
        const subscriptionMsg = { action: 'SUBSCRIBE', instrumentType: instrumentType };
        socket.send(JSON.stringify(subscriptionMsg));
        logMessage(`SENT: Subscribe INSTR_TYPE=${instrumentType}`, 'ws_send');
    };

    socket.onmessage = (event) => {
        const message = JSON.parse(event.data);
        // logMessage(`RECV: ${JSON.stringify(message).substring(0,100)}...`, 'ws_recv');

        if (message.type === 'SUBSCRIPTION_ACK') {
            logMessage(`SUB_ACK: ${message.status}`, 'success');
        } else if (message.type === 'NEW_RFQ') {
            const rfq = message.data;
            logMessage(`NEW_RFQ: ID ${rfq.id.slice(-6)} ${rfq.instrument.instrumentType}`, 'ws_recv');
            rfqDataMap.set(rfq.id, rfq);
            addRfqToTable(message.data);
        } else if (message.type === 'RFQ_UPDATE') {
            logMessage(`RFQ_UPD: ID ${message.data.id.slice(-6)} STATUS ${message.data.status}`, 'ws_recv');
            rfqDataMap.set(message.data.id, message.data); // Update stored data
            updateRfqInTable(message.data);
        } else if (message.type === 'ERROR') {
            logMessage(`ERR_SERV: ${message.message}`, 'error');
        } else if (message.type === 'CONNECTION_ACK') {
             logMessage(`CONN_ACK: ${message.message}`, 'info');
        }
    };

    socket.onerror = (error) => {
        updateConnectionStatus('Error', `Details in console.`);
        console.error('WebSocket Error:', error);
    };

    socket.onclose = (event) => {
        let reason = event.reason ? `Reason: ${event.reason}` : 'Closed.';
        if (event.code) reason = `Code: ${event.code} ${reason}`;
        updateConnectionStatus('Disconnected', reason);
        socket = null;
    };
}

disconnectButton.addEventListener('click', () => {
    if (socket) {
        socket.close();
        logMessage('INFO: Disconnected by user.', 'info');
    }
});

function formatQuantity(amount) {
    if (amount >= 1000000) return (amount / 1000000).toFixed(1) + 'MM';
    if (amount >= 1000) return (amount / 1000).toFixed(0) + 'M';
    return amount.toString();
}

// Simulate side for color coding as backend doesn't provide it
const rfqSides = new Map(); // Store simulated side for consistency
function getRfqSide(rfqId) {
    if (!rfqSides.has(rfqId)) {
        rfqSides.set(rfqId, Math.random() > 0.5 ? 'BUY' : 'SELL');
    }
    return rfqSides.get(rfqId);
}

function canRfqBeActioned(status) {
    const nonActionableStatuses = ['Lapsed', 'Passed', 'Filled', 'Expired', 'Done', 'Traded', 'Cancelled'];
    return !nonActionableStatuses.includes(status);
}


function createRfqTableRow(rfq) {
    if (noRfqsMessageRow) noRfqsMessageRow.classList.add('hidden');

    const row = document.createElement('tr');
    row.id = `rfq-${rfq.id}`;

    const side = getRfqSide(rfq.id);
    const sideClass = side === 'BUY' ? 'text-buy' : 'text-sell';

    const formattedQty = formatQuantity(rfq.size);
    const isActionable = canRfqBeActioned(rfq.status);

    row.innerHTML = `
        <td class="font-mono">${rfq.id.slice(-6)}</td>
        <td>${new Date(rfq.startTime).toLocaleTimeString([], {hour12: false, hour: '2-digit', minute:'2-digit', second:'2-digit'})}</td>
        <td class="${sideClass} font-semibold">${side}</td>
        <td class="${sideClass} text-right">${formattedQty}</td>
        <td>${rfq.instrument.cusip || rfq.instrument.description.substring(0,15)}</td>
        <td>${rfq.instrument.currency}</td>
        <td>${rfq.instrument.maturity === 'N/A' ? 'N/A' : new Date(rfq.instrument.maturity).toLocaleDateString('en-GB', { year:'2-digit', month:'short', day:'numeric' })}</td>
        <td>${rfq.venue.name.substring(0,10)}</td>
        <td>${rfq.customer.shortName.substring(0,10)}</td>
        <td class="font-semibold ${rfq.status === 'New' ? 'text-blue-400' : rfq.status === 'On the Wire' ? 'text-yellow-400' : rfq.status === 'Passed' ? 'text-red-400' : 'text-gray-500'}">${rfq.status}</td>
        <td>${rfq.respondingTraderId || '---'}</td>
        <td>
            ${rfq.instrument.DV01 !== undefined ? rfq.instrument.DV01.toFixed(2) : '---'}
        </td>
        <td>
            <div class="flex space-x-1 justify-start">
                <button class="respond-btn btn btn-action-respond" data-rfqid="${rfq.id}" ${!isActionable ? 'disabled' : ''}>Hit</button>
                <button class="pass-btn btn btn-action-pass" data-rfqid="${rfq.id}" ${!isActionable ? 'disabled' : ''}>Pass</button>
            </div>
        </td>
    `;
    return row;
}

function addRfqToTable(rfq) {
    // Always re-render the table to apply current filters and sort order
    renderTable();
    // Find the newly added/updated row to apply flash after re-render
    const newRenderedRow = document.getElementById(`rfq-${rfq.id}`);
    if (newRenderedRow) {
        flashRow(newRenderedRow, getRfqSide(rfq.id));
    }
}

function updateRfqInTable(rfq) {
    // Always re-render the table to reflect update with current filters and sort order
    renderTable();
    // If the updated RFQ was selected, ensure its details panel is also up-to-date
    // The selection highlighting will be handled by renderTable itself.
    if (currentSelectedRfqId === rfq.id) {
        displayRfqDetails(rfq.id); // Refresh detail panel
    }
}

function flashRow(rowElement, side) {
    rowElement.classList.add(side === 'BUY' ? 'bg-buy-flash' : 'bg-sell-flash');
    setTimeout(() => {
        rowElement.classList.remove('bg-buy-flash', 'bg-sell-flash');
    }, 300);
}

function attachActionButtonsToRow(rowElement) {
    const respondBtn = rowElement.querySelector('.respond-btn');
    if (respondBtn) {
        respondBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const rfqId = e.target.dataset.rfqid;
            openRespondModal(rfqId);
        });
    }

    const passBtn = rowElement.querySelector('.pass-btn');
    if (passBtn) {
        passBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const rfqId = e.target.dataset.rfqid;
            openPassModal(rfqId);
        });
    }
}

function openModal(modalElement) {
    modalElement.classList.remove('opacity-0', 'pointer-events-none');
    modalElement.classList.add('opacity-100');
}

function closeModal(modalElement) {
    modalElement.classList.add('opacity-0');
    setTimeout(() => {
      modalElement.classList.add('pointer-events-none');
    }, 250);
}

function displayRfqDetails(rfqId) {
    // Clear previous selection styling if a different RFQ is being selected
    if (currentSelectedRfqId && currentSelectedRfqId !== rfqId) {
        const prevSelectedRow = document.getElementById(`rfq-${currentSelectedRfqId}`);
        if (prevSelectedRow) {
            prevSelectedRow.classList.remove('selected-row');
        }
    }

    if (!rfqId) { // No RFQ selected or deselecting
        rfqDetailContentDiv.classList.add('hidden');
        noRfqSelectedMessageDiv.classList.remove('hidden');
        quickRespondSection.classList.add('hidden');

        // Reset all detail fields to placeholder
        detailRfqIdSpan.textContent = '-';
        detailRfqTimeSpan.textContent = '-';
        detailRfqSideSpan.textContent = '-'; detailRfqSideSpan.className = 'text-gray-100';
        detailRfqQtySpan.textContent = '-';
        detailRfqInstSpan.textContent = '-';
        detailRfqCcySpan.textContent = '-';
        detailRfqMatSpan.textContent = '-';
        detailRfqVenueSpan.textContent = '-';
        detailRfqCustSpan.textContent = '-';
        detailRfqStatusSpan.textContent = '-'; detailRfqStatusSpan.className = 'text-gray-100';
        detailRfqTraderSpan.textContent = '-';
        detailRfqDv01Span.textContent = '-';

        detailRespondPriceInput.value = '';
        detailRespondPriceInput.disabled = true;
        detailRespondSubmitButton.disabled = true;
        currentSelectedRfqId = null;
        return;
    }

    const rfq = rfqDataMap.get(rfqId);
    if (!rfq) {
        logMessage(`Error: Could not find details for RFQ ID ${rfqId} in rfqDataMap.`, 'error');
        displayRfqDetails(null); // Reset panel to "no selection"
        return;
    }

    const side = getRfqSide(rfq.id); // Get BUY/SELL side

    detailRfqIdSpan.textContent = rfq.id; // Show full ID in details
    detailRfqTimeSpan.textContent = new Date(rfq.startTime).toLocaleTimeString([], {hour12: false, hour: '2-digit', minute:'2-digit', second:'2-digit'});
    detailRfqSideSpan.textContent = side;
    detailRfqSideSpan.className = `font-semibold ${side === 'BUY' ? 'text-buy' : 'text-sell'}`;
    detailRfqQtySpan.textContent = formatQuantity(rfq.size);
    detailRfqInstSpan.textContent = rfq.instrument.description || rfq.instrument.cusip || 'N/A';
    detailRfqCcySpan.textContent = rfq.instrument.currency;
    detailRfqMatSpan.textContent = rfq.instrument.maturity === 'N/A' ? 'N/A' : new Date(rfq.instrument.maturity).toLocaleDateString('en-GB', { year:'2-digit', month:'short', day:'numeric' });
    detailRfqVenueSpan.textContent = rfq.venue.name;
    detailRfqCustSpan.textContent = rfq.customer.shortName;
    detailRfqStatusSpan.textContent = rfq.status;
    detailRfqStatusSpan.className = `font-semibold ${rfq.status === 'New' ? 'text-blue-400' : rfq.status === 'On the Wire' ? 'text-yellow-400' : rfq.status === 'Passed' ? 'text-red-400' : 'text-gray-500'}`;
    detailRfqTraderSpan.textContent = rfq.respondingTraderId || '---';
    detailRfqDv01Span.textContent = rfq.instrument.DV01 !== undefined ? rfq.instrument.DV01.toFixed(2) : 'N/A';

    // Quick Respond Section
    quickRespondSection.classList.remove('hidden');
    detailRespondPriceInput.value = ''; // Clear previous price

    const isActionable = canRfqBeActioned(rfq.status);
    detailRespondPriceInput.disabled = !isActionable;
    detailRespondSubmitButton.disabled = !isActionable;
    if (!isActionable) {
        detailRespondPriceInput.placeholder = "Non-actionable";
    } else {
        detailRespondPriceInput.placeholder = "e.g., 100.0250";
    }
    rfqDetailContentDiv.classList.remove('hidden');
    noRfqSelectedMessageDiv.classList.add('hidden');
    currentSelectedRfqId = rfqId; // Set the new current selection
}

function openRespondModal(rfqId) {
    const rfq = rfqDataMap.get(rfqId);
    if (!rfq) return;
    respondModalRfqIdSpan.textContent = rfqId.slice(-6);
    respondRfqIdHidden.value = rfqId;
    priceInput.value = '';
    quantityInput.value = rfq.size; // Pre-fill with RFQ size
    traderIdInput.value = localStorage.getItem('rfqTraderId') || 'TRADER_BTM_01';
    openModal(respondModal);
}
cancelRespondButton.addEventListener('click', () => closeModal(respondModal));
submitRespondButton.addEventListener('click', async () => {
    const rfqId = respondRfqIdHidden.value;
    const traderId = traderIdInput.value.trim() || 'TRADER_BTM_DEFAULT';
    localStorage.setItem('rfqTraderId', traderId);

    const payload = {
        traderId: traderId,
        responseType: responseTypeSelect.value,
        priceDetails: { price: parseFloat(priceInput.value) }
    };
    if (quantityInput.value) {
        payload.priceDetails.quantity = parseInt(quantityInput.value);
    }

    if (!payload.priceDetails.price || isNaN(payload.priceDetails.price)) {
        alert('Valid price required.');
        return;
    }

    try {
        const response = await fetch(`${API_BASE_URL}/rfqs/${rfqId}/respond`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const result = await response.json();
        if (response.ok) {
            logMessage(`RESP_SENT: RFQ ${rfqId.slice(-6)} - ${result.message}`, 'success');
        } else {
            logMessage(`RESP_ERR: RFQ ${rfqId.slice(-6)} - ${result.message || response.statusText}`, 'error');
            alert(`Error: ${result.message || response.statusText}`);
        }
    } catch (err) {
        logMessage(`NET_ERR: Respond RFQ ${rfqId.slice(-6)} - ${err.message}`, 'error');
        alert(`Network Error: ${err.message}`);
    }
    closeModal(respondModal);
});

function openPassModal(rfqId) {
    passModalRfqIdSpan.textContent = rfqId.slice(-6);
    passRfqIdHidden.value = rfqId;
    passReasonInput.value = '';
    passTraderIdInput.value = localStorage.getItem('rfqTraderId') || 'TRADER_BTM_01';
    openModal(passModal);
}
cancelPassButton.addEventListener('click', () => closeModal(passModal));
submitPassButton.addEventListener('click', async () => {
    const rfqId = passRfqIdHidden.value;
    const traderId = passTraderIdInput.value.trim() || 'TRADER_BTM_DEFAULT';
    localStorage.setItem('rfqTraderId', traderId);

    const payload = {
        traderId: traderId,
        reason: passReasonInput.value.trim()
    };

    try {
        const response = await fetch(`${API_BASE_URL}/rfqs/${rfqId}/pass`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const result = await response.json();
        if (response.ok) {
            logMessage(`PASS_SENT: RFQ ${rfqId.slice(-6)} - ${result.message}`, 'success');
        } else {
            logMessage(`PASS_ERR: RFQ ${rfqId.slice(-6)} - ${result.message || response.statusText}`, 'error');
            alert(`Error: ${result.message || response.statusText}`);
        }
    } catch (err) {
        logMessage(`NET_ERR: Pass RFQ ${rfqId.slice(-6)} - ${err.message}`, 'error');
        alert(`Network Error: ${err.message}`);
    }
    closeModal(passModal);
});

function getSortableValue(rfq, key) {
    switch (key) {
        case 'id': return rfq.id.slice(-6);
        case 'startTime': return new Date(rfq.startTime);
        case 'side': return getRfqSide(rfq.id); // Uses the simulated side
        case 'size': return rfq.size;
        case 'instrument': return rfq.instrument.cusip || rfq.instrument.description;
        case 'currency': return rfq.instrument.currency; // Corrected from instrument.cusip
        // For filtering, we might want to compare against the formatted date string
        // For sorting, Date object is better. Let's handle this in the filter logic.
        case 'startTime': return new Date(rfq.startTime);
        case 'maturity': return rfq.instrument.maturity === 'N/A' ? new Date(0) : new Date(rfq.instrument.maturity); // Handle N/A for sorting
        case 'venue': return rfq.venue.name;
        case 'customer': return rfq.customer.shortName;
        case 'status': return rfq.status;
        case 'trader': return rfq.respondingTraderId || ''; // Sort empty strings last/first
        case 'dv01': return rfq.instrument.DV01 !== undefined ? rfq.instrument.DV01 : Number.NEGATIVE_INFINITY; // Sort N/A (represented by -Infinity) first on asc
        default: return rfq[key];
    }
}

function applyFiltersToRfqs(rfqsArray) {
    const activeFilterKeys = Object.keys(activeFilters).filter(key => activeFilters[key] !== '');
    if (activeFilterKeys.length === 0) {
        return rfqsArray;
    }

    return rfqsArray.filter(rfq => {
        return activeFilterKeys.every(key => {
            let value = getSortableValue(rfq, key);
            let filterValue = activeFilters[key]; // Already lowercased

            if (value === undefined || value === null) return false;

            // Special handling for date/time fields for string comparison
            if (key === 'startTime') {
                value = new Date(rfq.startTime).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
            } else if (key === 'maturity' && rfq.instrument.maturity !== 'N/A') {
                value = new Date(rfq.instrument.maturity).toLocaleDateString('en-GB', { year: '2-digit', month: 'short', day: 'numeric' });
            } else if (key === 'dv01') {
                value = rfq.instrument.DV01 !== undefined ? rfq.instrument.DV01.toFixed(2) : 'N/A';
            } else if (typeof value !== 'string') {
                value = String(value);
            }

            return value.toLowerCase().includes(filterValue);
        });
    });
}

function sortRfqs(rfqsArray) {
    if (!currentSortKey) {
        // Default sort by startTime descending if no sort key is active
        return rfqsArray.sort((a,b) => new Date(b.startTime) - new Date(a.startTime));
    }

    // If a sort key is active, use it.
    // The original logic for currentSortKey is fine here.

    return rfqsArray.sort((a, b) => {
        let valA = getSortableValue(a, currentSortKey);
        let valB = getSortableValue(b, currentSortKey);

        let comparison = 0;
        if (valA > valB) {
            comparison = 1;
        } else if (valA < valB) {
            comparison = -1;
        }
        return currentSortDirection === 'desc' ? comparison * -1 : comparison;
    });
}

function renderTable() {
    let rfqsArray = Array.from(rfqDataMap.values());
    const filteredRfqs = applyFiltersToRfqs(rfqsArray);
    const sortedRfqs = sortRfqs(filteredRfqs);

    rfqTableBody.innerHTML = ''; // Clear existing rows

    if (sortedRfqs.length === 0 && noRfqsMessageRow) {
        rfqTableBody.appendChild(noRfqsMessageRow);
        noRfqsMessageRow.classList.remove('hidden');
        return;
    } else if (noRfqsMessageRow) {
        noRfqsMessageRow.classList.add('hidden');
    }

    sortedRfqs.forEach(rfq => {
        const row = createRfqTableRow(rfq);
        rfqTableBody.appendChild(row); // Append in sorted order
        attachActionButtonsToRow(row);
        if (rfq.id === currentSelectedRfqId) {
            row.classList.add('selected-row');
        }
    });
}

function updateSortIndicators() {
    document.querySelectorAll('.rfq-grid th .sort-indicator').forEach(indicator => {
        indicator.textContent = '';
        indicator.classList.remove('asc', 'desc');
    });

    if (currentSortKey) {
        const activeHeader = document.querySelector(`.rfq-grid th[data-sort-key="${currentSortKey}"] .sort-indicator`);
        if (activeHeader) {
            activeHeader.classList.add(currentSortDirection);
        }
    }
}

function handleHeaderClick(event) {
    const header = event.target.closest('th[data-sort-key]');
    if (!header) return;

    const sortKey = header.dataset.sortKey;
    if (currentSortKey === sortKey) {
        currentSortDirection = currentSortDirection === 'asc' ? 'desc' : 'asc';
    } else {
        currentSortKey = sortKey;
        currentSortDirection = 'asc';
    }
    updateSortIndicators();
    renderTable();
}
function handleFilterChange(event) {
    const filterKey = event.target.dataset.filterKey;
    const filterValue = event.target.value.trim().toLowerCase();
    activeFilters[filterKey] = filterValue;
    renderTable();
}

function clearAllFilters() {
    document.querySelectorAll('.filter-row input[type="text"]').forEach(input => {
        input.value = '';
    });
    activeFilters = {};
    renderTable();
}

subscribeButton.addEventListener('click', () => connectWebSocket());
logMessage('RFQ Terminal Initialized. Auto-subscribing to GovBond...', 'info');
updateConnectionStatus('Offline');

document.addEventListener('DOMContentLoaded', () => {
    instrumentTypeInput.value = 'GovBond';
    displayRfqDetails(null); // Ensure detail panel is in initial state
    connectWebSocket('GovBond');

    // Add event listener for header clicks (sorting)
    document.querySelector('.rfq-grid thead').addEventListener('click', handleHeaderClick);

    // Add event listeners for filter inputs
    document.querySelectorAll('.filter-row input[data-filter-key]').forEach(input => {
        input.addEventListener('input', handleFilterChange);
    });

    document.getElementById('clearFiltersButton').addEventListener('click', clearAllFilters);

    // Event listener for RFQ table row clicks to display details
    rfqTableBody.addEventListener('click', (event) => {
        let targetRow = event.target;
        // Traverse up to find the TR element if a TD or inner element was clicked
        while (targetRow && targetRow.tagName !== 'TR') {
            targetRow = targetRow.parentElement;
        }

        // Ensure the click was on a valid RFQ row within the table body
        if (targetRow && targetRow.parentElement === rfqTableBody && targetRow.id && targetRow.id.startsWith('rfq-')) {
            const rfqId = targetRow.id.replace('rfq-', '');
            if (currentSelectedRfqId === rfqId) {
                // Clicked on the already selected row: deselect it
                displayRfqDetails(null); // This will also remove 'selected-row' class via currentSelectedRfqId logic
            } else {
                displayRfqDetails(rfqId); // This will handle old selection removal and new selection
                targetRow.classList.add('selected-row'); // Add visual cue to the newly selected row
            }
        }
    });

    detailRespondSubmitButton.addEventListener('click', async () => {
        if (!currentSelectedRfqId) return;

        const rfq = rfqDataMap.get(currentSelectedRfqId);
        if (!rfq) {
            logMessage(`Error: RFQ ${currentSelectedRfqId.slice(-6)} not found for quick response.`, 'error');
            return;
        }

        const price = parseFloat(detailRespondPriceInput.value);
        if (isNaN(price) || price <= 0) {
            logMessage('QRESP ERR: Valid price required.', 'error');
            detailRespondPriceInput.focus();
            return;
        }

        const traderId = localStorage.getItem('rfqTraderId') || 'TRADER_BTM_QUICK'; // Default if not set
        const payload = {
            traderId: traderId,
            responseType: 'FIXED_PRICE', // Quick response is always fixed price
            priceDetails: {
                price: price,
                quantity: rfq.size // Respond with the full RFQ size
            }
        };

        try {
            const response = await fetch(`${API_BASE_URL}/rfqs/${rfq.id}/respond`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const result = await response.json();
            if (response.ok) {
                logMessage(`QRESP_SENT: RFQ ${rfq.id.slice(-6)} @ ${price.toFixed(4)} - ${result.message}`, 'success');
                detailRespondPriceInput.value = ''; // Clear on success
            } else {
                logMessage(`QRESP_ERR: RFQ ${rfq.id.slice(-6)} - ${result.message || response.statusText}`, 'error');
            }
        } catch (err) {
            logMessage(`NET_ERR: QRESP RFQ ${rfq.id.slice(-6)} - ${err.message}`, 'error');
        }
    });
    updateSortIndicators(); // Initial call to clear any indicators
});
