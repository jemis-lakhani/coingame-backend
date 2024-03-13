const express = require("express");
const app = express();
const http = require("http");
const { Server } = require("socket.io");
const cookieParser = require("cookie-parser");
const cors = require("cors");
const { createSocket } = require("dgram");

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
const clickedDotUpdated = {};

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
      teamPlayers.forEach((p, index) => {
        p.isRoomCreated = true;
        p.teamId = teamId;
        p.isCurrentPlayer = index === 0;
        p.startIndex = 0;
        p.endIndex = index === 0 ? 4 : 0;
        const socketId = p.socketId;
        const targetSocket = io.of("/").sockets.get(p.socketId);
        if (targetSocket) {
          targetSocket.join(roomId);
          targetSocket.join(teamId);
        }

        const clickedDotData = {
          playerId: p.id,
          teamId: teamId,
          clicked_dots: {
            round1: [],
            round2: [],
            round3: [],
            round4: [],
          },
        };
        if (clickedDotUpdated[teamId] == null) {
          clickedDotUpdated[teamId] = [];
        }
        clickedDotUpdated[teamId].push(clickedDotData);

        io.to(teamId).emit("join_room", {
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
  });

  socket.on("fetch_waiting_room_players", (data) => {
    io.emit("set_waiting_room_players", players);
    socket.emit("update_socket_connection", { id: socket.id });
  });

  socket.on("start_team_timer", ({ roomId, teamId }) => {
    io.to(teamId).emit("team_timer_started");
  });

  socket.on("fetch_players_time", ({ playersTime, roomId, teamId }) => {
    io.to(teamId).emit("set_players_time", { playersTime });
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
    io.to(teamId).emit("team_players", {
      roomId,
      teamId,
      players,
      clickedDots: clickedDotUpdated[teamId],
    });
  });

  socket.on(
    "dot_clicked",
    ({ playerId, teamId, roomId, dotIndex, round, batchSize }) => {
      const teamData = clickedDotUpdated[teamId];
      if (teamData) {
        let player = teamData.find((obj) => obj.playerId === playerId);
        if (player !== null && player !== undefined) {
          player["clicked_dots"][round].push(dotIndex);
        }
        io.to(teamId).emit("dot_clicked_update", { teamData });
        const isNextEnabled = player["clicked_dots"][round].length >= batchSize;
        const isAllClicked = player["clicked_dots"][round].length >= 4;
        socket.emit("manage_next_turn", { isNextEnabled, isAllClicked });
      }
    },
  );

  socket.on("check_for_new_round", ({ round, teamId }) => {
    const teamPlayers = players.filter((p) => p.teamId === parseInt(teamId));
    teamPlayers.forEach((p, index) => {
      p.startIndex = 0;
      p.endIndex = index === 0 ? 4 : 0;
      p.isCurrentPlayer = index === 0;
      p[round] = false;
    });
    let batchSize = 4;
    if (round === "round1") {
      batchSize = 4;
    } else if (round === "round2") {
      batchSize = 2;
    } else if (round === "round3") {
      batchSize = 2;
    } else if (round === "round4") {
      batchSize = 1;
    }
    const clickedDots = clickedDotUpdated[teamId];
    console.dir({ teamPlayers });
    const data = { players, clickedDots, batchSize };
    io.to(teamId).emit("start_new_round", data);
  });

  socket.on(
    "check_for_next_turn",
    ({ playerId, roomId, teamId, round, batchSize }) => {
      const currentTeam = clickedDotUpdated[teamId];
      if (currentTeam) {
        const currentIndex = currentTeam.findIndex(
          (p) => p.playerId === playerId,
        );
        if (currentIndex !== -1) {
          const currentPlayer = currentTeam[currentIndex];
          const clickedDots = currentPlayer["clicked_dots"][round];
          console.log({ clickedDots });
          currentPlayer["clicked_dots"][round].sort((a, b) => a - b);
          const dots = clickedDots.length;
          const taskCompleted = dots >= batchSize;
          if (taskCompleted) {
            currentPlayer["clicked_dots"][round] =
              currentPlayer["clicked_dots"][round].slice(batchSize);
            console.log(">>>> ", currentPlayer["clicked_dots"][round]);
            const teamPlayers = players.filter(
              (p) => p.teamId === parseInt(teamId),
            );
            const player = teamPlayers.find(
              (p) => p.id === currentPlayer.playerId,
            );
            if (player) {
              if (dots < 4) {
                const newEndIndex = Math.min(player.endIndex + batchSize, 4);
                player.startIndex += batchSize;
                player.endIndex = newEndIndex;
                player.isCurrentPlayer = true;
              } else {
                player.isCurrentPlayer = false;
                player.startIndex = 0;
                player.endIndex = 0;
              }
              let isRoundCompleted = false;
              let isLastPlayer = false;
              let completedDots = 0;
              if (currentIndex + 1 === currentTeam.length) {
                isRoundCompleted = dots === batchSize;
                isLastPlayer = true;
                completedDots = dots;
              } else {
                const nextIndex = (currentIndex + 1) % currentTeam.length;
                const nextPlayerId = currentTeam[nextIndex]?.playerId;
                const nextPlayer = teamPlayers.find(
                  (p) => p.id === nextPlayerId,
                );
                nextPlayer.isCurrentPlayer = true;
                nextPlayer.endIndex += batchSize;
              }
              const isAllClicked = dots >= 4;
              socket.emit("manage_next_turn", {
                isNextEnabled: false,
                isAllClicked,
              });
              io.to(teamId).emit("next_player_turn", {
                teamPlayers,
                clickedDots: currentTeam,
                isRoundCompleted,
                isLastPlayer,
                completedDots,
              });
            }
          }
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
