const express = require("express");
const app = express();
const http = require("http");
const { Server } = require("socket.io");
const cookieParser = require("cookie-parser");
const cors = require("cors");

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
const clickedDotUpdated = [];

io.on("connection", (socket) => {
  socket.on("join_room", (data) => {
    const { roomId, teamSize } = data;
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

    rooms[roomId].forEach((team) => {
      const teamId = team.id;
      const teamPlayers = team.players;
      teamPlayers.forEach((p) => {
        p.isRoomCreated = true;
        const socketId = p.socketId;
        const targetSocket = io.of("/").sockets.get(p.socketId);
        if (targetSocket) {
          targetSocket.join(roomId);
          targetSocket.join(teamId);
        }
        io.to(roomId).to(teamId).emit("room_users", {
          id: p.id,
          roomId,
          teamId,
          socketId,
          players: teamPlayers,
        });
      });
    });
  });

  socket.on("update_socket_connection", ({ oldId, newId }) => {
    players.forEach((p) => {
      if (p.socketId === oldId) {
        p.socketId = newId;
      }
    });
  });

  socket.on("add_player", (data) => {
    socket.emit("setCookie", { key: "randomRoom1234", value: data.name });
    data.round1 = false;
    data.round2 = false;
    data.round3 = false;
    data.round4 = false;
    io.emit("update_player_list", data);
    players.push(data);
  });

  socket.on("fetch_players", (data) => {
    io.emit("set_players", players);
    socket.emit("socket_connected", { id: socket.id });
  });

  socket.on("dot_clicked", ({ playerId, teamId, roomId, dotIndex, round }) => {
    let data1 = clickedDotUpdated.find((obj) => obj.id === playerId);
    console.log({ data1 });
    if (data1 !== null && data1 !== undefined) {
      data1["clicked_dots"][round].push(dotIndex);
    } else {
      const data = {
        id: playerId,
        clicked_dots: {
          round1: [],
          round2: [],
          round3: [],
          round4: [],
        },
      };
      data["clicked_dots"][round].push(dotIndex);
      clickedDotUpdated.push(data);
      data1 = clickedDotUpdated.find((obj) => obj.id === playerId);
    }
    const newData = { playerId, dots: data1["clicked_dots"][round] };
    io.to(roomId).to(teamId).emit("dot_clicked_update", newData);
  });

  socket.on("fetch_team_players", (data) => {
    let players;
    const { teamId, roomId, round } = data;
    socket.join(roomId);
    socket.join(teamId);
    teams.forEach((team) => {
      if (team.roomId == roomId && team.id == teamId) {
        players = team.players;
      }
    });
    io.emit("team_players", {
      roomId,
      teamId,
      players,
      clickedDot: clickedDotUpdated,
    });
  });

  socket.on("move_turn_to_next_player", (data) => {});

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
