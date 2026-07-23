const express = require("express");
const router = express.Router();
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const crypto = require("crypto");
const twilio = require("twilio");
const Razorpay = require("razorpay");
const { Bus, Route, Passenger, Agent } = require("../schemas");

// Initialize Twilio client
const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN,
);
const verifyServiceSid = process.env.TWILIO_VERIFY_SERVICE_SID;

// Initialize Razorpay instance
const razorpayInstance = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// JWT Secret (should be in environment variables)
const JWT_SECRET =
  process.env.JWT_SECRET || "your-secret-key-change-in-production";

// Middleware to verify JWT token
const verifyToken = (req, res, next) => {
  const token = req.cookies.agentToken;

  if (!token) {
    return res.status(401).json({
      success: false,
      message: "No authentication token. Please login first.",
    });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.agentId = decoded.agentId;
    next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: "Invalid or expired token. Please login again.",
    });
  }
};

// Helper function to add minutes to a time string (format: "HH:MM AM/PM")
const addMinutesToTime = (timeStr, minutesToAdd) => {
  const [time, period] = timeStr.split(" ");
  let [hours, minutes] = time.split(":").map(Number);

  // Convert to 24-hour format
  if (period === "PM" && hours !== 12) hours += 12;
  if (period === "AM" && hours === 12) hours = 0;

  // Add minutes
  minutes += minutesToAdd;

  // Handle overflow
  if (minutes >= 60) {
    hours += Math.floor(minutes / 60);
    minutes = minutes % 60;
  }

  // Handle 24-hour overflow
  hours = hours % 24;

  // Convert back to 12-hour format
  let newPeriod = hours >= 12 ? "PM" : "AM";
  let newHours = hours % 12 || 12;

  return `${String(newHours).padStart(2, "0")}:${String(minutes).padStart(2, "0")} ${newPeriod}`;
};

// API: Send OTP via Twilio Verify for Agents
router.post("/send-otp", async (req, res) => {
  try {
    const { phoneNo } = req.body;

    // Validate phone number
    if (!phoneNo || typeof phoneNo !== "string") {
      return res.status(400).json({
        success: false,
        message: "Phone number is required.",
      });
    }

    if (phoneNo.length !== 10 || !/^\d{10}$/.test(phoneNo)) {
      return res.status(400).json({
        success: false,
        message: "Invalid phone number. Must be 10 digits.",
      });
    }

    // Format phone number with country code
    const formattedPhone = `+91${phoneNo}`;

    // Send OTP using Twilio Verify API
    const verification = await twilioClient.verify.v2
      .services(verifyServiceSid)
      .verifications.create({
        to: formattedPhone,
        channel: "sms",
      });

    if (verification.status === "pending") {
      return res.json({
        success: true,
        message: "OTP sent successfully to your phone",
        sessionId: phoneNo,
      });
    } else {
      return res.status(400).json({
        success: false,
        message: "Failed to send OTP. Please try again.",
      });
    }
  } catch (error) {
    console.error("Send OTP error:", error);
    res.status(500).json({
      success: false,
      message:
        "Error sending OTP. Please check your phone number and try again.",
    });
  }
});

// Agent OTP Verification Login - Verify OTP and authenticate
router.post("/verify-otp", async (req, res) => {
  try {
    const { phoneNo, otp } = req.body;

    // Validate phone number format
    if (!phoneNo || typeof phoneNo !== "string" || phoneNo.length !== 10) {
      return res.status(400).json({
        success: false,
        message: "Invalid phone number. Must be 10 digits.",
      });
    }

    // Validate OTP format (6 digits)
    if (
      !otp ||
      typeof otp !== "string" ||
      otp.length !== 6 ||
      !/^\d{6}$/.test(otp)
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid OTP format. Must be 6 digits.",
      });
    }

    // Format phone number with country code
    const formattedPhone = `+91${phoneNo}`;

    // Verify OTP using Twilio Verify API
    const verificationCheck = await twilioClient.verify.v2
      .services(verifyServiceSid)
      .verificationChecks.create({
        to: formattedPhone,
        code: otp,
      });

    if (verificationCheck.status === "approved") {
      // OTP verified - now check if agent exists with this phone number
      const agent = await Agent.findOne({ phone: phoneNo });

      if (!agent) {
        return res.status(401).json({
          success: false,
          message: "Agent not found. Please check your phone number.",
        });
      }

      if (agent.status !== "active") {
        return res.status(401).json({
          success: false,
          message: "Agent account is inactive. Please contact support.",
        });
      }

      // Generate JWT token (expires in 7 days)
      const token = jwt.sign(
        { agentId: agent._id, phone: agent.phone },
        JWT_SECRET,
        { expiresIn: "7d" },
      );

      // Set JWT in httpOnly cookie
      res.cookie("agentToken", token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite:process.env.NODE_ENV === "production"?"none":"lax",
        maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
        path: "/", // Ensure cookie is available for all paths
      });

      // Agent found and active - return agent details
      res.json({
        success: true,
        message: "OTP verified successfully and logged in",
        data: {
          agentId: agent._id,
          name: agent.name,
          phone: agent.phone,
          agentCode: agent.agentId,
          seatDiscount: agent.seatDiscount,
          city: agent.city,
        },
      });
    } else if (verificationCheck.status === "failed") {
      return res.status(400).json({
        success: false,
        message: "Invalid OTP. Please check and try again.",
      });
    } else {
      return res.status(400).json({
        success: false,
        message:
          "OTP verification failed or expired. Please request a new OTP.",
      });
    }
  } catch (error) {
    console.error("Agent OTP verification error:", error);
    res.status(500).json({
      success: false,
      message: "Error verifying OTP. Please try again.",
    });
  }
});

// Agent Profile Endpoint - Get agent data using JWT token
router.get("/profile", verifyToken, async (req, res) => {
  try {
    const agent = await Agent.findById(req.agentId);

    if (!agent) {
      return res.status(404).json({
        success: false,
        message: "Agent not found",
      });
    }

    res.json({
      success: true,
      data: {
        agentId: agent._id,
        name: agent.name,
        phone: agent.phone,
        agentCode: agent.agentId,
        seatDiscount: agent.seatDiscount,
        city: agent.city,
      },
    });
  } catch (error) {
    console.error("Profile fetch error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch profile",
      error: error.message,
    });
  }
});

// Check Login Status - Verify if agent has valid JWT cookie
router.get("/check-login", (req, res) => {
  const token = req.cookies.agentToken;

  if (!token) {
    return res.json({
      success: false,
      isLoggedIn: false,
      message: "No authentication token found",
    });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    res.json({
      success: true,
      isLoggedIn: true,
      agentId: decoded.agentId,
      message: "Agent is logged in",
    });
  } catch (error) {
    res.json({
      success: false,
      isLoggedIn: false,
      message: "Token is invalid or expired",
    });
  }
});

// Agent Logout Endpoint - Clear JWT token
router.post("/logout", (req, res) => {
  res.clearCookie("agentToken", {
    httpOnly: true,
    secure: false,
    sameSite: "lax",
    path: "/",
  });
  res.json({
    success: true,
    message: "Logged out successfully",
  });
});

// API 1: Search buses by fromCity, toCity, and journeyDate (Agent version)
router.post("/search-buses", async (req, res) => {
  try {
    const { fromCity, toCity, journeyDate } = req.body;

    if (!fromCity || !toCity || !journeyDate) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields: fromCity, toCity, journeyDate",
      });
    }

    // Helper function to check if a stop name matches the search term (case-insensitive)
    const isCityMatch = (stopName, searchTerm) => {
      return stopName.toLowerCase() === searchTerm.toLowerCase();
    };

    // Step A: Search inside routes collection
    const routes = await Route.find({});
    const validRouteIds = [];

    routes.forEach((route) => {
      const stops = route.stops || [];

      // Find indices of fromCity and toCity
      const fromIndex = stops.findIndex((stop) =>
        isCityMatch(stop.stopName, fromCity),
      );
      const toIndex = stops.findIndex((stop) =>
        isCityMatch(stop.stopName, toCity),
      );

      // Step B: Compare order - if fromCity order < toCity order, keep that routeId
      if (fromIndex !== -1 && toIndex !== -1 && fromIndex < toIndex) {
        validRouteIds.push({
          routeId: route.routeId,
          fromStop: stops[fromIndex],
          toStop: stops[toIndex],
          totalDistance: route.totalDistance, // Store the entire route's total distance
        });
      }
    });

    if (validRouteIds.length === 0) {
      return res.status(200).json({
        success: true,
        message: "No buses found for the given route",
        data: [],
      });
    }

    // Step C: Check buses and match with routes
    const buses = await Bus.find({ status: "active" });
    const matchedBuses = [];

    buses.forEach((bus) => {
      if (!bus.trip || !Array.isArray(bus.trip)) return;

      bus.trip.forEach((tripData) => {
        const matchedRoute = validRouteIds.find(
          (vr) => vr.routeId === tripData.route_id,
        );

        if (matchedRoute) {
          // Calculate dynamic distance
          const distance = matchedRoute.toStop.Km - matchedRoute.fromStop.Km;

          // Calculate proportional price based on distance
          // Bus prices are for the full route, so we need to calculate based on proportion
          const proportion = distance / matchedRoute.totalDistance;
          const lowerDeckPrice = Math.round(
            parseInt(bus.price?.lowerDeck || 0) * proportion,
          );
          const upperDeckPrice = Math.round(
            parseInt(bus.price?.upperDeck || 0) * proportion,
          );

          // Calculate departure and arrival times based on minute field in stops
          // from_time is departure time from first stop (minute: 0)
          // Departure time from fromCity = from_time + fromStop.minute
          // Arrival time at toCity = from_time + toStop.minute
          const departureTime = addMinutesToTime(
            tripData.from_time,
            matchedRoute.fromStop.minute,
          );
          const arrivalTime = addMinutesToTime(
            tripData.from_time,
            matchedRoute.toStop.minute,
          );

          // Fetch the complete route to get all stops
          const completeRoute = routes.find(
            (route) => route.routeId === tripData.route_id,
          );

          const busData = {
            id: bus._id,
            busNumber: bus.bus_number,
            contactNo: bus.contactNO,
            fromCity,
            toCity,
            departureTime: departureTime,
            arrivalTime: arrivalTime,
            travelDate: journeyDate,
            busType: bus.bus_type,
            ac: bus.ac,
            seatsAvailable: 33,
            lowerDeckLayout: bus.lower_deck?.layout || [],
            lowerLadies: (bus.lower_deck?.ladies || []).map(String),
            lowerSeatPrice: lowerDeckPrice,
            lowerDeckType: bus.lower_deck?.type || null,
            upperDeckLayout: bus.upper_deck?.layout || [],
            upperLadies: (bus.upper_deck?.ladies || []).map(String),
            upperSeatPrice: upperDeckPrice,
            upperDeckType: bus.upper_deck?.type || null,
            distance: `${distance} km`,
            routeId: tripData.route_id,
            // Add complete route information
            route: {
              routeId: tripData.route_id,
              allStops: completeRoute
                ? completeRoute.stops.map((stop) => ({
                    stopName: stop.stopName,
                    minute: stop.minute,
                    order: stop.order,
                  }))
                : [],
              startingStop: matchedRoute.fromStop.stopName,
              endingStop: matchedRoute.toStop.stopName,
              fromStopDetails: matchedRoute.fromStop,
              toStopDetails: matchedRoute.toStop,
              fromTime: tripData.from_time,
            },
          };
          matchedBuses.push(busData);
        }
      });
    });

    res.status(200).json({
      success: true,
      message: "Buses fetched successfully",
      data: matchedBuses,
    });
  } catch (error) {
    console.error("Error in search-buses:", error.message);
    res.status(500).json({
      success: false,
      message: "Error fetching buses",
      error: error.message,
    });
  }
});

// API 2: Get all stops (unique stop names from routes collection)
router.get("/stops", async (req, res) => {
  // Get my bookings by phoneNo (for agent customer view)
  router.get("/my-bookings", async (req, res) => {
    try {
      const { phoneNo } = req.query;
      const query = {};
      if (phoneNo) query.phoneNo = phoneNo;
      const passengers = await Passenger.find(query)
        .lean()
        .sort({ createdAt: -1 });
      res.json({ success: true, data: passengers });
    } catch (error) {
      console.error("My bookings error:", error);
      res.status(500).json({ success: false, message: error.message });
    }
  });
  try {
    // Fetch all documents from routes collection
    const routes = await Route.find({});

    // Extract all unique stop names from stops array
    const stopsSet = new Set();
    routes.forEach((route) => {
      if (route.stops && Array.isArray(route.stops)) {
        route.stops.forEach((stop) => {
          if (stop.stopName) {
            stopsSet.add(stop.stopName);
          }
        });
      }
    });

    const stops = Array.from(stopsSet).sort();
    res.status(200).json({
      success: true,
      message: "Stops fetched successfully",
      data: stops,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error fetching stops",
      error: error.message,
    });
  }
});

// Agent Book-Seat API - Create Razorpay order
router.post("/book-seat", verifyToken, async (req, res) => {
  try {
    const { phoneNo, passengers, totalAmount, bookingData } = req.body;

    console.log("📱 Agent Book-seat request:", {
      phoneNo: phoneNo?.slice(0, 4) + "...",
      passengerCount: passengers?.length,
      totalAmount,
      bookingData,
    });

    if (
      !phoneNo ||
      !passengers ||
      !Array.isArray(passengers) ||
      passengers.length === 0 ||
      !totalAmount ||
      !bookingData
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Missing required fields: phoneNo, passengers (array), totalAmount, bookingData",
      });
    }

    if (!Number.isInteger(totalAmount) || totalAmount <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid totalAmount (must be positive integer)",
      });
    }

    // Create Razorpay order
    console.log("🔄 Creating Razorpay order for agent...");
    const order = await razorpayInstance.orders.create({
      amount: totalAmount * 100, // paise
      currency: "INR",
      receipt: `agent_booking_${Date.now()}`,
    });

    console.log("✅ Razorpay order created:", order.id);

    res.json({
      success: true,
      key_id: process.env.RAZORPAY_KEY_ID,
      order_id: order.id,
      amount: totalAmount,
      booking_temp_id: order.receipt,
    });
  } catch (error) {
    console.error("❌ Razorpay order error:", {
      message: error.message,
      code: error.code,
      description: error.description,
      source: error.source,
      statusCode: error.statusCode,
      metadata: error.metadata,
    });
    res.status(500).json({
      success: false,
      message: error.message || "Razorpay order creation failed",
      errorCode: error.code,
      fullError:
        process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
});

// Agent Verify-Payment API - Verify & save booking
router.post("/verify-payment", verifyToken, async (req, res) => {
  try {
    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      phoneNo,
      passengers,
      emailId,
      bookingData,
      totalAmount,
    } = req.body;

    const agentId = req.agentId;

    // Normalize booking data keys
    const busNumber = bookingData.busNumber || bookingData.bus_number;
    const travel_date = bookingData.travel_date || bookingData.travelDate;
    const sits_numbers =
      bookingData.sits_numbers || bookingData.sitsNumbers || {};

    // Verify signature
    const sign = razorpay_order_id + "|" + razorpay_payment_id;
    const expectedSign = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(sign.toString())
      .digest("hex");

    if (expectedSign !== razorpay_signature) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid signature" });
    }

    // Validate seats not already booked
    const allSeats = [];
    if (sits_numbers.lowerDeck)
      allSeats.push(...sits_numbers.lowerDeck.map((s) => `L${String(s)}`));
    if (sits_numbers.upperDeck)
      allSeats.push(...sits_numbers.upperDeck.map((s) => `U${String(s)}`));

    const existingPassengers = await Passenger.find({
      bus_number: busNumber,
      travel_date,
      Travel_status: { $ne: "cancelled" },
    }).select("sits_numbers");

    const bookedSeats = [];
    existingPassengers.forEach((p) => {
      if (p.sits_numbers?.lowerDeck)
        bookedSeats.push(
          ...p.sits_numbers.lowerDeck.map((s) => `L${String(s)}`),
        );
      if (p.sits_numbers?.upperDeck)
        bookedSeats.push(
          ...p.sits_numbers.upperDeck.map((s) => `U${String(s)}`),
        );
    });

    const overlap = allSeats.filter((seat) => bookedSeats.includes(seat));
    if (overlap.length > 0) {
      return res.status(400).json({
        success: false,
        message: `Seats already booked: ${overlap.join(", ")}`,
      });
    }

    const timestamp = Date.now();
    const randomStr = Math.random().toString(36).substring(2, 7).toUpperCase();
    const pnr = `DTH${timestamp.toString().slice(-5)}${randomStr}`;

    // Store booking in agent's booked array with new passengers structure
    if (agentId) {
      const agent = await Agent.findById(agentId);

      if (agent) {
        // Build passengers array with individual seat assignments
        const passengersArray = passengers.map((passenger, index) => ({
          passengerName: passenger.name || passenger.passengerName || "",
          gender: passenger.gender || "other",
          seat_number: {
            ...(passenger.seatId?.startsWith("L") && {
              lowerDeck: passenger.seatId.substring(1),
            }),
            ...(passenger.seatId?.startsWith("U") && {
              upperDeck: passenger.seatId.substring(1),
            }),
          },
        }));

        const bookingRecord = {
          phoneNo,
          emailId: emailId || "",
          passengers: passengersArray,
          bus_number: busNumber,
          BusContactNo:
            bookingData.BusContactNo || bookingData.busContactNo || "",
          from_city: bookingData.from_city || bookingData.fromCity || "",
          to_city: bookingData.to_city || bookingData.toCity || "",
          travel_date: travel_date,
          departureTime:
            bookingData.departureTime || bookingData.departure_time || "",
          arrivalTime:
            bookingData.arrivalTime || bookingData.arrival_time || "",
          arrival_date: bookingData.arrival_date || "",
          total_sits: passengers.length,
          totalPay: totalAmount.toString(),
          pnr,
          payment_mode: "online",
          Travel_status: "success",
          cancel_request: null,
          created_at: new Date(),
        };

        if (!agent.booked) {
          agent.booked = [];
        }
        agent.booked.push(bookingRecord);
        await agent.save();
      }
    }

    // Emit real-time update
    const room = `bus-${busNumber}-${travel_date}`;
    console.log("Emitting seat-booked event to room:", room);
    global.io.to(room).emit("seat-booked", {
      busNumber,
      travelDate: travel_date,
      bookedSeats: allSeats,
    });

    res.json({
      success: true,
      message: "Payment verified & booking confirmed",
      data: { pnr },
    });
  } catch (error) {
    console.error("Payment verify error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Agent Cash Booking API
router.post("/book-seat-cash", verifyToken, async (req, res) => {
  try {
    const { phoneNo, passengers, emailId, bookingData } = req.body;

    if (
      !phoneNo ||
      !passengers ||
      !Array.isArray(passengers) ||
      passengers.length === 0 ||
      !bookingData
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Missing required fields: phoneNo, passengers (array), bookingData",
      });
    }

    const busNumber = bookingData.busNumber || bookingData.bus_number;
    const travel_date = bookingData.travel_date || bookingData.travelDate;
    const sits_numbers =
      bookingData.sits_numbers || bookingData.sitsNumbers || {};

    const allSeats = [];
    if (sits_numbers.lowerDeck)
      allSeats.push(...sits_numbers.lowerDeck.map((s) => `L${String(s)}`));
    if (sits_numbers.upperDeck)
      allSeats.push(...sits_numbers.upperDeck.map((s) => `U${String(s)}`));

    // Pre-check for existing passenger bookings
    const existingPassengers = await Passenger.find({
      bus_number: busNumber,
      travel_date,
      Travel_status: { $ne: "cancelled" },
    }).select("sits_numbers");

    const bookedSeats = [];
    existingPassengers.forEach((p) => {
      if (p.sits_numbers?.lowerDeck)
        bookedSeats.push(
          ...p.sits_numbers.lowerDeck.map((s) => `L${String(s)}`),
        );
      if (p.sits_numbers?.upperDeck)
        bookedSeats.push(
          ...p.sits_numbers.upperDeck.map((s) => `U${String(s)}`),
        );
    });

    const overlap = allSeats.filter((seat) => bookedSeats.includes(seat));
    if (overlap.length > 0) {
      return res.status(400).json({
        success: false,
        message: `Seats already booked: ${overlap.join(", ")}`,
      });
    }

    const timestamp = Date.now();
    const randomStr = Math.random().toString(36).substring(2, 7).toUpperCase();
    const pnr = `DTH${timestamp.toString().slice(-5)}${randomStr}`;

    // Get agent ID from JWT token
    const agentId = req.agentId;

    if (agentId) {
      const agent = await Agent.findById(agentId);

      if (agent) {
        // Build passengers array with individual seat assignments
        const passengersArray = passengers.map((passenger) => ({
          passengerName: passenger.name || passenger.passengerName || "",
          gender: passenger.gender || "other",
          seat_number: {
            ...(passenger.seatId?.startsWith("L") && {
              lowerDeck: passenger.seatId.substring(1),
            }),
            ...(passenger.seatId?.startsWith("U") && {
              upperDeck: passenger.seatId.substring(1),
            }),
          },
        }));

        const bookingRecord = {
          phoneNo,
          emailId: emailId || "",
          passengers: passengersArray,
          bus_number: busNumber,
          BusContactNo:
            bookingData.BusContactNo || bookingData.busContactNo || "",
          from_city: bookingData.from_city || bookingData.fromCity || "",
          to_city: bookingData.to_city || bookingData.toCity || "",
          travel_date: travel_date,
          departureTime:
            bookingData.departureTime || bookingData.departure_time || "",
          arrivalTime:
            bookingData.arrivalTime || bookingData.arrival_time || "",
          arrival_date: bookingData.arrival_date || "",
          total_sits: passengers.length,
          totalPay: bookingData.totalAmount || bookingData.total_amount || "0",
          pnr,
          payment_mode: "cash",
          Travel_status: "success",
          cancel_request: null,
          created_at: new Date(),
        };

        if (!agent.booked) {
          agent.booked = [];
        }
        agent.booked.push(bookingRecord);
        await agent.save();
      }
    }

    // Emit real-time update
    const room = `bus-${busNumber}-${travel_date}`;
    console.log("Emitting seat-booked event to room:", room);
    global.io.to(room).emit("seat-booked", {
      busNumber,
      travelDate: travel_date,
      bookedSeats: allSeats,
    });

    res.json({
      success: true,
      message: "Cash booking confirmed",
      data: { pnr },
    });
  } catch (error) {
    console.error("Agent booking error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// API: Get agent's bookings
router.get("/bookings", verifyToken, async (req, res) => {
  try {
    const agentId = req.agentId;

    // Find agent by ID and get the booked array (without lean to keep ObjectIds)
    const agent = await Agent.findById(agentId);

    if (!agent) {
      return res.status(404).json({
        success: false,
        message: "Agent not found",
      });
    }

    // Return the booked array with _id fields preserved
    res.json({
      success: true,
      data: agent.booked || [],
    });
  } catch (error) {
    console.error("Error fetching agent bookings:", error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// API: Update cancel_request status for a booking
router.put(
  "/bookings/:bookingId/cancel-request",
  verifyToken,
  async (req, res) => {
    try {
      const { bookingId } = req.params;
      const { cancel_request } = req.body;
      const agentId = req.agentId;

      if (!bookingId || !cancel_request) {
        return res.status(400).json({
          success: false,
          message: "Missing required fields: bookingId or cancel_request",
        });
      }

      // Validate ObjectId format
      if (!mongoose.Types.ObjectId.isValid(bookingId)) {
        return res.status(400).json({
          success: false,
          message: "Invalid booking ID format",
        });
      }

      // Find and update the booking in the agent's booked array
      const result = await Agent.findByIdAndUpdate(
        agentId,
        {
          $set: {
            "booked.$[elem].cancel_request": cancel_request,
          },
        },
        {
          arrayFilters: [
            { "elem._id": new mongoose.Types.ObjectId(bookingId) },
          ],
          returnDocument: "after",
        },
      );

      if (result) {
        return res.json({
          success: true,
          message: "Cancellation request updated successfully",
          data: result,
        });
      } else {
        return res.status(404).json({
          success: false,
          message: "Booking not found",
        });
      }
    } catch (error) {
      console.error("Update cancel request error:", error);
      res.status(500).json({
        success: false,
        message: "Error updating cancellation request",
      });
    }
  },
);

module.exports = router;
