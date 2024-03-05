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
  socket.on("start_game", (data) => {
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
        io.to(roomId).to(teamId).emit("join_room", {
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

  socket.on("add_player_to_team", (data) => {
    socket.emit("setCookie", { key: "randomRoom1234", value: data.name });
    data.round1 = false;
    data.round2 = false;
    data.round3 = false;
    data.round4 = false;
    io.emit("update_player_list", data);
    players.push(data);

    const clickedDotData = {
      id: data?.id,
      clicked_dots: {
        round1: [],
        round2: [],
        round3: [],
        round4: [],
      },
    };
    clickedDotUpdated.push(clickedDotData);
  });

  socket.on("fetch_waiting_room_players", (data) => {
    io.emit("set_waiting_room_players", players);
    socket.emit("update_socket_connection", { id: socket.id });
  });

  socket.on("dot_clicked", ({ playerId, teamId, roomId, dotIndex, round }) => {
    let player = clickedDotUpdated.find((obj) => obj.id === playerId);
    if (player !== null && player !== undefined) {
      player["clicked_dots"][round].push(dotIndex);
    }
    const updatedData = { playerId, dots: player["clicked_dots"][round] };
    io.to(roomId).to(teamId).emit("dot_clicked_update", updatedData);
  });

  socket.on("start_team_timer", ({ roomId, teamId }) => {
    io.to(roomId).to(teamId).emit("team_timer_started");
  });

  socket.on("fetch_players_time", ({ playersTime, roomId, teamId }) => {
    console.log({ playersTime });
    console.log({ roomId });
    io.to(roomId).to(teamId).emit("set_players_time", { playersTime });
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

  socket.on(
    "check_for_next_turn",
    ({ playerId, roomId, teamId, round, batchSize }) => {
      const currentIndex = clickedDotUpdated.findIndex(
        (p) => p.id === playerId,
      );
      if (currentIndex !== -1) {
        const currentPlayer = clickedDotUpdated[currentIndex];
        const clickedDots = currentPlayer["clicked_dots"][round].length;
        const taskCompleted = clickedDots > 0 && clickedDots % batchSize === 0;
        if (taskCompleted) {
          const player = players.find((p) => p.id === currentPlayer.id);
          player.isCurrentPlayer = false;
          player.round1 = true;
          const nextIndex = (currentIndex + 1) % clickedDotUpdated.length;
          const nextPlayer = clickedDotUpdated[nextIndex];
          const nextPlayerUpdate = players.find((p) => p.id === nextPlayer.id);
          nextPlayerUpdate.isCurrentPlayer = true;
          io.to(roomId)
            .to(teamId)
            .emit("next_player_turn", {
              isRoundCompleted: nextIndex === clickedDotUpdated.length - 1,
              players,
              clickedDot: clickedDotUpdated,
            });
        }
      }
    },
  );

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
