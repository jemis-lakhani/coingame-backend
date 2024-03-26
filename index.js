const express = require("express");
const app = express();
const http = require("http");
const { Server } = require("socket.io");
const cookieParser = require("cookie-parser");
const cors = require("cors");

app.use(cors());
app.use(cookieParser());

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: process.env.FRONTEND_URL,
    methods: ["GET", "POST"],
  },
});

function generateRandomId() {
  const min = 100000;
  const max = 999999;
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

const CLICKED = "clicked_dots";

// All players
const players = [];
// Teams
const teams = [];
// Clicked dot update based on team players
const clickedDotUpdated = {};

io.on("connection", (socket) => {
  socket.on("add_player_to_team", (data) => {
    socket.emit("setCookie", { key: "randomRoom1234", value: data.name });
    data.round1 = false;
    data.round2 = false;
    data.round3 = false;
    data.round4 = false;
    io.emit("update_player_list", data);
    players.push(data);
  });

  // Update socket connection when user refresh the waiting room page
  socket.on("update_socket_connection", ({ oldId, newId }) => {
    players.forEach((p) => {
      if (p.socketId === oldId) {
        p.socketId = newId;
      }
    });
  });

  socket.on("start_game", (data) => {
    const { roomId, teamSize } = data;

    const numTeams = Math.ceil(players.length / teamSize);
    for (let i = 0; i < numTeams; i++) {
      const teamId = generateRandomId();
      const startIndex = i * teamSize;
      const endIndex = Math.min((i + 1) * teamSize, players.length);
      const teamPlayers = players.slice(startIndex, endIndex);
      teams.push({ id: teamId, roomId, players: teamPlayers });
    }

    teams.forEach((team) => {
      const teamId = team.id;
      const teamPlayers = team.players;
      teamPlayers.forEach((p, index) => {
        resetPlayerStats(p, index);
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
        socket.emit("game_started", {});
      });
    });
  });

  socket.on("reset_game", ({ roomId }) => {
    resetClickedDot();
    teams.forEach((team) => {
      const teamId = team.id;
      const teamPlayers = team.players;
      teamPlayers.forEach((p, index) => {
        resetPlayerStats(p, index);
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
      });
    });
    io.emit("restart_game", {});
    console.dir({ clickedDotUpdated });
    console.dir({ players });
  });

  socket.on("fetch_waiting_room_players", (data) => {
    io.emit("set_waiting_room_players", players);
    socket.emit("update_socket_connection", { id: socket.id });
  });

  socket.on("fetch_team_players", (data) => {
    let players;
    const { teamId, roomId } = data;
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
      isResetGame: false,
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

            const player = getPlayer(teamPlayers, playerId);
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

  socket.on(
    "check_for_new_round",
    ({ round, nextRound, teamId, batchSize }) => {
      resetTeamStats(round, teamId);
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

  // Reset clickedDot data
  const resetClickedDot = () => {
    Object.keys(clickedDotUpdated).forEach((key) => {
      clickedDotUpdated[key] = [];
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
});

// Get Team players
const getTeamPlayers = (teamId) => {
  const team = teams.find((team) => team.id === parseInt(teamId));
  return team?.players;
};

// Get Player
const getPlayer = (teamPlayers, playerId) => {
  const player = teamPlayers.find((p) => p.id === playerId);
  return player;
};

// Reset team stats
const resetTeamStats = (round, teamId) => {
  const teamPlayers = getTeamPlayers(teamId);
  teamPlayers.forEach((p, index) => {
    p.startIndex = 0;
    p.endIndex = index === 0 ? 20 : 0;
    p.isCurrentPlayer = index === 0;
    p[round] = false;
    p.count = 0;
    p.isTimerStarted = false;
  });
};

// Reset Player stats
const resetPlayerStats = (player, index) => {
  player.isRoomCreated = true;
  player.count = 0;
  player.isTimerStarted = false;
  player.isFirstPlayer = index === 0;
  player.isCurrentPlayer = index === 0;
  player.startIndex = 0;
  player.endIndex = index === 0 ? 20 : 0;
  player.round1 = false;
  player.round2 = false;
  player.round3 = false;
  player.round4 = false;
};

server.listen(5000, () => {
  console.log("Server listening on port", 5000);
});
