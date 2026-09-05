const socket = io();

let username = "";
let channelId = "";

let localStream = null;

let muted = false;
let deafened = false;

const peers = new Map();
const pendingCandidates = new Map();
const reconnectingPeers = new Set();


// =========================================================
// ELEMENTS
// =========================================================

const joinScreen =
    document.getElementById("join-screen");

const voiceScreen =
    document.getElementById("voice-screen");

const usernameInput =
    document.getElementById("username");

const channelInput =
    document.getElementById("channel");

const joinButton =
    document.getElementById("join-button");

const leaveButton =
    document.getElementById("leave-button");

const muteButton =
    document.getElementById("mute-button");

const deafenButton =
    document.getElementById("deafen-button");

const channelName =
    document.getElementById("channel-name");

const userList =
    document.getElementById("user-list");

const errorText =
    document.getElementById("error");

const audioContainer =
    document.getElementById("audio-container");

const themeToggle =
    document.getElementById("theme-toggle");


// =========================================================
// THEME
// =========================================================

const savedTheme =
    localStorage.getItem("voiceover-theme");

if (savedTheme === "light") {
    document.body.classList.add("light-theme");

    if (themeToggle) {
        themeToggle.checked = true;
    }
}

if (themeToggle) {
    themeToggle.addEventListener("change", () => {

        const isLight =
            themeToggle.checked;

        document.body.classList.toggle(
            "light-theme",
            isLight
        );

        localStorage.setItem(
            "voiceover-theme",
            isLight ? "light" : "dark"
        );
    });
}


// =========================================================
// JOIN
// =========================================================

joinButton.addEventListener(
    "click",
    joinChannel
);


usernameInput.addEventListener(
    "keydown",
    (event) => {

        if (event.key === "Enter") {
            joinChannel();
        }

    }
);


channelInput.addEventListener(
    "keydown",
    (event) => {

        if (event.key === "Enter") {
            joinChannel();
        }

    }
);


async function joinChannel() {

    username =
        usernameInput.value.trim();

    channelId =
        channelInput.value.trim();


    if (!username) {

        errorText.textContent =
            "Enter a username.";

        usernameInput.focus();

        return;
    }


    if (!channelId) {

        errorText.textContent =
            "Enter a channel ID.";

        channelInput.focus();

        return;
    }


    errorText.textContent = "";


    try {

        localStream =
            await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true
                },
                video: false
            });

    } catch (error) {

        console.error(
            "Microphone error:",
            error
        );

        errorText.textContent =
            "Could not access your microphone. Check your browser permissions.";

        return;
    }


    channelName.textContent =
        channelId;


    joinScreen.classList.add(
        "hidden"
    );

    voiceScreen.classList.remove(
        "hidden"
    );


    addUser(
        socket.id,
        username
    );


    socket.emit(
        "join-channel",
        {
            channelId,
            username
        }
    );
}


// =========================================================
// EXISTING USERS
// =========================================================

socket.on(
    "channel-users",
    async (users) => {

        console.log(
            "Existing users:",
            users
        );


        for (const user of users) {

            addUser(
                user.id,
                user.username
            );


            await createOffer(
                user.id
            );
        }
    }
);


// =========================================================
// USER JOINED
// =========================================================

socket.on(
    "user-joined",
    ({ id, username }) => {

        console.log(
            "User joined:",
            username,
            id
        );


        addUser(
            id,
            username
        );
    }
);


// =========================================================
// USER LEFT
// =========================================================

socket.on(
    "user-left",
    ({ id }) => {

        console.log(
            "User left:",
            id
        );


        removeUser(id);


        const peer =
            peers.get(id);


        if (peer) {

            peer.close();

            peers.delete(id);
        }


        const audio =
            document.getElementById(
                `audio-${id}`
            );


        if (audio) {
            audio.remove();
        }


        pendingCandidates.delete(id);
        reconnectingPeers.delete(id);
    }
);


// =========================================================
// ADD USER
// =========================================================

function addUser(id, name) {

    if (
        document.getElementById(
            `user-${id}`
        )
    ) {
        return;
    }


    const element =
        document.createElement("div");


    element.className =
        "user";

    element.id =
        `user-${id}`;


    element.innerHTML = `
        <span class="status"></span>
        <span>${escapeHtml(name)}</span>
    `;


    userList.appendChild(
        element
    );
}


// =========================================================
// REMOVE USER
// =========================================================

function removeUser(id) {

    const element =
        document.getElementById(
            `user-${id}`
        );


    if (element) {
        element.remove();
    }
}


// =========================================================
// ESCAPE HTML
// =========================================================

function escapeHtml(text) {

    const div =
        document.createElement("div");


    div.textContent =
        text;


    return div.innerHTML;
}


// =========================================================
// CREATE PEER
// =========================================================

function createPeer(userId) {

    if (
        peers.has(userId)
    ) {
        return peers.get(userId);
    }


    console.log(
        "Creating peer connection:",
        userId
    );


    const peer =
        new RTCPeerConnection({
            iceServers: [
                {
                    urls:
                        "stun:stun.l.google.com:19302"
                }
            ]
        });


    peers.set(
        userId,
        peer
    );


    // -----------------------------------------------------
    // ADD MICROPHONE
    // -----------------------------------------------------

    if (localStream) {

        for (
            const track
            of localStream.getTracks()
        ) {

            peer.addTrack(
                track,
                localStream
            );
        }
    }


    // -----------------------------------------------------
    // REMOTE AUDIO
    // -----------------------------------------------------

    peer.ontrack =
        async (event) => {

            console.log(
                "REMOTE AUDIO RECEIVED FROM:",
                userId
            );


            let audio =
                document.getElementById(
                    `audio-${userId}`
                );


            if (!audio) {

                audio =
                    document.createElement(
                        "audio"
                    );


                audio.id =
                    `audio-${userId}`;


                audio.autoplay =
                    true;

                audio.playsInline =
                    true;

                audio.controls =
                    false;


                audioContainer.appendChild(
                    audio
                );
            }


            if (
                event.streams &&
                event.streams[0]
            ) {

                audio.srcObject =
                    event.streams[0];

            } else {

                const stream =
                    new MediaStream([
                        event.track
                    ]);


                audio.srcObject =
                    stream;
            }


            audio.muted =
                deafened;


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


            event.track.onended = () => {

                console.warn(
                    "Remote audio track ended:",
                    userId
                );
            };
        };


    // -----------------------------------------------------
    // ICE CANDIDATES
    // -----------------------------------------------------

    peer.onicecandidate =
        (event) => {

            if (
                !event.candidate
            ) {
                return;
            }


            socket.emit(
                "ice-candidate",
                {
                    target: userId,
                    candidate:
                        event.candidate
                }
            );
        };


    // -----------------------------------------------------
    // CONNECTION STATE
    // -----------------------------------------------------

    peer.onconnectionstatechange =
        async () => {

            console.log(
                `Connection ${userId}:`,
                peer.connectionState
            );


            if (
                peer.connectionState ===
                "connected"
            ) {

                console.log(
                    "Voice connection established:",
                    userId
                );

                reconnectingPeers.delete(
                    userId
                );
            }


            if (
                peer.connectionState ===
                "disconnected"
            ) {

                console.warn(
                    "WebRTC connection temporarily disconnected:",
                    userId
                );

                schedulePeerRecovery(
                    userId
                );
            }


            if (
                peer.connectionState ===
                "failed"
            ) {

                console.warn(
                    "WebRTC connection failed:",
                    userId
                );

                await recoverPeer(
                    userId
                );
            }


            if (
                peer.connectionState ===
                "closed"
            ) {

                console.warn(
                    "WebRTC connection closed:",
                    userId
                );

                reconnectingPeers.delete(
                    userId
                );
            }
        };


    // -----------------------------------------------------
    // ICE STATE
    // -----------------------------------------------------

    peer.oniceconnectionstatechange =
        async () => {

            console.log(
                `ICE ${userId}:`,
                peer.iceConnectionState
            );


            if (
                peer.iceConnectionState ===
                "connected" ||
                peer.iceConnectionState ===
                "completed"
            ) {

                console.log(
                    "ICE connection established:",
                    userId
                );

                reconnectingPeers.delete(
                    userId
                );
            }


            if (
                peer.iceConnectionState ===
                "disconnected"
            ) {

                console.warn(
                    "ICE temporarily disconnected:",
                    userId
                );

                schedulePeerRecovery(
                    userId
                );
            }


            if (
                peer.iceConnectionState ===
                "failed"
            ) {

                console.warn(
                    "ICE failed:",
                    userId
                );

                await recoverPeer(
                    userId
                );
            }
        };


    // -----------------------------------------------------
    // ICE GATHERING DEBUG
    // -----------------------------------------------------

    peer.onicegatheringstatechange =
        () => {

            console.log(
                `ICE gathering ${userId}:`,
                peer.iceGatheringState
            );
        };


    // -----------------------------------------------------
    // SIGNALING DEBUG
    // -----------------------------------------------------

    peer.onsignalingstatechange =
        () => {

            console.log(
                `Signaling ${userId}:`,
                peer.signalingState
            );
        };


    return peer;
}


// =========================================================
// CREATE OFFER
// =========================================================

async function createOffer(userId) {

    try {

        const peer =
            createPeer(userId);


        console.log(
            "Creating offer for:",
            userId
        );


        const offer =
            await peer.createOffer();


        await peer.setLocalDescription(
            offer
        );


        socket.emit(
            "offer",
            {
                target: userId,
                offer:
                    peer.localDescription
            }
        );

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


            const peer =
                createPeer(sender);


            await peer.setRemoteDescription(
                new RTCSessionDescription(
                    offer
                )
            );


            await addPendingCandidates(
                sender
            );


            const answer =
                await peer.createAnswer();


            await peer.setLocalDescription(
                answer
            );


            socket.emit(
                "answer",
                {
                    target: sender,
                    answer:
                        peer.localDescription
                }
            );

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


            const peer =
                peers.get(sender);


            if (!peer) {

                console.warn(
                    "No peer for answer:",
                    sender
                );

                return;
            }


            await peer.setRemoteDescription(
                new RTCSessionDescription(
                    answer
                )
            );


            await addPendingCandidates(
                sender
            );

        } catch (error) {

            console.error(
                "Answer handling failed:",
                error
            );
        }
    }
);


// =========================================================
// RECEIVE ICE
// =========================================================

socket.on(
    "ice-candidate",
    async ({ sender, candidate }) => {

        try {

            const peer =
                peers.get(sender);


            if (!peer) {

                queueCandidate(
                    sender,
                    candidate
                );

                return;
            }


            if (
                !peer.remoteDescription
            ) {

                queueCandidate(
                    sender,
                    candidate
                );

                return;
            }


            await peer.addIceCandidate(
                new RTCIceCandidate(
                    candidate
                )
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
// QUEUE ICE
// =========================================================

function queueCandidate(
    userId,
    candidate
) {

    if (
        !pendingCandidates.has(
            userId
        )
    ) {

        pendingCandidates.set(
            userId,
            []
        );
    }


    pendingCandidates
        .get(userId)
        .push(candidate);
}


// =========================================================
// ADD QUEUED ICE
// =========================================================

async function addPendingCandidates(
    userId
) {

    const peer =
        peers.get(userId);


    if (!peer) {
        return;
    }


    const candidates =
        pendingCandidates.get(
            userId
        );


    if (!candidates) {
        return;
    }


    for (
        const candidate
        of candidates
    ) {

        try {

            await peer.addIceCandidate(
                new RTCIceCandidate(
                    candidate
                )
            );

        } catch (error) {

            console.error(
                "Queued ICE candidate failed:",
                error
            );
        }
    }


    pendingCandidates.delete(
        userId
    );
}


// =========================================================
// PEER RECOVERY
// =========================================================

function schedulePeerRecovery(userId) {

    if (
        reconnectingPeers.has(userId)
    ) {
        return;
    }


    reconnectingPeers.add(
        userId
    );


    console.log(
        "Scheduling WebRTC recovery:",
        userId
    );


    setTimeout(
        async () => {

            const peer =
                peers.get(userId);


            if (!peer) {

                reconnectingPeers.delete(
                    userId
                );

                return;
            }


            if (
                peer.connectionState ===
                "connected"
            ) {

                reconnectingPeers.delete(
                    userId
                );

                return;
            }


            await recoverPeer(
                userId
            );

        },
        1500
    );
}


// =========================================================
// RECOVER PEER
// =========================================================

async function recoverPeer(userId) {

    if (
        !localStream
    ) {
        return;
    }


    if (
        reconnectingPeers.has(userId) &&
        peers.get(userId)?.connectionState ===
            "failed"
    ) {

        // Continue with recovery.
    }


    reconnectingPeers.add(
        userId
    );


    const oldPeer =
        peers.get(userId);


    if (!oldPeer) {

        reconnectingPeers.delete(
            userId
        );

        return;
    }


    console.log(
        "Attempting WebRTC recovery:",
        userId
    );


    // -----------------------------------------------------
    // TRY ICE RESTART FIRST
    // -----------------------------------------------------

    try {

        if (
            oldPeer.signalingState ===
            "stable" &&
            oldPeer.connectionState !==
            "closed"
        ) {

            console.log(
                "Attempting ICE restart:",
                userId
            );


            const offer =
                await oldPeer.createOffer({
                    iceRestart: true
                });


            await oldPeer.setLocalDescription(
                offer
            );


            socket.emit(
                "offer",
                {
                    target: userId,
                    offer:
                        oldPeer.localDescription
                }
            );


            setTimeout(
                () => {

                    const currentPeer =
                        peers.get(userId);


                    if (
                        currentPeer &&
                        (
                            currentPeer.connectionState ===
                                "connected" ||
                            currentPeer.iceConnectionState ===
                                "connected" ||
                            currentPeer.iceConnectionState ===
                                "completed"
                        )
                    ) {

                        reconnectingPeers.delete(
                            userId
                        );

                    }

                },
                5000
            );


            return;
        }

    } catch (error) {

        console.warn(
            "ICE restart failed:",
            error
        );
    }


    // -----------------------------------------------------
    // FULL PEER REBUILD
    // -----------------------------------------------------

    console.log(
        "Rebuilding peer connection:",
        userId
    );


    try {
        oldPeer.close();
    } catch (error) {
        console.warn(
            "Error closing old peer:",
            error
        );
    }


    peers.delete(
        userId
    );


    const audio =
        document.getElementById(
            `audio-${userId}`
        );


    if (audio) {
        audio.remove();
    }


    reconnectingPeers.delete(
        userId
    );


    try {

        await createOffer(
            userId
        );

    } catch (error) {

        console.error(
            "Peer rebuild failed:",
            error
        );
    }
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


        muted =
            !muted;


        for (
            const track
            of localStream.getAudioTracks()
        ) {

            track.enabled =
                !muted;
        }


        muteButton.innerHTML =
            muted
                ? "🔇 <span>Unmute</span>"
                : "🎙️ <span>Mute</span>";
    }
);


// =========================================================
// DEAFEN
// =========================================================

deafenButton.addEventListener(
    "click",
    () => {

        deafened =
            !deafened;


        const audios =
            audioContainer.querySelectorAll(
                "audio"
            );


        audios.forEach(
            (audio) => {

                audio.muted =
                    deafened;
            }
        );


        deafenButton.innerHTML =
            deafened
                ? "🔇 <span>Undeafen</span>"
                : "🔊 <span>Deafen</span>";
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

    if (localStream) {

        for (
            const track
            of localStream.getTracks()
        ) {

            track.stop();
        }

        localStream = null;
    }


    for (
        const peer
        of peers.values()
    ) {

        try {
            peer.close();
        } catch (error) {
            console.warn(
                "Error closing peer:",
                error
            );
        }
    }


    peers.clear();

    pendingCandidates.clear();

    reconnectingPeers.clear();


    audioContainer.innerHTML =
        "";

    userList.innerHTML =
        "";


    socket.disconnect();


    location.reload();
}


// =========================================================
// SOCKET DEBUGGING
// =========================================================

socket.on(
    "connect",
    () => {

        console.log(
            "Socket connected:",
            socket.id
        );
    }
);


socket.on(
    "disconnect",
    () => {

        console.log(
            "Socket disconnected"
        );
    }
);


// =========================================================
// SOCKET RECONNECT
// =========================================================

socket.on(
    "connect_error",
    (error) => {

        console.error(
            "Socket connection error:",
            error
        );
    }
);