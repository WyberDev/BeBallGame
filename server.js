import { WebSocketServer } from 'ws';

const PORT = process.env.PORT || 8080;
const wss = new WebSocketServer({ port: PORT });

// Almacenar todos los clientes conectados
const clients = new Set();

console.clear();
console.log('===================================================');
console.log(`  ⚽ SERVIDOR CENTRAL DE BEBALL INICIADO (Puerto ${PORT})`);
console.log('  Esperando conexiones de jugadores...');
console.log('===================================================\n');

wss.on('connection', (ws, req) => {
    const clientIp = req.socket.remoteAddress || 'Desconocida';
    clients.add(ws);
    
    console.log(`[+] Jugador conectado desde IP: ${clientIp} | Total conectados: ${clients.size}`);

    // Manejo de mensajes entrantes (salas, chat, movimiento, posiciones)
    ws.on('message', (message) => {
        const payload = message.toString();
        
        // Output en consola sobre el tráfico de datos
        console.log(`[DATA] Mensaje recibido (${payload.length} bytes) -> Reenviando a ${clients.size - 1} clientes`);

        // Reenviar la información a todos los clientes excepto al emisor
        for (const client of clients) {
            if (client !== ws && client.readyState === 1) { // 1 = OPEN
                client.send(payload);
            }
        }
    });

    // Manejo de desconexión
    ws.on('close', () => {
        clients.delete(ws);
        console.log(`[-] Jugador desconectado | Total conectados: ${clients.size}`);
    });

    // Manejo de errores de red
    ws.on('error', (err) => {
        console.error(`[ERROR] Fallo de socket en cliente ${clientIp}:`, err.message);
    });
});