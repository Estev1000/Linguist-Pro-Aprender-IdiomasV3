// Configuración
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;
let isRecording = false;
let recordingTimeout = null;
let accumulatedText = ''; // Texto acumulado entre reinicios por pausa

// Respuestas por defecto
const DEFAULT_RESPONSES = ['¿Cómo se dice...?', 'No entiendo', '¿Puede repetir?', '¿Qué significa...?', 'Estoy practicando', 'Gracias'];

// Cargar respuestas guardadas o usar por defecto
let responses = JSON.parse(localStorage.getItem('responses')) || [...DEFAULT_RESPONSES];

// Cargar traducciones guardadas
let responseTranslations = JSON.parse(localStorage.getItem('responseTranslations')) || {};

if (SpeechRecognition) {
    recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = false;
} else {
    alert("Este navegador no soporta reconocimiento de voz. Use Chrome o Safari.");
}

const synthesis = window.speechSynthesis;

// Elementos
const btnListen = document.getElementById('btn-listen');
const clientOutput = document.getElementById('client-output');
const clientLang = document.getElementById('client-lang');
const staffInput = document.getElementById('staff-input');
const translationPreview = document.getElementById('translation-preview');
const btnSpeak = document.getElementById('btn-speak');
const btnEditResponses = document.getElementById('btn-edit-responses');
const editModal = document.getElementById('edit-modal');
const btnCloseModal = document.getElementById('btn-close-modal');
const responsesList = document.getElementById('responses-list');
const newResponseInput = document.getElementById('new-response-input');
const btnAddResponse = document.getElementById('btn-add-response');
let quickResponseBtns = document.querySelectorAll('.btn-quick');

// Función para resetear el botón
function resetBtn() {
    isRecording = false;
    btnListen.classList.remove('recording');
    if (recordingTimeout) {
        clearTimeout(recordingTimeout);
        recordingTimeout = null;
    }
}

// --- ESCUCHAR CLIENTE (Push-to-Talk) ---

function startListening() {
    if (!recognition || isRecording) return;
    
    accumulatedText = ''; // Limpiar texto acumulado al iniciar sesión nueva
    
    try {
        isRecording = true;
        recognition.lang = clientLang.value;
        recognition.start();
        btnListen.classList.add('recording');
        clientOutput.innerHTML = '<p class="placeholder">Te escucho... Suelta para terminar.</p>';
        
        // Timeout de seguridad: máximo 60 segundos
        recordingTimeout = setTimeout(() => {
            if (isRecording) {
                stopListening();
            }
        }, 60000);
    } catch (e) {
        console.error(e);
        clientOutput.innerHTML = '<p style="color:red">❌ Error al iniciar grabación: ' + e.message + '</p>';
        resetBtn();
    }
}

function stopListening() {
    if (!isRecording) return;
    resetBtn(); // Marcar como no-grabando ANTES de llamar stop()
    try {
        recognition.stop(); // El onend detectará isRecording=false y traducirá
    } catch (e) {
        console.error(e);
        finalizeListening(); // En caso de error, traducir igual
    }
}

// Eventos para PC
btnListen.addEventListener('mousedown', startListening);
btnListen.addEventListener('mouseup', stopListening);
btnListen.addEventListener('mouseleave', stopListening);

// Eventos para Móviles
btnListen.addEventListener('touchstart', (e) => {
    e.preventDefault(); // Evitar comportamientos extraños en móviles
    startListening();
}, { passive: false });

btnListen.addEventListener('touchend', (e) => {
    e.preventDefault();
    stopListening();
}, { passive: false });

if (recognition) {
    recognition.onresult = (event) => {
        // Tomar solo los nuevos resultados de esta sesión
        let newText = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
            if (event.results[i].isFinal) {
                newText += event.results[i][0].transcript + ' ';
            }
        }
        
        if (newText.trim()) {
            accumulatedText += newText;
        }
        
        const displayText = accumulatedText.trim();
        if (displayText) {
            clientOutput.innerHTML = `<p><strong>Mi voz:</strong> ${displayText}</p><p class="hint">🎤 Seguimos escuchando...</p>`;
        }
    };

    recognition.onerror = (event) => {
        // 'no-speech' es normal durante pausas, NO mostrar error ni detener
        if (event.error === 'no-speech') {
            return; // Ignorar silencio — el onend se encargará de reiniciar
        }
        
        let msg = "Error: " + event.error;
        
        if (event.error === 'not-allowed') {
            msg = "❌ Permiso de micrófono denegado.<br><br>" +
                "📱 <strong>Para habilitar:</strong><br>" +
                "Configuración → Aplicaciones → [Tu navegador] → Permisos → Micrófono → Activar";
        }
        if (event.error === 'network') {
            msg = "🔴 Error de red. Verifica tu conexión a Internet.";
        }
        if (event.error === 'bad-grammar') {
            msg = "⚠️ No entendí bien. Habla más claro, por favor.";
        }
        
        clientOutput.innerHTML = `<p style="color:red">${msg}</p>`;
        resetBtn();
    };

    recognition.onend = () => {
        // Si el usuario sigue presionando el botón, reiniciar automáticamente
        if (isRecording) {
            try {
                recognition.start(); // Reiniciar sin perder el texto acumulado
            } catch (e) {
                console.warn('No se pudo reiniciar el reconocimiento:', e);
                finalizeListening();
            }
        } else {
            // El usuario soltó el botón: traducir todo el texto acumulado
            finalizeListening();
        }
    };
}

// Traduce el texto acumulado al finalizar la escucha
async function finalizeListening() {
    const text = accumulatedText.trim();
    if (!text) {
        clientOutput.innerHTML = '<p class="hint">Toque abajo para escuchar...</p>';
        return;
    }
    
    clientOutput.innerHTML = `<p><strong>Mi voz:</strong> ${text}</p><p class="hint">Traduciendo...</p>`;
    
    try {
        const target = 'es';
        const source = clientLang.value.split('-')[0];
        const translated = await simpleTranslate(text, source, target);
        clientOutput.innerHTML = `<p><strong>Mi voz:</strong> ${text}</p><p style="color:#10b981"><strong>Trad:</strong> ${translated}</p>`;
    } catch (err) {
        clientOutput.innerHTML = `<p><strong>Mi voz:</strong> ${text}</p><p style="color:red">❌ Error al traducir.</p>`;
    }
    
    accumulatedText = '';
}

// --- RESPUESTA DEL STAFF ---

let timeout = null;
staffInput.oninput = () => {
    clearTimeout(timeout);
    timeout = setTimeout(async () => {
        const text = staffInput.value.trim();
        if (text.length < 2) {
            translationPreview.innerText = "";
            return;
        }
        
        try {
            const target = clientLang.value.split('-')[0];
            const translated = await simpleTranslate(text, 'es', target);
            translationPreview.innerText = translated;
        } catch (e) {
            translationPreview.innerText = "Error al traducir...";
        }
    }, 800);
};

btnSpeak.onclick = () => {
    const text = translationPreview.innerText;
    if (!text) return;

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = clientLang.value;
    
    const voices = synthesis.getVoices();
    const voice = voices.find(v => v.lang.startsWith(clientLang.value.split('-')[0]));
    if (voice) utterance.voice = voice;

    // Obtener la velocidad y aplicarla
    const speedSelect = document.getElementById('speech-speed');
    if (speedSelect) {
        utterance.rate = parseFloat(speedSelect.value);
    }

    synthesis.speak(utterance);
    
    btnSpeak.style.background = "#fff";
    btnSpeak.style.color = "#000";
    utterance.onend = () => {
        btnSpeak.style.background = "";
        btnSpeak.style.color = "";
    };
};

// --- TECLA ESPACIADORA PARA HABLAR ---
document.addEventListener('keydown', (e) => {
    if (e.code !== 'Space') return;

    const target = e.target;
    const tagName = target && target.tagName ? target.tagName.toLowerCase() : '';
    const isTypingField = tagName === 'input' || tagName === 'textarea' || (target && target.isContentEditable);
    if (isTypingField) return;

    if (translationPreview.innerText) {
        e.preventDefault();
        btnSpeak.click();
    }
});

async function simpleTranslate(text, from, to) {
    // Usando MyMemory API
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${from}|${to}`;
    const res = await fetch(url);
    const data = await res.json();
    return data.responseData.translatedText;
}

// --- RESPUESTAS RÁPIDAS ---

// Renderizar botones de respuestas rápidas
function renderQuickResponses() {
    const container = document.querySelector('.response-buttons');
    if (!container) return;
    
    container.innerHTML = '';
    responses.forEach(response => {
        const btn = document.createElement('button');
        btn.className = 'btn-quick';
        btn.textContent = response;
        btn.addEventListener('click', async () => {
            staffInput.value = response;
            
            // Obtener idioma actual del cliente
            const lang = clientLang.value.split('-')[0];
            
            // Verificar si ya existe traducción guardada
            if (responseTranslations[response] && responseTranslations[response][lang]) {
                translationPreview.innerText = responseTranslations[response][lang];
            } else {
                // Si no existe, hacer la traducción y guardarla
                try {
                    translationPreview.innerText = "Traduciendo...";
                    const translated = await simpleTranslate(response, 'es', lang);
                    
                    // Guardar traducción
                    if (!responseTranslations[response]) {
                        responseTranslations[response] = {};
                    }
                    responseTranslations[response][lang] = translated;
                    localStorage.setItem('responseTranslations', JSON.stringify(responseTranslations));
                    
                    translationPreview.innerText = translated;
                } catch (e) {
                    translationPreview.innerText = "Error al traducir...";
                }
            }
        });
        container.appendChild(btn);
    });
}

// Renderizar lista de respuestas en el modal
function renderResponsesList() {
    responsesList.innerHTML = '';
    responses.forEach((response, index) => {
        const item = document.createElement('div');
        item.className = 'response-item';
        item.innerHTML = `
            <input type="text" class="response-input" value="${response}" data-index="${index}" maxlength="50">
            <button class="btn-delete" data-index="${index}">🗑️</button>
        `;
        responsesList.appendChild(item);
    });
    
    // Agregar eventos para guardar cambios
    document.querySelectorAll('.response-input').forEach(input => {
        input.addEventListener('change', (e) => {
            const index = parseInt(e.target.getAttribute('data-index'));
            const oldText = responses[index];
            const newText = e.target.value.trim();
            if (newText) {
                responses[index] = newText;
                // Limpiar traducciones del texto anterior si cambió
                if (oldText !== newText && responseTranslations[oldText]) {
                    delete responseTranslations[oldText];
                }
                localStorage.setItem('responses', JSON.stringify(responses));
                localStorage.setItem('responseTranslations', JSON.stringify(responseTranslations));
                renderQuickResponses();
            }
        });
    });
    
    // Agregar eventos de eliminar
    document.querySelectorAll('.btn-delete').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const index = parseInt(e.target.getAttribute('data-index'));
            const responseToDelete = responses[index];
            responses.splice(index, 1);
            // Limpiar traducciones guardadas de esta respuesta
            if (responseTranslations[responseToDelete]) {
                delete responseTranslations[responseToDelete];
            }
            localStorage.setItem('responses', JSON.stringify(responses));
            localStorage.setItem('responseTranslations', JSON.stringify(responseTranslations));
            renderResponsesList();
            renderQuickResponses();
        });
    });
}

// Abrir modal
btnEditResponses.addEventListener('click', () => {
    editModal.classList.remove('hidden');
    renderResponsesList();
});

// Cerrar modal
btnCloseModal.addEventListener('click', () => {
    editModal.classList.add('hidden');
});

// Agregar nueva respuesta
btnAddResponse.addEventListener('click', () => {
    const newResponse = newResponseInput.value.trim();
    if (newResponse && responses.length < 12) {
        responses.push(newResponse);
        // Inicializar objeto de traducciones para esta respuesta
        if (!responseTranslations[newResponse]) {
            responseTranslations[newResponse] = {};
        }
        localStorage.setItem('responses', JSON.stringify(responses));
        localStorage.setItem('responseTranslations', JSON.stringify(responseTranslations));
        newResponseInput.value = '';
        renderResponsesList();
        renderQuickResponses();
    }
});

// Cerrar modal al hacer click fuera
editModal.addEventListener('click', (e) => {
    if (e.target === editModal) {
        editModal.classList.add('hidden');
    }
});

// Inicializar botones rápidos
renderQuickResponses();

// Cargar voces
synthesis.onvoiceschanged = () => { console.log("Voces listas"); };
