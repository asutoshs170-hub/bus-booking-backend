const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const crypto = require("crypto");
const twilio = require("twilio");
const { Bus, Route, Passenger } = require("../schemas");

// Initialize Twilio client
const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN,
);
const verifyServiceSid = process.env.TWILIO_VERIFY_SERVICE_SID;

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

// API 1: Search buses by fromCity, toCity, and journeyDate
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

// API 3: Get all stops (unique stop names from routes collection)
router.get("/stops", async (req, res) => {
  // Get my bookings by phoneNo
  router.get("/my-bookings", async (req, res) => {
    try {
      const { phoneNo } = req.query;
      if (!phoneNo) {
        return res
          .status(400)
          .json({ success: false, message: "phoneNo required" });
      }
      const passengers = await Passenger.find({ phoneNo })
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

// Customer Razorpay Booking APIs
const Razorpay = require("razorpay");

// Validate Razorpay env vars (DISABLED crash - for testing)
if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
  console.error(
    "⚠️  RAZORPAY_KEY_ID or RAZORPAY_KEY_SECRET missing in .env - using fallback",
  );
} else {
  console.log("✅ Razorpay initialized OK");
}

console.log(
  "Razorpay key status:",
  process.env.RAZORPAY_KEY_ID ? "PRESENT" : "MISSING",
);

const razorpayInstance = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// 1. POST /book-seat - Create Razorpay order
router.post("/book-seat", async (req, res) => {
  try {
    const { passengers, phoneNo, totalAmount, bookingData } = req.body;

    console.log("📱 Book-seat request:", {
      phoneNo: phoneNo?.slice(0, 4) + "...",
      totalAmount,
      bookingData,
    });

    if (!passengers || !phoneNo || !totalAmount || !bookingData) {
      return res.status(400).json({
        success: false,
        message:
          "Missing required fields: passengers, phoneNo, totalAmount, bookingData",
      });
    }

    if (!Number.isInteger(totalAmount) || totalAmount <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid totalAmount (must be positive integer)",
      });
    }

    // Create Razorpay order
    console.log("🔄 Creating Razorpay order...");
    const order = await razorpayInstance.orders.create({
      amount: totalAmount * 100, // paise
      currency: "INR",
      receipt: `booking_${Date.now()}`,
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

// 2. POST /verify-payment - Verify & save booking
router.post("/verify-payment", async (req, res) => {
  try {
    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      phoneNo,
      emailId,
      bus_number,
      travel_date,
      passengers,
      departureTime,
      arrivalTime,
      arrival_date,
      from_city,
      to_city,
      BusContactNo,
      totalPay,
      total_sits,
    } = req.body;

    // Extract seat numbers from passengers array for backward compatibility
    const allSeats = passengers
      .map((p) => {
        if (p.seat_number?.lowerDeck) return `L${p.seat_number.lowerDeck}`;
        if (p.seat_number?.upperDeck) return `U${p.seat_number.upperDeck}`;
        return null;
      })
      .filter((s) => s !== null);

    // Validate seats not already booked
    const existingPassengers = await Passenger.find({
      bus_number: bus_number,
      travel_date: travel_date,
      Travel_status: { $ne: "cancelled" },
    }).select("passengers");

    const bookedSeats = [];
    existingPassengers.forEach((p) => {
      if (p.passengers && Array.isArray(p.passengers)) {
        p.passengers.forEach((passenger) => {
          if (passenger.seat_number?.lowerDeck)
            bookedSeats.push(`L${passenger.seat_number.lowerDeck}`);
          if (passenger.seat_number?.upperDeck)
            bookedSeats.push(`U${passenger.seat_number.upperDeck}`);
        });
      }
    });

    const overlap = allSeats.filter((seat) => bookedSeats.includes(seat));
    if (overlap.length > 0) {
      return res.status(400).json({
        success: false,
        message: `Seats already booked: ${overlap.join(", ")}`,
      });
    }

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

    const timestamp = Date.now();
    const randomStr = Math.random().toString(36).substring(2, 7).toUpperCase();
    const pnr = `DTH${timestamp.toString().slice(-5)}${randomStr}`;

    // Create new passenger document with new schema structure
    const newPassenger = new Passenger({
      passengers: passengers,
      phoneNo: phoneNo,
      emailId: emailId || "",
      bus_number: bus_number,
      BusContactNo: BusContactNo || "",
      from_city: from_city || "",
      to_city: to_city || "",
      travel_date: travel_date,
      departureTime: departureTime || "",
      arrivalTime: arrivalTime || "",
      arrival_date: arrival_date || "",
      totalPay: totalPay.toString(),
      payment_mode: "online",
      pnr: pnr,
      razorpay_order_id: razorpay_order_id,
      razorpay_payment_id: razorpay_payment_id,
      Travel_status: "success",
      cancel_request: null,
      total_sits: total_sits || passengers.length,
    });

    try {
      await newPassenger.save();
    } catch (err) {
      console.error("Passenger save error:", err);
      return res.status(409).json({
        success: false,
        message:
          "Booking failed due to a conflict. Please refresh and try again.",
      });
    }

    // Emit real-time update to all clients in the bus room
    const room = `bus-${bus_number}-${travel_date}`;
    console.log("Emitting seat-booked event to room:", room, "with data:", {
      busNumber: bus_number,
      travelDate: travel_date,
      bookedSeats: allSeats,
    });
    global.io.to(room).emit("seat-booked", {
      busNumber: bus_number,
      travelDate: travel_date,
      bookedSeats: allSeats,
    });

    res.json({
      success: true,
      message: "Payment verified & booking confirmed",
      data: { pnr, passengerId: newPassenger._id },
    });
  } catch (error) {
    console.error("Payment verify error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// 3. POST /book-seat-cash - Passenger cash booking
router.post("/book-seat-cash", async (req, res) => {
  try {
    const {
      passengers,
      phoneNo,
      emailId,
      bus_number,
      travel_date,
      BusContactNo,
      from_city,
      to_city,
      departureTime,
      arrivalTime,
      arrival_date,
      totalPay,
    } = req.body;

    console.log("📊 Cash booking request data:", {
      passengers: passengers?.length,
      phoneNo,
      emailId,
      bus_number,
      travel_date,
      BusContactNo,
      from_city,
      to_city,
      departureTime,
      arrivalTime,
      arrival_date,
      totalPay,
    });

    if (
      !passengers ||
      !Array.isArray(passengers) ||
      passengers.length === 0 ||
      !phoneNo ||
      !bus_number ||
      !travel_date
    ) {
      console.log("❌ Validation failed:", {
        passengers: !!passengers,
        isArray: Array.isArray(passengers),
        hasLength: passengers?.length > 0,
        phoneNo: !!phoneNo,
        bus_number: !!bus_number,
        travel_date: !!travel_date,
      });
      return res
        .status(400)
        .json({ success: false, message: "Missing required fields" });
    }

    const busNumber = bus_number;
    const travelDate = travel_date;

    // Extract seat numbers from passengers array
    const allSeats = [];
    passengers.forEach((passenger) => {
      if (passenger.seat_number?.lowerDeck) {
        allSeats.push(`L${passenger.seat_number.lowerDeck}`);
      }
      if (passenger.seat_number?.upperDeck) {
        allSeats.push(`U${passenger.seat_number.upperDeck}`);
      }
    });

    // Validate seats not already booked
    const existingPassengers = await Passenger.find({
      bus_number: busNumber,
      travel_date: travelDate,
      Travel_status: { $ne: "cancelled" },
    }).select("passengers");

    const bookedSeats = [];
    existingPassengers.forEach((p) => {
      if (p.passengers && Array.isArray(p.passengers)) {
        p.passengers.forEach((passenger) => {
          if (passenger.seat_number?.lowerDeck) {
            bookedSeats.push(`L${passenger.seat_number.lowerDeck}`);
          }
          if (passenger.seat_number?.upperDeck) {
            bookedSeats.push(`U${passenger.seat_number.upperDeck}`);
          }
        });
      }
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

    // Create new passenger document for cash booking
    const newPassenger = new Passenger({
      passengers,
      phoneNo,
      emailId: emailId || "",
      bus_number: busNumber,
      BusContactNo: BusContactNo || "",
      from_city: from_city || "",
      to_city: to_city || "",
      travel_date: travelDate,
      departureTime: departureTime || "",
      arrivalTime: arrivalTime || "",
      arrival_date: arrival_date || "",
      totalPay: totalPay || "0",
      payment_mode: "cash",
      pnr,
      Travel_status: "success",
      cancel_request: null,
      total_sits: passengers.length,
    });

    try {
      await newPassenger.save();
    } catch (err) {
      console.error("Passenger booking save error:", err);
      return res.status(409).json({
        success: false,
        message:
          "Booking failed due to a conflict. Please refresh and try again.",
      });
    }

    // Emit real-time update to all clients in the bus room
    const room = `bus-${busNumber}-${travelDate}`;
    console.log("Emitting seat-booked event to room:", room, "with data:", {
      busNumber,
      travelDate: travelDate,
      bookedSeats: allSeats,
    });
    global.io.to(room).emit("seat-booked", {
      busNumber,
      travelDate: travelDate,
      bookedSeats: allSeats,
    });

    res.json({
      success: true,
      message: "Cash booking confirmed",
      data: { pnr, passengerId: newPassenger._id },
    });
  } catch (error) {
    console.error("Passenger cash booking error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// API: Verify phone number exists
router.post("/verify-phone", async (req, res) => {
  try {
    const { phoneNo } = req.body;

    if (!phoneNo) {
      return res.status(400).json({
        success: false,
        message: "Phone number is required",
      });
    }

    // Check if phone number exists in passengers collection
    const passenger = await Passenger.findOne({ phoneNo });

    if (passenger) {
      // Set cookie for 7 days
      res.cookie("passengerPhone", phoneNo, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite:process.env.NODE_ENV === "production"?"none":"lax",
        maxAge: 7 * 24 * 60 * 60 * 1000,
      });
      return res.json({
        success: true,
        message: "Phone number verified",
      });
    } else {
      return res.status(404).json({
        success: false,
        message: "You have no bookings with this number.",
      });
    }
  } catch (error) {
    console.error("Phone verification error:", error);
    res.status(500).json({
      success: false,
      message: "Error verifying phone number",
    });
  }
});

// API: Logout (clear cookie)
router.post("/logout", (req, res) => {
  res.clearCookie("passengerPhone");
  res.json({
    success: true,
    message: "Logged out successfully",
  });
});

// API: Check authentication (check if passengerPhone cookie exists)
router.get("/check-auth", (req, res) => {
  const phoneNo = req.cookies.passengerPhone;

  if (phoneNo) {
    res.json({
      success: true,
      phoneNo: phoneNo,
      message: "User is authenticated",
    });
  } else {
    res.status(401).json({
      success: false,
      message: "User is not authenticated",
    });
  }
});

// API: Fetch all bookings for a phone number
router.get("/bookings/:phoneNo", async (req, res) => {
  try {
    const { phoneNo } = req.params;

    if (!phoneNo) {
      return res.status(400).json({
        success: false,
        message: "Phone number is required",
      });
    }

    // Find all bookings for this phone number
    const bookings = await Passenger.find({ phoneNo });

    if (bookings && bookings.length > 0) {
      // Transform bookings for frontend
      const transformedBookings = bookings.map((booking) => ({
        _id: booking._id,
        passengers: booking.passengers,
        phoneNo: booking.phoneNo,
        emailId: booking.emailId,
        pnr: booking.pnr,
        bus_number: booking.bus_number,
        BusContactNo: booking.BusContactNo,
        from_city: booking.from_city,
        to_city: booking.to_city,
        travel_date: booking.travel_date,
        arrival_date: booking.arrival_date,
        departureTime: booking.departureTime,
        arrivalTime: booking.arrivalTime,
        total_sits: booking.total_sits,
        sits_numbers: booking.sits_numbers,
        totalPay: booking.totalPay,
        Travel_status: booking.Travel_status,
        cancel_request: booking.cancel_request,
        payment_mode: booking.payment_mode,
        createdAt: booking.createdAt,
      }));

      return res.json({
        success: true,
        data: transformedBookings,
      });
    } else {
      return res.json({
        success: false,
        message: "No bookings found for this phone number",
        data: [],
      });
    }
  } catch (error) {
    console.error("Fetch bookings error:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching bookings",
    });
  }
});

// API: Update cancel_request status for a booking
router.put("/bookings/:bookingId/cancel-request", async (req, res) => {
  try {
    const { bookingId } = req.params;
    const { cancel_request } = req.body;

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

    // Find the booking by ID and update cancel_request
    const result = await Passenger.findOneAndUpdate(
      { _id: new mongoose.Types.ObjectId(bookingId) },
      { cancel_request: cancel_request },
      { returnDocument: "after" },
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
});

// API: Send OTP via Twilio Verify
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

// API: Verify OTP and authenticate user
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
      // OTP verified - now check if phone number exists in passengers collection
      const passenger = await Passenger.findOne({ phoneNo });

      if (!passenger) {
        return res.status(404).json({
          success: false,
          message: "You have no bookings with this number.",
        });
      }

      // Phone exists and OTP verified - set authentication cookie for 7 days
      res.cookie("passengerPhone", phoneNo, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
         sameSite:process.env.NODE_ENV === "production"?"none":"lax",
        maxAge: 7 * 24 * 60 * 60 * 1000,
      });

      return res.json({
        success: true,
        message: "OTP verified successfully and logged in",
        phoneNo: phoneNo,
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
    console.error("Verify OTP error:", error);
    res.status(500).json({
      success: false,
      message: "Error verifying OTP. Please try again.",
    });
  }
});

module.exports = router;
