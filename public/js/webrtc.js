class PDRS_WebRTC {
    constructor(onTrack, onIceCandidate) {
        this.pc = new RTCPeerConnection({
            iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
        });
        this.localStream = null;
        this.onTrack = onTrack;
        this.onIceCandidate = onIceCandidate;

        this.pc.ontrack = (event) => this.onTrack(event.streams[0]);
        this.pc.onicecandidate = (event) => {
            if (event.candidate) this.onIceCandidate(event.candidate);
        };
    }

    async startLocalStream(video = true, audio = true) {
        try {
            this.localStream = await navigator.mediaDevices.getUserMedia({ video, audio });
            this.localStream.getTracks().forEach(track => this.pc.addTrack(track, this.localStream));
            return this.localStream;
        } catch (err) {
            console.error('WebRTC Media Error:', err);
            throw err;
        }
    }

    async startScreenShare() {
        try {
            const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
            const videoTrack = screenStream.getVideoTracks()[0];
            const sender = this.pc.getSenders().find(s => s.track.kind === 'video');
            if (sender) sender.replaceTrack(videoTrack);
            
            videoTrack.onended = () => {
                const cameraTrack = this.localStream.getVideoTracks()[0];
                if (sender) sender.replaceTrack(cameraTrack);
            };
            return screenStream;
        } catch (err) {
            console.error('Screen Share Error:', err);
            throw err;
        }
    }

    toggleCamera(enabled) {
        if (this.localStream) {
            this.localStream.getVideoTracks().forEach(t => t.enabled = enabled);
        }
    }

    toggleMic(enabled) {
        if (this.localStream) {
            this.localStream.getAudioTracks().forEach(t => t.enabled = enabled);
        }
    }

    async createOffer() {
        const offer = await this.pc.createOffer();
        await this.pc.setLocalDescription(offer);
        return offer;
    }

    async handleOffer(offer) {
        await this.pc.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await this.pc.createAnswer();
        await this.pc.setLocalDescription(answer);
        return answer;
    }

    async handleAnswer(answer) {
        await this.pc.setRemoteDescription(new RTCSessionDescription(answer));
    }

    async handleCandidate(candidate) {
        await this.pc.addIceCandidate(new RTCIceCandidate(candidate));
    }
}

window.pdrsWebRTC = PDRS_WebRTC;
