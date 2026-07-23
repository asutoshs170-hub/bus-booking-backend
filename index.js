const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const mongoose = require("mongoose");
const http = require("http");
const socketIo = require("socket.io");
require("dotenv").config();

// Import routes
const passengerRoutes = require("./routes/passengerRoutes");
const agentRoutes = require("./routes/agentRoutes");

// Initialize app
const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: [
      "http://localhost:3000",
      "http://localhost:5174",
      "http://localhost:5175",
    ], // React dev server and Vite
    methods: ["GET", "POST"],
  },
});

// Middleware
app.use(
  cors({
    origin: [
      "http://localhost:3000",
      "http://localhost:5174",
      "http://localhost:5175",
    ],
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH"],
    allowedHeaders: ["Content-Type", "Authorization"],
  }),
);
app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// API Routes
app.use("/api/passengers", passengerRoutes);
app.use("/api/agents", agentRoutes);
const bookingRoutes = require("./routes/bookingRoutes");
app.use("/api/bookings", bookingRoutes);

// Health check endpoint
app.get("/api/health", (req, res) => {
  res.status(200).json({
    success: true,
    message: "Backend server is running",
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: "Route not found",
  });
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({
    success: false,
    message: "Internal server error",
    error: err.message,
  });
});

// Socket.IO connection handling
io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  // Join room for specific bus and date
  socket.on("join-bus-room", (data) => {
    const { busNumber, date } = data;
    const room = `bus-${busNumber}-${date}`;
    socket.join(room);
    console.log(`User ${socket.id} joined room: ${room}`);
  });

  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id);
  });
});

// Export io for use in routes
global.io = io;

// Start server
const PORT = process.env.PORT || 5001;

// MongoDB connection
const MONGO_URI = process.env.MONGO_URI;

const connectDB = async () => {
  try {
    await mongoose.connect(MONGO_URI);
    console.log("✓ MongoDB connected successfully");

    // Drop problematic unique indexes on array elements
    try {
      const db = mongoose.connection.db;
      const collection = db.collection("bookings");

      // Drop the old unique indexes that were causing issues
      await collection.dropIndex({
        bus_number: 1,
        travel_date: 1,
        "sits_numbers.lowerDeck": 1,
      });
      console.log("✓ Dropped old lowerDeck index");
    } catch (indexError) {
      if (indexError.codeName !== "IndexNotFound") {
        console.warn(
          "Warning: Could not drop lowerDeck index:",
          indexError.message,
        );
      }
    }

    try {
      const db = mongoose.connection.db;
      const collection = db.collection("bookings");
      await collection.dropIndex({
        bus_number: 1,
        travel_date: 1,
        "sits_numbers.upperDeck": 1,
      });
      console.log("✓ Dropped old upperDeck index");
    } catch (indexError) {
      if (indexError.codeName !== "IndexNotFound") {
        console.warn(
          "Warning: Could not drop upperDeck index:",
          indexError.message,
        );
      }
    }
  } catch (error) {
    console.error("✗ MongoDB connection failed:", error.message);
    process.exit(1);
  }
};

connectDB().then(() => {
  server.listen(PORT, () => {
    console.log(`Backend server running on http://localhost:${PORT}`);
    console.log(
      `API endpoints available at http://localhost:${PORT}/api/passengers`,
    );
  });
});
