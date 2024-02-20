const express = require("express");
const app = express();
const http = require("http");
const { Server } = require("socket.io");
const cookieParser = require("cookie-parser");
const cors = require("cors");
const { log } = require("console");

app.use(cors());

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "http://localhost:3000",
    methods: ["GET", "POST"],
  },
});

app.use(cookieParser());

function generateRandomId() {
  const min = 100000;
  const max = 999999;
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

const players = [];
const rooms = {};
const teams = [];

io.on("connection", (socket) => {
  socket.on("join_room", (data) => {
    const { roomId, players, teamSize } = data;
    if (!rooms[roomId]) {
      rooms[roomId] = [];
    }

    const numTeams = Math.ceil(players.length / teamSize);
    for (let i = 0; i < numTeams; i++) {
      const teamId = generateRandomId();
      const startIndex = i * teamSize;
      const endIndex = Math.min((i + 1) * teamSize, players.length);
      const teamPlayers = players.slice(startIndex, endIndex);
      teams.push({ id: teamId, roomId, players: teamPlayers });
      rooms[roomId].push({ id: teamId, players: teamPlayers });
    }

    console.log({ teams });

    rooms[roomId].forEach((team) => {
      const teamId = team.id;
      const teamPlayers = team.players;
      teamPlayers.forEach((p) => {
        const socketId = p.socketId;
        const data = { teamId };
        io.to(p.socketId).emit("waiting", data);
        const targetSocket = io.of("/").sockets.get(p.socketId);
        if (targetSocket) {
          targetSocket.join(roomId);
          targetSocket.join(teamId);
        }
        io.to(roomId).to(teamId).to(p.socketId).emit("room_users", {
          roomId,
          teamId,
          socketId,
          players: teamPlayers,
        });
      });
    });
  });

  // const cookies = socket.handshake.headers.cookie;
  // console.log("Cookies:", cookies);
  socket.on("add_player", (data) => {
    socket.emit("setCookie", { key: "randomRoom1234", value: data.name });
    io.emit("update_player_list", data);
    players.push(data);
  });

  socket.on("get_data", (data) => {
    io.emit("send_data", players);
  });

  socket.on("fetch_team_players", (data) => {
    const { teamId, roomId } = data;
    let players;
    teams.forEach((team) => {
      if (team.roomId == roomId && team.id == teamId) {
        players = team.players;
      }
    });
    io.emit("team_players", { roomId, teamId, players });
  });

  socket.on("disconnect", () => {
    for (const roomId in rooms) {
      const index = rooms[roomId].findIndex((user) => user.id === socket.id);
      if (index !== -1) {
        rooms[roomId].splice(index, 1);
        io.to(roomId).emit("room_users", rooms[roomId]);
        break;
      }
    }
  });
});

server.listen(5000, () => {
  console.log("Server listening on port", 5000);
});
