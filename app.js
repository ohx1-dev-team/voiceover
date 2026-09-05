const socket = io();

let username = "";
let channelId = "";

let localStream = null;

let muted = false;
let deafened = false;

const peers = new Map();

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


/* -----------------------------
   JOIN
----------------------------- */

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
            audio: true,
            video: false
        });

    } catch (error) {

        console.error(error);

        errorText.textContent =
            "Microphone permission is required.";

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


/* -----------------------------
   CHANNEL USERS
----------------------------- */

socket.on("channel-users", async (users) => {

    for (const user of users) {

        addUser(user.id, user.username);

        await createOffer(user.id);
    }
});


socket.on("user-joined", ({ id, username }) => {

    addUser(id, username);
});


socket.on("user-left", ({ id }) => {

    removeUser(id);

    const peer = peers.get(id);

    if (peer) {
        peer.close();
        peers.delete(id);
    }
});


/* -----------------------------
   USER LIST
----------------------------- */

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


/* -----------------------------
   WEBRTC
----------------------------- */

function createPeer(userId) {

    if (peers.has(userId)) {
        return peers.get(userId);
    }

    const peer = new RTCPeerConnection({
        iceServers: [
            {
                urls: "stun:stun.l.google.com:19302"
            }
        ]
    });

    peers.set(userId, peer);


    // Send our microphone to them.
    for (const track of localStream.getTracks()) {
        peer.addTrack(track, localStream);
    }


    // Receive their microphone.
    peer.ontrack = (event) => {

        let audio = document.getElementById(`audio-${userId}`);

        if (!audio) {

            audio = document.createElement("audio");

            audio.id = `audio-${userId}`;
            audio.autoplay = true;
            audio.controls = false;

            audioContainer.appendChild(audio);
        }

        audio.srcObject = event.streams[0];

        audio.muted = deafened;
    };


    // ICE candidates.
    peer.onicecandidate = (event) => {

        if (!event.candidate) return;

        socket.emit("ice-candidate", {
            target: userId,
            candidate: event.candidate
        });
    };


    return peer;
}


/* -----------------------------
   OFFER
----------------------------- */

async function createOffer(userId) {

    const peer = createPeer(userId);

    const offer = await peer.createOffer();

    await peer.setLocalDescription(offer);

    socket.emit("offer", {
        target: userId,
        offer
    });
}


/* -----------------------------
   RECEIVE OFFER
----------------------------- */

socket.on("offer", async ({ sender, offer }) => {

    const peer = createPeer(sender);

    await peer.setRemoteDescription(
        new RTCSessionDescription(offer)
    );

    const answer = await peer.createAnswer();

    await peer.setLocalDescription(answer);

    socket.emit("answer", {
        target: sender,
        answer
    });
});


/* -----------------------------
   RECEIVE ANSWER
----------------------------- */

socket.on("answer", async ({ sender, answer }) => {

    const peer = peers.get(sender);

    if (!peer) return;

    await peer.setRemoteDescription(
        new RTCSessionDescription(answer)
    );
});


/* -----------------------------
   ICE
----------------------------- */

socket.on("ice-candidate", async ({ sender, candidate }) => {

    const peer = peers.get(sender);

    if (!peer) return;

    try {

        await peer.addIceCandidate(
            new RTCIceCandidate(candidate)
        );

    } catch (error) {

        console.error(
            "Failed to add ICE candidate:",
            error
        );
    }
});


/* -----------------------------
   MUTE
----------------------------- */

muteButton.addEventListener("click", () => {

    if (!localStream) return;

    muted = !muted;

    for (const track of localStream.getAudioTracks()) {
        track.enabled = !muted;
    }

    muteButton.textContent =
        muted ? "🔇 Unmute" : "🎙️ Mute";
});


/* -----------------------------
   DEAFEN
----------------------------- */

deafenButton.addEventListener("click", () => {

    deafened = !deafened;

    const audios =
        audioContainer.querySelectorAll("audio");

    audios.forEach(audio => {
        audio.muted = deafened;
    });

    deafenButton.textContent =
        deafened ? "🔇 Undeafen" : "🔊 Deafen";
});


/* -----------------------------
   LEAVE
----------------------------- */

leaveButton.addEventListener("click", leaveChannel);

function leaveChannel() {

    if (localStream) {

        for (const track of localStream.getTracks()) {
            track.stop();
        }

        localStream = null;
    }

    for (const peer of peers.values()) {
        peer.close();
    }

    peers.clear();

    audioContainer.innerHTML = "";
    userList.innerHTML = "";

    socket.disconnect();

    location.reload();
}