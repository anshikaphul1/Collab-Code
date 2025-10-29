import express from 'express';
import http from 'http';
import { Server } from "socket.io";
import path from 'path';
import axios from 'axios';

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
  },
});

const rooms = new Map();

io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  let currentRoom = null;
  let currentUser = null;

  // User joins a room
  socket.on("join", ({ roomId, userName }) => {
    if (currentRoom) {
      socket.leave(currentRoom);
      rooms.get(currentRoom)?.users.delete(currentUser);
      io.to(currentRoom).emit("userJoined", Array.from(rooms.get(currentRoom).users || []));
    }

    currentRoom = roomId;
    currentUser = userName;

    socket.join(roomId);

    // Initialize room if not exist (store code + language)
    if (!rooms.has(roomId)) {
      rooms.set(roomId, {
        users: new Set(),
        code: "// start code here",
        language: "Java", // default language
      });
    }

    const room = rooms.get(roomId);
    room.users.add(userName);

    //  Send current code + language to the newly joined user
    socket.emit("codeUpdate", room.code);
    socket.emit("languageUpdate", room.language);

    io.to(roomId).emit("userJoined", Array.from(room.users));
    console.log(`${userName} joined room ${roomId}`);
  });

  //  Code updates broadcast
  socket.on("codeChange", ({ roomId, code }) => {
    if (rooms.has(roomId)) {
      rooms.get(roomId).code = code;
    }
    socket.to(roomId).emit("codeUpdate", code);
  });

  //  Typing indicator
  socket.on("typing", ({ roomId, userName }) => {
    socket.to(roomId).emit("userTyping", userName);
  });

  //  Language change sync (and store it)
  socket.on("languageChange", ({ roomId, language }) => {
    if (rooms.has(roomId)) {
      rooms.get(roomId).language = language; // ✅ store language in room
    }
    io.to(roomId).emit("languageUpdate", language);
  });

  //  Code compilation handler
  socket.on("compileCode", async ({ code, roomId, language, version, input }) => {
    if (rooms.has(roomId)) {
      const room = rooms.get(roomId);

      //  Language normalization map
      const langMap = {
        Java: "java",
        Python: "python",
        Javascript: "javascript",
        cpp: "cpp",
      };
      const lang = langMap[language] || language.toLowerCase();

      console.log(`Compiling code in ${lang} for room ${roomId}`);

      try {
        const response = await axios.post("https://emkc.org/api/v2/piston/execute", {
          language: lang,
          version: version || "*",
          files: [{ content: code }],
          stdin: input,
        });

        room.output = response.data.run.output;
        io.to(roomId).emit("codeResponse", response.data);
      } catch (err) {
        console.error("Compilation error:", err.response?.data || err.message);
        io.to(roomId).emit("codeResponse", {
          run: { output: "❌ Error during code execution" },
        });
      }
    }
  });

  //  User leaves room
  socket.on("leaveRoom", () => {
    if (currentRoom && currentUser) {
      const room = rooms.get(currentRoom);
      if (room) {
        room.users.delete(currentUser);
        io.to(currentRoom).emit("userJoined", Array.from(room.users || []));
      }
      socket.leave(currentRoom);
      currentRoom = null;
      currentUser = null;
      console.log("User left room");
    }
  });

  //  Handle disconnect
  socket.on("disconnect", () => {
    if (currentRoom && currentUser) {
      const room = rooms.get(currentRoom);
      if (room) {
        room.users.delete(currentUser);
        io.to(currentRoom).emit("userJoined", Array.from(room.users || []));
      }
    }
    console.log("User disconnected:", socket.id);
  });
});

//  Server and static build setup
const port = process.env.PORT || 5000;
const __dirname = path.resolve();

app.use(express.static(path.join(__dirname, "/frontend/dist")));
app.use((req, res) => {
  res.sendFile(path.join(__dirname, "frontend", "dist", "index.html"));
});

server.listen(port, () => {
  console.log(`✅ Server is working on port ${port}`);
});
