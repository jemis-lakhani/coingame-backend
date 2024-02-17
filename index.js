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

const players = [];

io.on("connection", (socket) => {
  // const cookies = socket.handshake.headers.cookie;
  // console.log("Cookies:", cookies);

  socket.on("send_message", (data) => {
    socket.emit("setCookie", { key: "randomRoom1234", value: data.playerName });
    io.emit("receive_message", data);
    players.push(data.playerName);
  });

  socket.on("get_data", (data) => {
    io.emit("send_data", players);
  });
});

server.listen(5000, () => {
  console.log("Server listening on port", 5000);
});
