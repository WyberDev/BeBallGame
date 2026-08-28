// ==========================================
// MÓDULO DE RED Y SINCRONIZACIÓN
// ==========================================

const CHANNEL_NAME = 'beball_network_channel';
export const localNetwork = new BroadcastChannel(CHANNEL_NAME);

/**
 * Genera un jugador con un ID único por instancia/pestaña
 */
export function createPlayer(nick, team, isAdmin = false) {
    const uniqueId = 'player_' + Math.random().toString(36).substring(2, 9) + '_' + Date.now();
    
    return {
        id: uniqueId,
        nick: nick,
        team: team,
        isAdmin: isAdmin,
        avatar: '',
        x: 500,
        y: 250,
        vx: 0,
        vy: 0,
        radius: 15,
        speed: 0.1,
        friction: 0.99,
        mass: 2,
        displayX: 500,
        displayY: 250,
        isKicking: false
    };
}

/**
 * Emite un evento a todas las demás pestañas conectadas
 */
export function broadcastEvent(type, payload = null) {
    localNetwork.postMessage({ type, payload });
}

/**
 * Emite la salida de un jugador de la sala
 */
export function leaveRoom(roomId, playerId) {
    broadcastEvent('PLAYER_LEFT', { roomId, playerId });
}

/**
 * Configura la salida automática al cerrar la pestaña o recargar
 */
export function setupAutoLeaveOnUnload(getCurrentRoomId, getCurrentPlayerId) {
    window.addEventListener('beforeunload', () => {
        const roomId = getCurrentRoomId();
        const playerId = getCurrentPlayerId();
        if (roomId && playerId) {
            leaveRoom(roomId, playerId);
        }
    });
}

/**
 * Inicializa los oyentes del canal de red
 */
export function initNetworkListeners(handlers = {}) {
    localNetwork.onmessage = (event) => {
        const { type, payload } = event.data;

        switch (type) {
            case 'REQUEST_ROOMS':
                if (handlers.onRoomsRequested) handlers.onRoomsRequested(payload);
                break;
            case 'SYNC_ROOMS':
                if (handlers.onRoomsSynced) handlers.onRoomsSynced(payload);
                break;
            case 'ROOM_CREATED':
                if (handlers.onRoomCreated) handlers.onRoomCreated(payload);
                break;
            case 'PLAYER_JOINED':
                if (handlers.onPlayerJoined) handlers.onPlayerJoined(payload);
                break;
            case 'PLAYER_LEFT':
                if (handlers.onPlayerLeft) handlers.onPlayerLeft(payload);
                break;
            case 'SYNC_PLAYER_STATE':
                if (handlers.onPlayerStateSynced) handlers.onPlayerStateSynced(payload);
                break;
            case 'PLAYER_MOVED':
                if (handlers.onPlayerMoved) handlers.onPlayerMoved(payload);
                break;
            case 'TEAM_CHANGED':
                if (handlers.onTeamChanged) handlers.onTeamChanged(payload);
                break;
            case 'BALL_MOVED':
                if (handlers.onBallMoved) handlers.onBallMoved(payload);
                break;
            case 'SCORE_UPDATED':
                if (handlers.onScoreUpdated) handlers.onScoreUpdated(payload);
                break;
            case 'PING':
                broadcastEvent('PONG', payload);
                break;
            case 'PONG':
                if (handlers.onPongReceived) handlers.onPongReceived(payload);
                break;
            default:
                break;
        }
    };
}