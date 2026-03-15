const WebSocket = require('ws');
const http = require('http');

/**
 * 1. KHỞI TẠO HTTP SERVER
 * Render cần một server HTTP để kiểm tra trạng thái (Health Check).
 * Chúng ta cũng thêm CORS Header ở đây để trình duyệt cho phép Vercel kết nối đến.
 */
const server = http.createServer((req, res) => {
    // Cho phép mọi nguồn (Origin) truy cập - Rất quan trọng để không bị lỗi CORS trên trình duyệt
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    // Phản hồi cho Render Health Check
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Tank Server (Bang Bang AI) is running OK!\n');
});

/**
 * 2. KHỞI TẠO WEBSOCKET SERVER
 */
const wss = new WebSocket.Server({ server });

const rooms = {}; 

/**
 * HÀM CẬP NHẬT TRẠNG THÁI PHÒNG (LOBBY)
 */
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

/**
 * 3. XỬ LÝ KẾT NỐI
 */
wss.on('connection', function connection(ws) {
    // Tạo ID ngẫu nhiên cho người chơi mới
    ws.id = Math.random().toString(36).substring(2, 9); 
    ws.room = null;

    // Gửi ID về cho Client ngay khi vừa kết nối
    ws.send(JSON.stringify({ type: 'your_id', id: ws.id }));

    ws.on('message', function incoming(message) {
        try {
            const data = JSON.parse(message);

            // LOGIC: VÀO PHÒNG
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
                
                // Tự động chia team cân bằng
                let redCount = 0, blueCount = 0;
                room.players.forEach(p => {
                    if (p.team === 'RED') redCount++;
                    else blueCount++;
                });
                const assignedTeam = redCount <= blueCount ? 'RED' : 'BLUE';

                room.players.set(ws.id, {
                    ws: ws,
                    team: assignedTeam,
                    isReady: isHost, // Host thì mặc định Ready
                    isHost: isHost
                });

                console.log(`[+] [${ws.id}] vào phòng ${roomCode} - Team ${assignedTeam}`);
                broadcastLobby(roomCode);
            } 
            
            // LOGIC: ĐỔI TEAM (Chỉ khi team đích còn chỗ < 5)
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

            // LOGIC: SẴN SÀNG (Dành cho người chơi không phải Host)
            else if (data.type === 'toggle_ready') {
                if (ws.room && rooms[ws.room]) {
                    const p = rooms[ws.room].players.get(ws.id);
                    if (p && !p.isHost) {
                        p.isReady = !p.isReady;
                        broadcastLobby(ws.room);
                    }
                }
            }

            // LOGIC: BẮT ĐẦU GAME (Chỉ Host mới được bấm)
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
                        } else {
                            ws.send(JSON.stringify({ type: 'error', msg: 'Chưa đủ người hoặc chưa ai sẵn sàng!' }));
                        }
                    }
                }
            }

            // LOGIC: GAMEPLAY (Đồng bộ tọa độ, đạn bắn, v.v...)
            else {
                if (ws.room && rooms[ws.room]) {
                    data.id = ws.id; 
                    const packet = JSON.stringify(data);
                    
                    // Gửi dữ liệu cho tất cả mọi người trong phòng trừ người gửi
                    rooms[ws.room].players.forEach((p, id) => {
                        if (id !== ws.id && p.ws.readyState === WebSocket.OPEN) {
                            p.ws.send(packet);
                        }
                    });
                }
            }
        } catch (e) {
            console.error("Lỗi xử lý tin nhắn:", e);
        }
    });

    // XỬ LÝ KHI NGƯỜI CHƠI THOÁT
    ws.on('close', function close() {
        if (ws.room && rooms[ws.room]) {
            rooms[ws.room].players.delete(ws.id);
            console.log(`[-] [${ws.id}] thoát phòng ${ws.room}`);
            
            // Nếu phòng trống thì xóa luôn
            if (rooms[ws.room].players.size === 0) {
                delete rooms[ws.room];
                console.log(`[!] Xóa phòng trống: ${ws.room}`);
            } else {
                // Nếu Host thoát, nhường quyền Host cho người còn lại đầu tiên
                let hasHost = false;
                rooms[ws.room].players.forEach(p => { if (p.isHost) hasHost = true; });
                if (!hasHost) {
                    const firstPlayer = Array.from(rooms[ws.room].players.values())[0];
                    if (firstPlayer) {
                        firstPlayer.isHost = true;
                        firstPlayer.isReady = true;
                    }
                }
                broadcastLobby(ws.room);
            }
        }
    });
});

/**
 * 4. LẮNG NGHE TRÊN CỔNG ĐƯỢC CẤP
 */
const PORT = process.env.PORT || 8080;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Tank Server (Bang Bang) đang chạy trên port ${PORT}...`);
});
