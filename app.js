const socket = io();

let username = "";
let channelId = "";

let localStream = null;

let muted = false;
let deafened = false;

const peers = new Map();
const pendingCandidates = new Map();

const joinScreen = document.getElementById("join-screen");
const voiceScreen = document.getElementById("voice-screen");

const usernameInput = document.getElementById("username");
const channelInput = document.getElementById("channel");

const joinButton = document.getElementById("join-button");
const leaveButton = document.getElementById("leave-button");

const muteButton = document.getElementById("mute-button");
const deafenButton = document.getElementById("deafen-button");

const channelName = document.getElementById("channel-name");
const userList = document.getElementById("user-list");
const errorText = document.getElementById("error");

const audioContainer = document.getElementById("audio-container");


// =========================================================
// JOIN CHANNEL
// =========================================================

joinButton.addEventListener("click", joinChannel);

async function joinChannel() {
    username = usernameInput.value.trim();
    channelId = channelInput.value.trim();

    if (!username) {
        errorText.textContent = "Enter a username.";
        return;
    }

    if (!channelId) {
        errorText.textContent = "Enter a channel ID.";
        return;
    }

    errorText.textContent = "";

    try {
        localStream = await navigator.mediaDevices.getUserMedia({
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true
            },
            video: false
        });
    } catch (error) {
        console.error("Microphone error:", error);

        errorText.textContent =
            "Could not access your microphone.";

        return;
    }

    channelName.textContent = channelId;

    joinScreen.classList.add("hidden");
    voiceScreen.classList.remove("hidden");

    addUser(socket.id, username);

    socket.emit("join-channel", {
        channelId,
        username
    });
}


// =========================================================
// USERS
// =========================================================

socket.on("channel-users", async (users) => {
    console.log("Existing users:", users);

    for (const user of users) {
        addUser(user.id, user.username);

        await createOffer(user.id);
    }
});


socket.on("user-joined", ({ id, username }) => {
    console.log("User joined:", username, id);

    addUser(id, username);
});


socket.on("user-left", ({ id }) => {
    console.log("User left:", id);

    removeUser(id);

    const peer = peers.get(id);

    if (peer) {
        peer.close();
        peers.delete(id);
    }

    const audio = document.getElementById(`audio-${id}`);

    if (audio) {
        audio.remove();
    }

    pendingCandidates.delete(id);
});


// =========================================================
// USER LIST
// =========================================================

function addUser(id, name) {
    if (document.getElementById(`user-${id}`)) {
        return;
    }

    const element = document.createElement("div");

    element.className = "user";
    element.id = `user-${id}`;

    element.innerHTML = `
        <span class="status"></span>
        <span>${escapeHtml(name)}</span>
    `;

    userList.appendChild(element);
}


function removeUser(id) {
    const element = document.getElementById(`user-${id}`);

    if (element) {
        element.remove();
    }
}


function escapeHtml(text) {
    const div = document.createElement("div");

    div.textContent = text;

    return div.innerHTML;
}


// =========================================================
// WEBRTC PEER CONNECTION
// =========================================================

function createPeer(userId) {
    if (peers.has(userId)) {
        return peers.get(userId);
    }

    console.log("Creating peer connection:", userId);

    const peer = new RTCPeerConnection({
        iceServers: [
            {
                urls: "stun:stun.l.google.com:19302"
            }
        ]
    });

    peers.set(userId, peer);


    // -----------------------------------------------------
    // Add microphone
    // -----------------------------------------------------

    if (localStream) {
        for (const track of localStream.getTracks()) {
            peer.addTrack(track, localStream);
        }
    }


    // -----------------------------------------------------
    // Receive remote audio
    // -----------------------------------------------------

    peer.ontrack = async (event) => {
        console.log(
            "REMOTE AUDIO RECEIVED FROM:",
            userId
        );

        let audio = document.getElementById(
            `audio-${userId}`
        );

        if (!audio) {
            audio = document.createElement("audio");

            audio.id = `audio-${userId}`;

            audio.autoplay = true;
            audio.playsInline = true;

            audioContainer.appendChild(audio);
        }

        if (event.streams && event.streams[0]) {
            audio.srcObject = event.streams[0];
        } else {
            const stream = new MediaStream([
                event.track
            ]);

            audio.srcObject = stream;
        }

        audio.muted = deafened;

        try {
            await audio.play();

            console.log(
                "Remote audio playing:",
                userId
            );
        } catch (error) {
            console.warn(
                "Autoplay was blocked:",
                error
            );
        }
    };


    // -----------------------------------------------------
    // ICE candidates
    // -----------------------------------------------------

    peer.onicecandidate = (event) => {
        if (!event.candidate) {
            return;
        }

        console.log(
            "Sending ICE candidate to:",
            userId
        );

        socket.emit("ice-candidate", {
            target: userId,
            candidate: event.candidate
        });
    };


    // -----------------------------------------------------
    // Connection state
    // -----------------------------------------------------

    peer.onconnectionstatechange = () => {
        console.log(
            `Connection ${userId}:`,
            peer.connectionState
        );

        if (peer.connectionState === "connected") {
            console.log(
                "✅ Voice connection established:",
                userId
            );
        }

        if (peer.connectionState === "failed") {
            console.warn(
                "❌ WebRTC connection failed:",
                userId
            );
        }

        if (peer.connectionState === "disconnected") {
            console.warn(
                "⚠️ WebRTC connection disconnected:",
                userId
            );
        }
    };


    // -----------------------------------------------------
    // ICE state
    // -----------------------------------------------------

    peer.oniceconnectionstatechange = () => {
        console.log(
            `ICE ${userId}:`,
            peer.iceConnectionState
        );
    };


    return peer;
}


// =========================================================
// CREATE OFFER
// =========================================================

async function createOffer(userId) {
    try {
        const peer = createPeer(userId);

        const offer = await peer.createOffer();

        await peer.setLocalDescription(offer);

        console.log(
            "Sending offer to:",
            userId
        );

        socket.emit("offer", {
            target: userId,
            offer: peer.localDescription
        });

    } catch (error) {
        console.error(
            "Offer creation failed:",
            error
        );
    }
}


// =========================================================
// RECEIVE OFFER
// =========================================================

socket.on(
    "offer",
    async ({ sender, offer }) => {

        try {
            console.log(
                "Received offer from:",
                sender
            );

            const peer = createPeer(sender);

            await peer.setRemoteDescription(
                new RTCSessionDescription(offer)
            );

            await addPendingCandidates(sender);

            const answer = await peer.createAnswer();

            await peer.setLocalDescription(answer);

            console.log(
                "Sending answer to:",
                sender
            );

            socket.emit("answer", {
                target: sender,
                answer: peer.localDescription
            });

        } catch (error) {
            console.error(
                "Offer handling failed:",
                error
            );
        }
    }
);


// =========================================================
// RECEIVE ANSWER
// =========================================================

socket.on(
    "answer",
    async ({ sender, answer }) => {

        try {
            console.log(
                "Received answer from:",
                sender
            );

            const peer = peers.get(sender);

            if (!peer) {
                console.warn(
                    "No peer for answer:",
                    sender
                );

                return;
            }

            await peer.setRemoteDescription(
                new RTCSessionDescription(answer)
            );

            await addPendingCandidates(sender);

        } catch (error) {
            console.error(
                "Answer handling failed:",
                error
            );
        }
    }
);


// =========================================================
// RECEIVE ICE CANDIDATE
// =========================================================

socket.on(
    "ice-candidate",
    async ({ sender, candidate }) => {

        try {
            console.log(
                "Received ICE candidate from:",
                sender
            );

            const peer = peers.get(sender);

            if (!peer) {
                queueCandidate(
                    sender,
                    candidate
                );

                return;
            }

            if (!peer.remoteDescription) {
                queueCandidate(
                    sender,
                    candidate
                );

                return;
            }

            await peer.addIceCandidate(
                new RTCIceCandidate(candidate)
            );

        } catch (error) {
            console.error(
                "ICE candidate error:",
                error
            );
        }
    }
);


// =========================================================
// ICE CANDIDATE QUEUE
// =========================================================

function queueCandidate(userId, candidate) {

    if (!pendingCandidates.has(userId)) {
        pendingCandidates.set(
            userId,
            []
        );
    }

    pendingCandidates
        .get(userId)
        .push(candidate);
}


async function addPendingCandidates(userId) {

    const peer = peers.get(userId);

    if (!peer) {
        return;
    }

    const candidates =
        pendingCandidates.get(userId);

    if (!candidates) {
        return;
    }

    for (const candidate of candidates) {

        try {
            await peer.addIceCandidate(
                new RTCIceCandidate(candidate)
            );

        } catch (error) {
            console.error(
                "Queued ICE candidate failed:",
                error
            );
        }
    }

    pendingCandidates.delete(userId);
}


// =========================================================
// MUTE
// =========================================================

muteButton.addEventListener(
    "click",
    () => {

        if (!localStream) {
            return;
        }

        muted = !muted;

        for (
            const track
            of localStream.getAudioTracks()
        ) {
            track.enabled = !muted;
        }

        muteButton.textContent =
            muted
                ? "🔇 Unmute"
                : "🎙️ Mute";
    }
);


// =========================================================
// DEAFEN
// =========================================================

deafenButton.addEventListener(
    "click",
    () => {

        deafened = !deafened;

        const audios =
            audioContainer.querySelectorAll(
                "audio"
            );

        audios.forEach(
            (audio) => {
                audio.muted = deafened;
            }
        );

        deafenButton.textContent =
            deafened
                ? "🔇 Undeafen"
                : "🔊 Deafen";
    }
);


// =========================================================
// LEAVE
// =========================================================

leaveButton.addEventListener(
    "click",
    leaveChannel
);


function leaveChannel() {

    // Stop microphone
    if (localStream) {

        for (
            const track
            of localStream.getTracks()
        ) {
            track.stop();
        }

        localStream = null;
    }


    // Close WebRTC connections
    for (const peer of peers.values()) {
        peer.close();
    }

    peers.clear();
    pendingCandidates.clear();


    // Remove audio
    audioContainer.innerHTML = "";

    // Remove users
    userList.innerHTML = "";


    // Disconnect Socket.IO
    socket.disconnect();


    // Return to join screen
    location.reload();
}

const themeToggle = document.getElementById("theme-toggle");

themeToggle.addEventListener("click", () => {
    document.body.classList.toggle("light-theme");
});