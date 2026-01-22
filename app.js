// --- VARIABLES GLOBALES ---
let audioContext = null;
let analyser = null;
let mediaStreamSource = null;
let isRunning = false;
let rafID = null; // ID pour l'animation frame
const buflen = 2048;
let buf = new Float32Array(buflen); // Mémoire pour le son

// --- ÉLÉMENTS HTML ---
const hzDisplay = document.getElementById('hz-display');
const feedbackDisplay = document.getElementById('note-feedback');
const gaugeFill = document.getElementById('gauge-fill');
const targetSelect = document.getElementById('target-pitch');
const btnStart = document.getElementById('btn-start');

// --- DÉMARRAGE DU MICRO ---
btnStart.addEventListener('click', function() {
    if (isRunning) return; // Évite de lancer 2 fois
    
    // Création du contexte audio
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    
    // Demande d'accès au micro
    navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
        mediaStreamSource = audioContext.createMediaStreamSource(stream);
        analyser = audioContext.createAnalyser();
        analyser.fftSize = 2048;
        mediaStreamSource.connect(analyser);
        
        isRunning = true;
        btnStart.textContent = "Micro en écoute...";
        btnStart.style.backgroundColor = "#7f8c8d"; // Griser le bouton
        
        updatePitch(); // Lancer la boucle d'analyse
    }).catch(err => {
        alert("Erreur : Impossible d'accéder au micro.");
        console.error(err);
    });
});

// --- ALGORITHME D'AUTOCORRÉLATION (Mathématiques) ---
// Cette fonction trouve la fréquence fondamentale dans le bruit
function autoCorrelate(buf, sampleRate) {
    let SIZE = buf.length;
    let rms = 0; // Root Mean Square (Volume)

    // 1. Calculer le volume pour éviter d'analyser le silence
    for (let i = 0; i < SIZE; i++) {
        let val = buf[i];
        rms += val * val;
    }
    rms = Math.sqrt(rms / SIZE);
    if (rms < 0.01) return -1; // Trop silencieux

    // 2. Autocorrélation
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

    // Formule pour convertir en Hertz
    return sampleRate / T0;
}

// --- BOUCLE PRINCIPALE (Mise à jour de l'écran) ---
function updatePitch() {
    analyser.getFloatTimeDomainData(buf);
    let ac = autoCorrelate(buf, audioContext.sampleRate);
    
    if (ac !== -1) { // Si on entend un son
        let pitch = Math.round(ac);
        let target = parseInt(targetSelect.value);
        
        hzDisplay.innerText = pitch + " Hz";
        
        // Logique de la jauge (Feedback)
        let difference = Math.abs(pitch - target);
        
        if (difference < 5) {
            // BRAVO : On est sur la note (à 5Hz près)
            feedbackDisplay.innerText = "Parfait !";
            feedbackDisplay.style.color = "#2ecc71"; // Vert
            gaugeFill.style.backgroundColor = "#2ecc71";
            gaugeFill.style.width = "100%";
        } else if (pitch < target) {
            feedbackDisplay.innerText = "Trop Grave ↑";
            feedbackDisplay.style.color = "#e74c3c"; 
            gaugeFill.style.backgroundColor = "#e74c3c";
            gaugeFill.style.width = "50%";
        } else {
            feedbackDisplay.innerText = "Trop Aigu ↓";
            feedbackDisplay.style.color = "#f39c12"; 
            gaugeFill.style.backgroundColor = "#f39c12";
            gaugeFill.style.width = "50%";
        }
    } else {
        // Silence
        feedbackDisplay.innerText = "...";
        gaugeFill.style.width = "0%";
    }

    rafID = window.requestAnimationFrame(updatePitch);
}
