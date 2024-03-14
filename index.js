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

const NEXT_ROUND = {
  round1: "round2",
  round2: "round3",
  round3: "round4",
  round4: "round5",
};

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
        io.to(teamId).emit("dot_clicked_update", { teamData, playerId });
        const isNextEnabled = player["clicked_dots"][round].length >= batchSize;
        const isAllClicked = player["clicked_dots"][round].length >= 4;
        socket.emit("manage_next_turn", { isNextEnabled, isAllClicked });
      }
    },
  );

  socket.on("check_for_new_round", ({ round, nextRound, teamId }) => {
    resetPlayerStats(round, teamId);
    const clickedDots = clickedDotUpdated[teamId];
    io.to(teamId).emit("start_new_round", { players, clickedDots, nextRound });
  });

  socket.on(
    "check_for_next_turn",
    ({ playerId, teamId, round, batchSize, totalBatchSize }) => {
      const teamDotsData = clickedDotUpdated[teamId];
      const teamPlayers = getTeamPlayers(teamId);
      if (teamDotsData) {
        const index = teamDotsData.findIndex((p) => p.playerId === playerId);
        if (index !== -1) {
          const currentPlayer = teamDotsData[index];
          const clickedDots = currentPlayer["clicked_dots"][round];
          currentPlayer["clicked_dots"][round].sort((a, b) => a - b);
          const dots = clickedDots.length;
          if (dots >= batchSize) {
            currentPlayer["clicked_dots"][round] =
              currentPlayer["clicked_dots"][round].slice(batchSize);
            console.log(">>>", currentPlayer["clicked_dots"][round]);
            const player = getPlayer(teamPlayers, currentPlayer.playerId);
            if (player) {
              if (dots >= totalBatchSize) {
                console.log("Round completed >>");
                player.isCurrentPlayer = false;
                player.startIndex = 0;
                player.endIndex = 0;
                player[round] = true;
              } else {
                const newEndIndex = Math.min(player.endIndex + batchSize, 4);
                player.startIndex += batchSize;
                player.endIndex = newEndIndex;
                player.isCurrentPlayer = true;
                player[round] = false;
              }
              let isRoundCompleted = false;
              let isLastPlayer = false;
              if (index + 1 === teamDotsData.length) {
                isRoundCompleted = dots >= totalBatchSize;
                isLastPlayer = true;
              } else {
                const nextIndex = (index + 1) % teamDotsData.length;
                const nextPlayerId = teamDotsData[nextIndex]?.playerId;
                const nextPlayer = getPlayer(teamPlayers, nextPlayerId);
                nextPlayer.isCurrentPlayer = true;
                nextPlayer.endIndex += batchSize;
              }
              console.log({ teamPlayers });
              io.to(teamId).emit("next_player_turn", {
                teamPlayers,
                isRoundCompleted,
                isLastPlayer,
                clickedDots: teamDotsData,
                isNextEnabled:
                  currentPlayer["clicked_dots"][round].length >= batchSize,
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

const getTeamPlayers = (teamId) => {
  const teamPlayers = players.filter((p) => p.teamId === parseInt(teamId));
  return teamPlayers;
};

const getPlayer = (teamPlayers, playerId) => {
  const player = teamPlayers.find((p) => p.id === playerId);
  return player;
};

const resetPlayerStats = (round, teamId) => {
  const teamPlayers = getTeamPlayers(teamId);
  teamPlayers.forEach((p, index) => {
    p.startIndex = 0;
    p.endIndex = index === 0 ? 4 : 0;
    p.isCurrentPlayer = index === 0;
    p[round] = false;
  });
};

server.listen(5000, () => {
  console.log("Server listening on port", 5000);
});
