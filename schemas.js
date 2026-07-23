const mongoose = require("mongoose");

// Routes schema - defines bus routes with stops and pricing
const routeSchema = new mongoose.Schema(
  {
    routeId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    origin: String,
    destination: String,
    status: String,
    totalDistance: Number,

    stops: [
      {
        stopName: String,
        Km: Number,
        minute: Number,
        order: Number,
      },
    ],
    createdAt: Date,
    updatedAt: Date,
  },
  {
    collection: "routes",
    minimize: false,
  },
);

// Main Bus schema - updated to match new all_bus structure
const busSchema = new mongoose.Schema(
  {
    bus_number: String,
    bus_type: String,
    ac: Boolean,
    lower_deck: mongoose.Schema.Types.Mixed,
    upper_deck: mongoose.Schema.Types.Mixed,
    trip: [
      {
        route_id: String,
        from_time: String,
      },
    ],
    contactNO: String,
    price: {
      lowerDeck: String,
      upperDeck: String,
    },
  },
  {
    strict: false,
    collection: "all_bus",
    minimize: false,
  },
);

// Passengers schema - stores booking information with multiple passengers per booking
// Each document represents one booking that can have multiple passengers
const passengerSchema = new mongoose.Schema(
  {
    passengers: [
      {
        name: String,
        gender: {
          type: String,
          enum: ["male", "female", "other"],
        },
        seat_number: {
          lowerDeck: String,
          upperDeck: String,
        },
      },
    ],
    phoneNo: String,
    emailId: String,

    bus_number: String,
    BusContactNo: String,
    from_city: String,
    to_city: String,
    travel_date: String,
    departureTime: String,
    arrivalTime: String,
    arrival_date: String,
    minute: Number,
    total_sits: Number,
    totalPay: String,

    pnr: String,
    razorpay_order_id: String,
    razorpay_payment_id: String,
    payment_mode: {
      type: String,
      enum: ["online", "cash"],
      default: "cash",
    },
    Travel_status: String,
    cancel_request: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    collection: "passengers",
    minimize: false,
  },
);

// Agent schema
const agentSchema = new mongoose.Schema(
  {
    agentId: String,
    name: String,
    email: String,
    phone: String,
    whatsappNumber: String,
    gender: String,
    address: String,
    city: String,
    state: String,
    pincode: String,
    seatDiscount: Number,
    profilePhoto: String,
    aadharCard: String,
    panCard: String,
    status: {
      type: String,
      enum: ["active", "inactive"],
      default: "active",
    },
    booked: [
      {
        phoneNo: String,
        emailId: String,
        passengers: [
          {
            passengerName: String,
            gender: {
              type: String,
              enum: ["male", "female", "other"],
            },
            seat_number: {
              lowerDeck: String,
              upperDeck: String,
            },
          },
        ],
        bus_number: String,
        BusContactNo: String,
        from_city: String,
        to_city: String,
        travel_date: String,
        departureTime: String,
        arrivalTime: String,
        arrival_date: String,
        total_sits: Number,
        totalPay: String,
        pnr: String,
        payment_mode: String,
        Travel_status: String,
        cancel_request: {
          type: mongoose.Schema.Types.Mixed,
          default: null,
        },
        created_at: {
          type: Date,
          default: Date.now,
        },
      },
    ],
    createdAt: {
      type: Date,
      default: Date.now,
    },
    updatedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    collection: "agents",
    minimize: false,
  },
);

// Booking schema
const bookingSchema = new mongoose.Schema(
  {
    passengerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "passengers",
      required: true,
    },
    passengerName: String,
    phoneNo: String,
    bus_number: String,
    BusContactNo: String,
    from_city: String,
    to_city: String,
    travel_date: String,
    departureTime: String,
    arrivalTime: String,
    total_sits: Number,
    sits_numbers: {
      lowerDeck: [mongoose.Schema.Types.Mixed],
      upperDeck: [mongoose.Schema.Types.Mixed],
    },
    totalPay: String,
    booked_by: {
      type: String,
      enum: ["passenger", "agent"],
      default: "passenger",
    },
    payment_mode: {
      type: String,
      enum: ["online", "cash"],
      default: "cash",
    },
    razorpay_order_id: String,
    razorpay_payment_id: String,
    pnr: String,
    Travel_status: String,
    cancel_request: mongoose.Schema.Types.Mixed,
    createdAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    collection: "bookings",
    minimize: false,
  },
);

// Add compound index for efficient queries
bookingSchema.index({ bus_number: 1, travel_date: 1 });

const Booking = mongoose.model("Booking", bookingSchema);

const Bus = mongoose.model("all_bus", busSchema);
const Route = mongoose.model("routes", routeSchema);
const Passenger = mongoose.model("passengers", passengerSchema);
const Agent = mongoose.model("agents", agentSchema);

module.exports = { Bus, Route, Passenger, Booking, Agent };
