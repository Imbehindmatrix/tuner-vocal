// --- VARIABLES ---
let audioContext = null;
let analyser = null;
let mediaStreamSource = null;
let bufferLength = 2048;
let buffer = new Float32Array(bufferLength);

// États de l'application
let isListening = false; // Le micro est ouvert
let isRecording = false; // On est en train de détecter une voix
let silenceStart = null; // Chronomètre pour le silence
let recordedPitches = []; // Stockage temporaire des fréquences du mot

// Seuils
const VOLUME_THRESHOLD = 0.02; // Sensibilité du micro (Volume minimum pour déclencher)
const SILENCE_DELAY = 1000; // Arrêt après 1000ms (1s) de silence

// Notes de musique (Notation française)
const noteStrings = ["Do", "Do#", "Ré", "Ré#", "Mi", "Fa", "Fa#", "Sol", "Sol#", "La", "La#", "Si"];

// Éléments DOM
const statusBox = document.getElementById('status-box');
const bigNote = document.getElementById('big-note');
const bigHz = document.getElementById('big-hz');
const historyList = document.getElementById('history-list');
const btnStart = document.getElementById('btn-start');

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

        isListening = true;
        btnStart.textContent = "Micro Actif - Parlez maintenant !";
        btnStart.disabled = true;
        
        // Lancer la boucle
        loop();
    } catch (err) {
        alert("Erreur micro : " + err);
    }
});

// --- BOUCLE D'ANALYSE (Tourne 60 fois par seconde) ---
function loop() {
    requestAnimationFrame(loop);
    if (!isListening) return;

    analyser.getFloatTimeDomainData(buffer);
    
    // 1. Calcul du volume (RMS)
    let rms = 0;
    for (let i = 0; i < bufferLength; i++) {
        rms += buffer[i] * buffer[i];
    }
    rms = Math.sqrt(rms / bufferLength);

    // 2. Détection de fréquence (Pitch)
    let pitch = autoCorrelate(buffer, audioContext.sampleRate);

    // --- LOGIQUE DE DÉTECTION DE PAROLE ---
    
    if (rms > VOLUME_THRESHOLD) {
        // ==> ON PARLE
        if (!isRecording) {
            isRecording = true;
            recordedPitches = []; // Nouveau mot, on vide la mémoire
            statusBox.textContent = "🔴 Enregistrement...";
            statusBox.className = "status-recording";
        }
        
        // On réinitialise le timer de silence car on entend du bruit
        silenceStart = null;

        // Si on a une fréquence valide, on la garde en mémoire
        if (pitch !== -1) {
            recordedPitches.push(pitch);
        }

    } else {
        // ==> SILENCE
        if (isRecording) {
            // On vient de s'arrêter de parler, on lance le chrono
            if (!silenceStart) {
                silenceStart = Date.now();
            } else {
                // Si le silence dure depuis plus de 1s (SILENCE_DELAY)
                if (Date.now() - silenceStart > SILENCE_DELAY) {
                    finishRecording(); // TERMINÉ !
                }
            }
        }
    }
}

// --- QUAND L'ENREGISTREMENT EST FINI ---
function finishRecording() {
    isRecording = false;
    silenceStart = null;
    statusBox.textContent = "Analyse...";
    statusBox.className = "status-analyzing";

    // Calculer la moyenne des fréquences capturées
    if (recordedPitches.length > 0) {
        // On trie et on prend la médiane (plus fiable que la moyenne)
        recordedPitches.sort((a, b) => a - b);
        let medianPitch = recordedPitches[Math.floor(recordedPitches.length / 2)];
        
        // Trouver la note
        let noteInfo = getNote(medianPitch);

        // Affichage Principal
        bigNote.innerText = noteInfo.note + (noteInfo.octave);
        bigHz.innerText = Math.round(medianPitch) + " Hz";

        // Ajout à la liste
        addToHistory(noteInfo.note + noteInfo.octave, Math.round(medianPitch));
    }

    // Remise à zéro visuelle après un court instant
    setTimeout(() => {
        statusBox.textContent = "En attente de voix...";
        statusBox.className = "status-waiting";
    }, 1000);
}

// --- OUTILS MATHÉMATIQUES ---

function addToHistory(note, freq) {
    const li = document.createElement('li');
    li.innerHTML = `<span class="note-tag">${note}</span> <span>${freq} Hz</span>`;
    // Insérer en haut de la liste
    historyList.insertBefore(li, historyList.firstChild);
}

// Convertir Hz en Note (Do, Ré, Mi...)
function getNote(frequency) {
    let noteNum = 12 * (Math.log(frequency / 440) / Math.log(2));
    let midi = Math.round(noteNum) + 69;
    let note = noteStrings[midi % 12];
    let octave = Math.floor(midi / 12) - 1;
    return { note: note, octave: octave };
}

// Algorithme d'Autocorrélation (Le même qu'avant)
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
