// --- VARIABLES GLOBALES ---
let audioContext = null;
let analyser = null;
let mediaStreamSource = null;
let recorder = null;
let audioChunks = [];

let bufferLength = 2048;
let buffer = new Float32Array(bufferLength);
let dataArray = new Uint8Array(bufferLength);

// États
let isListening = false;
let isRecording = false;
let silenceStart = null;
let recordedPitches = [];

// Compteurs et Historique
let recordingCounter = 0; // Pour compter 1, 2, 3...
let markers = []; // Pour stocker la position visuelle des enregistrements

// Seuils & Paramètres
const VOLUME_THRESHOLD = 0.02;
const SILENCE_DELAY = 1000;
const MIN_FREQ_VISUAL = 80;  // Le bord gauche du demi-cercle (Grave)
const MAX_FREQ_VISUAL = 600; // Le bord droit du demi-cercle (Aigu)

// Notes
const noteStrings = ["Do", "Do#", "Ré", "Ré#", "Mi", "Fa", "Fa#", "Sol", "Sol#", "La", "La#", "Si"];

// DOM
const statusBox = document.getElementById('status-box');
const bigNote = document.getElementById('big-note');
const bigHz = document.getElementById('big-hz');
const historyList = document.getElementById('history-list');
const btnStart = document.getElementById('btn-start');
const canvas = document.getElementById('spectrum-canvas');
const canvasCtx = canvas.getContext('2d');

// --- DÉMARRAGE ---
btnStart.addEventListener('click', async () => {
    if (audioContext) return;

    // Fix pour iOS : AudioContext doit être créé sur un clic
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    audioContext = new AudioContext();

    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaStreamSource = audioContext.createMediaStreamSource(stream);
        analyser = audioContext.createAnalyser();
        analyser.fftSize = 2048;
        mediaStreamSource.connect(analyser);

        recorder = new MediaRecorder(stream);
        recorder.ondataavailable = (e) => {
            if (e.data.size > 0) audioChunks.push(e.data);
        };

        isListening = true;
        btnStart.textContent = "Micro Actif - Parlez !";
        btnStart.disabled = true;
        
        loop();
    } catch (err) {
        alert("Erreur micro (sur iOS vérifiez les réglages) : " + err);
    }
});

// --- BOUCLE PRINCIPALE ---
function loop() {
    requestAnimationFrame(loop);
    if (!isListening) return;

    analyser.getFloatTimeDomainData(buffer);
    analyser.getByteFrequencyData(dataArray);
    
    // On dessine toujours (pour voir les marqueurs même en silence)
    drawVisualizer(); 

    // Calculs Audio
    let rms = 0;
    for (let i = 0; i < bufferLength; i++) { rms += buffer[i] * buffer[i]; }
    rms = Math.sqrt(rms / bufferLength);

    let pitch = autoCorrelate(buffer, audioContext.sampleRate);

    // Logique Enregistrement
    if (rms > VOLUME_THRESHOLD) {
        if (!isRecording) {
            isRecording = true;
            recordedPitches = [];
            audioChunks = [];
            recorder.start();
            statusBox.textContent = "🔴 Enregistrement " + (recordingCounter + 1) + "...";
            statusBox.className = "status-recording";
        }
        silenceStart = null;
        if (pitch !== -1) recordedPitches.push(pitch);
    } else {
        if (isRecording) {
            if (!silenceStart) {
                silenceStart = Date.now();
            } else if (Date.now() - silenceStart > SILENCE_DELAY) {
                finishRecording();
            }
        }
    }
}

// --- FIN ENREGISTREMENT ---
function finishRecording() {
    isRecording = false;
    recorder.stop();
    recordingCounter++; // On passe au numéro suivant (1 -> 2)
    
    statusBox.textContent = "Analyse...";
    statusBox.className = "status-analyzing";

    let medianPitch = 0;
    let noteInfo = { note: "--", octave: "" };
    
    if (recordedPitches.length > 0) {
        recordedPitches.sort((a, b) => a - b);
        medianPitch = recordedPitches[Math.floor(recordedPitches.length / 2)];
        noteInfo = getNote(medianPitch);

        // Ajouter un marqueur visuel pour le dessin
        markers.push({
            id: recordingCounter,
            freq: medianPitch
        });
    }

    bigNote.innerText = noteInfo.note + noteInfo.octave;
    bigHz.innerText = Math.round(medianPitch) + " Hz";

    recorder.onstop = async () => {
        const audioBlob = new Blob(audioChunks, { type: 'audio/wav' });
        const mp3Blob = await convertToMp3(audioBlob);
        const audioUrl = URL.createObjectURL(mp3Blob);
        
        addToHistory(recordingCounter, noteInfo.note + noteInfo.octave, Math.round(medianPitch), audioUrl, medianPitch);
        
        setTimeout(() => {
            statusBox.textContent = "En attente...";
            statusBox.className = "status-waiting";
        }, 1000);
    };
}

// --- DESSIN DU SPECTRE ET DES MARQUEURS ---
function drawVisualizer() {
    const WIDTH = canvas.width;
    const HEIGHT = canvas.height;
    const CENTER_X = WIDTH / 2;
    const CENTER_Y = HEIGHT; 
    const RADIUS = HEIGHT - 20;
    
    canvasCtx.clearRect(0, 0, WIDTH, HEIGHT);

    // 1. DESSINER LES BARRES (La voix en direct)
    if (isRecording || statusBox.className === "status-recording") {
        const bars = 60;
        const step = Math.PI / bars;
        
        for (let i = 0; i < bars; i++) {
            let value = dataArray[i + 3]; // Décalage pour ignorer les infra-basses
            if(!value) value = 0;
            
            let barHeight = (value / 255) * RADIUS * 0.9;
            let hue = (i / bars) * 240; 
            
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
        // Dessiner un arc gris discret quand c'est le silence pour montrer la zone
        canvasCtx.beginPath();
        canvasCtx.arc(CENTER_X, CENTER_Y, RADIUS, Math.PI, 0);
        canvasCtx.strokeStyle = "#444";
        canvasCtx.lineWidth = 2;
        canvasCtx.stroke();
    }

    // 2. DESSINER LES MARQUEURS (1, 2, 3...)
    markers.forEach(marker => {
        // Calcul de la position sur l'arc en fonction de la fréquence
        // On "clamp" la fréquence entre min et max pour qu'elle reste dans le graphique
        let safeFreq = Math.max(MIN_FREQ_VISUAL, Math.min(marker.freq, MAX_FREQ_VISUAL));
        
        // Position en pourcentage (0 = gauche/grave, 1 = droite/aigu)
        let percent = (safeFreq - MIN_FREQ_VISUAL) / (MAX_FREQ_VISUAL - MIN_FREQ_VISUAL);
        
        let angle = Math.PI + (percent * Math.PI); // De PI (180°) à 2PI (360/0°)
        
        // Position du petit rond
        let markerX = CENTER_X + (RADIUS - 15) * Math.cos(angle);
        let markerY = CENTER_Y + (RADIUS - 15) * Math.sin(angle);

        // Dessiner le rond
        canvasCtx.beginPath();
        canvasCtx.arc(markerX, markerY, 12, 0, 2 * Math.PI);
        canvasCtx.fillStyle = "white";
        canvasCtx.fill();
        canvasCtx.strokeStyle = "#000";
        canvasCtx.lineWidth = 1;
        canvasCtx.stroke();

        // Écrire le numéro
        canvasCtx.fillStyle = "black";
        canvasCtx.font = "bold 12px Arial";
        canvasCtx.textAlign = "center";
        canvasCtx.textBaseline = "middle";
        canvasCtx.fillText(marker.id, markerX, markerY);
    });
}

// --- HISTORIQUE & OUTILS ---
function addToHistory(id, note, freq, audioUrl, rawFreq) {
    const li = document.createElement('li');
    
    // Couleur indicateur
    let hue = 0;
    if (rawFreq > 0) hue = Math.min(240, Math.max(0, (rawFreq - MIN_FREQ_VISUAL) / (MAX_FREQ_VISUAL - MIN_FREQ_VISUAL) * 240));
    
    const colorIndicator = `<span style="display:inline-block; width:20px; height:20px; line-height:20px; text-align:center; border-radius:50%; background-color:white; color:black; font-weight:bold; margin-right:10px; font-size:0.8rem;">${id}</span>`;

    li.innerHTML = `
        <div class="note-info">
            <div>${colorIndicator} <strong>Enr. ${id}</strong> : <span class="note-tag">${note}</span></div>
            <span style="font-size:0.8em; color:#ccc;">${freq} Hz</span>
        </div>
        <a href="${audioUrl}" download="Enregistrement_${id}_${note}.mp3">
            <button class="download-btn">MP3</button>
        </a>
    `;
    historyList.insertBefore(li, historyList.firstChild);
}

// Conversion MP3 (lamejs)
async function convertToMp3(blob) {
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const arrayBuffer = await blob.arrayBuffer();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

    const mp3Encoder = new lamejs.Mp3Encoder(1, audioBuffer.sampleRate, 128);
    const samples = audioBuffer.getChannelData(0);
    let sampleData = new Int16Array(samples.length);
    for (let i = 0; i < samples.length; i++) {
        sampleData[i] = samples[i] * 32767.5;
    }

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

// Outils Maths (Note & Autocorrélation)
function getNote(frequency) {
    let noteNum = 12 * (Math.log(frequency / 440) / Math.log(2));
    let midi = Math.round(noteNum) + 69;
    let note = noteStrings[midi % 12];
    let octave = Math.floor(midi / 12) - 1;
    return { note: note, octave: octave };
}

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
    for (let i = 0; i < SIZE; i++) {
        for (let j = 0; j < SIZE - i; j++) { c[i] = c[i] + buf[j] * buf[j + i]; }
    }

    let d = 0; while (c[d] > c[d + 1]) d++;
    let maxval = -1, maxpos = -1;
    for (let i = d; i < SIZE; i++) {
        if (c[i] > maxval) { maxval = c[i]; maxpos = i; }
    }
    let T0 = maxpos;
    return sampleRate / T0;
}
