const express = require("express");
const app = express();
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");

app.use(cors());

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "http://localhost:3000",
    methods: ["GET", "POST"],
  },
});

io.on("connection", (socket) => {
  console.log("Socket connected");
  socket.on("send_message", (data) => {
    io.emit("receive_message", data);
  });
});

server.listen(5000, () => {
  console.log("Server listening on port", 5000);
});
