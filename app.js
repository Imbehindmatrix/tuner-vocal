// --- VARIABLES GLOBALES ---
let audioContext = null;
let analyser = null;
let mediaStreamSource = null;
let recorder = null; // Pour l'enregistrement audio brut
let audioChunks = []; // Stockage temporaire de l'audio

let bufferLength = 2048;
let buffer = new Float32Array(bufferLength);
let dataArray = new Uint8Array(bufferLength); // Pour le visuel

// États de l'application
let isListening = false;
let isRecording = false;
let silenceStart = null;
let recordedPitches = [];

// Seuils
const VOLUME_THRESHOLD = 0.02;
const SILENCE_DELAY = 1000;

// Notes
const noteStrings = ["Do", "Do#", "Ré", "Ré#", "Mi", "Fa", "Fa#", "Sol", "Sol#", "La", "La#", "Si"];

// Éléments DOM
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

    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaStreamSource = audioContext.createMediaStreamSource(stream);
        analyser = audioContext.createAnalyser();
        analyser.fftSize = 2048;
        mediaStreamSource.connect(analyser);

        // Configuration de l'enregistreur (pour le MP3)
        recorder = new MediaRecorder(stream);
        recorder.ondataavailable = (e) => {
            if (e.data.size > 0) audioChunks.push(e.data);
        };

        isListening = true;
        btnStart.textContent = "Micro Actif - Parlez !";
        btnStart.disabled = true;
        
        loop(); // Lancer la boucle d'analyse et de dessin
    } catch (err) {
        alert("Erreur micro : " + err);
    }
});

// --- BOUCLE PRINCIPALE (Analyse + Visuel) ---
function loop() {
    requestAnimationFrame(loop);
    if (!isListening) return;

    analyser.getFloatTimeDomainData(buffer); // Pour le pitch
    analyser.getByteFrequencyData(dataArray); // Pour le visuel
    
    drawVisualizer(); // Dessiner le demi-cercle

    // 1. Calcul du volume (RMS)
    let rms = 0;
    for (let i = 0; i < bufferLength; i++) { rms += buffer[i] * buffer[i]; }
    rms = Math.sqrt(rms / bufferLength);

    // 2. Détection de fréquence
    let pitch = autoCorrelate(buffer, audioContext.sampleRate);

    // --- LOGIQUE DE DÉTECTION ---
    if (rms > VOLUME_THRESHOLD) {
        // ==> ON PARLE
        if (!isRecording) {
            isRecording = true;
            recordedPitches = [];
            audioChunks = []; // On vide le buffer audio
            recorder.start(); // On commence à enregistrer le son pour le MP3
            statusBox.textContent = "🔴 Enregistrement...";
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
                finishRecording(); // TERMINÉ !
            }
        }
    }
}

// --- FIN DE L'ENREGISTREMENT ---
function finishRecording() {
    isRecording = false;
    recorder.stop(); // Arrêter l'enregistrement audio
    statusBox.textContent = "Analyse & Encodage...";
    statusBox.className = "status-analyzing";

    // Calcul du pitch médian
    let medianPitch = 0;
    let noteInfo = { note: "--", octave: "" };
    if (recordedPitches.length > 0) {
        recordedPitches.sort((a, b) => a - b);
        medianPitch = recordedPitches[Math.floor(recordedPitches.length / 2)];
        noteInfo = getNote(medianPitch);
    }

    // Affichage
    bigNote.innerText = noteInfo.note + noteInfo.octave;
    bigHz.innerText = Math.round(medianPitch) + " Hz";

    // Encodage MP3 (une fois que les données sont prêtes)
    recorder.onstop = async () => {
        const audioBlob = new Blob(audioChunks, { type: 'audio/wav' }); // D'abord en WAV
        const mp3Blob = await convertToMp3(audioBlob); // Puis conversion MP3
        const audioUrl = URL.createObjectURL(mp3Blob);
        
        addToHistory(noteInfo.note + noteInfo.octave, Math.round(medianPitch), audioUrl, medianPitch);
        
        setTimeout(() => {
            statusBox.textContent = "En attente de voix...";
            statusBox.className = "status-waiting";
        }, 1000);
    };
}

// --- NOUVEAU : FONCTION DE DESSIN DU VISUEL ---
function drawVisualizer() {
    const WIDTH = canvas.width;
    const HEIGHT = canvas.height;
    const CENTER_X = WIDTH / 2;
    const CENTER_Y = HEIGHT; // Bas du canvas
    const RADIUS = HEIGHT - 20;
    
    canvasCtx.clearRect(0, 0, WIDTH, HEIGHT);

    // On ne dessine que si on enregistre ou si on parle
    if (!isRecording && statusBox.className !== "status-recording") return;

    const bars = 60; // Nombre de barres dans le demi-cercle
    const step = Math.PI / bars; // Espace entre chaque barre

    for (let i = 0; i < bars; i++) {
        // On prend les fréquences basses à moyennes (là où est la voix)
        let value = dataArray[i + 5] / 255; 
        let barHeight = value * RADIUS * 0.8;

        // Couleur basée sur la position (Grave=Rouge -> Aigu=Bleu)
        let hue = (i / bars) * 240; 
        canvasCtx.fillStyle = `hsl(${hue}, 100%, 50%)`;

        let angle = Math.PI + (i * step); // Commence à gauche (PI) et va à droite (2*PI)

        // Coordonnées du début de la barre (sur le cercle)
        let x1 = CENTER_X + RADIUS * Math.cos(angle);
        let y1 = CENTER_Y + RADIUS * Math.sin(angle);
        
        // Coordonnées de la fin de la barre (vers l'extérieur)
        let x2 = CENTER_X + (RADIUS + barHeight) * Math.cos(angle);
        let y2 = CENTER_Y + (RADIUS + barHeight) * Math.sin(angle);

        canvasCtx.beginPath();
        canvasCtx.moveTo(x1, y1);
        canvasCtx.lineTo(x2, y2);
        canvasCtx.lineWidth = WIDTH / bars / 2;
        canvasCtx.strokeStyle = `hsl(${hue}, 100%, 50%)`;
        canvasCtx.stroke();
    }
}

// --- OUTILS MATHÉMATIQUES & AJOUTS ---

// Fonction pour convertir WAV -> MP3 via lamejs
async function convertToMp3(blob) {
    const audioContext = new AudioContext();
    const arrayBuffer = await blob.arrayBuffer();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

    const mp3Encoder = new lamejs.Mp3Encoder(1, audioBuffer.sampleRate, 128); // Mono, 128kbps
    const samples = audioBuffer.getChannelData(0);
    // Convertir float32 en int16 pour lamejs
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

function addToHistory(note, freq, audioUrl, rawFreq) {
    const li = document.createElement('li');
    
    // Créer un petit indicateur de couleur pour le visuel
    let hue = 0;
    // Mapping grossier de la fréquence (80Hz-1000Hz) vers une couleur (Rouge-Bleu)
    if (rawFreq > 0) hue = Math.min(240, Math.max(0, (rawFreq - 80) / (1000 - 80) * 240));
    const colorIndicator = `<span style="display:inline-block; width:10px; height:10px; border-radius:50%; background-color:hsl(${hue}, 100%, 50%); margin-right:10px;"></span>`;

    li.innerHTML = `
        <div class="note-info">
            <div>${colorIndicator}<span class="note-tag">${note}</span></div>
            <span>${freq} Hz</span>
        </div>
        <a href="${audioUrl}" download="enregistrement_${note}_${freq}Hz.mp3">
            <button class="download-btn">Télécharger MP3</button>
        </a>
    `;
    historyList.insertBefore(li, historyList.firstChild);
}

// ... (Les fonctions getNote et autoCorrelate sont identiques au code précédent, je ne les remets pas pour gagner de la place, mais ELLES DOIVENT Y ÊTRE) ...
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
    for (let i = 0; i < SIZE; i++) {
        let val = buf[i];
        rms += val * val;
    }
    rms = Math.sqrt(rms / SIZE);
    if (rms < 0.01) return -1;

    let r1 = 0, r2 = SIZE - 1, thres = 0.2;
    for (let i = 0; i < SIZE / 2; i++) {
        if (Math.abs(buf[i]) < thres) { r1 = i; break; }
    }
    for (let i = 1; i < SIZE / 2; i++) {
        if (Math.abs(buf[SIZE - i]) < thres) { r2 = SIZE - i; break; }
    }

    buf = buf.slice(r1, r2);
    SIZE = buf.length;

    let c = new Array(SIZE).fill(0);
    for (let i = 0; i < SIZE; i++) {
        for (let j = 0; j < SIZE - i; j++) {
            c[i] = c[i] + buf[j] * buf[j + i];
        }
    }

    let d = 0; while (c[d] > c[d + 1]) d++;
    let maxval = -1, maxpos = -1;
    for (let i = d; i < SIZE; i++) {
        if (c[i] > maxval) {
            maxval = c[i];
            maxpos = i;
        }
    }
    let T0 = maxpos;
    return sampleRate / T0;
}
