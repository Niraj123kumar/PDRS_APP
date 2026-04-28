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

    async startScreenShare() {
        try {
            const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
            const videoTrack = screenStream.getVideoTracks()[0];
            
            // If we already have a video sender, replace its track
            const sender = this.pc.getSenders().find(s => s.track && s.track.kind === 'video');
            if (sender) {
                sender.replaceTrack(videoTrack);
            } else {
                this.pc.addTrack(videoTrack, screenStream);
            }
            
            return screenStream;
        } catch (err) {
            console.error('Screen Share Error:', err);
            if (err.name !== 'NotAllowedError' && window.showToast) {
                window.showToast('Screen share failed', 'error');
            }
            throw err;
        }
    }

    async createOffer() {
        try {
            const offer = await this.pc.createOffer();
            await this.pc.setLocalDescription(offer);
            return offer;
        } catch (err) {
            console.error('WebRTC Offer Error:', err);
            if (window.showToast) window.showToast('Failed to create connection offer', 'error');
            throw err;
        }
    }

    async handleOffer(offer) {
        try {
            await this.pc.setRemoteDescription(new RTCSessionDescription(offer));
            const answer = await this.pc.createAnswer();
            await this.pc.setLocalDescription(answer);
            return answer;
        } catch (err) {
            console.error('WebRTC Handle Offer Error:', err);
            if (window.showToast) window.showToast('Failed to handle connection offer', 'error');
            throw err;
        }
    }

    async handleAnswer(answer) {
        try {
            await this.pc.setRemoteDescription(new RTCSessionDescription(answer));
        } catch (err) {
            console.error('WebRTC Handle Answer Error:', err);
            if (window.showToast) window.showToast('Failed to handle connection answer', 'error');
            throw err;
        }
    }

    async handleCandidate(candidate) {
        try {
            await this.pc.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (err) {
            console.error('WebRTC ICE Candidate Error:', err);
            // Don't toast for every candidate error as it might be noisy
            throw err;
        }
    }
}

window.pdrsWebRTC = PDRS_WebRTC;
