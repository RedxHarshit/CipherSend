const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { nanoid } = require('nanoid');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Serve static files
app.use(express.static(path.join(__dirname,'public')));

// Store share IDs and their corresponding socket IDs
const shareIdToSocket = new Map();
const socketToShareId = new Map();

io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);

    socket.on('request-share-id', () => {
        const shareId = nanoid(8);
        shareIdToSocket.set(shareId, socket.id);
        socketToShareId.set(socket.id, shareId);
        socket.emit('share-id-created', shareId);
        console.log(`Created Share ID ${shareId} for socket ${socket.id}`);
    });

    socket.on('receiver-ready', (payload) => {
        const { targetNanoId, sender } = payload;
        const targetSocketId = shareIdToSocket.get(targetNanoId);
        
        if (targetSocketId) {
            io.to(targetSocketId).emit('receiver-ready', { sender: socket.id });
            console.log(`Relaying 'receiver-ready' from ${socket.id} to NanoID ${targetNanoId} (Socket: ${targetSocketId})`);
        } else {
            socket.emit('error', 'Invalid share ID');
            console.log(`Invalid share ID: ${targetNanoId}`);
        }
    });

    socket.on('offer', (payload) => {
        io.to(payload.target).emit('offer', payload);
    });

    socket.on('answer', (payload) => {
        io.to(payload.target).emit('answer', payload);
    });

    socket.on('ice-candidate', (payload) => {
        io.to(payload.target).emit('ice-candidate', payload);
    });

    socket.on('disconnect', () => {
        console.log(`User disconnected: ${socket.id}`);
        
        // Clean up share IDs when socket disconnects
        const shareId = socketToShareId.get(socket.id);
        if (shareId) {
            shareIdToSocket.delete(shareId);
            socketToShareId.delete(socket.id);
            console.log(`Cleaned up maps for Share ID ${shareId}`);
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`✅ Signaling server running on port ${PORT}`);
});
