const WebSocket = require('ws');
const http = require('http'); // Thêm thư viện web

// 1. Tạo một trang web "giả" để Render kiểm tra sức khỏe
const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Tank Server is running OK!\n');
});

// 2. Gắn WebSocket Server vào cái cổng web đó
const wss = new WebSocket.Server({ server });

const rooms = {}; 

function broadcastLobby(roomCode) {
    if (!rooms[roomCode]) return;
    const room = rooms[roomCode];
    const playersList = [];
    
    room.players.forEach((p, id) => {
        playersList.push({ id: id, team: p.team, isReady: p.isReady, isHost: p.isHost });
    });
    
    const packet = JSON.stringify({ type: 'lobby_update', players: playersList });
    room.players.forEach(p => {
        if (p.ws.readyState === WebSocket.OPEN) p.ws.send(packet);
    });
}

// Lắng nghe trên Port của Render
const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
    console.log(`WebSocket Server (Lobby 5v5 Mode) đang chạy trên port ${PORT}...`);
});

wss.on('connection', function connection(ws) {
    ws.id = Math.random().toString(36).substring(2, 9); 
    ws.room = null;

    ws.send(JSON.stringify({ type: 'your_id', id: ws.id }));

    ws.on('message', function incoming(message) {
        try {
            const data = JSON.parse(message);

            if (data.type === 'join') {
                const roomCode = data.room;
                ws.room = roomCode;

                if (!rooms[roomCode]) {
                    rooms[roomCode] = { players: new Map() };
                }
                
                const room = rooms[roomCode];
                
                if (room.players.size >= 10) {
                    ws.send(JSON.stringify({ type: 'error', msg: 'Phòng đã đầy (Max 10)!' }));
                    return;
                }

                const isHost = room.players.size === 0; 
                
                let redCount = 0, blueCount = 0;
                room.players.forEach(p => {
                    if (p.team === 'RED') redCount++;
                    else blueCount++;
                });
                const assignedTeam = redCount <= blueCount ? 'RED' : 'BLUE';

                room.players.set(ws.id, {
                    ws: ws,
                    team: assignedTeam,
                    isReady: isHost,
                    isHost: isHost
                });

                console.log(`[+] [${ws.id}] vào phòng ${roomCode} - Team ${assignedTeam}`);
                broadcastLobby(roomCode);
            } 
            else if (data.type === 'switch_team') {
                if (ws.room && rooms[ws.room]) {
                    const p = rooms[ws.room].players.get(ws.id);
                    if (p) {
                        let targetTeam = p.team === 'RED' ? 'BLUE' : 'RED';
                        let count = 0;
                        rooms[ws.room].players.forEach(player => { if (player.team === targetTeam) count++; });
                        
                        if (count < 5) {
                            p.team = targetTeam;
                            broadcastLobby(ws.room);
                        }
                    }
                }
            }
            else if (data.type === 'toggle_ready') {
                if (ws.room && rooms[ws.room]) {
                    const p = rooms[ws.room].players.get(ws.id);
                    if (p && !p.isHost) {
                        p.isReady = !p.isReady;
                        broadcastLobby(ws.room);
                    }
                }
            }
            else if (data.type === 'start_game') {
                if (ws.room && rooms[ws.room]) {
                    const room = rooms[ws.room];
                    const p = room.players.get(ws.id);
                    
                    if (p && p.isHost) {
                        let allReady = true;
                        room.players.forEach(player => {
                            if (!player.isReady) allReady = false;
                        });
                        
                        if (allReady) {
                            console.log(`[START] Phòng ${ws.room} bắt đầu game!`);
                            const startPacket = JSON.stringify({ type: 'start_game' });
                            room.players.forEach(player => {
                                if (player.ws.readyState === WebSocket.OPEN) player.ws.send(startPacket);
                            });
                        }
                    }
                }
            }
            else {
                if (ws.room && rooms[ws.room]) {
                    data.id = ws.id; 
                    const packet = JSON.stringify(data);
                    
                    rooms[ws.room].players.forEach((p, id) => {
                        if (id !== ws.id && p.ws.readyState === WebSocket.OPEN) {
                            p.ws.send(packet);
                        }
                    });
                }
            }
        } catch (e) {
            console.error("Lỗi:", e);
        }
    });

    ws.on('close', function close() {
        if (ws.room && rooms[ws.room]) {
            rooms[ws.room].players.delete(ws.id);
            console.log(`[-] [${ws.id}] thoát phòng ${ws.room}`);
            
            if (rooms[ws.room].players.size === 0) {
                delete rooms[ws.room];
                console.log(`[!] Xóa phòng trống: ${ws.room}`);
            } else {
                let hasHost = false;
                rooms[ws.room].players.forEach(p => { if (p.isHost) hasHost = true; });
                if (!hasHost) {
                    const firstPlayer = Array.from(rooms[ws.room].players.values())[0];
                    firstPlayer.isHost = true;
                    firstPlayer.isReady = true;
                }
                broadcastLobby(ws.room);
            }
        }
    });
});
