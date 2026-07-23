const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const { Passenger, Agent } = require("../schemas");

// GET /api/bookings/seats?busNumber=...&travelDate=... - Get booked seats
// Fetches from both passengers collection and agents collection's booked field
// Returns array of objects with seat number and gender information
router.get("/seats", async (req, res) => {
  try {
    const { busNumber, travelDate } = req.query;
    if (!busNumber || !travelDate) {
      return res
        .status(400)
        .json({ success: false, message: "busNumber and travelDate required" });
    }
    console.log(
      "Fetching booked seats for bus:",
      busNumber,
      "date:",
      travelDate,
    );

    const bookedSeats = [];

    // Fetch booked seats from passengers collection
    const passengers = await Passenger.find({
      bus_number: busNumber,
      travel_date: travelDate,
      Travel_status: { $ne: "cancelled" },
    }).select("passengers");

    passengers.forEach((p) => {
      if (p.passengers && Array.isArray(p.passengers)) {
        p.passengers.forEach((passenger) => {
          if (passenger.seat_number?.lowerDeck) {
            bookedSeats.push({
              seat: `L${passenger.seat_number.lowerDeck}`,
              gender: passenger.gender || "other",
            });
          }
          if (passenger.seat_number?.upperDeck) {
            bookedSeats.push({
              seat: `U${passenger.seat_number.upperDeck}`,
              gender: passenger.gender || "other",
            });
          }
        });
      }
    });

    // Fetch booked seats from agents collection's booked field
    const agents = await Agent.find({
      "booked.bus_number": busNumber,
      "booked.travel_date": travelDate,
    }).select("booked");

    agents.forEach((agent) => {
      if (agent.booked && Array.isArray(agent.booked)) {
        agent.booked.forEach((booking) => {
          // Only include non-cancelled bookings from agents
          if (
            booking.bus_number === busNumber &&
            booking.travel_date === travelDate &&
            (!booking.Travel_status || booking.Travel_status !== "cancelled")
          ) {
            // Check passengers array with new seat_number structure
            if (booking.passengers && Array.isArray(booking.passengers)) {
              booking.passengers.forEach((passenger) => {
                if (passenger.seat_number?.lowerDeck) {
                  bookedSeats.push({
                    seat: `L${passenger.seat_number.lowerDeck}`,
                    gender: passenger.gender || "other",
                  });
                }
                if (passenger.seat_number?.upperDeck) {
                  bookedSeats.push({
                    seat: `U${passenger.seat_number.upperDeck}`,
                    gender: passenger.gender || "other",
                  });
                }
              });
            }
            // Fallback to old sits_numbers structure for backwards compatibility
            if (booking.sits_numbers?.lowerDeck) {
              booking.sits_numbers.lowerDeck.forEach((seatNum) => {
                if (seatNum) {
                  bookedSeats.push({
                    seat: `L${seatNum}`,
                    gender: "other",
                  });
                }
              });
            }
            if (booking.sits_numbers?.upperDeck) {
              booking.sits_numbers.upperDeck.forEach((seatNum) => {
                if (seatNum) {
                  bookedSeats.push({
                    seat: `U${seatNum}`,
                    gender: "other",
                  });
                }
              });
            }
          }
        });
      }
    });

    console.log("Found booked seats:", bookedSeats);
    res.json({ success: true, bookedSeats });
  } catch (error) {
    console.error("Seats API error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /api/bookings/:pnr - Get booking details by PNR
router.get("/:pnr", async (req, res) => {
  try {
    const { pnr } = req.params;

    // First check passengers collection (customer bookings)
    const passenger = await Passenger.findOne({ pnr });

    if (passenger) {
      // Transform for frontend
      const bookingData = {
        pnr: passenger.pnr,
        passengers: passenger.passengers || [],
        phoneNo: passenger.phoneNo,
        emailId: passenger.emailId,
        bus_number: passenger.bus_number,
        busNumber: passenger.bus_number,
        from_city: passenger.from_city,
        fromCity: passenger.from_city,
        to_city: passenger.to_city,
        toCity: passenger.to_city,
        boardingPoint: passenger.from_city,
        droppingPoint: passenger.to_city,
        travel_date: passenger.travel_date,
        travelDate: passenger.travel_date,
        departureTime: passenger.departureTime,
        arrivalTime: passenger.arrivalTime,
        arrival_date: passenger.arrival_date,
        totalAmount: passenger.totalPay,
        totalPay: passenger.totalPay,
        paymentMethod:
          (passenger.payment_mode && passenger.payment_mode.toUpperCase()) ||
          "CASH",
        payment_mode: passenger.payment_mode,
        status: passenger.Travel_status || "Confirmed",
        Travel_status: passenger.Travel_status,
        busContact: passenger.BusContactNo,
        BusContactNo: passenger.BusContactNo,
        createdAt: passenger.createdAt,
        bookedBy: "passenger",
      };

      return res.json({
        success: true,
        data: bookingData,
      });
    }

    // If not found in passengers, check agents collection (agent bookings)
    const agent = await Agent.findOne({ "booked.pnr": pnr });

    if (agent) {
      // Find the specific booking in the agent's booked array
      const booking = agent.booked.find((b) => b.pnr === pnr);

      if (booking) {
        // Transform for frontend
        const bookingData = {
          pnr: booking.pnr,
          passengers: booking.passengers || [],
          phoneNo: booking.phoneNo,
          emailId: booking.emailId,
          busNumber: booking.bus_number,
          bus_number: booking.bus_number,
          fromCity: booking.from_city,
          from_city: booking.from_city,
          toCity: booking.to_city,
          to_city: booking.to_city,
          boardingPoint: booking.from_city,
          droppingPoint: booking.to_city,
          travelDate: booking.travel_date,
          travel_date: booking.travel_date,
          departureTime: booking.departureTime,
          departure_time: booking.departureTime,
          arrivalTime: booking.arrivalTime,
          arrival_time: booking.arrivalTime,
          arrival_date: booking.arrival_date,
          seats: booking.sits_numbers,
          totalSeats: booking.total_sits,
          totalAmount: booking.totalPay,
          totalPay: booking.totalPay,
          paymentMethod: booking.payment_mode?.toUpperCase() || "CASH",
          payment_mode: booking.payment_mode,
          status: booking.Travel_status || "Confirmed",
          Travel_status: booking.Travel_status,
          busContact: booking.BusContactNo,
          BusContactNo: booking.BusContactNo,
          createdAt: booking.created_at,
          bookedBy: "agent",
        };

        return res.json({
          success: true,
          data: bookingData,
        });
      }
    }

    // Booking not found in either collection
    return res
      .status(404)
      .json({ success: false, message: "Booking not found" });
  } catch (error) {
    console.error("Booking details error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// POST /api/bookings/cash-booking - Wrapper for agent cash booking (accessible from frontend)
router.post("/cash-booking", async (req, res) => {
  try {
    const { phoneNo, passengerName, emailId, bookingData } = req.body;

    if (!phoneNo || !passengerName || !bookingData) {
      return res
        .status(400)
        .json({ success: false, message: "Missing required fields" });
    }

    // Forward to agent routes logic (same validation)
    const agentResponse = await fetch(
      "http://127.0.0.1:5001/api/agents/book-seat-cash",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phoneNo, passengerName, emailId, bookingData }),
      },
    );

    const agentData = await agentResponse.json();

    if (agentResponse.ok && agentData.success) {
      res.json(agentData);
    } else {
      res.status(400).json(agentData);
    }
  } catch (error) {
    console.error("Cash booking wrapper error:", error);
    res
      .status(500)
      .json({ success: false, message: "Cash booking proxy failed" });
  }
});

module.exports = router;
