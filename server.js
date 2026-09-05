import express from "express";
import http from "http";
import { Server } from "socket.io";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(__dirname));

const channels = new Map();

io.on("connection", (socket) => {
    console.log("Connected:", socket.id);

    socket.on("join-channel", ({ channelId, username }) => {
        if (
            typeof channelId !== "string" ||
            typeof username !== "string" ||
            !channelId.trim() ||
            !username.trim()
        ) {
            return;
        }

        channelId = channelId.trim();
        username = username.trim().slice(0, 32);

        socket.join(channelId);

        socket.channelId = channelId;
        socket.username = username;

        if (!channels.has(channelId)) {
            channels.set(channelId, new Map());
        }

        const channel = channels.get(channelId);

        const existingUsers = [];

        for (const [id, user] of channel) {
            existingUsers.push({
                id,
                username: user.username
            });
        }

        socket.emit("channel-users", existingUsers);

        channel.set(socket.id, {
            username
        });

        socket.to(channelId).emit("user-joined", {
            id: socket.id,
            username
        });

        console.log(`${username} joined channel ${channelId}`);
    });

    socket.on("offer", ({ target, offer }) => {
        if (!target || !offer) return;

        io.to(target).emit("offer", {
            sender: socket.id,
            offer
        });
    });

    socket.on("answer", ({ target, answer }) => {
        if (!target || !answer) return;

        io.to(target).emit("answer", {
            sender: socket.id,
            answer
        });
    });

    socket.on("ice-candidate", ({ target, candidate }) => {
        if (!target || !candidate) return;

        io.to(target).emit("ice-candidate", {
            sender: socket.id,
            candidate
        });
    });

    socket.on("disconnect", () => {
        const channelId = socket.channelId;

        if (!channelId) return;

        const channel = channels.get(channelId);

        if (!channel) return;

        channel.delete(socket.id);

        socket.to(channelId).emit("user-left", {
            id: socket.id
        });

        if (channel.size === 0) {
            channels.delete(channelId);
        }

        console.log(
            `${socket.username || socket.id} left channel ${channelId}`
        );
    });
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
    console.log(`Voiceover running on port ${PORT}`);
});