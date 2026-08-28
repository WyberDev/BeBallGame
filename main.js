import { localNetwork, createPlayer, broadcastEvent, initNetworkListeners } from './network.js';

// ==========================================
// 0. PERSISTENCIA DE PREFERENCIAS (LOCALSTORAGE)
// ==========================================
const STORAGE_KEYS = {
    NICK: 'beball_player_nick',
    EXTRAPOLATION: 'beball_extrapolation_ms'
};

function loadSavedPreferences() {
    const savedNick = localStorage.getItem(STORAGE_KEYS.NICK) || "Jugador";
    const savedExtrapolation = localStorage.getItem(STORAGE_KEYS.EXTRAPOLATION);
    
    return {
        nick: savedNick,
        extrapolationMs: savedExtrapolation !== null ? parseInt(savedExtrapolation, 10) : 0
    };
}

function saveNick(nick) {
    if (nick && nick.trim() !== '') {
        localStorage.setItem(STORAGE_KEYS.NICK, nick.trim());
    }
}

function saveExtrapolation(ms) {
    localStorage.setItem(STORAGE_KEYS.EXTRAPOLATION, ms);
}

// Carga inicial de preferencias
const initialPrefs = loadSavedPreferences();

// ==========================================
// 1. SELECCIÓN DE ELEMENTOS DEL DOM
// ==========================================
let nickMenu = document.getElementById('nick-menu');
let salasMenu = document.getElementById('salas-menu');
let gameContainer = document.getElementById('game-container');

let inputNick = document.getElementById('input-nick');
let btnAceptar = document.getElementById('btn-aceptar');
let btnTestCanvas = document.getElementById('btn-test-canvas');
let btnChangeNick = document.getElementById('btn-cambiar-nick');
let btnSalirJuego = document.getElementById('btn-salir-juego');

// Modal Creador de Salas
let modalCrearSala = document.getElementById('modal-crear-sala');
let btnAbrirCrearSala = document.getElementById('btn-abrir-crear-sala');
let btnCerrarCrearSala = document.getElementById('btn-cerrar-crear-sala');
let btnConfirmarCrearSala = document.getElementById('btn-confirmar-crear-sala');
let inputNombreSala = document.getElementById('nombre-sala-input');
let selectMaxJugadores = document.getElementById('max-jugadores-select');

// Elementos de Contraseña
let chkUsarPass = document.getElementById('chk-usar-pass');
let groupPassInput = document.getElementById('group-pass-input');
let salaPassInput = document.getElementById('sala-pass-input');

// Controles In-Game y Modal
let btnToggleInGameMenu = document.getElementById('btn-toggle-in-game-menu');
let inGameModal = document.getElementById('in-game-modal');
let btnCloseModal = document.getElementById('btn-close-modal');
let btnJoinBlue = document.getElementById('btn-join-blue');
let btnJoinRed = document.getElementById('btn-join-red');
let btnJoinSpec = document.getElementById('btn-join-spec');

// Elementos de Pausa y Admin
let pauseOverlay = document.getElementById('pause-overlay');
let pauseTitle = document.getElementById('pause-title');
let countdownTimer = document.getElementById('countdown-timer');
let adminPanel = document.getElementById('admin-panel');
let btnTogglePause = document.getElementById('btn-toggle-pause');
let playersAdminList = document.getElementById('players-admin-list');

let canvas = document.getElementById('gameCanvas');
let ctx = canvas ? canvas.getContext('2d') : null;

let chatContainer = document.getElementById('chat-container');
let chatMessages = document.getElementById('chat-messages');
let chatForm = document.getElementById('chat-form');
let chatInput = document.getElementById('chat-input');

if (canvas) {
    canvas.width = 1000;
    canvas.height = 500;
}

// ==========================================
// 2. ESTADO DEL JUEGO Y MARCADOR
// ==========================================
let gameRunning = false;
let animationFrameId;
let currentUserNick = initialPrefs.nick;
let currentRoom = null;
let availableRooms = []; 
let isChatFocused = false;
let extrapolationMs = initialPrefs.extrapolationMs;

let currentPing = 0;
let lastPingTimestamp = 0;

let scoreRed = 0;
let scoreBlue = 0;

let isPaused = false;
let isUnpausing = false;
let unpauseCountdown = 1.5;
let unpauseInterval = null;

const baseWidth = canvas ? canvas.width : 1000;
const baseHeight = canvas ? canvas.height : 500;

const TEAM_COLORS = {
    BLUE: '#14c2f3',
    RED: '#e74c3c',
    SPEC: null
};

const GOAL_CONFIG = {
    height: 150,     
    depth: 45,       
    offset: 50,      
    postRadius: 7    
};

let roomPlayers = [];
let localPlayerId = null;

const ZOOM_LEVELS = {
    1: 1.0,   
    2: 1.15,  
    3: 1.30,  
    4: 1.35,  
    5: 2.45,  
    6: 2.50,  
    7: 2.60   
};
let currentZoomKey = 1;
let cameraScale = ZOOM_LEVELS[currentZoomKey];

const ball = {
    x: baseWidth / 2,
    y: baseHeight / 2,
    radius: 11,
    color: '#ffffff',
    vx: 0,
    vy: 0,
    friction: 0.985,
    mass: 1
};

let displayBall = { x: ball.x, y: ball.y };
const keys = {};

// Medición periódica del Ping
setInterval(() => {
    if (gameRunning) {
        lastPingTimestamp = performance.now();
        broadcastEvent('PING', { senderId: localPlayerId, timestamp: lastPingTimestamp });
    }
}, 1000);

// ==========================================
// 3. LISTENERS DE RED
// ==========================================
initNetworkListeners({
    onRoomsRequested: () => {
        if (availableRooms.length > 0) {
            broadcastEvent('SYNC_ROOMS', availableRooms);
        }
    },
    onRoomsSynced: (salasActualizadas) => {
        availableRooms = salasActualizadas;
        renderSalasMenu();
    },
    onRoomCreated: (nuevaSala) => {
        if (!availableRooms.some(r => r.id === nuevaSala.id)) {
            availableRooms.push(nuevaSala);
            renderSalasMenu();
        }
    },
    onPlayerJoined: (nuevoJugador) => {
        if (!roomPlayers.some(p => p.id === nuevoJugador.id)) {
            roomPlayers.push(nuevoJugador);
            appendChatMessage("Sistema", `${nuevoJugador.nick} ingresó a la sala.`, true);
            
            if (currentRoom) {
                const s = availableRooms.find(r => r.id === currentRoom.id);
                if (s) {
                    s.jugadores = roomPlayers.length;
                    broadcastEvent('SYNC_ROOMS', availableRooms);
                }
            }
            renderAdminPanel();
        }

        const localP = roomPlayers.find(p => p.id === localPlayerId);
        if (localP && localP.id !== nuevoJugador.id) {
            broadcastEvent('SYNC_PLAYER_STATE', localP);
        }
    },
    onPlayerLeft: (data) => {
        const index = roomPlayers.findIndex(p => p.id === data.id);
        if (index !== -1) {
            const p = roomPlayers[index];
            roomPlayers.splice(index, 1);
            appendChatMessage("Sistema", `${p.nick} salió de la sala.`, true);

            if (data.roomId) {
                const sIndex = availableRooms.findIndex(r => r.id === data.roomId);
                if (sIndex !== -1) {
                    availableRooms[sIndex].jugadores--;
                    if (availableRooms[sIndex].jugadores <= 0) {
                        availableRooms.splice(sIndex, 1);
                    }
                    broadcastEvent('SYNC_ROOMS', availableRooms);
                    renderSalasMenu();
                }
            }
            renderAdminPanel();
        }
    },
    onPlayerStateSynced: (jugadorExistente) => {
        if (!roomPlayers.some(p => p.id === jugadorExistente.id)) {
            roomPlayers.push(jugadorExistente);
            renderAdminPanel();
        }
    },
    onPlayerMoved: (data) => {
        if (data.id === localPlayerId) return;

        const p = roomPlayers.find(player => player.id === data.id);
        if (p) {
            p.x = data.x;
            p.y = data.y;
            p.vx = data.vx;
            p.vy = data.vy;
            p.isKicking = data.isKicking;
        }
    },
    onTeamChanged: (data) => {
        setPlayerTeamLocal(data.id, data.team);
    },
    onBallMoved: (data) => {
        const localP = roomPlayers.find(p => p.id === localPlayerId);
        if (localP && localP.isAdmin) return;

        ball.x = data.x;
        ball.y = data.y;
        ball.vx = data.vx;
        ball.vy = data.vy;
    },
    onScoreUpdated: (scores) => {
        scoreRed = scores.red;
        scoreBlue = scores.blue;
    },
    onPongReceived: (data) => {
        if (data.senderId === localPlayerId) {
            currentPing = Math.round(performance.now() - data.timestamp);
        }
    }
});

window.addEventListener('beforeunload', () => {
    if (currentRoom && localPlayerId) {
        broadcastEvent('PLAYER_LEFT', { id: localPlayerId, roomId: currentRoom.id });
    }
});

// ==========================================
// 4. EVENTOS DE TECLADO Y NAVEGACIÓN
// ==========================================
window.addEventListener('keydown', (e) => {
    const key = e.key.toLowerCase();

    if (e.key === 'Escape' && gameRunning) {
        e.preventDefault();
        toggleInGameMenu();
        return;
    }

    if (gameRunning && e.key === 'Enter' && !isChatFocused) {
        e.preventDefault();
        const currentChatInput = document.getElementById('chat-input') || chatInput;
        if (currentChatInput) currentChatInput.focus();
        return;
    }

    if (isChatFocused) return;

    if (gameRunning && e.key >= '1' && e.key <= '7') {
        const level = parseInt(e.key);
        if (ZOOM_LEVELS[level]) {
            currentZoomKey = level;
            cameraScale = ZOOM_LEVELS[level];
        }
        return;
    }

    if (e.code === 'Space' || key === 'x' || e.code === 'ControlRight') {
        keys['kick'] = true;
    }

    keys[key] = true;
});

window.addEventListener('keyup', (e) => {
    const key = e.key.toLowerCase();

    if (e.code === 'Space' || key === 'x' || e.code === 'ControlRight') {
        keys['kick'] = false;
    }

    if (isChatFocused) return;
    keys[key] = false;
});

if (chkUsarPass && groupPassInput) {
    chkUsarPass.addEventListener('change', () => {
        if (chkUsarPass.checked) {
            groupPassInput.classList.remove('oculto');
            if (salaPassInput) salaPassInput.focus();
        } else {
            groupPassInput.classList.add('oculto');
            if (salaPassInput) salaPassInput.value = '';
        }
    });
}

export function ingresarMenuSalas() {
    const inputEl = document.getElementById('input-nick');
    const nick = inputEl ? inputEl.value.trim() : "";

    if (!nick) {
        alert("Ingresá un nickname válido.");
        return;
    }

    currentUserNick = nick;
    saveNick(currentUserNick);

    const nickMenuEl = document.getElementById('nick-menu');
    const salasMenuEl = document.getElementById('salas-menu');

    if (nickMenuEl) nickMenuEl.classList.add('oculto');
    if (salasMenuEl) salasMenuEl.classList.remove('oculto');

    renderSalasMenu();
    broadcastEvent('REQUEST_ROOMS');
}

function renderSalasMenu() {
    const listaSalas = document.getElementById('lista-salas');
    if (!listaSalas) return;

    listaSalas.innerHTML = '';

    if (availableRooms.length === 0) {
        listaSalas.innerHTML = `
            <div class="no-rooms-box">
                <p class="no-rooms">No hay salas disponibles por el momento.</p>
            </div>
        `;
        return;
    }

    availableRooms.forEach(sala => {
        const item = document.createElement('div');
        item.className = 'room-item';
        item.innerHTML = `
            <div class="room-info">
                <span class="room-title">${escapeHTML(sala.nombre)} ${sala.password ? '🔒' : ''}</span>
                <span class="room-details">${sala.jugadores}/${sala.maxJugadores} Jugadores | Host: ${escapeHTML(sala.host)}</span>
            </div>
            <button class="btn-primary" onclick="unirseASala(${sala.id})">Unirse</button>
        `;
        listaSalas.appendChild(item);
    });
}

export function unirseASala(id) {
    const sala = availableRooms.find(r => r.id === id);
    if (!sala) return;

    if (sala.password) {
        const inputPass = prompt("Esta sala es privada. Ingresá la contraseña:");
        if (inputPass === null) return;
        if (inputPass !== sala.password) {
            alert("Contraseña incorrecta.");
            return;
        }
    }

    desconectarDeSala();

    currentRoom = sala;
    
    const nuevoJugador = createPlayer(currentUserNick, 'BLUE', false);
    localPlayerId = nuevoJugador.id;
    roomPlayers = [nuevoJugador];

    broadcastEvent('PLAYER_JOINED', nuevoJugador);

    iniciarPartidaLocal(false);
}

if (btnChangeNick) {
    btnChangeNick.addEventListener('click', () => {
        const nickMenuEl = document.getElementById('nick-menu');
        const salasMenuEl = document.getElementById('salas-menu');
        if (salasMenuEl) salasMenuEl.classList.add('oculto');
        if (nickMenuEl) nickMenuEl.classList.remove('oculto');
    });
}

if (btnAbrirCrearSala) {
    btnAbrirCrearSala.addEventListener('click', () => {
        if (modalCrearSala) modalCrearSala.classList.remove('oculto');
    });
}

if (btnCerrarCrearSala) {
    btnCerrarCrearSala.addEventListener('click', () => {
        if (modalCrearSala) modalCrearSala.classList.add('oculto');
    });
}

if (btnConfirmarCrearSala) {
    btnConfirmarCrearSala.addEventListener('click', () => {
        const nombreSala = inputNombreSala ? inputNombreSala.value.trim() : '';
        const maxJugadores = selectMaxJugadores ? parseInt(selectMaxJugadores.value) : 10;
        const tienePass = chkUsarPass ? chkUsarPass.checked : false;
        const password = tienePass && salaPassInput ? salaPassInput.value.trim() : null;

        if (!nombreSala) return alert('Por favor, ingresá un nombre para la sala.');
        if (tienePass && !password) return alert('Activaste la opción de contraseña, ingresá una clave.');

        desconectarDeSala();

        const nuevaSala = {
            id: Date.now(),
            nombre: nombreSala,
            jugadores: 1,
            maxJugadores: maxJugadores,
            host: currentUserNick,
            password: password
        };

        availableRooms.push(nuevaSala);
        currentRoom = nuevaSala;

        broadcastEvent('ROOM_CREATED', nuevaSala);

        const hostPlayer = createPlayer(currentUserNick, 'BLUE', true);
        localPlayerId = hostPlayer.id;
        roomPlayers = [hostPlayer];

        if (modalCrearSala) modalCrearSala.classList.add('oculto');
        if (inputNombreSala) inputNombreSala.value = '';
        if (salaPassInput) salaPassInput.value = '';
        if (chkUsarPass) chkUsarPass.checked = false;
        if (groupPassInput) groupPassInput.classList.add('oculto');

        iniciarPartidaLocal(false);
    });
}

if (btnTestCanvas) {
    btnTestCanvas.addEventListener('click', () => {
        desconectarDeSala();

        currentRoom = {
            id: 0,
            nombre: "Sala de Prueba",
            jugadores: 1,
            maxJugadores: 10,
            host: currentUserNick,
            password: null
        };
        const localP = createPlayer(currentUserNick, 'BLUE', true);
        localPlayerId = localP.id;
        iniciarPartidaLocal(true);
    });
}

function desconectarDeSala() {
    if (currentRoom && localPlayerId) {
        broadcastEvent('PLAYER_LEFT', { id: localPlayerId, roomId: currentRoom.id });
    }
    roomPlayers = [];
    localPlayerId = null;
    currentRoom = null;
}

function iniciarPartidaLocal(isTestMode = false) {
    const nickMenuEl = document.getElementById('nick-menu');
    const salasMenuEl = document.getElementById('salas-menu');
    const gameContainerEl = document.getElementById('game-container');
    const inGameModalEl = document.getElementById('in-game-modal');

    if (salasMenuEl) salasMenuEl.classList.add('oculto');
    if (nickMenuEl) nickMenuEl.classList.add('oculto');
    if (gameContainerEl) gameContainerEl.classList.remove('oculto');
    if (inGameModalEl) inGameModalEl.classList.add('oculto');

    scoreRed = 0;
    scoreBlue = 0;

    if (isTestMode) {
        const localP = createPlayer(currentUserNick, 'BLUE', true);
        localPlayerId = localP.id;
        roomPlayers = [
            localP,
            { id: 'bot_99', nick: "Bot_Rojo", team: 'RED', isAdmin: false, avatar: '2', x: canvas.width / 2 + 200, y: canvas.height / 2, vx: 0, vy: 0, radius: 15, speed: 0.1, friction: 0.99, mass: 2, displayX: canvas.width / 2 + 200, displayY: canvas.height / 2, isKicking: false }
        ];
    }

    resetMatch();
    renderAdminPanel();

    if (chatMessages) chatMessages.innerHTML = '';
    appendChatMessage("Sistema", `Bienvenido a la sala "${currentRoom ? currentRoom.nombre : 'Partida'}"`, true);

    gameRunning = true;
    gameLoop();
}

if (btnSalirJuego) {
    btnSalirJuego.addEventListener('click', () => {
        gameRunning = false;
        cancelAnimationFrame(animationFrameId);
        if (unpauseInterval) clearInterval(unpauseInterval);

        desconectarDeSala();

        const gameContainerEl = document.getElementById('game-container');
        const salasMenuEl = document.getElementById('salas-menu');
        if (gameContainerEl) gameContainerEl.classList.add('oculto');
        if (salasMenuEl) salasMenuEl.classList.remove('oculto');

        renderSalasMenu();
    });
}

function toggleInGameMenu() {
    if (!inGameModal) return;
    inGameModal.classList.toggle('oculto');
    if (!inGameModal.classList.contains('oculto')) renderAdminPanel();
}

if (btnToggleInGameMenu) btnToggleInGameMenu.addEventListener('click', toggleInGameMenu);
if (btnCloseModal) btnCloseModal.addEventListener('click', () => inGameModal.classList.add('oculto'));

if (btnJoinBlue) btnJoinBlue.addEventListener('click', () => setPlayerTeam(localPlayerId, 'BLUE'));
if (btnJoinRed) btnJoinRed.addEventListener('click', () => setPlayerTeam(localPlayerId, 'RED'));
if (btnJoinSpec) btnJoinSpec.addEventListener('click', () => setPlayerTeam(localPlayerId, 'SPEC'));

function setPlayerTeamLocal(playerId, teamName) {
    const p = roomPlayers.find(player => player.id === playerId);
    if (!p) return;

    p.team = teamName;
    
    if (teamName === 'BLUE') {
        p.x = canvas.width / 2 - 220;
        p.y = canvas.height / 2;
    } else if (teamName === 'RED') {
        p.x = canvas.width / 2 + 220;
        p.y = canvas.height / 2;
    }
    p.vx = 0;
    p.vy = 0;
    p.displayX = p.x;
    p.displayY = p.y;

    const teamLabel = teamName === 'BLUE' ? 'Equipo Azul' : teamName === 'RED' ? 'Equipo Rojo' : 'Espectadores';
    appendChatMessage("Sistema", `${p.nick} se unió a ${teamLabel}`, true);
    renderAdminPanel();
}

export function setPlayerTeam(playerId, teamName) {
    setPlayerTeamLocal(playerId, teamName);
    broadcastEvent('TEAM_CHANGED', { id: playerId, team: teamName });
}

function resetMatch() {
    isPaused = false;
    isUnpausing = false;
    if (pauseOverlay) pauseOverlay.classList.add('oculto');
    ball.x = canvas.width / 2;
    ball.y = canvas.height / 2;
    ball.vx = 0;
    ball.vy = 0;
    displayBall.x = ball.x;
    displayBall.y = ball.y;

    roomPlayers.forEach(p => {
        if (p.team === 'BLUE') {
            p.x = canvas.width / 2 - 220;
            p.y = canvas.height / 2;
        } else if (p.team === 'RED') {
            p.x = canvas.width / 2 + 220;
            p.y = canvas.height / 2;
        }
        p.vx = 0;
        p.vy = 0;
        p.displayX = p.x;
        p.displayY = p.y;
    });
}

// ==========================================
// 5. PAUSA Y ADMIN
// ==========================================
if (btnTogglePause) {
    btnTogglePause.addEventListener('click', () => {
        const localP = roomPlayers.find(p => p.id === localPlayerId);
        if (!localP || !localP.isAdmin) return;

        if (isUnpausing) return;

        if (!isPaused) {
            isPaused = true;
            if (pauseTitle) pauseTitle.textContent = "JUEGO EN PAUSA";
            if (countdownTimer) countdownTimer.classList.add('oculto');
            if (pauseOverlay) pauseOverlay.classList.remove('oculto');
            btnTogglePause.textContent = "Reanudar Juego";
            appendChatMessage("Sistema", "El Administrador pausó el juego.", true);
        } else {
            isUnpausing = true;
            if (pauseTitle) pauseTitle.textContent = "REANUDANDO EN...";
            unpauseCountdown = 1.5;
            if (countdownTimer) {
                countdownTimer.textContent = unpauseCountdown.toFixed(1);
                countdownTimer.classList.remove('oculto');
            }

            unpauseInterval = setInterval(() => {
                unpauseCountdown -= 0.1;
                if (unpauseCountdown <= 0) {
                    clearInterval(unpauseInterval);
                    isPaused = false;
                    isUnpausing = false;
                    if (pauseOverlay) pauseOverlay.classList.add('oculto');
                    btnTogglePause.textContent = "Pausar Juego";
                    appendChatMessage("Sistema", "¡Juego Reanudado!", true);
                } else {
                    if (countdownTimer) countdownTimer.textContent = unpauseCountdown.toFixed(1);
                }
            }, 100);
        }
    });
}

function renderAdminPanel() {
    const localP = roomPlayers.find(p => p.id === localPlayerId);
    if (!localP || !localP.isAdmin) {
        if (adminPanel) adminPanel.classList.add('oculto');
        return;
    }
    if (adminPanel) adminPanel.classList.remove('oculto');
    if (playersAdminList) {
        playersAdminList.innerHTML = '';

        roomPlayers.forEach(p => {
            const row = document.createElement('div');
            row.className = 'player-row';
            row.innerHTML = `
                <div class="player-info">
                    <span>${escapeHTML(p.nick)}</span>
                    ${p.isAdmin ? '<span class="badge-admin">ADMIN</span>' : ''}
                </div>
                <div class="admin-actions">
                    <button class="btn-team-blue" onclick="setPlayerTeam('${p.id}', 'BLUE')">Azul</button>
                    <button class="btn-team-red" onclick="setPlayerTeam('${p.id}', 'RED')">Rojo</button>
                    <button class="btn-team-spec" onclick="setPlayerTeam('${p.id}', 'SPEC')">Espec</button>
                </div>
            `;
            playersAdminList.appendChild(row);
        });
    }
}

// ==========================================
// 6. CHAT Y COMANDOS
// ==========================================
if (chatInput) {
    chatInput.addEventListener('focus', () => { isChatFocused = true; });
    chatInput.addEventListener('blur', () => { isChatFocused = false; });
}

if (chatForm) {
    chatForm.addEventListener('submit', (e) => {
        e.preventDefault();
        if (!chatInput) return;
        const msg = chatInput.value.trim();
        if (msg !== "") {
            if (msg.startsWith('/extrapolation')) {
                const val = parseInt(msg.split(' ')[1]);
                if (!isNaN(val) && val >= 0 && val <= 300) {
                    extrapolationMs = val;
                    saveExtrapolation(extrapolationMs);
                    appendChatMessage("Sistema", `Extrapolación establecida en ${extrapolationMs} ms`, true);
                } else {
                    appendChatMessage("Sistema", "Uso: /extrapolation <0-300>", true);
                }
            } 
            else if (msg.startsWith('/avatar')) {
                const parts = msg.split(' ');
                const localP = roomPlayers.find(p => p.id === localPlayerId);

                if (parts.length === 1 || parts[1] === "") {
                    if (localP) localP.avatar = "";
                    appendChatMessage("Sistema", "Avatar limpiado.", true);
                } else {
                    const newAvatar = parts[1].slice(0, 2);
                    if (localP) localP.avatar = newAvatar;
                    appendChatMessage("Sistema", `Avatar cambiado a: "${newAvatar}"`, true);
                }
            } 
            else if (msg.startsWith('/zoom')) {
                const level = parseInt(msg.split(' ')[1]);
                if (!isNaN(level) && ZOOM_LEVELS[level]) {
                    currentZoomKey = level;
                    cameraScale = ZOOM_LEVELS[level];
                    const percent = Math.round(cameraScale * 100);
                    appendChatMessage("Sistema", `Zoom ajustado a nivel ${level} (${percent}%)`, true);
                } else {
                    appendChatMessage("Sistema", "Uso: /zoom <1-7>", true);
                }
            } 
            else {
                appendChatMessage(currentUserNick, msg);
            }
            chatInput.value = "";
        }
        chatInput.blur();
    });
}

function appendChatMessage(author, message, isSystem = false) {
    if (!chatMessages) return;
    const msgDiv = document.createElement('div');
    msgDiv.classList.add('chat-msg');
    if (isSystem) {
        msgDiv.classList.add('system');
        msgDiv.textContent = message;
    } else {
        msgDiv.innerHTML = `<span class="author">${escapeHTML(author)}:</span> ${escapeHTML(message)}`;
    }
    chatMessages.appendChild(msgDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

function escapeHTML(str) {
    return str.replace(/[&<>'"]/g, tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag));
}

// ==========================================
// 7. MOTOR DE FÍSICA Y RENDERIZADO
// ==========================================
function updatePhysics() {
    if (isPaused) return;

    const localP = roomPlayers.find(p => p.id === localPlayerId);
    const isHost = localP && localP.isAdmin;

    if (localP) {
        localP.isKicking = !!keys['kick'];

        if (localP.team !== 'SPEC') {
            if (keys['w'] || keys['arrowup']) localP.vy -= localP.speed;
            if (keys['s'] || keys['arrowdown']) localP.vy += localP.speed;
            if (keys['a'] || keys['arrowleft']) localP.vx -= localP.speed;
            if (keys['d'] || keys['arrowright']) localP.vx += localP.speed;

            const maxSpeed = 4.5;
            const currentSpeed = Math.sqrt(localP.vx * localP.vx + localP.vy * localP.vy);
            if (currentSpeed > maxSpeed) {
                localP.vx = (localP.vx / currentSpeed) * maxSpeed;
                localP.vy = (localP.vy / currentSpeed) * maxSpeed;
            }

            broadcastEvent('PLAYER_MOVED', {
                id: localP.id,
                x: localP.x,
                y: localP.y,
                vx: localP.vx,
                vy: localP.vy,
                isKicking: localP.isKicking
            });
        }
    }

    roomPlayers.forEach(p => {
        if (p.team === 'SPEC') return;

        p.vx *= p.friction;
        p.vy *= p.friction;
        p.x += p.vx;
        p.y += p.vy;

        if (p.x - p.radius < 0) { p.x = p.radius; p.vx = -p.vx * 0.5; }
        if (p.x + p.radius > canvas.width) { p.x = canvas.width - p.radius; p.vx = -p.vx * 0.5; }
        if (p.y - p.radius < 0) { p.y = p.radius; p.vy = -p.vy * 0.5; }
        if (p.y + p.radius > canvas.height) { p.y = canvas.height - p.radius; p.vx = -p.vx * 0.5; }
    });

    for (let i = 0; i < roomPlayers.length; i++) {
        const p1 = roomPlayers[i];
        if (p1.team === 'SPEC') continue;

        for (let j = i + 1; j < roomPlayers.length; j++) {
            const p2 = roomPlayers[j];
            if (p2.team === 'SPEC') continue;

            let dx = p2.x - p1.x;
            let dy = p2.y - p1.y;
            let distance = Math.sqrt(dx * dx + dy * dy);
            let minDistance = p1.radius + p2.radius;

            if (distance < minDistance) {
                let nx = dx / (distance || 1);
                let ny = dy / (distance || 1);
                let overlap = minDistance - distance;

                p1.x -= nx * overlap * 0.5;
                p1.y -= ny * overlap * 0.5;
                p2.x += nx * overlap * 0.5;
                p2.y += ny * overlap * 0.5;

                let kx = p1.vx - p2.vx;
                let ky = p1.vy - p2.vy;
                let pImpulse = 2 * (nx * kx + ny * ky) / (p1.mass + p2.mass);

                p1.vx -= pImpulse * p2.mass * nx;
                p1.vy -= pImpulse * p2.mass * ny;
                p2.vx += pImpulse * p1.mass * nx;
                p2.vy += pImpulse * p1.mass * ny;
            }
        }
    }

    roomPlayers.forEach(p => {
        if (p.team === 'SPEC') return;

        let dx = ball.x - p.x;
        let dy = ball.y - p.y;
        let distance = Math.sqrt(dx * dx + dy * dy);

        let physicalDistance = p.radius + ball.radius; 
        let kickDistance = physicalDistance + 6; 

        let nx = dx / (distance || 1);
        let ny = dy / (distance || 1);

        if (p.isKicking && distance <= kickDistance) {
            const kickPower = 5.5; 
            ball.vx = p.vx * 0.4 + nx * kickPower;
            ball.vy = p.vy * 0.4 + ny * kickPower;
            ball.x = p.x + nx * (physicalDistance + 2);
            ball.y = p.y + ny * (physicalDistance + 2);
        }
        else if (distance < physicalDistance) {
            let overlap = physicalDistance - distance;

            p.x -= nx * overlap * 0.2;
            p.y -= ny * overlap * 0.2;
            ball.x += nx * overlap * 0.8;
            ball.y += ny * overlap * 0.8;

            let kickPower = 1.1; 
            ball.vx = p.vx * 0.5 + nx * kickPower;
            ball.vy = p.vy * 0.5 + ny * kickPower;
        }

        const extraFrames = extrapolationMs / 16.66;
        const targetX = p.x + (p.vx * extraFrames);
        const targetY = p.y + (p.vy * extraFrames);

        p.displayX += (targetX - p.displayX) * 0.5;
        p.displayY += (targetY - p.displayY) * 0.5;
    });

    // ==========================================
    // FÍSICA GLOBAL DE LA PELOTA (TODOS LOS CLIENTES)
    // ==========================================
    ball.vx *= ball.friction;
    ball.vy *= ball.friction;
    ball.x += ball.vx;
    ball.y += ball.vy;

    const leftGoalLine = GOAL_CONFIG.offset;
    const rightGoalLine = canvas.width - GOAL_CONFIG.offset;
    const goalTop = (canvas.height - GOAL_CONFIG.height) / 2;
    const goalBottom = (canvas.height + GOAL_CONFIG.height) / 2;

    if (ball.x < leftGoalLine - GOAL_CONFIG.depth + ball.radius) {
        ball.x = leftGoalLine - GOAL_CONFIG.depth + ball.radius;
        ball.vx = -ball.vx * 0.5;
    }
    if (ball.x > rightGoalLine + GOAL_CONFIG.depth - ball.radius) {
        ball.x = rightGoalLine + GOAL_CONFIG.depth - ball.radius;
        ball.vx = -ball.vx * 0.5;
    }

    if (ball.y - ball.radius < 0) { ball.y = ball.radius; ball.vy = -ball.vy * 0.8; }
    if (ball.y + ball.radius > canvas.height) { ball.y = canvas.height - ball.radius; ball.vy = -ball.vy * 0.8; }

    if (ball.y < goalTop || ball.y > goalBottom) {
        if (ball.x - ball.radius < leftGoalLine) { ball.x = leftGoalLine + ball.radius; ball.vx = -ball.vx * 0.8; }
        if (ball.x + ball.radius > rightGoalLine) { ball.x = rightGoalLine - ball.radius; ball.vx = -ball.vx * 0.8; }
    }

    const posts = [
        { x: leftGoalLine, y: goalTop },
        { x: leftGoalLine, y: goalBottom },
        { x: rightGoalLine, y: goalTop },
        { x: rightGoalLine, y: goalBottom }
    ];

    posts.forEach(post => {
        let pdx = ball.x - post.x;
        let pdy = ball.y - post.y;
        let pDist = Math.sqrt(pdx * pdx + pdy * pdy);
        let minDist = ball.radius + GOAL_CONFIG.postRadius;

        if (pDist < minDist) {
            let pnx = pdx / (pDist || 1);
            let pny = pdy / (pDist || 1);
            let overlap = minDist - pDist;

            ball.x += pnx * overlap;
            ball.y += pny * overlap;

            let dot = ball.vx * pnx + ball.vy * pny;
            ball.vx = (ball.vx - 2 * dot * pnx) * 0.8;
            ball.vy = (ball.vy - 2 * dot * pny) * 0.8;
        }
    });

    // ==========================================
    // LÓGICA EXCLUSIVA DEL HOST (DETECCIÓN DE GOLES Y BROADCAST)
    // ==========================================
    if (isHost) {
        if (ball.x + ball.radius < leftGoalLine && ball.y > goalTop && ball.y < goalBottom) {
            scoreRed++;
            broadcastEvent('SCORE_UPDATED', { red: scoreRed, blue: scoreBlue });
            appendChatMessage("Sistema", "¡GOL DEL EQUIPO ROJO! ⚽🔴", true);
            resetMatch();
            return;
        }

        if (ball.x - ball.radius > rightGoalLine && ball.y > goalTop && ball.y < goalBottom) {
            scoreBlue++;
            broadcastEvent('SCORE_UPDATED', { red: scoreRed, blue: scoreBlue });
            appendChatMessage("Sistema", "¡GOL DEL EQUIPO AZUL! ⚽🔵", true);
            resetMatch();
            return;
        }

        broadcastEvent('BALL_MOVED', {
            x: ball.x,
            y: ball.y,
            vx: ball.vx,
            vy: ball.vy
        });
    }

    const ballExtraFrames = extrapolationMs / 16.66;
    const targetBallX = ball.x + (ball.vx * ballExtraFrames);
    const targetBallY = ball.y + (ball.vy * ballExtraFrames);

    displayBall.x += (targetBallX - displayBall.x) * 0.5;
    displayBall.y += (targetBallY - displayBall.y) * 0.5;
}

function draw() {
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.save();

    const localPlayer = roomPlayers.find(p => p.id === localPlayerId && p.team !== 'SPEC');
    let targetX = localPlayer ? localPlayer.displayX : displayBall.x;
    let targetY = localPlayer ? localPlayer.displayY : displayBall.y;

    const halfViewWidth = (canvas.width / 2) / cameraScale;
    const halfViewHeight = (canvas.height / 2) / cameraScale;

    if (halfViewWidth < canvas.width / 2) {
        targetX = Math.max(halfViewWidth, Math.min(canvas.width - halfViewWidth, targetX));
    } else {
        targetX = canvas.width / 2;
    }

    if (halfViewHeight < canvas.height / 2) {
        targetY = Math.max(halfViewHeight, Math.min(canvas.height - halfViewHeight, targetY));
    } else {
        targetY = canvas.height / 2;
    }

    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.scale(cameraScale, cameraScale);
    ctx.translate(-targetX, -targetY);

    const leftGoalLine = GOAL_CONFIG.offset;
    const rightGoalLine = canvas.width - GOAL_CONFIG.offset;

    ctx.beginPath();
    ctx.setLineDash([10, 10]);
    ctx.moveTo(canvas.width / 2, 0);
    ctx.lineTo(canvas.width / 2, canvas.height);
    ctx.strokeStyle = "rgba(255, 255, 255, 0.4)";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.beginPath();
    ctx.arc(canvas.width / 2, canvas.height / 2, 85, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(255, 255, 255, 0.4)";
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.strokeStyle = "rgba(255, 255, 255, 0.4)";
    ctx.lineWidth = 2;
    
    ctx.beginPath();
    ctx.moveTo(leftGoalLine, 0);
    ctx.lineTo(leftGoalLine, canvas.height);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(rightGoalLine, 0);
    ctx.lineTo(rightGoalLine, canvas.height);
    ctx.stroke();

    const goalTop = (canvas.height - GOAL_CONFIG.height) / 2;

    ctx.fillStyle = "rgba(20, 194, 243, 0.35)";
    ctx.fillRect(leftGoalLine - GOAL_CONFIG.depth, goalTop, GOAL_CONFIG.depth, GOAL_CONFIG.height);
    
    ctx.strokeStyle = "rgba(255, 255, 255, 0.3)";
    ctx.lineWidth = 1;
    for (let x = leftGoalLine - GOAL_CONFIG.depth; x < leftGoalLine; x += 10) {
        ctx.beginPath(); ctx.moveTo(x, goalTop); ctx.lineTo(x, goalTop + GOAL_CONFIG.height); ctx.stroke();
    }
    for (let y = goalTop; y < goalTop + GOAL_CONFIG.height; y += 10) {
        ctx.beginPath(); ctx.moveTo(leftGoalLine - GOAL_CONFIG.depth, y); ctx.lineTo(leftGoalLine, y); ctx.stroke();
    }
    
    ctx.strokeStyle = TEAM_COLORS.BLUE;
    ctx.lineWidth = 3;
    ctx.strokeRect(leftGoalLine - GOAL_CONFIG.depth, goalTop, GOAL_CONFIG.depth, GOAL_CONFIG.height);

    ctx.fillStyle = "rgba(231, 76, 60, 0.35)";
    ctx.fillRect(rightGoalLine, goalTop, GOAL_CONFIG.depth, GOAL_CONFIG.height);

    ctx.strokeStyle = "rgba(255, 255, 255, 0.3)";
    ctx.lineWidth = 1;
    for (let x = rightGoalLine; x < rightGoalLine + GOAL_CONFIG.depth; x += 10) {
        ctx.beginPath(); ctx.moveTo(x, goalTop); ctx.lineTo(x, goalTop + GOAL_CONFIG.height); ctx.stroke();
    }
    for (let y = goalTop; y < goalTop + GOAL_CONFIG.height; y += 10) {
        ctx.beginPath(); ctx.moveTo(rightGoalLine, y); ctx.lineTo(rightGoalLine + GOAL_CONFIG.depth, y); ctx.stroke();
    }

    ctx.strokeStyle = TEAM_COLORS.RED;
    ctx.lineWidth = 3;
    ctx.strokeRect(rightGoalLine, goalTop, GOAL_CONFIG.depth, GOAL_CONFIG.height);

    const postsToDraw = [
        { x: leftGoalLine, y: goalTop },
        { x: leftGoalLine, y: goalTop + GOAL_CONFIG.height },
        { x: rightGoalLine, y: goalTop },
        { x: rightGoalLine, y: goalTop + GOAL_CONFIG.height }
    ];

    postsToDraw.forEach(p => {
        ctx.beginPath();
        ctx.arc(p.x, p.y, GOAL_CONFIG.postRadius, 0, Math.PI * 2);
        ctx.fillStyle = "#ffffff";
        ctx.fill();
        ctx.strokeStyle = "#111111";
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.closePath();
    });

    ctx.beginPath();
    ctx.arc(displayBall.x, displayBall.y, ball.radius, 0, Math.PI * 2);
    ctx.fillStyle = ball.color;
    ctx.fill();
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.closePath();

    roomPlayers.forEach(p => {
        if (p.team === 'SPEC') return;

        ctx.beginPath();
        ctx.arc(p.displayX, p.displayY, p.radius, 0, Math.PI * 2);
        ctx.fillStyle = TEAM_COLORS[p.team];
        ctx.fill();

        ctx.strokeStyle = p.isKicking ? '#ffffff' : '#a0a0a0';
        ctx.lineWidth = 3.5;
        ctx.stroke();
        ctx.closePath();

        if (p.avatar) {
            ctx.fillStyle = "#ffffff";
            ctx.font = "bold 11px RobotoMono, sans-serif";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(p.avatar, p.displayX, p.displayY);
        }

        ctx.fillStyle = "#ffffff";
        ctx.font = "11px RobotoMono";
        ctx.textAlign = "center";
        ctx.textBaseline = "alphabetic";
        ctx.fillText(p.nick, p.displayX, p.displayY - p.radius - 5);
    });

    ctx.restore();

    // HUD - MARCADOR Y PING
    ctx.font = "bold 26px RobotoMono, monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";

    ctx.fillStyle = TEAM_COLORS.BLUE;
    ctx.fillText(scoreBlue.toString(), canvas.width / 2 - 40, 15);

    ctx.fillStyle = "#ffffff";
    ctx.fillText("-", canvas.width / 2, 15);

    ctx.fillStyle = TEAM_COLORS.RED;
    ctx.fillText(scoreRed.toString(), canvas.width / 2 + 40, 15);

    ctx.fillStyle = currentPing > 100 ? '#e74c3c' : '#2ecc71';
    ctx.font = "bold 13px RobotoMono, monospace";
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillText(`PING: ${currentPing} ms`, 15, canvas.height - 15);
}

function gameLoop() {
    if (!gameRunning) return;
    updatePhysics();
    draw();
    animationFrameId = requestAnimationFrame(gameLoop);
}

// Globales para el HTML
window.ingresarMenuSalas = ingresarMenuSalas;
window.unirseASala = unirseASala;
window.setPlayerTeam = setPlayerTeam;

window.addEventListener('DOMContentLoaded', () => {
    const inputEl = document.getElementById('input-nick');
    if (inputEl) {
        inputEl.value = initialPrefs.nick;
    }

    const nickForm = document.getElementById('nick-form');
    if (nickForm) {
        nickForm.addEventListener('submit', (e) => {
            e.preventDefault();
            ingresarMenuSalas();
        });
    }
});