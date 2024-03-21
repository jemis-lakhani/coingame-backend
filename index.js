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

const CLICKED = "clicked_dots";

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
        p.isFirstPlayer = index === 0;
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
    data.count = 0;
    data.isTimerStarted = false;
    data.isFirstPlayer = false;
    io.emit("update_player_list", data);
    players.push(data);
  });

  socket.on("fetch_waiting_room_players", (data) => {
    io.emit("set_waiting_room_players", players);
    socket.emit("update_socket_connection", { id: socket.id });
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

  socket.on("fetch_players_time", ({ playersTime, teamId }) => {
    io.to(teamId).emit("set_players_time", { playersTime });
  });

  socket.on(
    "dot_clicked",
    ({ playerId, teamId, dotIndex, round, batchSize, totalSize }) => {
      const teamData = clickedDotUpdated[teamId];
      if (teamData) {
        let dotsData = teamData.find((obj) => obj.playerId === playerId);
        if (dotsData !== null && dotsData !== undefined) {
          dotsData[CLICKED][round].push(dotIndex);
        }
        io.to(teamId).emit("dot_clicked_update", { teamData });

        const teamPlayers = getTeamPlayers(teamId);
        const player = getPlayer(teamPlayers, playerId);
        const clickedCount = dotsData[CLICKED][round].length;
        const isNextEnabled = clickedCount >= batchSize;
        const isAllClicked = clickedCount + player.count >= totalSize;

        if (!player.isTimerStarted) {
          player.isTimerStarted = true;
          managePlayerTimer(true, false);
          manageTeamTimer(teamId, true, false, false);
        }
        if (isAllClicked) {
          managePlayerTimer(false, false);
        }
        socket.emit("manage_next_turn", { isNextEnabled });
      }
    },
  );

  socket.on(
    "check_for_new_round",
    ({ round, nextRound, teamId, batchSize }) => {
      resetPlayerStats(round, teamId);
      resetTimers(teamId);
      const clickedDots = clickedDotUpdated[teamId];
      const players = getTeamPlayers(teamId);
      io.to(teamId).emit("start_new_round", {
        players,
        clickedDots,
        nextRound,
        batchSize,
      });
    },
  );

  socket.on(
    "check_for_next_turn",
    ({ playerId, teamId, round, batchSize, totalSize }) => {
      const teamDotsData = clickedDotUpdated[teamId];
      const teamPlayers = getTeamPlayers(teamId);
      if (teamDotsData) {
        const index = teamDotsData.findIndex((p) => p.playerId === playerId);
        if (index !== -1) {
          const dotsData = teamDotsData[index];
          const isLastPlayer = index + 1 === teamDotsData.length;
          const clickedDots = dotsData[CLICKED][round];
          if (clickedDots.length >= batchSize) {
            dotsData[CLICKED][round].sort((a, b) => a - b);
            dotsData[CLICKED][round] =
              dotsData[CLICKED][round].slice(batchSize);

            const player = getPlayer(teamPlayers, dotsData.playerId);
            if (player) {
              // Manage player stats
              player.count += batchSize;
              if (player.endIndex - player.startIndex === batchSize) {
                player.startIndex = player.endIndex;
                player.isCurrentPlayer = false;
              } else {
                player.startIndex += batchSize;
                player.isCurrentPlayer = true;
              }
              if (!isLastPlayer) {
                const nextIndex = (index + 1) % teamDotsData.length;
                const nextPlayerId = teamDotsData[nextIndex]?.playerId;
                const nextPlayer = getPlayer(teamPlayers, nextPlayerId);
                nextPlayer.isCurrentPlayer = true;
                nextPlayer.endIndex += batchSize;
              }

              // If round completed => stop team timer
              const roundCompleted = isLastPlayer && player.count >= totalSize;
              if (isLastPlayer) {
                if (player.count === batchSize) {
                  manageTeamTimer(teamId, true, true, false);
                }
                if (roundCompleted) {
                  manageTeamTimer(teamId, false, false, false);
                }
              }

              const isNextEnabled =
                dotsData[CLICKED][round].length >= batchSize;
              socket.emit("manage_next_turn", { isNextEnabled });
              io.to(teamId).emit("next_player_turn", {
                teamPlayers,
                clickedDots: teamDotsData,
                roundCompleted,
                isLastPlayer,
              });
            }
          }
        }
      }
    },
  );

  // Reset players/team timers
  const resetTimers = (teamId) => {
    io.to(teamId).emit("manage_player_timer", {
      start: false,
      isReset: true,
    });
    io.to(teamId).emit("manage_team_timer", {
      start: false,
      isFirstValue: false,
      isReset: true,
    });
  };

  // Manage Team Timers
  const manageTeamTimer = (teamId, start, isFirstValue, isReset) => {
    io.to(teamId).emit("manage_team_timer", {
      start,
      isFirstValue,
      isReset,
    });
  };

  // Manage Player Timer
  const managePlayerTimer = (start, isReset) => {
    socket.emit("manage_player_timer", {
      start,
      isReset,
    });
  };

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
    p.count = 0;
    p.isTimerStarted = false;
  });
};

server.listen(5000, () => {
  console.log("Server listening on port", 5000);
});
