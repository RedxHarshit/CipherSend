# CipherSend

CipherSend is a private, peer-to-peer file transfer app with end-to-end encryption. It enables users to securely send and receive files of any size directly between devices, without sign-in or cloud storage, using modern web technologies.

---

## 🌐 Live Demo

Try CipherSend instantly at:  
**[ciphersend.onrender.com](https://ciphersend.onrender.com)**

---

## 🚀 Features

- **End-to-End Encrypted**: Your files are encrypted in your browser and can only be decrypted by the intended recipient.
- **Peer-to-Peer (P2P)**: Transfers occur directly between devices using WebRTC, never stored on any server.
- **No Size Limits**: Transfer files as large as your device and network can handle.
- **No Sign-In, No Accounts**: Start sending and receiving instantly—no registration required.
- **Unique Share Codes**: Connect sender and receiver with a simple code, never exposing your identity.
- **Modern, Responsive UI**: Works on desktop and mobile, with dark mode.

---

## 🛠 How It Works

1. **Sender** clicks "Send" and receives a unique share code.
2. **Receiver** clicks "Receive" and enters the code from the sender.
3. A secure connection is established directly between the two devices.
4. Files are transferred in parallel, encrypted, and streamed directly—never touching a third-party server.

---

## 🖥️ Running Locally

### Prerequisites

- [Node.js](https://nodejs.org/)
- [npm](https://www.npmjs.com/) (comes with Node.js)

### Steps

1. **Clone the repo:**
   ```bash
   git clone https://github.com/RedxHarshit/CipherSend.git
   cd CipherSend
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Start the server:**
   ```bash
   npm start
   ```
   This will launch the app at `http://localhost:3000` (default).

---

## 🗂 Project Structure

- `public/` – Static frontend (HTML, CSS, JS)
- `server.js` – Node.js backend for signaling (using socket.io)
- `public/client.js` – Handles WebRTC, file transfer, and encryption logic

---

## 🔒 Security

- Files are end-to-end encrypted in the browser using WebRTC data channels.
- The server acts **only** as a signaling relay; file data never passes through it.
- Unique one-time codes connect sender and receiver anonymously.

---

## 🤝 Contributing

Pull requests are welcome! For major changes, please open an issue first to discuss what you would like to change.

---

## 📄 License

MIT License

---

**CipherSend — The private way to share files. No sign in. No cloud. No limits. Just pure peer-to-peer.**
