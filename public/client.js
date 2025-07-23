// --- Theme Switcher Logic ---
const themeToggle = document.getElementById('theme-checkbox');

const setTheme = (theme) => {
    document.body.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
    themeToggle.checked = theme === 'dark';
};

themeToggle.addEventListener('change', () => {
    if (themeToggle.checked) {
        setTheme('dark');
    } else {
        setTheme('light');
    }
});

const savedTheme = localStorage.getItem('theme');
const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;

if (savedTheme) {
    setTheme(savedTheme);
} else if (prefersDark) {
    setTheme('dark');
} else {
    setTheme('light');
}

// --- Basic Setup ---
const socket = io();

// --- DOM Elements ---
const roleSelectionContainer = document.getElementById('role-selection-container');
const initiateSendButton = document.getElementById('initiate-send-button');
const initiateReceiveButton = document.getElementById('initiate-receive-button');
const senderView = document.getElementById('sender-view');
const senderIdInput = document.getElementById('sender-id-input');
const copyIdButton = document.getElementById('copy-id-button');
const receiverView = document.getElementById('receiver-view');
const receiverIdInput = document.getElementById('receiver-id-input');
const connectButton = document.getElementById('connect-button');
const fileTransferContainer = document.getElementById('file-transfer-container');
const localIdDisplay = document.getElementById('local-id');
const remoteIdDisplay = document.getElementById('remote-id');
const senderFileControls = document.getElementById('sender-file-controls');
const fileInput = document.getElementById('file-input');
const fileLabel = document.getElementById('file-label');
const sendButton = document.getElementById('send-button');
const statusMessage = document.getElementById('status-message');

// --- WebRTC and State Variables ---
let localConnection;
let sendChannels = [];
let receiveChannels = [];
let localId;
let remoteId;

// --- PARALLEL TRANSFER CONFIGURATION ---
const NUM_PARALLEL_CHANNELS = 8;
const CHUNK_SIZE = 256 * 1024;
const BUFFER_THRESHOLD = 4 * 1024 * 1024;
const MAX_BUFFER_AMOUNT = 16 * 1024 * 1024;

// --- TAB PROTECTION VARIABLES ---
let transferInProgress = false;
let wakeLock = null;
let protectionCleanup = null;

// --- PARALLEL TRANSFER STATE ---
let currentTransferState = {
    isSending: false,
    isReceiving: false,
    currentFileName: null,
    expectedFileSize: 0,
    receivedSegments: new Map(),
    totalSegments: 0,
    receivedSize: 0
};

// --- FIXED FILE INPUT STATE MANAGEMENT ---
const setFileInputState = (enabled) => {
    const fileUploadContainer = document.querySelector('.file-upload-container');
    const uploadIcon = document.querySelector('.upload-icon');
    const uploadText = document.querySelector('.upload-text');
    
    if (!fileUploadContainer || !uploadIcon || !uploadText) {
        console.warn('File input elements not found in DOM');
        return;
    }
    
    fileInput.disabled = !enabled;
    
    if (enabled) {
        fileUploadContainer.classList.remove('disabled');
        uploadIcon.textContent = '📁';
        uploadText.textContent = 'Click to upload or drag and drop any file type or size file';
    } else {
        fileUploadContainer.classList.add('disabled');
        uploadIcon.textContent = '⏳';
        uploadText.textContent = currentTransferState.isSending 
            ? `Sending: ${currentTransferState.currentFileName}...` 
            : 'Transfer in progress...';
    }
};

// --- UI Logic ---
const showView = (view) => {
    const heroSection = document.getElementById('hero-section');
    if (heroSection) {
        heroSection.style.display = view === roleSelectionContainer ? 'block' : 'none';
    }
    
    roleSelectionContainer.style.display = 'none';
    senderView.style.display = 'none';
    receiverView.style.display = 'none';
    fileTransferContainer.style.display = 'none';
    view.style.display = 'block';
};

initiateSendButton.onclick = () => {
    showView(senderView);
    socket.emit('request-share-id');
    createOffer();
};

initiateReceiveButton.onclick = () => {
    showView(receiverView);
};

copyIdButton.onclick = () => {
    senderIdInput.select();
    document.execCommand('copy');
    copyIdButton.textContent = 'Copied!';
    setTimeout(() => { copyIdButton.textContent = 'Copy'; }, 2000);
};

connectButton.onclick = () => {
    const targetNanoId = receiverIdInput.value;
    if (targetNanoId) {
        socket.emit('receiver-ready', { targetNanoId: targetNanoId, sender: localId });
        connectButton.disabled = true;
        receiverIdInput.disabled = true;
        statusMessage.textContent = "Attempting to connect...";
    }
};

// --- Signaling Server Connection ---
socket.on('connect', () => {
    localId = socket.id;
    console.log(`Connected to signaling server with ID: ${localId}`);
});

socket.on('share-id-created', (shareId) => {
    senderIdInput.value = shareId;
});

socket.on('receiver-ready', (payload) => {
    console.log('Receiver is ready, sending offer.');
    remoteId = payload.sender;
    socket.emit('offer', {
        target: remoteId,
        sender: localId,
        offer: localConnection.localDescription,
    });
});

socket.on('offer', (payload) => {
    if (!localConnection) {
        remoteId = payload.sender;
        console.log('Received an offer. I will create an answer.');
        createAnswer(payload.offer);
    }
});

socket.on('answer', (payload) => {
    console.log('Received an answer.');
    handleAnswer(payload.answer);
});

socket.on('ice-candidate', (payload) => {
    if (localConnection) {
        console.log('Received ICE candidate.');
        localConnection.addIceCandidate(new RTCIceCandidate(payload.candidate));
    }
});

// --- TAB PROTECTION FUNCTIONS ---
const requestWakeLock = async () => {
    try {
        if ('wakeLock' in navigator) {
            wakeLock = await navigator.wakeLock.request('screen');
            console.log('Wake lock acquired');
            wakeLock.addEventListener('release', () => {
                console.log('Wake lock released');
            });
        }
    } catch (err) {
        console.error('Wake lock failed:', err);
    }
};

const releaseWakeLock = () => {
    if (wakeLock) {
        wakeLock.release();
        wakeLock = null;
    }
};

const preventPageUnload = () => {
    const handleBeforeUnload = (e) => {
        if (transferInProgress) {
            const message = 'File transfer in progress. Leaving will cancel the transfer.';
            e.preventDefault();
            e.returnValue = message;
            return message;
        }
    };

    const handlePopState = (e) => {
        if (transferInProgress) {
            const confirmLeave = confirm('File transfer in progress. Are you sure you want to navigate away?');
            if (!confirmLeave) {
                history.pushState(null, null, window.location.href);
            }
        }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    window.addEventListener('popstate', handlePopState);
    
    return () => {
        window.removeEventListener('beforeunload', handleBeforeUnload);
        window.removeEventListener('popstate', handlePopState);
    };
};

const handleVisibilityChange = () => {
    if (document.hidden && transferInProgress) {
        console.warn('Tab became hidden during transfer');
        statusMessage.textContent += ' (Tab hidden - transfer may slow down)';
        keepTabActive();
    } else if (!document.hidden && transferInProgress) {
        statusMessage.textContent = statusMessage.textContent.replace(' (Tab hidden - transfer may slow down)', '');
    }
};

const keepTabActive = () => {
    const keepAliveInterval = setInterval(() => {
        if (!transferInProgress) {
            clearInterval(keepAliveInterval);
            return;
        }
        document.body.style.transform = document.body.style.transform === 'translateZ(0)' 
            ? 'translateZ(0.1px)' 
            : 'translateZ(0)';
    }, 30000);
    return keepAliveInterval;
};

const requestUserAttention = () => {
    let originalTitle = document.title;
    let flashCount = 0;
    const flashInterval = setInterval(() => {
        document.title = flashCount % 2 === 0 ? '🔥 Transfer Complete!' : originalTitle;
        flashCount++;
        if (flashCount >= 10) {
            clearInterval(flashInterval);
            document.title = originalTitle;
        }
    }, 1000);
    
    if (Notification.permission === 'granted') {
        new Notification('File Transfer Complete', {
            body: 'Your file transfer has finished successfully.',
            icon: '/favicon.ico'
        });
    }
};

const showProtectionStatus = () => {
    const existingProtection = document.getElementById('protection-status');
    if (existingProtection) return;
    
    const protectionDiv = document.createElement('div');
    protectionDiv.id = 'protection-status';
    protectionDiv.className = 'protection-indicator';
    protectionDiv.innerHTML = `
        <div class="protection-badge">
            🛡️ Parallel Transfer Protection Active
            <ul>
                <li>✅ ${NUM_PARALLEL_CHANNELS} parallel channels</li>
                <li>✅ Page reload blocked</li>
                <li>✅ Screen sleep prevented</li>
                <li>✅ Tab throttling minimized</li>
            </ul>
        </div>
    `;
    fileTransferContainer.insertBefore(protectionDiv, statusMessage);
};

const hideProtectionStatus = () => {
    const protectionDiv = document.getElementById('protection-status');
    if (protectionDiv) {
        protectionDiv.remove();
    }
};

const showTransferWarnings = (fileSize) => {
    const hours = (fileSize / (8 * 1024 * 1024)) / 3600;
    
    if (hours > 1) {
        const existingWarning = document.querySelector('.transfer-warning');
        if (existingWarning) existingWarning.remove();
        
        const warningDiv = document.createElement('div');
        warningDiv.className = 'transfer-warning';
        warningDiv.innerHTML = `
            <h3>⚠️ Large File Transfer</h3>
            <p>Estimated time: ${hours.toFixed(1)} hours (with ${NUM_PARALLEL_CHANNELS}x speed boost)</p>
            <p><strong>Parallel transfer enabled:</strong> Using ${NUM_PARALLEL_CHANNELS} channels</p>
            <ul>
                <li>Tab reload/close will be blocked</li>
                <li>Screen sleep will be prevented</li>
                <li>You'll be notified when complete</li>
            </ul>
        `;
        fileTransferContainer.insertBefore(warningDiv, statusMessage);
    }
};

document.addEventListener('visibilitychange', handleVisibilityChange);

// --- WebRTC Core Functions ---
const createPeerConnection = () => {
    const connection = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    });

    connection.onicecandidate = (event) => {
        if (event.candidate) {
            socket.emit('ice-candidate', {
                target: remoteId,
                candidate: event.candidate,
            });
        }
    };

    connection.ondatachannel = (event) => {
        const channel = event.channel;
        const channelIndex = parseInt(channel.label.replace('fileTransferChannel_', ''));
        
        console.log(`Received data channel: ${channel.label} (index: ${channelIndex})`);
        
        if (!receiveChannels[channelIndex]) {
            receiveChannels[channelIndex] = channel;
            setupReceiveChannel(channel, channelIndex);
        }
        
        if (channelIndex === 0) {
            showFileTransferUI();
            statusMessage.textContent = 'Waiting for a file from the sender...';
        }
    };

    return connection;
};

const createOffer = async () => {
    localConnection = createPeerConnection();
    
    sendChannels = [];
    for (let i = 0; i < NUM_PARALLEL_CHANNELS; i++) {
        const channel = localConnection.createDataChannel(`fileTransferChannel_${i}`);
        sendChannels[i] = channel;
        setupSendChannel(channel, i);
    }
    
    try {
        const offer = await localConnection.createOffer();
        await localConnection.setLocalDescription(offer);
    } catch (e) {
        console.error('Error creating offer:', e);
    }
};

const createAnswer = async (offer) => {
    localConnection = createPeerConnection();
    try {
        await localConnection.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await localConnection.createAnswer();
        await localConnection.setLocalDescription(answer);
        socket.emit('answer', {
            target: remoteId,
            sender: localId,
            answer: answer,
        });
    } catch (e) {
        console.error('Error creating answer:', e);
    }
};

const handleAnswer = async (answer) => {
    try {
        await localConnection.setRemoteDescription(new RTCSessionDescription(answer));
        showFileTransferUI();
    } catch (e) {
        console.error('Error setting remote description:', e);
    }
};

const showFileTransferUI = () => {
    localIdDisplay.textContent = localId;
    remoteIdDisplay.textContent = remoteId;
    showView(fileTransferContainer);
    
    // Show file controls only for senders
    if (sendChannels && sendChannels.length > 0) {
        senderFileControls.style.display = 'block';
    }
};

// --- Parallel Transfer Helper Functions ---
const waitForBufferSpace = (channel, targetThreshold = BUFFER_THRESHOLD) => {
    return new Promise((resolve) => {
        if (channel.bufferedAmount <= targetThreshold) {
            resolve();
            return;
        }
        
        const onBufferLow = () => {
            channel.removeEventListener('bufferedamountlow', onBufferLow);
            resolve();
        };
        
        channel.addEventListener('bufferedamountlow', onBufferLow);
    });
};

const monitorConnection = () => {
    if (localConnection.connectionState !== 'connected') {
        throw new Error('Connection lost during transfer');
    }
};

const updateProgress = (totalSent, fileSize, startTime) => {
    const progress = Math.round((totalSent / fileSize) * 100);
    const elapsed = (Date.now() - startTime) / 1000;
    const speed = (totalSent / elapsed / 1024 / 1024).toFixed(2);
    const remaining = fileSize - totalSent;
    const eta = remaining / (totalSent / elapsed);
    const etaFormatted = eta > 3600 ? 
        `${Math.floor(eta / 3600)}h ${Math.floor((eta % 3600) / 60)}m` :
        `${Math.floor(eta / 60)}m ${Math.floor(eta % 60)}s`;
    
    statusMessage.textContent = 
        `Uploading (${NUM_PARALLEL_CHANNELS} channels)... ${progress}% (${speed} MB/s) ETA: ${etaFormatted}`;
};

// --- Data Channel Setup ---
const setupSendChannel = (channel, channelIndex) => {
    channel.binaryType = 'arraybuffer';
    channel.bufferedAmountLowThreshold = BUFFER_THRESHOLD;
    
    channel.onopen = () => {
        console.log(`Send channel ${channelIndex} opened`);
        if (channelIndex === 0) {
            statusMessage.textContent = 'Connected! Select a file to send.';
        }
    };
    
    channel.onclose = () => {
        console.log(`Send channel ${channelIndex} closed`);
    };
    
    channel.onerror = (error) => {
        console.error(`Send channel ${channelIndex} error:`, error);
        statusMessage.textContent = 'Connection error occurred.';
    };
};

const setupReceiveChannel = (channel, channelIndex) => {
    channel.binaryType = 'arraybuffer';
    
    channel.onopen = () => {
        console.log(`Receive channel ${channelIndex} opened`);
    };

    channel.onmessage = (event) => {
        handleReceivedData(event.data, channelIndex);
    };

    channel.onerror = (error) => {
        console.error(`Receive channel ${channelIndex} error:`, error);
        statusMessage.textContent = 'Connection error occurred.';
    };
};

// --- Receive Logic ---
const handleReceivedData = (data, channelIndex) => {
    try {
        if (typeof data === 'string') {
            const metadata = JSON.parse(data);
            
            if (metadata.type === 'fileStart') {
                if (currentTransferState.isReceiving && 
                    currentTransferState.receivedSize < currentTransferState.expectedFileSize) {
                    console.warn('New file metadata received while transfer in progress. Ignoring.');
                    return;
                }
                
                currentTransferState.isReceiving = true;
                currentTransferState.currentFileName = metadata.name;
                currentTransferState.expectedFileSize = metadata.size;
                currentTransferState.receivedSegments = new Map();
                currentTransferState.totalSegments = metadata.totalSegments;
                currentTransferState.receivedSize = 0;
                
                transferInProgress = true;
                protectionCleanup = preventPageUnload();
                requestWakeLock();
                showProtectionStatus();
                
                statusMessage.textContent = `Receiving file: ${metadata.name} (${(metadata.size / 1024 / 1024).toFixed(2)} MB) via ${NUM_PARALLEL_CHANNELS} channels`;
                console.log('Started receiving new file:', metadata.name);
                return;
            }
            
            if (metadata.type === 'segment') {
                console.log(`Channel ${channelIndex}: Receiving segment ${metadata.segmentIndex} (${metadata.startByte}-${metadata.endByte})`);
                return;
            }
        }

        if (!currentTransferState.isReceiving) {
            console.warn('Received file data but not in receiving state. Ignoring.');
            return;
        }

        currentTransferState.receivedSize += data.byteLength;
        
        const progress = Math.round((currentTransferState.receivedSize / currentTransferState.expectedFileSize) * 100);
        const clampedProgress = Math.min(100, progress);
        statusMessage.textContent = `Downloading (${NUM_PARALLEL_CHANNELS} channels)... ${clampedProgress}%`;

        if (!currentTransferState.receivedSegments.has(channelIndex)) {
            currentTransferState.receivedSegments.set(channelIndex, []);
        }
        currentTransferState.receivedSegments.get(channelIndex).push(data);

        if (currentTransferState.receivedSize >= currentTransferState.expectedFileSize) {
            reassembleFile();
        }
        
    } catch (error) {
        console.error('Error processing received data:', error);
        statusMessage.textContent = 'Error processing received file.';
        resetTransferState();
    }
};

const reassembleFile = () => {
    try {
        const allSegments = [];
        for (let i = 0; i < NUM_PARALLEL_CHANNELS; i++) {
            if (currentTransferState.receivedSegments.has(i)) {
                allSegments.push(...currentTransferState.receivedSegments.get(i));
            }
        }
        
        const receivedFile = new Blob(allSegments, { type: 'application/octet-stream' });
        const downloadLink = document.createElement('a');
        downloadLink.href = URL.createObjectURL(receivedFile);
        downloadLink.download = currentTransferState.currentFileName;
        downloadLink.textContent = `Click to download ${currentTransferState.currentFileName}`;
        downloadLink.style.display = 'block';
        downloadLink.style.margin = '10px 0';
        
        const existingLink = fileTransferContainer.querySelector('a');
        if (existingLink) existingLink.remove();
        
        fileTransferContainer.appendChild(downloadLink);
        statusMessage.textContent = 'File received successfully via parallel channels! Ready for next file.';
        
        resetTransferState();
        requestUserAttention();
        console.log('Parallel file transfer completed successfully');
        
    } catch (error) {
        console.error('Error reassembling file:', error);
        statusMessage.textContent = 'Error assembling received file.';
        resetTransferState();
    }
};

const resetTransferState = () => {
    currentTransferState.isReceiving = false;
    currentTransferState.isSending = false;
    currentTransferState.currentFileName = null;
    currentTransferState.expectedFileSize = 0;
    currentTransferState.receivedSegments = new Map();
    currentTransferState.totalSegments = 0;
    currentTransferState.receivedSize = 0;
    
    transferInProgress = false;
    if (protectionCleanup) protectionCleanup();
    releaseWakeLock();
    hideProtectionStatus();
};

// --- Parallel File Send Function ---
const sendFileWithParallelChannels = async () => {
    const file = fileInput.files[0];
    if (!file) {
        statusMessage.textContent = 'Please select a file first.';
        return;
    }

    const readyChannels = sendChannels.filter(ch => ch && ch.readyState === 'open');
    if (readyChannels.length !== NUM_PARALLEL_CHANNELS) {
        statusMessage.textContent = `Connection not ready. Only ${readyChannels.length}/${NUM_PARALLEL_CHANNELS} channels available.`;
        return;
    }

    if (currentTransferState.isSending) {
        statusMessage.textContent = 'A file transfer is already in progress. Please wait for it to complete.';
        return;
    }

    currentTransferState.isSending = true;
    currentTransferState.currentFileName = file.name;
    
    transferInProgress = true;
    protectionCleanup = preventPageUnload();
    await requestWakeLock();
    showProtectionStatus();
    setFileInputState(false);
    
    if (Notification.permission === 'default') {
        await Notification.requestPermission();
    }
    
    sendButton.disabled = true;
    statusMessage.textContent = 'Preparing parallel file transfer...';

    try {
        const segmentSize = Math.ceil(file.size / NUM_PARALLEL_CHANNELS);
        const totalSegments = NUM_PARALLEL_CHANNELS;
        
        const metadata = {
            type: 'fileStart',
            name: file.name,
            size: file.size,
            totalSegments: totalSegments
        };
        
        for (let i = 0; i < NUM_PARALLEL_CHANNELS; i++) {
            sendChannels[i].send(JSON.stringify(metadata));
        }

        const startTime = Date.now();
        const sendPromises = [];
        let totalSent = 0;
        
        for (let channelIndex = 0; channelIndex < NUM_PARALLEL_CHANNELS; channelIndex++) {
            const startByte = channelIndex * segmentSize;
            const endByte = Math.min(startByte + segmentSize, file.size);
            
            if (startByte < file.size) {
                const promise = sendSegment(file, channelIndex, startByte, endByte, (sent) => {
                    totalSent += sent;
                    updateProgress(totalSent, file.size, startTime);
                });
                sendPromises.push(promise);
            }
        }

        await Promise.all(sendPromises);
        
        statusMessage.textContent = 'Parallel file transfer completed successfully!';
        requestUserAttention();
        
    } catch (error) {
        console.error("Parallel file transfer failed:", error);
        statusMessage.textContent = `Transfer failed: ${error.message}`;
    } finally {
        resetTransferState();
        sendButton.disabled = false;
        setFileInputState(true);
        
        const uploadText = document.querySelector('.upload-text');
        if (uploadText) uploadText.textContent = 'Click to upload or drag and drop any file type or size file';
    }
};

const sendSegment = async (file, channelIndex, startByte, endByte, onProgress) => {
    const channel = sendChannels[channelIndex];
    const segmentSize = endByte - startByte;
    const segment = file.slice(startByte, endByte);
    
    console.log(`Channel ${channelIndex}: Sending segment ${startByte}-${endByte} (${segmentSize} bytes)`);
    
    const segmentMetadata = {
        type: 'segment',
        segmentIndex: channelIndex,
        startByte: startByte,
        endByte: endByte
    };
    channel.send(JSON.stringify(segmentMetadata));
    
    let offset = 0;
    const reader = new FileReader();
    
    while (offset < segmentSize) {
        const chunkSize = Math.min(CHUNK_SIZE, segmentSize - offset);
        const chunk = segment.slice(offset, offset + chunkSize);
        
        if (channel.bufferedAmount > BUFFER_THRESHOLD) {
            await waitForBufferSpace(channel);
        }
        
        await new Promise((resolve, reject) => {
            reader.onload = (e) => {
                try {
                    channel.send(e.target.result);
                    offset += chunkSize;
                    onProgress(chunkSize);
                    resolve();
                } catch (error) {
                    reject(error);
                }
            };
            reader.onerror = () => reject(new Error('Failed to read file chunk'));
            reader.readAsArrayBuffer(chunk);
        });
        
        if (offset % (10 * CHUNK_SIZE) === 0) {
            monitorConnection();
        }
    }
    
    console.log(`Channel ${channelIndex}: Segment transfer completed`);
};

// --- Event Listeners ---
sendButton.onclick = sendFileWithParallelChannels;

fileInput.addEventListener('change', () => {
    if (currentTransferState.isSending || currentTransferState.isReceiving) {
        fileInput.value = '';
        statusMessage.textContent = 'Cannot select file during transfer. Please wait for current transfer to complete.';
        return;
    }
    
    const file = fileInput.files[0];
    const uploadText = document.querySelector('.upload-text');
    
    if (file) {
        if (uploadText) uploadText.textContent = `Selected: ${file.name}`;
        sendButton.disabled = false;
        showTransferWarnings(file.size);
    } else {
        if (uploadText) uploadText.textContent = 'Click to upload or drag and drop any file type or size file';
        sendButton.disabled = true;
        
        const existingWarning = document.querySelector('.transfer-warning');
        if (existingWarning) existingWarning.remove();
    }
});
