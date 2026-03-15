const WebSocket = require('ws');

// 1. Cấu hình Port động: Ưu tiên PORT của Render, nếu không có thì dùng 8080 (chạy local)
const PORT = process.env.PORT || 8080;

// 2. Khởi tạo server
const wss = new WebSocket.Server({ port: PORT }, () => {
    console.log(`🚀 Tank Game Server đang chạy tại Port: ${PORT}`);
});

// Lưu trữ cấu trúc: rooms['Mã_Phòng'] = { players: Map(ID -> { ws, team, isReady, isHost }) }
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
        if (p.ws.readyState === WebSocket.OPEN) {
            try {
                p.ws.send(packet);
            } catch (e) {
                console.error(`Lỗi gửi packet tới ${p.id}:`, e);
            }
        }
    });
}

wss.on('connection', function connection(ws) {
    // Cấp ID ngẫu nhiên cho người chơi
    ws.id = Math.random().toString(36).substring(2, 9); 
    ws.room = null;
    ws.isAlive = true; // Để kiểm tra kết nối còn sống không

    // Heartbeat: Khi nhận được 'pong', đánh dấu là vẫn còn sống
    ws.on('pong', () => { ws.isAlive = true; });

    // Báo cho client biết ID của họ
    ws.send(JSON.stringify({ type: 'your_id', id: ws.id }));

    ws.on('message', function incoming(message) {
        try {
            const data = JSON.parse(message);

            // Xử lý JOIN phòng
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
                
                // Tự động xếp team
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

            // Xử lý ĐỔI TEAM
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

            // Xử lý READY
            else if (data.type === 'toggle_ready') {
                if (ws.room && rooms[ws.room]) {
                    const p = rooms[ws.room].players.get(ws.id);
                    if (p && !p.isHost) {
                        p.isReady = !p.isReady;
                        broadcastLobby(ws.room);
                    }
                }
            }

            // Xử lý START GAME
            else if (data.type === 'start_game') {
                if (ws.room && rooms[ws.room]) {
                    const room = rooms[ws.room];
                    const p = room.players.get(ws.id);
                    if (p && p.isHost) {
                        let allReady = true;
                        room.players.forEach(player => { if (!player.isReady) allReady = false; });
                        
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

            // Forward dữ liệu In-game (move, shoot, hp...)
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
            console.error("Lỗi xử lý message:", e);
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
                    const playersArray = Array.from(rooms[ws.room].players.values());
                    if (playersArray.length > 0) {
                        playersArray[0].isHost = true;
                        playersArray[0].isReady = true;
                    }
                }
                broadcastLobby(ws.room);
            }
        }
    });
});

// 3. Cơ chế Heartbeat: Quét 30s/lần để dọn dẹp các kết nối "treo"
const interval = setInterval(() => {
    wss.clients.forEach((ws) => {
        if (ws.isAlive === false) return ws.terminate();
        ws.isAlive = false;
        ws.ping();
    });
}, 30000);

wss.on('close', () => {
    clearInterval(interval);
});
