const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");

// Helper to parse date string (YYYY-MM-DD)
const parseDate = (dateStr) => {
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return null;
  // Normalize to start of day (UTC)
  date.setUTCHours(0, 0, 0, 0);
  return date;
};

// GET /api/seats/:busId/:date --> list all booked seat numbers for bus and date
router.get("/seats/:busId/:date", async (req, res) => {
  try {
    const { busId, date } = req.params;
    if (!mongoose.Types.ObjectId.isValid(busId)) {
      return res.status(400).json({ success: false, message: "Invalid busId" });
    }

    const travelDate = parseDate(date);
    if (!travelDate) {
      return res.status(400).json({ success: false, message: "Invalid date" });
    }

    const start = new Date(travelDate);
    const end = new Date(travelDate);
    end.setDate(end.getDate() + 1);

    const bookings = await SeatBooking.find({
      busId,
      travelDate: { $gte: start, $lt: end },
    }).select("seatNumber");

    const bookedSeats = bookings.map((b) => b.seatNumber);
    res.json({ success: true, bookedSeats });
  } catch (error) {
    console.error("Seat status error:", error);
    res
      .status(500)
      .json({ success: false, message: "Failed to fetch seat status" });
  }
});

// POST /api/book-seat
router.post("/book-seat", async (req, res) => {
  try {
    const { busId, seatNumber, travelDate, passengerName } = req.body;

    if (!mongoose.Types.ObjectId.isValid(busId)) {
      return res.status(400).json({ success: false, message: "Invalid busId" });
    }
    if (!seatNumber || typeof seatNumber !== "number") {
      return res
        .status(400)
        .json({ success: false, message: "Invalid seatNumber" });
    }
    if (!passengerName || typeof passengerName !== "string") {
      return res
        .status(400)
        .json({ success: false, message: "Invalid passengerName" });
    }

    const date = parseDate(travelDate);
    if (!date) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid travelDate" });
    }

    const booking = new SeatBooking({
      busId,
      seatNumber,
      travelDate: date,
      passengerName,
    });

    try {
      await booking.save();
      // Emit real-time update to all clients in the bus room
      const room = `bus-${busId}-${date.toISOString().split("T")[0]}`;
      global.io.to(room).emit("seat-booked", { seatNumber });
      return res.json({ success: true, message: "Seat booked successfully" });
    } catch (err) {
      if (err.code === 11000) {
        return res.status(409).json({
          success: false,
          message: "Sorry, this seat was just booked by another user.",
        });
      }
      throw err;
    }
  } catch (error) {
    console.error("Book seat error:", error);
    res.status(500).json({ success: false, message: "Unable to book seat" });
  }
});

module.exports = router;
