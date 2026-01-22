// --- VARIABLES GLOBALES ---
let audioContext = null;
let analyser = null;
let mediaStreamSource = null;
let recorder = null;
let audioChunks = [];

let bufferLength = 2048;
let buffer = new Float32Array(bufferLength);
let dataArray = new Uint8Array(bufferLength);

// États de l'application
let isMicActive = false; // INTERRUPTEUR GÉNÉRAL
let isRecording = false; // En train de capturer un mot
let silenceStart = null;
let recordedPitches = [];

// Compteurs et Historique
let recordingCounter = 0;
let markers = []; 

// Seuils
const VOLUME_THRESHOLD = 0.02; // Sensibilité déclenchement
const SILENCE_DELAY = 1000;    // Arrêt après 1s de silence
const MIN_FREQ_VISUAL = 80;    // Pour le dessin (Grave)
const MAX_FREQ_VISUAL = 600;   // Pour le dessin (Aigu)

const noteStrings = ["Do", "Do#", "Ré", "Ré#", "Mi", "Fa", "Fa#", "Sol", "Sol#", "La", "La#", "Si"];

// Éléments du DOM
const statusBox = document.getElementById('status-box');
const bigNote = document.getElementById('big-note');
const bigHz = document.getElementById('big-hz');
const historyList = document.getElementById('history-list');
const btnToggle = document.getElementById('btn-toggle');
const canvas = document.getElementById('spectrum-canvas');
const canvasCtx = canvas.getContext('2d');

// --- GESTION DU BOUTON ON/OFF ---
btnToggle.addEventListener('click', async () => {
    
    // 1. Initialisation Audio (uniquement au tout premier clic)
    if (!audioContext) {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        audioContext = new AudioContext();
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            mediaStreamSource = audioContext.createMediaStreamSource(stream);
            analyser = audioContext.createAnalyser();
            analyser.fftSize = 2048;
            mediaStreamSource.connect(analyser);

            // Préparation de l'enregistreur MP3/WAV
            recorder = new MediaRecorder(stream);
            recorder.ondataavailable = (e) => {
                if (e.data.size > 0) audioChunks.push(e.data);
            };
            
            // Lancer la boucle d'animation
            loop();
        } catch (err) {
            alert("Erreur micro : " + err);
            return;
        }
    }

    // 2. Bascule ON / OFF
    isMicActive = !isMicActive; // On inverse l'état

    if (isMicActive) {
        // ==> ON ALLUME
        if (audioContext.state === 'suspended') audioContext.resume();
        btnToggle.textContent = "STOP / PAUSE";
        btnToggle.className = "btn-on";
        statusBox.textContent = "En attente de voix...";
        statusBox.className = "status-waiting";
    } else {
        // ==> ON ÉTEINT
        btnToggle.textContent = "RÉACTIVER LE MICRO";
        btnToggle.className = "btn-off"; // Revient en bleu
        statusBox.textContent = "Micro en pause";
        statusBox.className = "status-waiting";
        statusBox.style.background = "#353b48"; 
        
        // Si on coupe alors qu'on enregistrait, on annule proprement
        isRecording = false;
        silenceStart = null;
        if(recorder && recorder.state === "recording") recorder.stop();
    }
});

// --- BOUCLE PRINCIPALE (Tourne 60 fois par seconde) ---
function loop() {
    requestAnimationFrame(loop);

    // SI LE MICRO EST OFF : On dessine juste les anciens marqueurs et on s'arrête
    if (!isMicActive || !analyser) {
        drawVisualizer(false); // false = pas de barres qui bougent
        return; 
    }

    // SINON : ON ANALYSE LE SON
    analyser.getFloatTimeDomainData(buffer); // Pour le pitch
    analyser.getByteFrequencyData(dataArray); // Pour le visuel
    
    drawVisualizer(true); // true = dessiner les barres

    // Calculs Volume (RMS) et Hauteur (Pitch)
    let rms = 0;
    for (let i = 0; i < bufferLength; i++) { rms += buffer[i] * buffer[i]; }
    rms = Math.sqrt(rms / bufferLength);

    let pitch = autoCorrelate(buffer, audioContext.sampleRate);

    // --- LOGIQUE AUTOMATIQUE (VAD) ---
    if (rms > VOLUME_THRESHOLD) {
        // ==> ON PARLE
        if (!isRecording) {
            isRecording = true;
            recordedPitches = [];
            audioChunks = [];
            recorder.start(); // Début enregistrement fichier
            statusBox.textContent = "🔴 Enregistrement " + (recordingCounter + 1) + "...";
            statusBox.className = "status-recording";
        }
        silenceStart = null;
        if (pitch !== -1) recordedPitches.push(pitch);

    } else {
        // ==> SILENCE
        if (isRecording) {
            if (!silenceStart) {
                silenceStart = Date.now();
            } else if (Date.now() - silenceStart > SILENCE_DELAY) {
                finishRecording(); // Silence > 1s, on termine
            }
        }
    }
}

// --- FIN ENREGISTREMENT ---
function finishRecording() {
    isRecording = false;
    recorder.stop();
    recordingCounter++; 
    
    statusBox.textContent = "Analyse...";
    statusBox.className = "status-analyzing";

    let medianPitch = 0;
    let noteInfo = { note: "--", octave: "" };
    
    // Calcul de la note moyenne
    if (recordedPitches.length > 0) {
        recordedPitches.sort((a, b) => a - b);
        medianPitch = recordedPitches[Math.floor(recordedPitches.length / 2)];
        noteInfo = getNote(medianPitch);

        // Ajouter un marqueur visuel (1, 2, 3...)
        markers.push({ id: recordingCounter, freq: medianPitch });
    }

    // Affichage principal
    bigNote.innerText = noteInfo.note + noteInfo.octave;
    bigHz.innerText = Math.round(medianPitch) + " Hz";

    // Traitement du fichier Audio (MP3)
    recorder.onstop = async () => {
        const audioBlob = new Blob(audioChunks, { type: 'audio/wav' });
        const mp3Blob = await convertToMp3(audioBlob);
        const audioUrl = URL.createObjectURL(mp3Blob);
        
        addToHistory(recordingCounter, noteInfo.note + noteInfo.octave, Math.round(medianPitch), audioUrl, medianPitch);
        
        // Retour à l'état d'attente
        setTimeout(() => {
            if(isMicActive) {
                statusBox.textContent = "En attente...";
                statusBox.className = "status-waiting";
            }
        }, 1000);
    };
}

// --- FONCTION DE DESSIN ---
function drawVisualizer(animateBars) {
    const WIDTH = canvas.width;
    const HEIGHT = canvas.height;
    const CENTER_X = WIDTH / 2;
    const CENTER_Y = HEIGHT; 
    const RADIUS = HEIGHT - 20;
    
    canvasCtx.clearRect(0, 0, WIDTH, HEIGHT);

    // 1. DESSINER LES BARRES (Seulement si actif)
    if (animateBars && (isRecording || statusBox.className === "status-recording")) {
        const bars = 60;
        const step = Math.PI / bars;
        
        for (let i = 0; i < bars; i++) {
            let value = dataArray[i + 3]; 
            if(!value) value = 0;
            
            let barHeight = (value / 255) * RADIUS * 0.9;
            let hue = (i / bars) * 240; // Arc-en-ciel
            
            let angle = Math.PI + (i * step);
            
            let x1 = CENTER_X + RADIUS * Math.cos(angle);
            let y1 = CENTER_Y + RADIUS * Math.sin(angle);
            let x2 = CENTER_X + (RADIUS + barHeight) * Math.cos(angle);
            let y2 = CENTER_Y + (RADIUS + barHeight) * Math.sin(angle);

            canvasCtx.beginPath();
            canvasCtx.moveTo(x1, y1);
            canvasCtx.lineTo(x2, y2);
            canvasCtx.lineWidth = WIDTH / bars / 1.5;
            canvasCtx.strokeStyle = `hsl(${hue}, 100%, 50%)`;
            canvasCtx.stroke();
        }
    } else {
        // Arc de repos (Gris)
        canvasCtx.beginPath();
        canvasCtx.arc(CENTER_X, CENTER_Y, RADIUS, Math.PI, 0);
        canvasCtx.strokeStyle = isMicActive ? "#444" : "#222"; 
        canvasCtx.lineWidth = 2;
        canvasCtx.stroke();
    }

    // 2. DESSINER LES MARQUEURS (Toujours visibles)
    markers.forEach(marker => {
        let safeFreq = Math.max(MIN_FREQ_VISUAL, Math.min(marker.freq, MAX_FREQ_VISUAL));
        let percent = (safeFreq - MIN_FREQ_VISUAL) / (MAX_FREQ_VISUAL - MIN_FREQ_VISUAL);
        let angle = Math.PI + (percent * Math.PI);
        
        let markerX = CENTER_X + (RADIUS - 15) * Math.cos(angle);
        let markerY = CENTER_Y + (RADIUS - 15) * Math.sin(angle);

        // Rond blanc
        canvasCtx.beginPath();
        canvasCtx.arc(markerX, markerY, 12, 0, 2 * Math.PI);
        canvasCtx.fillStyle = "white";
        canvasCtx.fill();
        canvasCtx.strokeStyle = "#000";
        canvasCtx.lineWidth = 1;
        canvasCtx.stroke();

        // Numéro
        canvasCtx.fillStyle = "black";
        canvasCtx.font = "bold 12px Arial";
        canvasCtx.textAlign = "center";
        canvasCtx.textBaseline = "middle";
        canvasCtx.fillText(marker.id, markerX, markerY);
    });
}

// --- UTILITAIRES ---

// Conversion MP3 (LameJS)
async function convertToMp3(blob) {
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const arrayBuffer = await blob.arrayBuffer();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
    const mp3Encoder = new lamejs.Mp3Encoder(1, audioBuffer.sampleRate, 128);
    const samples = audioBuffer.getChannelData(0);
    let sampleData = new Int16Array(samples.length);
    for (let i = 0; i < samples.length; i++) { sampleData[i] = samples[i] * 32767.5; }
    let mp3Data = [];
    let blockSize = 1152;
    for (let i = 0; i < sampleData.length; i += blockSize) {
        let sampleChunk = sampleData.subarray(i, i + blockSize);
        let mp3buf = mp3Encoder.encodeBuffer(sampleChunk);
        if (mp3buf.length > 0) mp3Data.push(mp3buf);
    }
    let mp3buf = mp3Encoder.flush();
    if (mp3buf.length > 0) mp3Data.push(mp3buf);
    return new Blob(mp3Data, { type: 'audio/mp3' });
}

// Ajout à l'historique
function addToHistory(id, note, freq, audioUrl, rawFreq) {
    const li = document.createElement('li');
    let hue = 0;
    if (rawFreq > 0) hue = Math.min(240, Math.max(0, (rawFreq - MIN_FREQ_VISUAL) / (MAX_FREQ_VISUAL - MIN_FREQ_VISUAL) * 240));
    const colorIndicator = `<span style="display:inline-block; width:20px; height:20px; line-height:20px; text-align:center; border-radius:50%; background-color:white; color:black; font-weight:bold; margin-right:10px; font-size:0.8rem;">${id}</span>`;
    
    li.innerHTML = `
        <div class="note-info">
            <div>${colorIndicator} <strong>Enr. ${id}</strong> : <span class="note-tag">${note}</span></div>
            <span style="font-size:0.8em; color:#ccc; margin-left:5px;">${freq} Hz</span>
        </div>
        <a href="${audioUrl}" download="Enregistrement_${id}_${note}.mp3">
            <button class="download-btn">MP3</button>
        </a>
    `;
    historyList.insertBefore(li, historyList.firstChild);
}

// Note (Hz -> Texte)
function getNote(frequency) {
    let noteNum = 12 * (Math.log(frequency / 440) / Math.log(2));
    let midi = Math.round(noteNum) + 69;
    let note = noteStrings[midi % 12];
    let octave = Math.floor(midi / 12) - 1;
    return { note: note, octave: octave };
}

// Autocorrélation (Pitch detection)
function autoCorrelate(buf, sampleRate) {
    let SIZE = buf.length;
    let rms = 0;
    for (let i = 0; i < SIZE; i++) { let val = buf[i]; rms += val * val; }
    rms = Math.sqrt(rms / SIZE);
    if (rms < 0.01) return -1;
    let r1 = 0, r2 = SIZE - 1, thres = 0.2;
    for (let i = 0; i < SIZE / 2; i++) { if (Math.abs(buf[i]) < thres) { r1 = i; break; } }
    for (let i = 1; i < SIZE / 2; i++) { if (Math.abs(buf[SIZE - i]) < thres) { r2 = SIZE - i; break; } }
    buf = buf.slice(r1, r2);
    SIZE = buf.length;
    let c = new Array(SIZE).fill(0);
    for (let i = 0; i < SIZE; i++) { for (let j = 0; j < SIZE - i; j++) { c[i] = c[i] + buf[j] * buf[j + i]; } }
    let d = 0; while (c[d] > c[d + 1]) d++;
    let maxval = -1, maxpos = -1;
    for (let i = d; i < SIZE; i++) { if (c[i] > maxval) { maxval = c[i]; maxpos = i; } }
    let T0 = maxpos;
    return sampleRate / T0;
}
